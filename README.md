# Spec2Proof

**Spec2Proof** is a PR acceptance execution agent that converts explicit acceptance criteria into an approved execution plan, verifies the change against a non-production target, captures deterministic evidence, and publishes a merge-oriented result.

## Status

The repository now contains the initial runnable architecture for the hackathon MVP. The domain lifecycle, Strands planning/execution adapters, approved-plan guard, assertion evidence ledger, Playwright adapter, AgentCore-compatible runtime, authenticated GitHub webhook ingress, local demo, and core tests are scaffolded.

Production GitHub App authentication, Check Run publishing, durable AWS storage, AgentCore Browser, secret-profile injection, and checkpoint resume are intentionally the next slices rather than placeholder platform abstractions.

## Core workflow

```text
GitHub Pull Request
→ Explicit Acceptance Criteria
→ Strands planning invocation
→ Human plan approval
→ Strands execution invocation
→ Deterministic assertions and evidence
→ GitHub Check result
→ Human merge decision
```

## Architecture

```text
src/
├── apps/              # webhook, AgentCore runtime, local demo
├── domain/            # acceptance/run models and verdict rules
├── application/       # thin use-case orchestration and ports
├── agent/             # Strands prompts, schemas, approved-plan guard, tools
├── adapters/          # in-memory, local file, Playwright
├── github/            # webhook signature and command parsing
├── security/          # URL allowlist and SSRF guardrails
├── config/            # validated runtime configuration
└── observability/     # structured redacted logging
```

The project intentionally remains a single TypeScript package with multiple entrypoints. It will only split into independently versioned packages after a concrete deployment or ownership boundary appears.

## Requirements

- Node.js 22+
- npm
- AWS credentials and access to the configured Bedrock model for live Strands invocations
- Chromium installed by Playwright for real browser execution

## Setup

```bash
npm install
cp .env.example .env
npm run check
```

Generate Playwright browser assets for local execution:

```bash
npx playwright install chromium
```

## Local deterministic demo

This exercises the run lifecycle without AWS, GitHub, or a browser:

```bash
npm run dev:demo
```

## Webhook ingress

```bash
export GITHUB_WEBHOOK_SECRET='replace-with-a-long-random-secret'
npm run dev:webhook
```

Endpoints:

```text
GET  /healthz
POST /webhooks/github
```

The current ingress validates `X-Hub-Signature-256`, enforces a payload limit, parses `/spec2proof` commands, and returns `202`. GitHub installation-token resolution and dispatch are the next integration slice.

## AgentCore-compatible runtime

```bash
export SPEC2PROOF_ALLOWED_HOSTS='staging.example.com'
npm run dev:runtime
```

The runtime uses `BedrockAgentCoreApp`, an explicitly configured Bedrock model, Strands Agents with sequential tool execution, the closed Spec2Proof tool registry, Playwright request interception, URL policy enforcement, and local evidence storage. The browser adapter is replaceable with AgentCore Browser without changing application or domain code.

The trusted result path is:

```text
approved criterion / step / assertion IDs
→ deterministic browser assertion
→ evidence store-issued ID
→ invocation-local evidence ledger
→ enforced criterion result
→ run verdict
```

The model cannot provide its own expected value or arbitrary evidence ID to obtain `PASS` or `FAIL`. A `PASS` is rejected until every approved deterministic assertion and every evidence type required by the plan has been recorded.

## Verification

```bash
npm run typecheck
npm test
npm run build
# or
npm run check
```

## Documentation

- [Requirements SPEC v1.0](docs/specs/spec2proof-pr-acceptance-agent-spec-v1.0.md)
- [Initial architecture](docs/architecture/initial-architecture.md)
- [Agent development rules](AGENTS.md)

## Design principles

- Explicit requirements only
- Thin harness
- One agent role; no multi-agent workflow
- Approved-plan tool boundary
- Evidence-first verification
- Deterministic assertions
- Fail closed
- Two human decision points
- No automatic code changes or PR merges

## License

MIT License
