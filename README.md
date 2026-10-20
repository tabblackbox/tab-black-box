# Tab Black Box

Chrome extension that automatically saves snapshots of your open windows, tabs, and tab groups on your own computer so you can restore them after a crash, a mass close, or a bad update.

- Local only: snapshots stay in Chrome storage plus a rolling export at `Downloads/TabBlackBox/tab-backup.json`. Nothing is sent to any server.
- No host permissions; the extension cannot read page contents.
- Free: 30 days of history. Paid ($15/year via ExtensionPay): unlimited history.

Source is in `ext/`. Tests: `npm test` (unit) and `npm run e2e` (Chrome for Testing).

Privacy policy: see `privacy.md`. Support: memerealaf@gmail.com.

Licensed under AGPL-3.0-or-later (see LICENSE); bundles ExtPay.js.
