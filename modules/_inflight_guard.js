// Phase 89.41 — Single-flight guard for async operations.
//
// Use case: prevent double-execution when a UI handler can be re-entered
// (e.g., user double-clicks a checkout button while an await is still pending).
//
// Pattern: createInflightGuard() returns { run, isInflight }. The 1st caller
// to run(fn) executes fn; concurrent callers receive undefined and skip.
// The lock is released in a finally block, so it also clears on throw.
//
// Tested in: tests/checkout_inflight.test.js
// Used in:
//   - main.js checkout() — POS checkout (Site 1)
//   - modules/customer_dashboard.js customer checkout handler (Site 2)

export function createInflightGuard() {
  let inflight = false;
  return {
    async run(fn) {
      if (inflight) return undefined;
      inflight = true;
      try {
        return await fn();
      } finally {
        // The inflight flag IS the mutex — by construction, only the run() call that
        // set it to true can reach this finally. ESLint's race analysis can't see this.
        // eslint-disable-next-line require-atomic-updates
        inflight = false;
      }
    },
    get isInflight() { return inflight; },
  };
}
