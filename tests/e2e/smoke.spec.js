// Smoke tests — Phase 89.14
// Goal: catch "AI fix แล้วแอปเปิดไม่ได้" ตั้งแต่ CI ก่อน user รู้
//
// ไม่ต้องการ login → ทดสอบแค่ static load + DOM + CSP + no console error
// ถ้าอยาก login จริง ต้องตั้ง Supabase test project (out of scope batch นี้)

import { test, expect } from "@playwright/test";

const CONSOLE_ALLOW = [
  // Supabase config ยังไม่ inject ตอน local — ปล่อยผ่าน
  /SUPABASE_CONFIG/i,
  // SW register ใน file:// / http://127.0.0.1 อาจ warn
  /service ?worker/i,
  // CDN ถูก block ใน CI sandbox (ออก internet ไม่ได้)
  /Failed to load resource.*cdn/i,
  // Phase 92.63b: Supabase client โหลดจาก https://esm.sh/@supabase/supabase-js@2 (main.js)
  //   — esm.sh 503/timeout ชั่วคราว = external CDN/network noise ไม่ใช่ app crash
  //   (local probe ไม่มี 503, prod build 333 ใช้งานปกติ)
  /esm\.sh/i,
  // Chart.js / xlsx CDN integrity ถ้าไม่โหลด
  /integrity/i,
];

function isAllowedConsoleMsg(msg) {
  const text = msg.text();
  return CONSOLE_ALLOW.some(re => re.test(text));
}

const CDN_ALLOW_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "cdn.sheetjs.com",
  "esm.sh",
  "unpkg.com",
]);

function isAllowedCdnUrl(url) {
  try {
    return CDN_ALLOW_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isGenericFailedResourceConsole(text) {
  return /Failed to load resource: (the server responded with a status of \d+|net::ERR_)/i.test(text);
}

test.describe("Smoke — static load", () => {
  test("index.html loads without uncaught JS errors", async ({ page }) => {
    const errors = [];
    const pageErrors = [];
    const externalCdnFailures = [];
    const internalResourceFailures = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !isAllowedConsoleMsg(msg)) {
        errors.push(msg.text());
      }
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const url = response.url();
      if (isAllowedCdnUrl(url)) {
        externalCdnFailures.push(`${response.status()} ${url}`);
      } else {
        internalResourceFailures.push(`${response.status()} ${url}`);
      }
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      const failure = request.failure()?.errorText || "request failed";
      if (isAllowedCdnUrl(url)) {
        externalCdnFailures.push(`${failure} ${url}`);
      } else if (failure !== "net::ERR_ABORTED") {
        internalResourceFailures.push(`${failure} ${url}`);
      }
    });
    await page.route("**/*", (route) => {
      if (isAllowedCdnUrl(route.request().url())) {
        route.abort("blockedbyclient");
        return;
      }
      route.continue();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);  // ให้ inline bootstrap run

    let externalFailureBudget = externalCdnFailures.length;
    const unexpectedErrors = errors.filter((text) => {
      if (isGenericFailedResourceConsole(text) && externalFailureBudget > 0) {
        externalFailureBudget -= 1;
        return false;
      }
      return true;
    });

    expect(pageErrors, "uncaught page errors").toEqual([]);
    expect(internalResourceFailures, "local/internal resource failures").toEqual([]);
    expect(unexpectedErrors, "unexpected console errors").toEqual([]);
    await page.close();
  });

  test("title is correct", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Boonsook POS/i);
  });

  test("app shell mounted in DOM", async ({ page }) => {
    await page.goto("/");
    const shell = page.locator("#appShell");
    await expect(shell).toBeAttached();
  });

  test("APP_BUILD is set", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    const build = await page.evaluate(() => window.APP_BUILD);
    expect(build, "APP_BUILD missing").toBeGreaterThan(0);
    // sanity — เลข build ต้องไม่ลด (compare กับ baseline)
    expect(build, "APP_BUILD must be >= 222").toBeGreaterThanOrEqual(222);
  });

  test("service worker file is reachable", async ({ page }) => {
    const res = await page.request.get("/sw.js");
    expect(res.ok(), "sw.js must be 200").toBe(true);
    const body = await res.text();
    expect(body, "sw.js must declare CACHE_NAME").toMatch(/CACHE_NAME\s*=/);
    // CACHE_NAME version must match index.html APP_BUILD format
    expect(body).toMatch(/boonsook-pos-v5-cache-v\d+/);
  });

  test("CSP is declared in _headers (Cloudflare Pages)", async ({ page }) => {
    // CSP บนโปรเจกต์นี้ขับเคลื่อนผ่าน _headers ของ Cloudflare Pages
    // local python3 http.server ไม่ apply _headers → test อ่านไฟล์ตรงๆ
    const res = await page.request.get("/_headers");
    expect(res.ok(), "_headers must be reachable").toBe(true);
    const body = await res.text();
    expect(body, "_headers must declare CSP").toMatch(/Content-Security-Policy:/i);
    expect(body, "CSP must have script-src directive").toMatch(/script-src[^;]+/i);
    expect(body, "CSP must have frame-ancestors 'none'").toMatch(/frame-ancestors\s+'none'/i);
  });

  test("Permissions-Policy allows geolocation=(self) but keeps mic/payment locked (Phase 378)", async ({ page }) => {
    // HR self clock (Phase 377) ต้องใช้ navigator.geolocation — Permissions-Policy ต้องอนุญาต self
    // เดิม geolocation=() block ตั้งแต่ browser ก่อน app code รัน
    const res = await page.request.get("/_headers");
    expect(res.ok(), "_headers must be reachable").toBe(true);
    const body = await res.text();
    expect(body, "Permissions-Policy must be declared").toMatch(/Permissions-Policy:/i);
    expect(body, "geolocation must be allowed for self").toMatch(/geolocation=\(self\)/i);
    expect(body, "geolocation must NOT be fully blocked").not.toMatch(/geolocation=\(\)/i);
    // อย่า relax ฟีเจอร์อ่อนไหวที่ตั้งใจปิด
    expect(body, "microphone must stay disabled").toMatch(/microphone=\(\)/i);
    expect(body, "payment must stay disabled").toMatch(/payment=\(\)/i);
  });
});

