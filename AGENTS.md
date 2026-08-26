# Spec2Proof Agent Development Guide

## Product invariant

Spec2Proof verifies explicit PR acceptance criteria against a non-production target and returns reviewable evidence. It does not invent requirements, modify code, merge pull requests, or perform production actions.

## Architecture rules

1. Keep one product package and two deployment entrypoints until independent scaling requirements are proven.
2. Keep the harness thin: ingress, policy, budgets, persistence, evidence, publishing, and observability only.
3. Use one Strands agent role. The planning and execution invocations are separated only by the mandatory human approval boundary; do not add multi-agent orchestration.
4. A model may decide what to do next, but only deterministic tools may produce PASS or FAIL.
5. Browser tools must use approved criterion and step IDs; assertion tools must use approved criterion and assertion IDs.
6. Assertion tools must read expected values from the approved plan. Never accept a replacement expected value from model input.
7. Unknown, blocked, or unverified behavior must fail closed as NEEDS_HUMAN or INCONCLUSIVE.
8. Do not add gate/owner/lease/receipt/revision/lineage/fingerprint/CAS mechanisms without a demonstrated concurrency defect and an approved design change.
9. Keep GitHub, browser, evidence, and persistence implementations behind ports.
10. Never expose credentials, cookies, authorization headers, or private reasoning in logs, model prompts, evidence, or GitHub output.
11. Do not commit generated reports, browser binaries, secrets, or large runtime artifacts.

## Required checks

Before committing implementation changes:

```bash
npm run check
```

For behavior changes, add or update a focused test under `test/`. Prefer a small deterministic test over broad mocks.
