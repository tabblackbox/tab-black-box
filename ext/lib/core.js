// Pure logic, no chrome.* calls. Unit tested in node.
import { DEFAULTS, SCHEMA_VERSION } from "./config.js";
const DAY = 24 * 3600 * 1000;

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

// Build a snapshot state from raw chrome window/tab/group objects. Skips incognito.
export function buildState(windows, tabs, groups) {
  const ws = windows.filter(w => !w.incognito && (w.type === "normal" || w.type === undefined || w.type === "popup"));
  const wIds = new Set(ws.map(w => w.id));
  return {
    windows: ws.map((w, order) => ({ id: w.id, type: w.type || "normal", state: w.state || "normal", focused: !!w.focused, order })),
    tabs: tabs.filter(t => !t.incognito && wIds.has(t.windowId))
      .map(t => ({ url: t.url || t.pendingUrl || "", title: t.title || "", pinned: !!t.pinned, index: t.index, windowId: t.windowId, groupId: t.groupId ?? -1, favIconUrl: typeof t.favIconUrl === "string" ? t.favIconUrl : undefined }))
      .sort((a, b) => a.windowId - b.windowId || a.index - b.index),
    groups: groups.filter(g => wIds.has(g.windowId)).map(g => ({ id: g.id, title: g.title || "", color: g.color, collapsed: !!g.collapsed, windowId: g.windowId })),
  };
}

// Normalized hash: URLs, titles, groups, pinned, order. Ignores ids, focus, favicons.
export function hashState(state) {
  const wOrder = new Map(state.windows.map((w, i) => [w.id, i]));
  const gKey = new Map(state.groups.map(g => [g.id, `${g.title}|${g.color}|${g.collapsed ? 1 : 0}`]));
  const norm = state.windows.map(w => ({
    s: w.state,
    t: state.tabs.filter(t => t.windowId === w.id).sort((a, b) => a.index - b.index)
      .map(t => [t.url, t.title, t.pinned ? 1 : 0, t.groupId === -1 ? "" : (gKey.get(t.groupId) || "?")]),
  }));
  void wOrder;
  return fnv1a(JSON.stringify(norm));
}

export function makeSnapshot(state, trigger, version, now) {
  const hash = hashState(state);
  return { id: `${now}-${hash}`, ts: now, lastSeen: now, trigger, version, hash,
    pinnedUntil: trigger === "mass_close" ? now + DEFAULTS.massClosePinDays * DAY : 0,
    tabCount: state.tabs.length, ...state };
}

// Insert with dedupe against the most recent snapshot. Mass close is exempt from dedupe.
// Returns {snapshots, added: boolean}
export function addSnapshot(snapshots, snap) {
  const list = snapshots.slice();
  const last = list[list.length - 1];
  if (snap.trigger !== "mass_close" && last && last.hash === snap.hash) {
    list[list.length - 1] = { ...last, lastSeen: snap.ts };
    return { snapshots: list, added: false };
  }
  if (snap.tabCount === 0 && snap.trigger !== "manual") return { snapshots: list, added: false };
  list.push(snap);
  list.sort((a, b) => a.ts - b.ts);
  return { snapshots: list, added: true };
}

// Merge imported snapshots: dedupe by id and by (hash, ts).
export function mergeSnapshots(existing, incoming) {
  const seen = new Set(existing.map(s => s.id));
  const out = existing.slice();
  let added = 0;
  for (const s of incoming) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); added++; }
  out.sort((a, b) => a.ts - b.ts);
  return { snapshots: out, added };
}

// Free tier pruning: drop > freeDays old unless pinned (mass close within 7 days).
// Paid tier: never prune. Note: spec says lapsed paid history is hidden, not deleted;
// callers pass keepAll=true when the user ever paid.
export function prune(snapshots, now, { paid = false, keepAll = false, freeDays = DEFAULTS.freeHistoryDays } = {}) {
  if (paid || keepAll) return snapshots.slice();
  const cutoff = now - freeDays * DAY;
  return snapshots.filter(s => s.ts >= cutoff || (s.pinnedUntil && s.pinnedUntil > now));
}

export function visibleSnapshots(snapshots, now, paid, freeDays = DEFAULTS.freeHistoryDays) {
  if (paid) return snapshots;
  const cutoff = now - freeDays * DAY;
  return snapshots.filter(s => s.ts >= cutoff || (s.pinnedUntil && s.pinnedUntil > now));
}