test.describe("Smoke — critical modules", () => {
  test("main.js loads as ES module", async ({ page }) => {
    const res = await page.request.get("/main.js");
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"] || "").toMatch(/javascript|application/);
  });

  test("at least 5 key modules are reachable", async ({ page }) => {
    const modules = [
      "/modules/pos.js",
      "/modules/auth.js",
      "/modules/accounting/auto_post.js",
      "/modules/stock_cas.js",
      "/modules/error_reporter.js",
    ];
    for (const m of modules) {
      const res = await page.request.get(m);
      expect(res.ok(), `${m} must be 200`).toBe(true);
    }
  });
});

test.describe("Smoke — build version sync", () => {
  test("sw.js CACHE_NAME version matches selfheal data-app-build", async ({ page }) => {
    // Phase 89.15 ย้าย APP_BUILD จาก inline var → data-app-build attribute ของ selfheal.js
    // pattern: <script src="./selfheal.js?v=230" data-app-build="230">
    const [indexRes, swRes] = await Promise.all([
      page.request.get("/index.html"),
      page.request.get("/sw.js"),
    ]);
    const indexHtml = await indexRes.text();
    const swText = await swRes.text();

    // Try ทั้ง 2 patterns: data-app-build (Phase 89.15+) หรือ inline var APP_BUILD (legacy)
    const buildMatch =
      indexHtml.match(/data-app-build=["'](\d+)["']/) ||
      indexHtml.match(/APP_BUILD\s*=\s*(\d+)/);
    // ★ Phase 608: ต้อง anchor ที่บรรทัดประกาศจริง — sw.js มีคอมเมนต์ changelog ที่ยกโค้ดเก่ามาอ้าง
    //   regex ไม่ anchor จะจับเลขในคอมเมนต์ก่อน แล้วบอกว่า build ไม่ตรงทั้งที่ตรง (หรือแย่กว่า: เขียวหลอก)
    const cacheMatch = swText.match(/^const CACHE_NAME = 'boonsook-pos-v5-cache-v(\d+)';$/m);

    expect(buildMatch, "APP_BUILD not found (ตรวจ data-app-build attribute)").toBeTruthy();
    expect(cacheMatch, "cache-vN not found in sw.js").toBeTruthy();

    const build = Number(buildMatch[1]);
    const cache = Number(cacheMatch[1]);
    expect(cache, `SW cache v${cache} must match APP_BUILD ${build} (ลืม bump?)`).toBe(build);
  });

  test("selfheal.js?v= query matches data-app-build (cache-bust sync)", async ({ page }) => {
    const res = await page.request.get("/index.html");
    const html = await res.text();
    // <script src="./selfheal.js?v=230" data-app-build="230">
    const srcMatch = html.match(/selfheal\.js\?v=(\d+)/);
    const attrMatch = html.match(/data-app-build=["'](\d+)["']/);
    if (srcMatch && attrMatch) {
      expect(Number(srcMatch[1]), "selfheal ?v= ต้อง = data-app-build").toBe(Number(attrMatch[1]));
    }
  });

  test("ALL build-tracking ?v= refs match data-app-build (no stale cache)", async ({ page }) => {
    const html = await (await page.request.get("/index.html")).text();
    const appBuildMatch = html.match(/data-app-build=["'](\d+)["']/);
    expect(appBuildMatch, "data-app-build attribute not found").toBeTruthy();
    const build = Number(appBuildMatch[1]);

    // Build-tracking group: selfheal, main, boot, style.css
    // (independent cadence: doc-print.css?v=1, phase4-*.css, supabase-config, ai-chat-widget — skip)
    const trackingPatterns = [
      /selfheal\.js\?v=(\d+)/,
      /main\.js\?v=(\d+)/,
      /boot\.js\?v=(\d+)/,
      /style\.css\?v=(\d+)/,
    ];

    for (const pattern of trackingPatterns) {
      const match = html.match(pattern);
      if (match) {
        const version = Number(match[1]);
        expect(version, `${pattern.source} version ${version} must match data-app-build ${build}`).toBe(build);
      }
    }
  });
});
