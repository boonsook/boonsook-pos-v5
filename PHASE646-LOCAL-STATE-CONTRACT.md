# Phase 646 — credit/exchange refund approval contract (local only)

Baseline: `99c0303` (build 641); candidate client build 642 / v5.69.109.
No production or staging change is authorized by this file.
The owner chose: staff submit a request; an admin must approve **before** any refund row,
stock return, accounting journal, loyalty reversal, or spendable credit is created.
The store is **not VAT-registered**. Phase 646 must not add VAT to the refund. The
credit amount must be checked against the sale's net amount after discounts;
`qty × unit_price` is only a request estimate, not the payable refund amount.
If an older sale records nonzero VAT, or the net amount cannot be allocated to
the returned items unambiguously, stop for manual review rather than guessing.
Cash/transfer refunds and ordinary credit redemption stay outside this phase.

| State | Allowed transition | Effects and failure rule |
| --- | --- | --- |
| `pending` | Staff submit an exact whole-sale request with no prior refund or recorded VAT | No refund/stock/JV/loyalty/ledger write. Server derives customer and the net amount after discount from the sale. Submission error or uncertain response is resolved by reading the request key, never blind retry. |
| `manual_review` before approval | A subset of items, reduced quantity, prior refund, or recorded VAT is detected at submission | Request is paused immediately. No auto-approval, refund, stock return, JV, loyalty reversal or credit. Admin must inspect the discount split and points; this candidate has no manual-completion override. |
| `rejected` | Admin rejects `pending` | Terminal. No financial side effect; the reason and actor are retained. |
| `approved` | Admin approves `pending` after locking and revalidating sale, remaining quantities and snapshot | Explicit admin identity/time recorded. No financial side effect yet. Changed/stale request is rejected, not silently recalculated. |
| Finalize call | Admin confirms the approved net amount and starts one database-owned transaction | The server revalidates the sale and makes the refund, stock return, balanced JV, loyalty reversal and ledger entry together. The browser never writes those effects in sequence. A network timeout is resolved by reading the durable request, never blind retry. |
| `manual_review` after approval | A required side effect fails, the sale's earned points have already been spent, or its outcome cannot be proved | The database rolls back all financial/stock effects in the failed transaction and records a coarse failure state for manual inspection. No spendable credit is issued and the app offers no automatic retry or manual-completion override. |
| `completed` | The single transaction commits successfully | The request retains linked refund ID, admin identity/time and exact net amount. Repeated finalizer calls return the same row without a second effect. |

Direct browser writes to the credit ledger and direct credit/exchange refund inserts must be
closed by database grants and server guards; hiding a button is not authorization.
The server must reject non-admin approval/finalization, forged amounts/customers,
duplicate and concurrent requests, stale quantities, and changed linked rows.
An accountant keeps read access to credit history. Technician keeps existing POS credit
use; B1 RPCs and B2 active-sale release are not changed here.

Owner decision: partial returns pause for manual review before either a discount
allocation or a loyalty reversal is attempted (the current helper supports one
reversal per whole sale). No automatic path can issue credit for these requests.
The eventual manual-resolution process, including how a human records the split
and points outcome, is not yet designed or authorized. Do not silently reuse
the legacy `qty × unit_price` estimate as the final amount.

The 2026-10-06 owner-opened Dashboard was queried with catalog-only SELECTs for
refund/JV/stock/loyalty structures, recorded in
`PHASE646-PRODUCTION-CATALOG-READONLY-20261006.md`. Those observations are not
business-row smoke or proof of production behavior. Release remains blocked until
independent review of the exact candidate and a separate owner approval for the
exact SQL digest. Local tests never prove production behavior.
