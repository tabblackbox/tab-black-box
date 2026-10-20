import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../ext/lib/core.js";
const DAY = 864e5;
const W = (id, extra = {}) => ({ id, type: "normal", state: "normal", focused: false, ...extra });
const T = (i, w, extra = {}) => ({ id: 100 + i, url: `https://e.com/${i}`, title: `t${i}`, pinned: false, index: i, windowId: w, groupId: -1, ...extra });
const state = (n = 3) => C.buildState([W(1)], Array.from({ length: n }, (_, i) => T(i, 1)), []);

test("buildState skips incognito windows and tabs, keeps groups and pinned", () => {
  const s = C.buildState([W(1), W(2, { incognito: true })],
    [T(0, 1, { pinned: true }), T(1, 1, { groupId: 9 }), T(2, 2, { incognito: true })],
    [{ id: 9, title: "Work", color: "blue", collapsed: true, windowId: 1 }, { id: 8, title: "x", color: "red", windowId: 2 }]);
  assert.equal(s.windows.length, 1); assert.equal(s.tabs.length, 2);
  assert.equal(s.tabs[0].pinned, true); assert.deepEqual(s.groups.map(g => [g.title, g.color, g.collapsed]), [["Work", "blue", true]]);
});
test("hash ignores ids/focus but changes with order, title, pinned, group", () => {
  const a = state(); const b = C.buildState([W(7, { focused: true })], [0, 1, 2].map(i => ({ ...T(i, 7), id: 900 + i })), []);
  assert.equal(C.hashState(a), C.hashState(b));
  const swapped = structuredClone(a); swapped.tabs[0].index = 1; swapped.tabs[1].index = 0;
  assert.notEqual(C.hashState(a), C.hashState(swapped));
  const p = structuredClone(a); p.tabs[0].pinned = true; assert.notEqual(C.hashState(a), C.hashState(p));
  const g1 = C.buildState([W(1)], [T(0, 1, { groupId: 5 })], [{ id: 5, title: "A", color: "red", windowId: 1 }]);
  const g2 = C.buildState([W(1)], [T(0, 1, { groupId: 5 })], [{ id: 5, title: "A", color: "blue", windowId: 1 }]);
  assert.notEqual(C.hashState(g1), C.hashState(g2));
});
test("dedupe: identical consecutive states produce one snapshot with updated lastSeen", () => {
  let list = []; let r = C.addSnapshot(list, C.makeSnapshot(state(), "alarm", "0.1", 1000)); assert.equal(r.added, true);
  r = C.addSnapshot(r.snapshots, C.makeSnapshot(state(), "alarm", "0.1", 2000));
  assert.equal(r.added, false); assert.equal(r.snapshots.length, 1); assert.equal(r.snapshots[0].lastSeen, 2000);
  r = C.addSnapshot(r.snapshots, C.makeSnapshot(state(4), "alarm", "0.1", 3000)); assert.equal(r.snapshots.length, 2);
});
test("mass close snapshot is exempt from dedupe and pinned 7 days", () => {
  let r = C.addSnapshot([], C.makeSnapshot(state(), "alarm", "0.1", 1000));
  r = C.addSnapshot(r.snapshots, C.makeSnapshot(state(), "mass_close", "0.1", 2000));
  assert.equal(r.snapshots.length, 2); assert.equal(r.snapshots[1].pinnedUntil, 2000 + 7 * DAY);
});
test("empty automatic snapshots are not stored", () => {
  assert.equal(C.addSnapshot([], C.makeSnapshot(state(0), "alarm", "0.1", 1)).added, false);
});
test("prune: free keeps 30 days plus pinned mass close within 7 days; paid keeps all", () => {
  const now = 100 * DAY;
  const old = { ...C.makeSnapshot(state(), "alarm", "v", now - 31 * DAY) };
  const recent = C.makeSnapshot(state(2), "alarm", "v", now - 1 * DAY);
  const massOldPinned = { ...C.makeSnapshot(state(), "mass_close", "v", now - 40 * DAY), pinnedUntil: now + DAY };
  const massExpired = C.makeSnapshot(state(), "mass_close", "v", now - 40 * DAY);
  const all = [massExpired, massOldPinned, old, recent];
  assert.deepEqual(C.prune(all, now).map(s => s.id), [massOldPinned.id, recent.id]);
  assert.equal(C.prune(all, now, { paid: true }).length, 4);
  assert.equal(C.prune(all, now, { keepAll: true }).length, 4);
});
test("mass close detector: 20 removals in a burst fire once; slow removals never fire", () => {
  const d = new C.MassCloseDetector(5, 3000); let fires = 0;
  for (let i = 0; i < 20; i++) if (d.record(10000 + i * 10)) fires++;
  assert.equal(fires, 1);
  const d2 = new C.MassCloseDetector(5, 3000); let f2 = 0;
  for (let i = 0; i < 20; i++) if (d2.record(i * 1000)) f2++;  // 4 within any 3s window
  assert.equal(f2, 0);
  const d3 = new C.MassCloseDetector(5, 3000);
  assert.equal([0, 1, 2, 3].map(i => d3.record(i * 700)).some(Boolean), false);
  assert.equal(d3.record(2900), true); // 5th within 3s
});
test("mass close detector re-arms after a quiet gap", () => {
  const d = new C.MassCloseDetector(5, 3000); let fires = 0;
  for (let i = 0; i < 6; i++) if (d.record(i)) fires++;
  d.record(100000); // quiet gap resets
  for (let i = 0; i < 6; i++) if (d.record(200000 + i)) fires++;
  assert.equal(fires, 2);
});
test("debounce coalesces events into one call", () => {
  const q = []; const timers = { set: (fn, ms) => { q.push(fn); return q.length; }, clear: (h) => { q[h - 1] = null; } };
  let calls = 0; const deb = C.makeDebouncer(() => calls++, 2000, timers);
  for (let i = 0; i < 20; i++) deb(); q.forEach(f => f && f()); assert.equal(calls, 1);
});
test("shouldExport: only on change and at most hourly, force bypasses interval", () => {
  const H = 3600e3;
  assert.equal(C.shouldExport({ now: 10, currentHash: "a" }), true);
  assert.equal(C.shouldExport({ now: H * 2, lastExportTs: H, lastExportHash: "a", currentHash: "a" }), false);
  assert.equal(C.shouldExport({ now: H + 10, lastExportTs: H, lastExportHash: "a", currentHash: "b" }), false);
  assert.equal(C.shouldExport({ now: H * 2, lastExportTs: H, lastExportHash: "a", currentHash: "b" }), true);
  assert.equal(C.shouldExport({ now: H + 10, lastExportTs: H, lastExportHash: "a", currentHash: "a", force: true }), true);
});
test("import validation and merge dedupe", () => {
  const s = C.makeSnapshot(state(), "alarm", "v", 5);
  const exp = C.buildExport([s], "v", 6);
  assert.equal(C.validateImport(exp), null);
  assert.match(C.validateImport({}), /Not a Tab Black Box/);
  assert.match(C.validateImport({ ...exp, snapshots: [{ id: 1 }] }), /malformed/);
  assert.match(C.validateImport({ ...exp, schemaVersion: 99 }), /Unsupported/);
  const m = C.mergeSnapshots([s], [s, C.makeSnapshot(state(5), "alarm", "v", 1)]);
  assert.equal(m.added, 1); assert.equal(m.snapshots[0].ts, 1);
});
test("restorable URLs", () => {
  assert.equal(C.isRestorableUrl("https://a.com"), true);
  assert.equal(C.isRestorableUrl("chrome://settings"), false);
  assert.equal(C.isRestorableUrl("file:///x"), false);
});
