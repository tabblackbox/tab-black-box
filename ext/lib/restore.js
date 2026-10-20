import { isRestorableUrl } from "./core.js";
// Restores into NEW windows. Never closes or modifies existing tabs.
// opts: {windowId?: number (original id), groupId?: number}
export async function restoreSnapshot(snap, opts = {}) {
  const skipped = [];
  let windows = snap.windows.slice().sort((a, b) => a.order - b.order);
  if (opts.windowId != null) windows = windows.filter(w => w.id === opts.windowId);
  let created = 0;
  for (const w of windows) {
    let tabs = snap.tabs.filter(t => t.windowId === w.id).sort((a, b) => a.index - b.index);
    if (opts.groupId != null) tabs = tabs.filter(t => t.groupId === opts.groupId);
    const ok = tabs.filter(t => { const r = isRestorableUrl(t.url); if (!r) skipped.push(t); return r; });
    if (!ok.length) continue;
    const win = await chrome.windows.create({ focused: false, state: w.state === "minimized" ? "normal" : undefined });
    const placeholder = win.tabs && win.tabs[0];
    const large = ok.length > 10;
    const toDiscard = [];
    const map = []; // [snapshotTab, newTabId]
    for (let i = 0; i < ok.length; i++) {
      const t = ok[i];
      // pinned tabs first by index in snapshot already; Chrome keeps pinned at front
      const nt = await chrome.tabs.create({ windowId: win.id, url: t.url, pinned: t.pinned, active: i === 0 });
      map.push([t, nt.id]);
      created++;
      if (large && i > 0 && !t.pinned) toDiscard.push(nt.id);
    }
    // Discard only after the URL has committed; discarding a tab that has not started
    // loading leaves it stuck as a spinning, blank tab. Bounded wait, never loops.
    for (const id of toDiscard) await discardWhenCommitted(id);
    if (placeholder) { try { await chrome.tabs.remove(placeholder.id); } catch (e) {} } // blank tab of the NEW window only
    const byGroup = new Map();
    for (const [t, id] of map) if (t.groupId !== -1 && !t.pinned) { if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []); byGroup.get(t.groupId).push(id); }
    for (const [gid, ids] of byGroup) {
      const g = snap.groups.find(x => x.id === gid);
      const newGid = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: win.id } });
      if (g) await chrome.tabGroups.update(newGid, { title: g.title, color: g.color, collapsed: g.collapsed });
    }
    if (w.state === "maximized" || w.state === "minimized") { try { await chrome.windows.update(win.id, { state: w.state }); } catch (e) {} }
  }
  return { created, skipped };
}

async function discardWhenCommitted(id, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    let t; try { t = await chrome.tabs.get(id); } catch (e) { return; }
    if (t.active || t.discarded) return;
    if (t.url && !t.pendingUrl) { try { await chrome.tabs.discard(id); } catch (e) {} return; }
    await new Promise(r => setTimeout(r, 150));
  }
  // Not committed in time: leave the tab loading normally rather than risk a stuck tab.
}
