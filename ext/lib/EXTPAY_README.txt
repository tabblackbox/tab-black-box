Vendored third-party code: ExtPay.js (ExtensionPay client library)
Upstream: https://github.com/Glench/ExtPay  (tag 3.1.2, also npm "extpay@3.1.2")
lib/ExtPay.js      = dist/ExtPay.js verbatim (IIFE build with bundled webextension-polyfill)
                     sha256 ec38f20eeea04502e68e99b939fe0e188045bf68cabe605080cdad79c7fae15a
                     (identical in npm tarball and GitHub tag). Used as the content script on https://extensionpay.com/*.
lib/ExtPay.esm.js  = the same file plus one appended line "export default ExtPay;" so the
                     module service worker can import it. No other modifications.
License: the npm package.json and the source header say AGPL-3.0-or-later ("AGPLv3 licensed");
the repository LICENSE file contains only the text "LGPL-3.0". Treat as copyleft; check with the
author / counsel before publishing a closed-source extension. Bundled webextension-polyfill is MPL-2.0.
