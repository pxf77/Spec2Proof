# Stage 2 complete

The GitHub App PR acceptance flow implementation was merged through PR #1 and verified on the latest  tree.

## Verified contract

- TypeScript strict type checking passed.
- The focused Node test suite passed.
- The production TypeScript build passed.
- Verification command: 
> spec2proof@0.2.0 check
> npm run typecheck && npm test && npm run build


> spec2proof@0.2.0 typecheck
> tsc -p tsconfig.json --noEmit


> spec2proof@0.2.0 test
> node --import tsx --test test/*.test.ts

TAP version 13
# Subtest: invokes the AgentCore-compatible runtime and validates the run binding
ok 1 - invokes the AgentCore-compatible runtime and validates the run binding
  ---
  duration_ms: 29.229819
  type: 'test'
  ...
# Subtest: parses a run command from a multi-line comment
ok 2 - parses a run command from a multi-line comment
  ---
  duration_ms: 1.283406
  type: 'test'
  ...
# Subtest: requires a reason when rejecting
ok 3 - requires a reason when rejecting
  ---
  duration_ms: 0.273324
  type: 'test'
  ...
# Subtest: verifies the GitHub webhook HMAC signature
ok 4 - verifies the GitHub webhook HMAC signature
  ---
  duration_ms: 0.638083
  type: 'test'
  ...
# Subtest: rejects malformed GitHub webhook signatures
ok 5 - rejects malformed GitHub webhook signatures
  ---
  duration_ms: 0.123548
  type: 'test'
  ...
# Subtest: agent runtime environment applies boolean defaults
ok 6 - agent runtime environment applies boolean defaults
  ---
  duration_ms: 3.368032
  type: 'test'
  ...
# Subtest: agent runtime environment parses explicit boolean strings
ok 7 - agent runtime environment parses explicit boolean strings
  ---
  duration_ms: 0.452183
  type: 'test'
  ...
# Subtest: webhook environment normalizes escaped PEM newlines and URLs
ok 8 - webhook environment normalizes escaped PEM newlines and URLs
  ---
  duration_ms: 2.145408
  type: 'test'
  ...
# Subtest: enforces approved step and browser-session attribution
ok 9 - enforces approved step and browser-session attribution
  ---
  duration_ms: 1.814205
  type: 'test'
  ...
# Subtest: derives PASS from every approved evidenced assertion
ok 10 - derives PASS from every approved evidenced assertion
  ---
  duration_ms: 1.439441
  type: 'test'
  ...
# Subtest: refuses PASS before deterministic assertions complete
ok 11 - refuses PASS before deterministic assertions complete
  ---
  duration_ms: 0.29582
  type: 'test'
  ...
# Subtest: requires every evidence type approved by the plan before PASS
ok 12 - requires every evidence type approved by the plan before PASS
  ---
  duration_ms: 0.695847
  type: 'test'
  ...
# Subtest: rejects assertion evidence that weakens the approved expected value
ok 13 - rejects assertion evidence that weakens the approved expected value
  ---
  duration_ms: 0.318726
  type: 'test'
  ...
# Subtest: a failed assertion can only produce an evidenced FAIL
ok 14 - a failed assertion can only produce an evidenced FAIL
  ---
  duration_ms: 0.436843
  type: 'test'
  ...
# Subtest: creates a signed GitHub App JWT and caches installation tokens
ok 15 - creates a signed GitHub App JWT and caches installation tokens
  ---
  duration_ms: 59.332807
  type: 'test'
  ...
# Subtest: dispatches run and approve commands through the real run lifecycle
ok 16 - dispatches run and approve commands through the real run lifecycle
  ---
  duration_ms: 5.664323
  type: 'test'
  ...
# Subtest: upserts one Check Run and one PR comment across the run lifecycle
ok 17 - upserts one Check Run and one PR comment across the run lifecycle
  ---
  duration_ms: 2.632317
  type: 'test'
  ...
# Subtest: parses the structured Spec2Proof block from a PR body
ok 18 - parses the structured Spec2Proof block from a PR body
  ---
  duration_ms: 11.452431
  type: 'test'
  ...
# Subtest: fails closed when the structured Spec2Proof block is missing
ok 19 - fails closed when the structured Spec2Proof block is missing
  ---
  duration_ms: 0.433438
  type: 'test'
  ...
# Subtest: rejects criteria that mix deterministic and human outcomes
ok 20 - rejects criteria that mix deterministic and human outcomes
  ---
  duration_ms: 1.407466
  type: 'test'
  ...
# Subtest: cancellation remains terminal while an execution request unwinds
ok 21 - cancellation remains terminal while an execution request unwinds
  ---
  duration_ms: 3.347546
  type: 'test'
  ...
# Subtest: runs through the two lifecycle boundaries
ok 22 - runs through the two lifecycle boundaries
  ---
  duration_ms: 3.901279
  type: 'test'
  ...
# Subtest: rejects approval for a stale head SHA
ok 23 - rejects approval for a stale head SHA
  ---
  duration_ms: 1.005764
  type: 'test'
  ...
# Subtest: rejects a generated plan that weakens an expected outcome
ok 24 - rejects a generated plan that weakens an expected outcome
  ---
  duration_ms: 0.417118
  type: 'test'
  ...
# Subtest: allows an exact HTTPS host
ok 25 - allows an exact HTTPS host
  ---
  duration_ms: 0.992562
  type: 'test'
  ...
# Subtest: rejects an unlisted host
ok 26 - rejects an unlisted host
  ---
  duration_ms: 0.597715
  type: 'test'
  ...
# Subtest: rejects private hosts unless explicitly enabled
ok 27 - rejects private hosts unless explicitly enabled
  ---
  duration_ms: 0.237236
  type: 'test'
  ...
# Subtest: rejects IPv6 loopback and unique-local hosts
ok 28 - rejects IPv6 loopback and unique-local hosts
  ---
  duration_ms: 0.355568
  type: 'test'
  ...
# Subtest: rejects malformed host allowlist rules
ok 29 - rejects malformed host allowlist rules
  ---
  duration_ms: 0.21975
  type: 'test'
  ...
# Subtest: PASS requires every criterion to pass
ok 30 - PASS requires every criterion to pass
  ---
  duration_ms: 1.239443
  type: 'test'
  ...
# Subtest: FAIL has precedence while blocked coverage remains incomplete
ok 31 - FAIL has precedence while blocked coverage remains incomplete
  ---
  duration_ms: 0.135772
  type: 'test'
  ...
# Subtest: missing results are inconclusive
ok 32 - missing results are inconclusive
  ---
  duration_ms: 0.098129
  type: 'test'
  ...
# Subtest: PASS without evidence is inconclusive
ok 33 - PASS without evidence is inconclusive
  ---
  duration_ms: 0.156084
  type: 'test'
  ...
# Subtest: an evidenced failure still fails while unproven coverage remains incomplete
ok 34 - an evidenced failure still fails while unproven coverage remains incomplete
  ---
  duration_ms: 0.120736
  type: 'test'
  ...
1..34
# tests 34
# suites 0
# pass 34
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1067.844858

> spec2proof@0.2.0 build
> tsc -p tsconfig.build.json.
- Verified main SHA: .

## Implemented boundary

GitHub App authentication, installation-scoped REST access, bounded PR context retrieval, structured acceptance-spec parsing, reviewer authorization, Check Run and summary-comment publication, Agent Runtime execution, stale-SHA invalidation, and terminal cancellation handling are connected to the existing thin application core.
