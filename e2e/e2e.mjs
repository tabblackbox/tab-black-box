// Repeatable e2e check in an isolated throwaway Chrome profile.
import puppeteer from "puppeteer-core";
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const EXT = path.resolve(import.meta.dirname, "../ext");
const exe = process.env.CHROME || path.join(import.meta.dirname, ".cache/chrome/linux-155.0.8059.84/chrome-linux64/chrome");
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "tbb-e2e-")); const dl = path.join(udd, "dl"); fs.mkdirSync(dl);
const srv = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(`<title>p${q.url}</title><h1>${q.url}</h1>`); }).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const log = []; const fail = []; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: exe, headless: "new", userDataDir: udd, pipe: true,
  args: [`--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "--no-first-run", "--no-default-browser-check", "--disable-features=DisableLoadExtensionCommandLineSwitch", "--no-sandbox", "--host-resolver-rules=MAP extensionpay.com ~NOTFOUND"] });
try {
  const swT = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 15000 });
  const id = new URL(swT.url()).host; const sw = await swT.worker();
  sw.on("console", m => log.push(`[sw ${m.type()}] ${m.text()}`));
  const swCdp = await swT.createCDPSession(); await swCdp.send("Runtime.enable"); await swCdp.send("Profiler.enable").catch(()=>{});
  swCdp.on("Runtime.exceptionThrown", e => log.push("[sw exception] " + JSON.stringify(e.exceptionDetails.exception?.description || e.exceptionDetails.text)));
  const opts = `chrome-extension://${id}/options.html`;
  // Stub ExtensionPay: intercept every extensionpay.com request at the browser level (incl. the worker).
  // The resolver rule above guarantees nothing can reach the real service even if interception missed.
  const epReqs = []; const ep = { paid: false };
  const stub = async (cdp) => { await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://extensionpay.com/*" }] }); cdp.on("Fetch.requestPaused", (e) => onPaused(cdp, e)); };
  const onPaused = async (bcdp, e) => {
    const u = new URL(e.request.url); epReqs.push(e.request.method + " " + u.pathname + u.search);
    let body = "<title>stub</title>stub", ct = "text/html";
    if (u.pathname.endsWith("/api/new-key")) { body = JSON.stringify("testkey"); ct = "application/json"; }
    else if (u.pathname.endsWith("/api/v2/user")) { body = JSON.stringify({ paid: ep.paid, paidAt: ep.paid ? "2026-10-20T10:00:00.000Z" : null, installedAt: "2026-10-01T00:00:00.000Z", trialStartedAt: null }); ct = "application/json"; }
    await bcdp.send("Fetch.fulfillRequest", { requestId: e.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: ct }, { name: "Access-Control-Allow-Origin", value: "*" }], body: Buffer.from(body).toString("base64") }).catch(() => {});
  };
  await stub(swCdp); // worker fetches (new-key, user)
  browser.on("targetcreated", async (t) => { if (t.type() === "page") { const c = await t.createCDPSession().catch(() => null); if (c) await stub(c).catch(() => {}); } });
  // UI page that the user keeps open while restoring (like real use).
  const ui = await browser.newPage(); await ui.goto(opts); await ui.waitForSelector("#list");
  const dialogs = [];
  ui.on("dialog", async d => { dialogs.push(d.type() + ": " + d.message().slice(0, 60)); if (d.type() === "confirm") await d.accept(); else if (process.env.DISMISS) await d.accept(); /* else alerts left open like an unattended user */ });
  await sw.evaluate(async (base) => {
    const w = await chrome.windows.create({ url: "about:blank" });
    const ids = []; for (let i = 0; i < 6; i++) ids.push((await chrome.tabs.create({ windowId: w.id, url: `${base}/t${i}` })).id);
    const g = await chrome.tabs.group({ tabIds: ids.slice(0, 2), createProperties: { windowId: w.id } });
    await chrome.tabGroups.update(g, { title: "G", color: "blue" });
  }, base);
  await sleep(2500);
  await sw.evaluate(async (base) => { const ts = await chrome.tabs.query({ url: base + "/t*" }); await chrome.tabs.remove(ts.slice(0, 5).map(t => t.id)); }, base);
  await sleep(4500);
  await ui.reload(); await ui.waitForSelector("#list .snap.mass", { timeout: 10000 });
  const t0 = Date.now();
  await ui.evaluate(() => [...document.querySelectorAll("#list .snap.mass button")].find(b => b.textContent === "Restore all").click());
  await ui.evaluate(() => [...document.querySelectorAll("#list .snap.mass button")].find(b => b.textContent.startsWith("Click again")).click()).catch(() => log.push("[e2e] no inline confirm (legacy UI)"));
  await sleep(6000);
  // Measure: fresh options page load, and the popup page.
  const measure = async (url) => { const p = await browser.newPage(); const s = Date.now();
    const ok = await Promise.race([p.goto(url, { waitUntil: "domcontentloaded" }).then(() => true, () => false), sleep(10000).then(() => false)]);
    const ms = Date.now() - s; p.close().catch(()=>{}); return { ok, ms }; };
  const optLoad = await measure(opts), popLoad = await measure(`chrome-extension://${id}/popup.html`);
  const stats = await Promise.race([sw.evaluate(async (base) => {
    const all = await chrome.storage.local.get(null); const snaps = all.snapshots || [];
    const dls = await chrome.downloads.search({});
    const restored = await chrome.tabs.query({ url: base + "/t*" }); const groups = await chrome.tabGroups.query({});
    return { bytes: await chrome.storage.local.getBytesInUse(null), snapshots: snaps.length, triggers: snaps.map(s => s.trigger), downloads: dls.length, dlNames: dls.map(d => d.filename.split("/").pop()), restoredTabs: restored.length, groups: groups.map(g => g.title) };
  }, base), sleep(10000).then(() => ({ error: "worker timeout" }))]);
  const m = await swCdp.send("Runtime.evaluate", { expression: "1" }).then(() => "responsive", () => "unresponsive");
  const restMsg = await Promise.race([ui.evaluate(() => document.getElementById("restmsg")?.textContent || ""), sleep(3000).then(() => "(options page frozen)")]);
  const r = { restMsg, restoreClickToMeasureMs: Date.now() - t0, dialogs, optLoad, popLoad, worker: m, ...stats };
  console.log(JSON.stringify(r, null, 1)); console.log(log.join("\n"));
  if (!optLoad.ok || optLoad.ms > 3000) fail.push("options.html did not render in 3s");
  if (!popLoad.ok || popLoad.ms > 3000) fail.push("popup.html did not render in 3s");
  if (!/^Opened \d+ tabs/.test(restMsg)) fail.push("no inline restore result: " + restMsg);
  if (r.restoredTabs < 6) fail.push("restore incomplete");
  if (!(r.groups || []).includes("G")) fail.push("group not restored");
  if (r.downloads > 1) fail.push("more than 1 export download");
  if (dialogs.some(d => d.startsWith("alert") || d.startsWith("confirm"))) fail.push("blocking modal dialog used: " + dialogs.join(" | "));
  // ---- ExtensionPay flow (stubbed) ----
  const page = await browser.newPage(); await page.goto(opts); await page.waitForSelector("#upgrade");
  const ui0 = await page.evaluate(() => ({ key: !!document.getElementById("key"), up: !document.getElementById("upgrade").hidden, login: !document.getElementById("login").hidden, manage: !document.getElementById("manage").hidden }));
  if (ui0.key) fail.push("license key field still present"); if (!ui0.up || !ui0.login || ui0.manage) fail.push("unpaid buttons wrong: " + JSON.stringify(ui0));
  page.on("dialog", d => { fail.push("modal dialog: " + d.message()); d.dismiss(); });
  const tabUrl = (re) => browser.waitForTarget(t => re.test(t.url()), { timeout: 8000 }).then(t => t.url(), () => null);
  await page.click("#upgrade"); const payUrl = await tabUrl(/extensionpay\.com\/extension\/tab-black-box\/choose-plan\/yearly\?api_key=testkey/);
  if (!payUrl) fail.push("Upgrade did not open choose-plan/yearly");
  await page.bringToFront(); await page.click("#login"); const loginUrl = await tabUrl(/extensionpay\.com\/extension\/tab-black-box\/reactivate\?api_key=testkey/);
  if (!loginUrl) fail.push("Log in did not open reactivate page");
  ep.paid = true; await page.bringToFront(); await page.click("#recheck");
  await page.waitForFunction(() => /Paid subscription active/.test(document.getElementById("tier").textContent), { timeout: 8000 }).catch(() => fail.push("paid status not shown after getUser paid=true"));
  const ui1 = await page.evaluate(() => ({ up: !document.getElementById("upgrade").hidden, manage: !document.getElementById("manage").hidden, msg: document.getElementById("licmsg").textContent }));
  if (ui1.up || !ui1.manage) fail.push("paid buttons wrong: " + JSON.stringify(ui1));
  const cache = await sw.evaluate(async () => (await chrome.storage.local.get("paidCache")).paidCache);
  if (!cache || !cache.paid) fail.push("paidCache not stored");
  console.log(log.slice(-10).join("\n")); console.log(JSON.stringify({ extpay: { ui0, payUrl, loginUrl, ui1, cache, requests: epReqs } }, null, 1));
} finally { await browser.close().catch(()=>{}); srv.close(); fs.rmSync(udd, { recursive: true, force: true }); }
if (fail.length) { console.error("E2E FAIL:\n- " + fail.join("\n- ")); process.exit(1); } else console.log("E2E PASS");
