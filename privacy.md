# Privacy Policy (DRAFT, not legal advice)

Tab Black Box, published by Tab Black Box. Contact: memerealaf@gmail.com. Last updated: October 20, 2026.

## Summary
Your tab data stays on your computer. We do not collect, sell, or receive it.

## What the extension handles
To make backups, the extension reads the URLs and titles of your open tabs, your windows, tab groups (name, color, collapsed), pinned state, and tab order. It does not read page content, passwords, cookies, form data, or browsing history. Incognito tabs are not saved.

## Where it is stored
- In Chrome's local extension storage on this device.
- In a backup file in your Downloads folder (for example `TabBlackBox/tab-backup.json`), which you control and can delete at any time.
Nothing is stored in Chrome sync or on our servers.

## What is transmitted
Only payment-related data, handled by ExtensionPay (extensionpay.com), our payment provider:
- On first use of Upgrade or Log in, the extension asks ExtensionPay for an anonymous random API key that identifies this installation. To check whether you have paid, the extension sends that key to ExtensionPay over HTTPS (at startup, about once a day, and after a payment). ExtensionPay returns only whether you have paid and related dates. The key and this status are stored in Chrome's extension storage (chrome.storage.sync, which Chrome may sync to your other devices if Chrome sync is on, and chrome.storage.local).
- When you pay or log in, you do so on extensionpay.com in a normal browser tab. ExtensionPay receives your email address and stores it together with your paid status so you can log in on other devices and manage your subscription. A small script bundled with the extension runs only on extensionpay.com pages, solely to tell the extension that a payment or login has completed.
- No tab data, URLs, titles, or browsing information are ever sent to ExtensionPay, Stripe, or us. ExtensionPay may log request metadata such as IP address under its own privacy policy (https://extensionpay.com/privacy).

## Payments
Payments are processed by Stripe on behalf of ExtensionPay. We and ExtensionPay do not see or store your full card details. We can see your email address and subscription status in the ExtensionPay dashboard so we can provide support. Stripe's and ExtensionPay's privacy policies apply to the data you give them.

## No analytics
The extension contains no analytics, tracking, advertising, or crash reporting.

## Your choices
Delete local data by removing the extension. Delete the backup file from your Downloads folder. To delete your email and subscription record held by ExtensionPay, email memerealaf@gmail.com and we will request deletion from ExtensionPay; you can also cancel the subscription via "Manage subscription".

## Chrome Web Store Limited Use
Use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the backup and restore feature, is not transferred to anyone, and is not used for advertising or credit decisions.

## Changes
We will update this page and the date above if anything changes.
