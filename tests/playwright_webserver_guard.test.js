// Guard Playwright webServer stability in CI.
// The static server must stay alive for the whole e2e run; Playwright tears it down.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const configSrc = fs.readFileSync(path.resolve("playwright.config.js"), "utf8");

test("playwright webServer idle exit is long enough for the e2e suite", () => {
  const webServerIdx = configSrc.indexOf("webServer:");
  assert.notEqual(webServerIdx, -1, "playwright webServer config exists");
  const webServerBlock = configSrc.slice(webServerIdx, webServerIdx + 600);
  assert.match(webServerBlock, /node scripts\/static-server\.js/, "webServer uses the local static server");
  const idleMatch = webServerBlock.match(/--idle-exit-ms=(\d+)/);
  assert.ok(idleMatch, "webServer should set an idle exit so local runs do not hang");
  assert.ok(Number(idleMatch[1]) >= 30000, "idle exit must not be so short that CI smoke tests lose the server mid-suite");
});
