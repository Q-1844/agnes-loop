# L3 Skill: Review Process

## Overview

The reviewer executes mechanical checks defined in REVIEW_CRITERIA.json.

## Steps

1. Read REVIEW_CRITERIA.json
2. For each dimension (correctness, security, etc.):
   - For each check:
     - If `execute` is a shell command → run with code_run
     - If `execute` is `__LLM_CHECK__` → SKIP in M1
     - Compare exit_code/output against pass_condition
     - Record PASS/FAIL with evidence
3. If all blockers pass → overall PASS
4. If any blocker fails → overall FAIL

## Common Shell Checks

- TypeScript: `npx tsc --noEmit` (exit 0 = pass)
- Tests: `npm test` (exit 0 = pass)
- Lint: `npx eslint src/` (exit 0 = pass)
- Build: `npm run build` (exit 0 = pass)
- No secrets: `grep -rn 'api_key' src/` (exit 1 = pass, no match)
