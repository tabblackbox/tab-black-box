// Paid status via ExtensionPay. Pure-ish service with injected extpay + storage so it can be unit tested.
import { DEFAULTS } from "./config.js";
// cache: {paid:boolean, lastOkTs:number, lastCheckTs:number, lastError:string|null, everPaid:boolean}
// Offline grace: if getUser() fails, keep the last known paid status for up to graceMs after the last successful check.
export function paidStatus(cache, now, graceMs = DEFAULTS.paidGraceMs) {
  if (!cache || !cache.paid) return { paid: false, reason: cache && cache.everPaid ? "not_paid_anymore" : "free" };
  if (typeof cache.lastOkTs === "number" && now - cache.lastOkTs <= graceMs) return { paid: true, reason: cache.lastError ? "offline_grace" : "ok" };
  return { paid: false, reason: "grace_expired" };
}
export function nextPaidCache(prev, result, now) {
  const p = prev || { paid: false, lastOkTs: 0, everPaid: false };
  if (result.ok) { const paid = !!(result.user && result.user.paid); return { paid, lastOkTs: now, lastCheckTs: now, lastError: null, everPaid: p.everPaid || paid }; }
  return { ...p, lastCheckTs: now, lastError: String(result.error) };
}
export function createPaidService({ extpay, storage, clock = () => Date.now(), timeoutMs = 15000 }) {
  const read = async () => (await storage.get("paidCache")).paidCache || null;
  let inflight = null;
  async function refresh0() {
    const now = clock();
    let result, timer;
    try {
      const user = await Promise.race([extpay.getUser(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("ExtensionPay timeout")), timeoutMs); })]);
      result = { ok: true, user };
    } catch (e) { result = { ok: false, error: (e && e.message) || e }; }
    finally { clearTimeout(timer); }
    const next = nextPaidCache(await read(), result, now);
    await storage.set({ paidCache: next });
    return next;
  }
  return {
    refresh: () => inflight || (inflight = refresh0().finally(() => { inflight = null; })),
    status: async () => paidStatus(await read(), clock()),
    read,
    upgrade: () => extpay.openPaymentPage("yearly"),
    manage: () => extpay.openPaymentPage(),
    login: () => extpay.openLoginPage(),
  };
}
