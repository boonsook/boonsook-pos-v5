// ESLint flat config — Phase 89.18 (revised after first lint run)
// Strategy: legacy adoption mode
//   - Real-bug rules = "error" (block CI: no-eval, no-async-promise-executor, etc.)
//   - Style/cleanup = "warn" (visible but ไม่ fail)
//   - no-undef = "error" ใน browser modules (Phase 89.35: count = 0 → promoted from warn)
//   - no-undef = "warn"  ใน tests / functions / sw / scripts (smaller scope, lower risk)
//
// Goal: 0 errors, warnings ปล่อยทยอยแก้

import js from "@eslint/js";

// ───────────────────────────────────────────────────────────────
// Global ignores (separate object — flat config requires this)
// ───────────────────────────────────────────────────────────────
const GLOBAL_IGNORES = {
  ignores: [
    "node_modules/**",
    ".claude/**",
    "playwright-report/**",
    "test-results/**",
    "data/**",
    "icons/**",
    "*.bak.js",
    "*.bak.*",
    "ai-chat-widget.js.bak.js",
    "**/*.new",
    "**/*.tmp",
    "share.html",       // standalone, ไม่ใช่ module
    "offline.html",
  ],
};

// ───────────────────────────────────────────────────────────────
// Complete browser globals (covers Window + DOM + Fetch + Crypto)
// ───────────────────────────────────────────────────────────────
const BROWSER_GLOBALS = {
  // Window
  window: "readonly", document: "readonly", navigator: "readonly",
  location: "readonly", history: "readonly", screen: "readonly",
  self: "readonly", parent: "readonly", top: "readonly", frames: "readonly",
  globalThis: "readonly",

  // Storage / DB
  localStorage: "readonly", sessionStorage: "readonly", indexedDB: "readonly",
  caches: "readonly",         // also exists on Window for SW
  cookieStore: "readonly",

  // Network
  fetch: "readonly", Headers: "readonly", Request: "readonly", Response: "readonly",
  XMLHttpRequest: "readonly", EventSource: "readonly", WebSocket: "readonly",
  WebTransport: "readonly", BroadcastChannel: "readonly",

  // Files / Blob
  Blob: "readonly", File: "readonly", FileList: "readonly", FileReader: "readonly",
  FormData: "readonly", URLSearchParams: "readonly", URL: "readonly", URLPattern: "readonly",

  // Binary
  ArrayBuffer: "readonly", Uint8Array: "readonly", Uint16Array: "readonly",
  Uint32Array: "readonly", Int8Array: "readonly", Int16Array: "readonly",
  Int32Array: "readonly", Float32Array: "readonly", Float64Array: "readonly",
  DataView: "readonly", SharedArrayBuffer: "readonly", Atomics: "readonly",
  TextEncoder: "readonly", TextDecoder: "readonly",

  // Streams
  ReadableStream: "readonly", WritableStream: "readonly", TransformStream: "readonly",

  // Encoding / Crypto
  atob: "readonly", btoa: "readonly", crypto: "readonly", SubtleCrypto: "readonly",

  // Dialogs / Notify
  alert: "readonly", confirm: "readonly", prompt: "readonly",
  Notification: "readonly",

  // Console / Timing
  console: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly",
  setInterval: "readonly", clearInterval: "readonly",
  queueMicrotask: "readonly",
  requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
  requestIdleCallback: "readonly", cancelIdleCallback: "readonly",
  performance: "readonly", PerformanceObserver: "readonly",

  // Events
  Event: "readonly", CustomEvent: "readonly", EventTarget: "readonly",
  KeyboardEvent: "readonly", MouseEvent: "readonly", TouchEvent: "readonly",
  FocusEvent: "readonly", InputEvent: "readonly", PointerEvent: "readonly",
  WheelEvent: "readonly", DragEvent: "readonly", ClipboardEvent: "readonly",
  AbortController: "readonly", AbortSignal: "readonly",

  // Clipboard API (Phase 89.34 — main.js ClipboardItem write)
  ClipboardItem: "readonly",

  // DOM
  Element: "readonly", HTMLElement: "readonly",
  HTMLDivElement: "readonly", HTMLInputElement: "readonly",
  HTMLSelectElement: "readonly", HTMLTextAreaElement: "readonly",
  HTMLButtonElement: "readonly", HTMLFormElement: "readonly",
  HTMLImageElement: "readonly", HTMLCanvasElement: "readonly",
  HTMLVideoElement: "readonly", HTMLAudioElement: "readonly",
  HTMLAnchorElement: "readonly", HTMLLinkElement: "readonly",
  HTMLScriptElement: "readonly", HTMLStyleElement: "readonly",
  HTMLTableElement: "readonly", HTMLTableRowElement: "readonly",
  HTMLTableCellElement: "readonly", HTMLTemplateElement: "readonly",
  HTMLOptionElement: "readonly", HTMLDialogElement: "readonly",
  HTMLCollection: "readonly", NodeList: "readonly", Node: "readonly",
  DocumentFragment: "readonly", Document: "readonly", Window: "readonly",
  Range: "readonly", Selection: "readonly",
  Image: "readonly", Audio: "readonly", Option: "readonly",
  CanvasRenderingContext2D: "readonly", Path2D: "readonly",
  DOMParser: "readonly", XMLSerializer: "readonly",
  DOMRect: "readonly", DOMRectReadOnly: "readonly",
  ShadowRoot: "readonly", CSSStyleSheet: "readonly", CSS: "readonly",

  // Observers
  MutationObserver: "readonly", IntersectionObserver: "readonly",
  ResizeObserver: "readonly", PerformanceMark: "readonly",

  // Media / etc.
  matchMedia: "readonly", getComputedStyle: "readonly", getSelection: "readonly",
  open: "readonly", close: "readonly", print: "readonly",
  scroll: "readonly", scrollTo: "readonly", scrollBy: "readonly",
  postMessage: "readonly", structuredClone: "readonly",
  reportError: "readonly",
  MessageChannel: "readonly", MessagePort: "readonly",

  // Workers
  Worker: "readonly", SharedWorker: "readonly", ServiceWorker: "readonly",
  ServiceWorkerContainer: "readonly", ServiceWorkerRegistration: "readonly",

  // Misc
  HashChangeEvent: "readonly", PopStateEvent: "readonly", StorageEvent: "readonly",
  Touch: "readonly", TouchList: "readonly",
};

