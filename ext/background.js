import { buildState, makeSnapshot, addSnapshot, MassCloseDetector, makeDebouncer, shouldExport, historyHash, buildExport, visibleSnapshots, hashState, RestoreGuard, singleFlight, isKnownMessage } from "./lib/core.js";
import { DEFAULTS, EXPORT_FILENAME, EXTPAY_ID } from "./lib/config.js";
import ExtPay from "./lib/ExtPay.esm.js";
import { createPaidService } from "./lib/paid.js";
import { getSettings, getSnapshots, saveSnapshots, isPaid, everPaid } from "./lib/store.js";
import { restoreSnapshot } from "./lib/restore.js";

const VERSION = chrome.runtime.getManifest().version;

// ---- Payments (ExtensionPay) ----
const extpay = ExtPay(EXTPAY_ID);
extpay.startBackground();
const paidSvc = createPaidService({ extpay, storage: chrome.storage.local });
const refreshPaid = () => paidSvc.refresh().catch(console.error);
extpay.onPaid.addListener(() => { refreshPaid(); });
let lastKnown = null;      // state before most recent change
let pendingPre = null;     // frozen pre-removal state awaiting write
let pendingTrigger = null;
let detector = new MassCloseDetector(DEFAULTS.massCloseN, DEFAULTS.massCloseWindowMs);
const restoreGuard = new RestoreGuard(120000);

async function captureNow() {
  const [windows, tabs, groups] = await Promise.all([
    chrome.windows.getAll({ windowTypes: ["normal", "popup"] }), chrome.tabs.query({}), chrome.tabGroups.query({}),
  ]);
  return buildState(windows, tabs, groups);
}
async function refreshLastKnown() {
  if (pendingPre || restoreGuard.active()) return; // do not overwrite pre-close state mid-burst
  lastKnown = await captureNow();
  await chrome.storage.session.set({ lastKnown });
}
const debouncedRefresh0 = makeDebouncer(() => refreshLastKnown().catch(console.error), 500);
const debouncedRefresh = () => { if (!restoreGuard.active()) debouncedRefresh0(); };

// Serialize writes
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn).catch(console.error));

async function writeSnapshot(state, trigger) {
  const now = Date.now();
  const snap = makeSnapshot(state, trigger, VERSION, now);
  const { snapshots, added } = addSnapshot(await getSnapshots(), snap);
  await saveSnapshots(snapshots, now);
  await chrome.storage.local.set({ lastSnapshotTs: now });
  if (trigger === "mass_close" && added) await maybeExport({ afterMassClose: true });
  return added;
}

const flushRemoval = makeDebouncer(() => serial(async () => {
  const state = pendingPre, trig = pendingTrigger;
  pendingPre = null; pendingTrigger = null;
  if (state) await writeSnapshot(state, trig);
  await refreshLastKnown();
}), DEFAULTS.debounceMs);

async function ensureLastKnown() {
  if (lastKnown) return;
  const s = await chrome.storage.session.get("lastKnown");
  lastKnown = s.lastKnown || null;
}
function onRemoval(isTab) {
  if (restoreGuard.active()) return Promise.resolve(); // events caused by our own restore
  const now = Date.now();
  const p = ensureLastKnown().then(() => {
    if (!pendingPre && lastKnown) { pendingPre = lastKnown; pendingTrigger = "removal"; }
    if (isTab && detector.record(now)) pendingTrigger = "mass_close";
    flushRemoval();
  });
  return p;
}

chrome.tabs.onRemoved.addListener(() => { onRemoval(true); });
chrome.windows.onRemoved.addListener(() => { onRemoval(false); });
chrome.tabGroups.onRemoved.addListener(() => { onRemoval(false); });
chrome.tabGroups.onUpdated.addListener(() => debouncedRefresh());
for (const ev of ["onCreated", "onUpdated", "onMoved", "onAttached", "onDetached"]) chrome.tabs[ev].addListener(() => debouncedRefresh());
chrome.tabGroups.onCreated.addListener(() => debouncedRefresh());

async function setupAlarms() {
  const s = await getSettings();
  const mins = Math.min(60, Math.max(5, Number(s.alarmMinutes) || 15));
  await chrome.alarms.create("snapshot", { periodInMinutes: mins });
  await chrome.alarms.create("export", { periodInMinutes: 60 });
  await chrome.alarms.clear("license");
  await chrome.alarms.create("paid", { periodInMinutes: 24 * 60 });
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "snapshot") { if (restoreGuard.active()) return; serial(async () => { await writeSnapshot(await captureNow(), "alarm"); await refreshLastKnown(); }); }
  else if (a.name === "export") serial(() => maybeExport({}));
  else if (a.name === "paid") refreshPaid();
});

