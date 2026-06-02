# Superseded Claude Workflow

This file is historical and should not be used as the active workflow.

The old autonomous workflow was useful during earlier Phase 89/92 cleanup work, but it is now too broad and conflicts with the current one-phase-at-a-time review process.

## Active Workflow

Use `IMPLEMENT_TEAM_PROTOCOL.md`.

Short version:

1. Read the protocol and shared docs.
2. Sync repo and inspect working tree.
3. Confirm the approved phase and scope.
4. Implement only that phase.
5. Run lint/tests/e2e and required smoke checks.
6. Commit/push only scoped changes.
7. Update `CHANGELOG.md`, `HANDOFF.md`, and `SESSION_START_SHARED.md`.
8. Stop and wait for owner/Codex review.

## Important

- Do not run broad autonomous batches.
- Do not start the next phase yourself.
- Do not use old phase numbers from this file.
- Do not reset/revert local work from another session.
- Do not touch stock/POS/cart/schema/auth/API unless the approved phase explicitly allows it.