// Mass close detector: sliding window of removal timestamps.
export class MassCloseDetector {
  constructor(n = DEFAULTS.massCloseN, windowMs = DEFAULTS.massCloseWindowMs) { this.n = n; this.windowMs = windowMs; this.times = []; this.active = false; }
  // Returns true exactly once when the threshold is first crossed in a burst.
  record(now) {
    this.times = this.times.filter(t => now - t <= this.windowMs);
    this.times.push(now);
    if (this.times.length < 2) this.active = false;
    if (!this.active && this.times.length >= this.n) { this.active = true; return true; }
    return false;
  }
  inBurst(now) { return this.times.some(t => now - t <= this.windowMs) && this.times.length > 1; }
}

// Debouncer with injectable timers.
export function makeDebouncer(fn, ms, timers = { set: (f, m) => setTimeout(f, m), clear: (h) => clearTimeout(h) }) {
  let h = null;
  return (...args) => { if (h) timers.clear(h); h = timers.set(() => { h = null; fn(...args); }, ms); };
}

export function shouldExport({ now, lastExportTs, lastExportHash, currentHash, force = false, minIntervalMs = DEFAULTS.exportMinIntervalMs }) {
  if (currentHash === lastExportHash && !force) return false;
  if (force) return true;
  return !lastExportTs || now - lastExportTs >= minIntervalMs;
}

export function historyHash(snapshots) { return fnv1a(snapshots.map(s => `${s.id}:${s.lastSeen}`).join(",")); }

export function buildExport(snapshots, version, now) {
  return { schema: "tab-black-box", schemaVersion: SCHEMA_VERSION, exportedAt: now, extensionVersion: version, snapshots };
}

export function validateImport(obj) {
  if (!obj || typeof obj !== "object") return "Not a JSON object.";
  if (obj.schema !== "tab-black-box") return "Not a Tab Black Box backup file.";
  if (typeof obj.schemaVersion !== "number" || obj.schemaVersion > SCHEMA_VERSION) return "Unsupported backup version.";
  if (!Array.isArray(obj.snapshots)) return "Backup has no snapshot list.";
  for (const s of obj.snapshots) {
    if (!s || typeof s.id !== "string" || typeof s.ts !== "number" || !Array.isArray(s.windows) || !Array.isArray(s.tabs) || !Array.isArray(s.groups)) return "Backup contains a malformed snapshot.";
    for (const t of s.tabs) if (typeof t.url !== "string") return "Backup contains a malformed tab.";
  }
  return null;
}

export function isRestorableUrl(url) {
  if (!url) return false;
  if (/^(https?|ftp):/i.test(url)) return true;
  if (/^chrome:\/\/newtab/i.test(url)) return true;
  return false; // chrome://, file://, chrome-extension://, javascript:, data: are skipped
}

// Restore-in-progress guard. While active, tab/window/group events caused by the
// restore itself must not produce snapshots, mass-close detection or exports.
// Auto-expires after maxMs so a crashed restore can never suppress snapshots forever.
export class RestoreGuard {
  constructor(maxMs = 120000, clock = () => Date.now()) { this.maxMs = maxMs; this.clock = clock; this.until = 0; this.token = 0; }
  active() { return this.clock() < this.until; }
  // Returns a token, or null if a restore is already running (re-entrancy guard).
  begin() { if (this.active()) return null; this.until = this.clock() + this.maxMs; return ++this.token; }
  // Keep suppressing for a short tail so late events from the restore are ignored.
  end(token, tailMs = 3000) { if (token !== this.token) return; this.until = Math.min(this.until, this.clock() + tailMs); }
}

// Single-flight wrapper: concurrent callers share one in-flight promise.
export function singleFlight(fn) {
  let p = null;
  return (...args) => { if (p) return p; p = Promise.resolve().then(() => fn(...args)).finally(() => { p = null; }); return p; };
}

export const KNOWN_MESSAGES = ["snapshotNow", "exportNow", "restore", "settingsChanged", "status", "upgrade", "manageSubscription", "login", "refreshPaid"];
export function isKnownMessage(msg) { return !!msg && typeof msg === "object" && KNOWN_MESSAGES.includes(msg.type); }

export function restoreResultText(r) {
  if (!r || r.error) return (r && r.error) || "Restore failed.";
  return `Opened ${r.created} tabs.` + (r.skipped && r.skipped.length ? `\nSkipped ${r.skipped.length} tabs that cannot be opened:\n` + r.skipped.map(t => t.url).join("\n") : "");
}
