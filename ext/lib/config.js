// ExtensionPay extension id (registered at extensionpay.com). Plan nickname for the $15/yr plan.
export const EXTPAY_ID = "tab-black-box";
export const EXTPAY_PLAN = "yearly";
export const SCHEMA_VERSION = 1;
export const DEFAULTS = {
  alarmMinutes: 15,       // 5..60
  massCloseN: 5,
  massCloseWindowMs: 3000,
  debounceMs: 2000,
  exportMinIntervalMs: 60 * 60 * 1000,
  freeHistoryDays: 30,
  massClosePinDays: 7,
  paidGraceMs: 30 * 24 * 3600 * 1000, // keep last known paid status this long if ExtensionPay is unreachable
};
export const EXPORT_FILENAME = "TabBlackBox/tab-backup.json";
