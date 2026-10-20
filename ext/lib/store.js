import { prune } from "./core.js";
import { paidStatus } from "./paid.js";
export const get = (k) => chrome.storage.local.get(k);
export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return { alarmMinutes: 15, exportEnabled: true, ...settings };
}
export async function getSnapshots() { return (await chrome.storage.local.get("snapshots")).snapshots || []; }
export async function getPaidCache() { return (await chrome.storage.local.get("paidCache")).paidCache || null; }
export async function isPaid(now = Date.now()) { return paidStatus(await getPaidCache(), now).paid; }
export async function everPaid() { return !!((await getPaidCache()) || {}).everPaid; }
export async function saveSnapshots(list, now = Date.now()) {
  const paid = await isPaid(now);
  const keepAll = await everPaid(); // lapsed subscribers: older history hidden, not deleted
  await chrome.storage.local.set({ snapshots: prune(list, now, { paid, keepAll }) });
}
