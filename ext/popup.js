const fmt = (ts) => ts ? new Date(ts).toLocaleString() : "none yet";
const $ = (id) => document.getElementById(id);
// Always resolves: a missing/late worker response becomes an error object instead of a forever-pending await.
const send = (m, ms = 15000) => Promise.race([
  chrome.runtime.sendMessage(m).then(r => r ?? { error: "No response from background." }, e => ({ error: String(e && e.message || e) })),
  new Promise(r => setTimeout(() => r({ error: "Background did not respond in time." }), ms)),
]);
let refreshing = false;
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    const s = await send({ type: "status" }) || {};
    if (s.error) { $("last").textContent = "unavailable"; $("exp").textContent = "unavailable"; $("msg").textContent = s.error; return; }
    const paid = !!(s.license && s.license.paid);
    $("tier").textContent = paid ? "Paid: unlimited history." : "Free: 30 days of history.";
    $("upgrade").hidden = paid; $("login").hidden = paid; $("manage").hidden = !paid;
    $("last").textContent = fmt(s.lastSnapshotTs);
    const e = s.exportState;
    $("exp").textContent = !e ? "none yet" : e.ok === false ? "failed: " + (e.error || "unknown error") : fmt(e.ts);
  } finally { refreshing = false; }
}
$("snap").onclick = async () => { const r = await send({ type: "snapshotNow" }); $("msg").textContent = r.error ? "Snapshot failed: " + r.error : r.added ? "Snapshot saved." : "No change since the last snapshot."; refresh(); };
$("export").onclick = async () => { const r = await send({ type: "exportNow" }); $("msg").textContent = r.ok ? "Exported to Downloads/TabBlackBox/tab-backup.json" : "Export: " + (r.error || r.skipped || "failed"); refresh(); };
for (const [id, type] of [["upgrade", "upgrade"], ["manage", "manageSubscription"], ["login", "login"]]) $(id).onclick = async () => { const r = await send({ type }); $("msg").textContent = r.error ? "Could not open ExtensionPay: " + r.error : ""; };
refresh();
