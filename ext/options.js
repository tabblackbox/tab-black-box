import { validateImport, mergeSnapshots, visibleSnapshots, restoreResultText } from "./lib/core.js";
import { getSettings, getSnapshots, saveSnapshots } from "./lib/store.js";
const $ = (id) => document.getElementById(id);
// Always resolves: a missing/late worker response becomes an error object instead of a forever-pending await.
const send = (m, ms = m.type === "restore" ? 180000 : 15000) => Promise.race([
  chrome.runtime.sendMessage(m).then(r => r ?? { error: "No response from background." }, e => ({ error: String(e && e.message || e) })),
  new Promise(r => setTimeout(() => r({ error: "Background did not respond in time." }), ms)),
]);
const LABEL = { removal: "tab or window closed", mass_close: "mass close", alarm: "scheduled", manual: "manual" };

function el(tag, attrs = {}, ...kids) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e[k] = v; else e.setAttribute(k, v); } for (const c of kids) e.append(c); return e; }

// No alert()/confirm()/prompt() anywhere in extension pages: a modal dialog blocks the
// main thread of the shared extension renderer process, so every other options/popup
// page of this extension then hangs without rendering (see tests/no-modal-dialogs.test.js).
function note(text) { const m = $("restmsg"); m.textContent = text; m.hidden = !text; }
let armed = null;
async function restore(id, opts, btn) {
  if (armed !== btn) { // two-step inline confirmation instead of confirm()
    if (armed) armed.textContent = armed.dataset.label; armed = btn;
    btn.dataset.label = btn.textContent; btn.textContent = "Click again to restore into new windows";
    note("Existing tabs stay open. Logins, cookies, form contents and page state are not restored.");
    setTimeout(() => { if (armed === btn) { btn.textContent = btn.dataset.label; armed = null; } }, 6000); return;
  }
  btn.textContent = btn.dataset.label; armed = null; btn.disabled = true; note("Restoring...");
  try { const r = await send({ type: "restore", id, opts }); note(restoreResultText(r)); } finally { btn.disabled = false; }
}

async function render() {
  if (rendering) { renderAgain = true; return; } rendering = true;
  try { await render0(); } finally { rendering = false; if (renderAgain) { renderAgain = false; render(); } }
}
let rendering = false, renderAgain = false;
async function render0() {
  const st = await send({ type: "status" }); const paid = !!(st.license && st.license.paid);
  $("upgrade").hidden = paid; $("manage").hidden = !paid; $("login").hidden = paid;
  if (st.error) $("tier").textContent = "Status unavailable: " + st.error;
  else $("tier").textContent = paid ? "Paid subscription active: unlimited history." + (st.license.reason === "offline_grace" ? " (Could not reach ExtensionPay; using your last known status.)" : "") : "Free tier: showing the last 30 days (mass close snapshots are kept for at least 7 days)." + (st.license && st.license.reason === "grace_expired" ? " Your subscription could not be verified for 30 days; older history is kept and still exported, but hidden here." : st.license && st.license.reason === "not_paid_anymore" ? " Your subscription has ended; older history is kept and still exported, but hidden here." : "");
  const q = $("q").value.toLowerCase();
  const list = visibleSnapshots(await getSnapshots(), Date.now(), paid).slice().reverse();
  const root = $("list"); root.replaceChildren();
  for (const s of list) {
    const tabs = q ? s.tabs.filter(t => (t.title + " " + t.url).toLowerCase().includes(q)) : s.tabs;
    if (q && !tabs.length) continue;
    const box = el("div", { class: "snap" + (s.trigger === "mass_close" ? " mass" : "") },
      el("b", {}, new Date(s.ts).toLocaleString()), el("span", { class: "badge" }, LABEL[s.trigger] || s.trigger),
      ` ${s.windows.length} windows, ${s.tabCount} tabs` + (s.lastSeen > s.ts ? `, unchanged until ${new Date(s.lastSeen).toLocaleString()}` : ""), " ",
      el("button", { onclick: (e) => restore(s.id, {}, e.currentTarget) }, "Restore all"), el("button", { onclick: () => d.toggleAttribute("hidden") }, "Details"));
    const d = el("div", { hidden: "" });
    for (const w of s.windows) {
      const wt = tabs.filter(t => t.windowId === w.id); if (!wt.length) continue;
      d.append(el("div", { class: "win" }, `Window (${wt.length} tabs) `, el("button", { onclick: (e) => restore(s.id, { windowId: w.id }, e.currentTarget) }, "Restore window")));
      const shown = new Set();
      for (const t of wt) {
        if (t.groupId !== -1 && !shown.has(t.groupId)) { shown.add(t.groupId); const g = s.groups.find(x => x.id === t.groupId) || {}; d.append(el("div", { class: "grp" }, `Group: ${g.title || "(unnamed)"} [${g.color || ""}${g.collapsed ? ", collapsed" : ""}] `, el("button", { onclick: (e) => restore(s.id, { windowId: w.id, groupId: t.groupId }, e.currentTarget) }, "Restore group"))); }
        d.append(el("div", { class: "tab", title: t.url }, (t.pinned ? "[pinned] " : "") + (t.title || t.url)));
      }
    }
    box.append(d); root.append(box);
  }
  if (!root.children.length) root.append(el("p", { class: "small" }, "No snapshots yet."));
}

$("q").oninput = render;
$("snap").onclick = async () => { await send({ type: "snapshotNow" }); render(); };
$("export").onclick = async () => { const r = await send({ type: "exportNow", timestamped: $("stamped").checked }); $("expmsg").textContent = r.ok ? "Backup saved to Downloads/TabBlackBox/tab-backup.json" : "Export failed: " + (r.error || r.skipped); };
$("file").onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  let obj; try { obj = JSON.parse(await f.text()); } catch { $("impmsg").textContent = "Import rejected: the file is not valid JSON. Your history was not changed."; return; }
  const err = validateImport(obj); if (err) { $("impmsg").textContent = "Import rejected: " + err + " Your history was not changed."; return; }
  const { snapshots, added } = mergeSnapshots(await getSnapshots(), obj.snapshots);
  await saveSnapshots(snapshots); $("impmsg").textContent = `Imported ${added} new snapshots.`; render();
};
(async () => { const s = await getSettings(); $("mins").value = s.alarmMinutes; $("expOn").checked = s.exportEnabled; })();
$("save").onclick = async () => { const m = Math.min(60, Math.max(5, parseInt($("mins").value, 10) || 15)); await chrome.storage.local.set({ settings: { alarmMinutes: m, exportEnabled: $("expOn").checked } }); await send({ type: "settingsChanged" }); $("savemsg").textContent = "Saved."; };
const pay = (type) => async () => { $("licmsg").textContent = "Opening ExtensionPay..."; const r = await send({ type }); $("licmsg").textContent = r.error ? "Could not open ExtensionPay: " + r.error : ""; };
$("upgrade").onclick = pay("upgrade"); $("manage").onclick = pay("manageSubscription"); $("login").onclick = pay("login");
$("recheck").onclick = async () => { $("licmsg").textContent = "Checking..."; const r = await send({ type: "refreshPaid" }); $("licmsg").textContent = r.error ? r.error : r.license && r.license.paid ? "Paid subscription active." : "No active subscription found."; render(); };
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.paidCache) render(); });
render();
