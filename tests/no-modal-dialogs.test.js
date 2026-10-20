import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { restoreResultText } from "../ext/lib/core.js";
// Regression: an alert() left open after "Restore all" froze the shared extension renderer,
// so options.html / popup.html never rendered (reproduced in e2e/e2e.mjs).
test("extension pages never use blocking modal dialogs", () => {
  const dir = new URL("../ext/", import.meta.url);
  const files = ["options.js", "popup.js", ...fs.readdirSync(new URL("lib/", dir)).filter(f => !f.startsWith("ExtPay")).map(f => "lib/" + f)];
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\s*\(/, `${f} uses a modal dialog`);
  }
});
test("restoreResultText formats results inline", () => {
  assert.equal(restoreResultText({ created: 6, skipped: [] }), "Opened 6 tabs.");
  assert.match(restoreResultText({ created: 1, skipped: [{ url: "chrome://x" }] }), /Skipped 1 .*\nchrome:\/\/x/s);
  assert.equal(restoreResultText({ error: "busy" }), "busy");
  assert.equal(restoreResultText(undefined), "Restore failed.");
});