async function startup() { refreshPaid(); await chrome.storage.local.remove(["license", "everLicensed"]); await setupAlarms(); await refreshLastKnown(); }
chrome.runtime.onStartup.addListener(() => startup());
chrome.runtime.onInstalled.addListener(() => startup());
ensureLastKnown().then(() => { if (!lastKnown) refreshLastKnown(); });

// ---- Export ----
const maybeExport = singleFlight(maybeExport0); // never run two downloads concurrently
async function maybeExport0({ force = false, afterMassClose = false, timestamped = false }) {
  const s = await getSettings();
  if (!s.exportEnabled && !force) return { skipped: "disabled" };
  const now = Date.now();
  const all = await getSnapshots();
  const cur = historyHash(all);
  const { exportState = {} } = await chrome.storage.local.get("exportState");
  const ok = shouldExport({ now, lastExportTs: exportState.ts, lastExportHash: exportState.hash, currentHash: cur, force: force || (afterMassClose && cur !== exportState.hash) });
  if (!ok) return { skipped: "unchanged_or_too_soon" };
  // Export: free gets 30 days (plus pinned); paid or lapsed-paid gets everything stored (never hidden from export).
  const paid = await isPaid(now);
  const list = paid || await everPaid() ? all : visibleSnapshots(all, now, false);
  const json = JSON.stringify(buildExport(list, VERSION, now));
  const url = "data:application/json;base64," + b64(json);
  try {
    await chrome.downloads.download({ url, filename: EXPORT_FILENAME, conflictAction: "overwrite", saveAs: false });
    if (timestamped) {
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      await chrome.downloads.download({ url, filename: `TabBlackBox/tab-backup-${stamp}.json`, conflictAction: "uniquify", saveAs: false });
    }
    await chrome.storage.local.set({ exportState: { ts: now, hash: cur, ok: true, error: null } });
    return { ok: true };
  } catch (e) {
    await chrome.storage.local.set({ exportState: { ...exportState, ok: false, error: String(e && e.message || e), lastTry: now } });
    return { ok: false, error: String(e) };
  }
}
function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

async function runRestore(snap, opts) {
  const token = restoreGuard.begin();
  if (token == null) return { error: "A restore is already in progress. Please wait for it to finish." };
  try { return await restoreSnapshot(snap, opts); }
  finally {
    restoreGuard.end(token);
    // After the tail, drop any partial burst state and re-baseline from the restored tabs.
    setTimeout(() => { if (!restoreGuard.active()) { detector = new MassCloseDetector(DEFAULTS.massCloseN, DEFAULTS.massCloseWindowMs); refreshLastKnown().catch(console.error); } }, 3100);
  }
}

// ---- Messages from UI ----
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (typeof msg === "string" && msg.startsWith("extpay-")) return false; // handled by ExtPay's own listener
  if (!isKnownMessage(msg)) { reply({ error: "Unknown message" }); return false; }
  (async () => {
    switch (msg.type) {
      case "snapshotNow": return serial(async () => ({ added: await writeSnapshot(await captureNow(), "manual") }));
      case "exportNow": return serial(() => maybeExport({ force: true, timestamped: !!msg.timestamped }));
      case "restore": { const all = await getSnapshots(); const s = all.find(x => x.id === msg.id); if (!s) return { error: "Snapshot not found" }; return runRestore(s, msg.opts || {}); }
      case "settingsChanged": await setupAlarms(); return { ok: true };
      case "upgrade": await paidSvc.upgrade(); return { ok: true };
      case "manageSubscription": await paidSvc.manage(); return { ok: true };
      case "login": await paidSvc.login(); return { ok: true };
      case "refreshPaid": await paidSvc.refresh(); return { ok: true, license: await paidSvc.status() };
      case "status": {
        const st = await chrome.storage.local.get(["lastSnapshotTs", "exportState"]);
        return { ...st, license: await paidSvc.status() };
      }
    }
    return { error: "Unhandled" };
  })().then((r) => reply(r ?? { error: "No result" }), (e) => reply({ error: String(e) }));
  return true;
});
void hashState;
