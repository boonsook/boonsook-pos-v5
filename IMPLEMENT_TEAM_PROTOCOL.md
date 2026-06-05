# Implement Team Protocol - Boonsook POS V5

This is the canonical operating protocol for the implementation team, including Claude Code sessions.

Read this file before changing anything. Do one phase at a time. Stop after the phase and wait for owner/Codex review.

Last updated: 2026-06-05
Latest known app state: version 5.66.0, build 369.

## Role

You are the implement team for Boonsook POS V5, a live business POS/PWA.

Your job is to implement the explicitly approved phase only. Do not invent the next phase. Do not continue after the current phase without review.

## Read Order

At the start of every new session, read in this order:

1. `IMPLEMENT_TEAM_PROTOCOL.md`
2. `PROMPT_PHASE_BRIEF_SKILL.md` when drafting or implementing from a phase prompt
3. `SESSION_START_SHARED.md`
4. Latest relevant section of `HANDOFF.md`
5. Latest relevant section of `CHANGELOG.md`
6. `CLAUDE.md` for review/security guidance

Old Claude files such as `CLAUDE_CODE_PROMPT.md`, `CLAUDE_CODE_WORKFLOW.md`, and `CLAUDE_SESSION_HANDOFF.md` are historical only unless the owner explicitly says otherwise.

## Non-Negotiable Rules

- Work on one phase only.
- Stop after the phase. Do not begin the next phase yourself.
- Do not touch files outside scope.
- Do not overwrite or revert local work from another session.
- Do not change stock, POS, cart, schema, auth, API, accounting, or SQL unless the approved phase explicitly says so.
- Do not auto-save documents, change workflow status, or mutate stock unless explicitly approved.
- Do not call work done until lint, tests, CI/deploy, and live/build checks are reported.
- If scope is unclear, stop and ask.

## Phase Start Checklist

Before editing files, report:

- Current branch and latest commit.
- Ahead/behind versus `origin/main`.
- Whether the working tree is clean.
- Latest build and phase from shared docs.
- Approved phase name.
- Files likely to be touched.
- Files and systems that will not be touched.
- Verification plan.

Required commands:

```bash
git fetch origin
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
git log --oneline -5 origin/main
```

If local changes exist and are not yours, stop and report. Do not stash, reset, revert, or commit them without approval.

## Implementation Rules

- Prefer existing local patterns over new abstractions.
- Keep UI-only work UI-only.
- Escape user/DB text before rendering with `innerHTML`.
- Preserve Thai UI wording unless the phase requests wording changes.
- For PWA/cache changes, bump every required build/cache marker together.
- For air catalog work, remember:
  - The air catalog is not real inventory.
  - Do not link it to `products`, POS cart, stock value, or stock mutation.
  - It is for pricing, quotation drafts, booking, and service-request context only.

## Verification Gates

Run the smallest complete verification for the phase. Default gates:

```bash
npm run lint:errors
npm test
npm run test:e2e
```

For UI/mobile work, also smoke test 390x844 and at least one desktop viewport.

Check for:

- No text overlap.
- No horizontal overflow.
- No floating button covering important content.
- Existing nearby flows still work.
- No forbidden stock/POS/cart/schema/API mutation.

If a test cannot run, report why and the residual risk.

## Commit / Push Rules

Before commit:

```bash
git diff --stat
git diff --name-only
git status --short
```

Commit only scoped files. Use a phase/build-aware message, for example:

```bash
git commit -m "feat(service_jobs,build 352): air job source filter"
```

After push:

- Wait for GitHub Actions Tests.
- Wait for Cloudflare Pages deploy if runtime files changed.
- Verify live build marker when relevant.

## Shared Docs Update

After a phase completes, update:

- `CHANGELOG.md`
- `HANDOFF.md`
- `SESSION_START_SHARED.md`

Keep entries short. Include:

- Phase and build.
- Commit hash.
- Files changed.
- What changed.
- What was not touched.
- Verification results.
- Known risk.
- Next recommended phase.
- STOP marker.

Do not paste a huge transcript. Summarize only the facts needed for the next session.

## Required Final Report Format

Use this format:

```text
Phase:
Build:
Commit:
Files changed:
What changed:
What was NOT touched:
Verification:
- lint:
- tests:
- e2e:
- mobile smoke:
- desktop smoke:
- CI:
- deploy:
Live marker:
Known risks:
Next recommended phase:
Stopped here: yes
```

If `Stopped here` is not `yes`, explain why.