// CDN library globals
const CDN_GLOBALS = {
  Chart: "readonly",
  jspdf: "readonly", jsPDF: "readonly",
  XLSX: "readonly",
  JsBarcode: "readonly",
  Html5Qrcode: "readonly", Html5QrcodeScanner: "readonly",
  html2canvas: "readonly",       // Phase 89.34 — CDN: receipts/quotations PDF capture
  // Anthropic / app-level globals set ใน main.js
  APP_BUILD: "writable",
  _appAuthFetch: "readonly", _appConfirm: "readonly",
  _appXhrPatch: "readonly",
  _sbAccessToken: "writable", _refreshInflight: "writable",
  _swSaving: "writable", _printerDevice: "writable", _printerType: "writable",
  _crDate: "writable",
  SUPABASE_CONFIG: "readonly",
  showToast: "readonly",         // Phase 89.34 — defined as top-level function in main.js (window.showToast)
};

export default [
  GLOBAL_IGNORES,
  js.configs.recommended,

  // ─────────────────────────────────────────────
  // Browser modules (main.js, modules/**, etc.)
  // ─────────────────────────────────────────────
  {
    files: ["**/*.js"],
    ignores: [
      "tests/**",
      "functions/**",
      "sw.js",
      "scripts/**",
      "playwright.config.js",
      "eslint.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...BROWSER_GLOBALS, ...CDN_GLOBALS },
    },
    rules: {
      // ── REAL bug catchers (error — block CI) ──
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-async-promise-executor": "error",
      "no-self-compare": "error",
      "no-unreachable-loop": "error",
      "no-throw-literal": "error",
      "no-dupe-keys": "error",                          // bug จริง — duplicate object key
      "no-dupe-class-members": "error",
      "no-duplicate-case": "error",
      "no-import-assign": "error",
      "no-loss-of-precision": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",           // bug จริง — TypeError potential
      "no-constant-condition": ["error", { checkLoops: false }],
      "use-isnan": "error",
      "valid-typeof": "error",

      // ── Real-bug rules แต่ codebase นี้ pattern กว้าง → warn ก่อน, แก้ทยอย ──
      "no-promise-executor-return": "warn",             // `(res) => return setTimeout(res, x)` ทำงานปกติ
      "no-misleading-character-class": "warn",          // Thai regex บางทีเป็น false positive
      "no-unreachable": "warn",                         // 1 จุดใน loyalty.js — ดูทีหลัง
      "no-useless-assignment": "off",                   // rule ใหม่ ESLint v9.17+ false positive ใน destructuring
      "preserve-caught-error": "off",                   // rule ใหม่ — ของแถม

      // ── Style / cleanup (warn — visible แต่ ไม่ block CI) ──
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-undef": "error",       // Phase 89.35 — count reached 0; block CI on future regressions
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-prototype-builtins": "warn",
      "no-irregular-whitespace": "warn",
      "no-control-regex": "warn",
      "no-fallthrough": "warn",
      "no-redeclare": "warn",
      "no-cond-assign": "warn",
      "no-case-declarations": "warn",
      "require-atomic-updates": "warn",
      "no-template-curly-in-string": "warn",

      // ── Off — intentional patterns ใน codebase ──
      "no-console": "off",
      "no-var": "off",
      "no-inner-declarations": "off",
      "no-implicit-globals": "off",
      "no-await-in-loop": "off",
      "no-constant-binary-expression": "off",
    },
  },

  // ─────────────────────────────────────────────
  // Node unit tests (tests/*.test.js)
  // ─────────────────────────────────────────────
  {
    files: ["tests/**/*.test.js"],
    ignores: ["tests/e2e/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly", Buffer: "readonly", global: "readonly",
        console: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        URL: "readonly", URLSearchParams: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly",
        fetch: "readonly", Headers: "readonly", Response: "readonly", Request: "readonly",
        window: "writable",     // Phase 89.34 — tests set `globalThis.window = {...}` then read via `window.X`
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "warn",
      "no-empty": "off",
      "no-useless-escape": "off",        // XSS regex tests มี explicit escape pattern ตั้งใจ
    },
  },

  // ─────────────────────────────────────────────
  // Playwright e2e tests (own runner, own globals)
  // ─────────────────────────────────────────────
  {
    files: ["tests/e2e/**/*.js", "tests/e2e/**/*.spec.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...BROWSER_GLOBALS,
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",   // Playwright test framework ฉีด globals ผ่าน import
    },
  },

  // ─────────────────────────────────────────────
  // Cloudflare Pages Functions
  // ─────────────────────────────────────────────
  {
    files: ["functions/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        Response: "readonly", Request: "readonly", Headers: "readonly",
        fetch: "readonly", URL: "readonly", URLSearchParams: "readonly",
        crypto: "readonly", console: "readonly",
        atob: "readonly", btoa: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly",
        ReadableStream: "readonly", WritableStream: "readonly",
        FormData: "readonly", Blob: "readonly", File: "readonly",
        // Phase 89.34 — Cloudflare Workers runtime timers + abort (parse-receipt.js, verify-slip.js)
        setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        AbortController: "readonly", AbortSignal: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-undef": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",          // regex char class escape เขียน explicit ก็ได้
    },
  },

  // ─────────────────────────────────────────────
  // Service Worker (sw.js)
  // ─────────────────────────────────────────────
  {
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        self: "readonly", caches: "readonly", clients: "readonly",
        fetch: "readonly", Response: "readonly", Request: "readonly",
        URL: "readonly", console: "readonly", skipWaiting: "readonly",
        ServiceWorkerGlobalScope: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-undef": "warn",
      "no-implicit-globals": "off",
    },
  },

  // ─────────────────────────────────────────────
  // Build scripts / config files
  // ─────────────────────────────────────────────
  {
    files: ["scripts/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly", console: "readonly",
        __dirname: "readonly", __filename: "readonly",
        Buffer: "readonly", global: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "warn",
    },
  },
];
