# Prompt Phase Brief Skill - Boonsook POS V5

Purpose: make phase prompts sharp enough for Claude/Codex implementation sessions. Use this file when drafting, reviewing, or refining a prompt before any agent edits code.

This is a companion to `IMPLEMENT_TEAM_PROTOCOL.md`. The protocol controls how to run a phase. This file controls how to write the phase brief so the implement team does not guess, overreach, or miss failure cases.

## When To Use

Use this file before giving an implementation prompt to Claude/Codex when the work touches:

- stock, POS, cart, payment, accounting, auth, SQL/RLS, API, service worker/cache, deployment, or customer data
- multi-step UI flows where a caller depends on existing return shape or state shape
- any phase that needs build bump, tests, commit, push, CI, deploy, or live marker checks

For tiny copy/doc edits, keep the prompt short but still include scope, files, verification, and stop marker.

## Phase Brief Order

Write phase prompts in this order. Do not start with implementation details before the baseline and invariant are clear.

1. Header: phase/build number, slug, severity, and one-sentence goal.
2. Baseline: current build/commit, current bug, evidence, and known data state.
3. Start Gate: docs to read, git commands, clean-tree rule, and stop-if-baseline-mismatch.
4. Scope: allowed files/functions, forbidden files/systems, and whether SQL/schema/RLS is allowed.
5. Target Behavior: user-visible result, data invariant, return shape, failure semantics, and cache/state sync.
6. Implementation Steps: concrete numbered steps, existing helpers to reuse, and required `.ok` checks.
7. Edge Cases: missing data, invalid input, race, partial failure, and caller compatibility.
8. Tests: positive path, negative path, partial failure/rollback, source guard if needed, and existing suites.
9. Verification: exact commands, browser smoke path, CI/deploy/live marker, and acceptable known noise.
10. Docs / Build / Git: build bump markers, docs to update, commit message, push expectations.
11. Final Report: diff summary, verification results, known risks, and STOP marker.

## Hardening Rules For Prompts

- Define the invariant first. Example: "warehouse transfer must not change total stock" is stronger than "fix transfer".
- Define failure semantics after every side effect. If step A succeeds and step B fails, say exactly whether to rollback, retry, warn, or return success with warning.
- Do not assume helpers throw. In this repo many helpers resolve `{ ok:false }`. Prompts must say to check `.ok`.
- Preserve caller contracts. If callers expect `{ ok, error }`, say which extra fields are allowed and which fields must stay.
- Normalize external input once. For quantities, money, dates, and IDs, state the normalized variable and require using it throughout.
- For stock decreases, require CAS/floor unless the phase explicitly allows negative stock.
- For accounting, require balanced debit/credit and idempotency guard.
- For UI rendering from DB/user text, require escaping or `textContent`.
- For PWA delivery, list every marker that must bump together. Do not say only "bump build".
- For tests that grep source, require extraction of the target function/block to avoid false positives from unrelated code.
- For SQL/data fixes, separate "owner must run in Supabase" from "agent can edit repo".
- For manual override behavior, name it explicitly. Do not let an implementer accidentally remove or widen admin override.

## Review Checklist Before Sending To Claude/Codex

- Does it state the exact bug and the exact invariant?
- Does it identify the current baseline build/commit?
- Does it define allowed files and forbidden files?
- Does it say what must happen when an API returns `{ ok:false }`?
- Does it cover partial failure after a successful write?
- Does it preserve existing return shape and caller behavior?
- Does it include at least one negative test?
- Does it include build/cache/docs requirements only when needed?
- Does it include a STOP marker?
- Could an agent implement a larger feature than intended? If yes, narrow the scope.

## Phase Prompt Template

```text
Phase NNN - <slug>

Goal:
<one sentence>

Severity:
<low/medium/high> because <business/data/security reason>

Baseline:
- Start from build <NNN-1>, commit <hash/HEAD of origin/main>.
- Current bug: <exact behavior>.
- Evidence: <file/function/page/prior phase>.
- Stop if baseline does not match.

Before editing:
1. Read IMPLEMENT_TEAM_PROTOCOL.md, PROMPT_PHASE_BRIEF_SKILL.md, SESSION_START_SHARED.md, HANDOFF.md, CHANGELOG.md, CLAUDE.md.
2. Run:
   git fetch origin
   git status --short --branch
   git rev-list --left-right --count HEAD...origin/main
   git log --oneline -5 origin/main
3. Stop if there are uncommitted changes from another session.

Scope:
- Allowed: <files/functions>
- Forbidden: <files/systems>
- SQL/RLS/schema: <allowed/forbidden>

Target behavior:
- <positive behavior>
- <negative/failure behavior>
- Preserve return shape: <contract>
- State/cache sync: <requirement>

Implementation:
1. <step>
2. <step>
3. <step>

Edge cases:
- <case> -> <expected result>
- <case> -> <expected result>

Tests:
- <test 1>
- <test 2>
- Existing suite: npm.cmd run lint:errors, npm.cmd test, npm.cmd run test:e2e

Build/docs:
- Build bump: <yes/no and exact markers>
- Docs: <files>

Commit:
<type(scope,build NNN): subject>

Report back:
- Diff summary
- What changed / what was not touched
- Verification results
- Commit hash / CI / deploy / live marker if applicable
- Known risks
- Stopped here: yes, waiting for owner/Codex review
```

## Example Failure-Semantics Wording

Use wording like this for multi-write phases:

```text
If source decrement succeeds but target increment/create fails, rollback source best-effort and return {ok:false,error:"..."}.
If source+target stock writes succeed but audit/log write fails, do not rollback stock; warn/log the audit failure and report the risk because the business state already changed.
```

This prevents an agent from creating a worse divergence while trying to be "safe".
