# Spec2Proof

**Spec2Proof** is a GitHub-native PR acceptance execution agent. It converts explicit acceptance criteria into an approved execution plan, verifies the change against a non-production target, captures deterministic evidence, and publishes a merge-oriented GitHub Check.

## Current status

The repository contains the first end-to-end GitHub App integration slice:

- GitHub App JWT creation and Installation Token caching;
- authenticated, deduplicated webhook ingress;
- real PR metadata plus bounded changed-file patch context retrieval;
- structured acceptance-spec parsing from the PR description;
- Strands planning invocation;
- human plan approval through PR commands;
- AgentCore-compatible runtime invocation;
- one updatable PR summary comment and one Check Run per run;
- reviewer permission enforcement;
- stale-run cancellation after a new PR head commit;
- failed/blocked criterion rerun planning on the same head SHA.

The run store and delivery deduplication store are currently in-memory. Durable AWS storage and managed AgentCore Browser are the next infrastructure slices.

## Core workflow

```text
GitHub Pull Request
→ /spec2proof run
→ GitHub App reads PR + structured acceptance criteria
→ Strands creates an execution plan
→ Check Run queued + plan comment
→ /spec2proof approve
→ reviewer permission and current Head SHA verified
→ AgentCore-compatible runtime executes the approved plan
→ deterministic assertions and evidence
→ Check Run completed + result comment
→ human merge decision
```

## Architecture

```text
src/
├── apps/              # webhook and AgentCore-compatible runtime entrypoints
├── domain/            # acceptance/run models and verdict rules
├── application/       # thin use-case orchestration and ports
├── agent/             # Strands prompts, schemas, approved-plan guard, tools
├── adapters/          # in-memory, runtime HTTP, local file, Playwright
├── github/            # App auth, API client, PR source, dispatcher, publisher
├── security/          # URL allowlist and SSRF guardrails
├── config/            # validated runtime configuration
└── observability/     # structured redacted logging
```

The project intentionally remains one TypeScript package with two deployment entrypoints. It does not use a multi-agent graph or a complex workflow state machine.

## Requirements

- Node.js 22+
- npm
- a GitHub App
- AWS credentials and Bedrock model access for live planning/execution
- Chromium installed by Playwright for the runtime

## Install

```bash
npm install
cp .env.example .env
npm run check
npx playwright install chromium
```

## GitHub App configuration

Configure the GitHub App with the following repository permissions:

| Permission | Level | Purpose |
|---|---|---|
| Metadata | Read | Repository identity |
| Pull requests | Read | PR metadata and changed files |
| Issues | Write | Create/update the PR conversation comment |
| Checks | Write | Create/update the Spec2Proof Check Run |

Subscribe to these webhook events:

- Issue comment
- Pull request

Set the webhook URL to:

```text
POST https://<host>/webhooks/github
```

The service validates `X-Hub-Signature-256`, deduplicates `X-GitHub-Delivery`, and acknowledges accepted deliveries before model or runtime work begins.

## Environment

Webhook process:

```bash
export GITHUB_WEBHOOK_SECRET='replace-with-a-long-random-secret'
export GITHUB_APP_ID='123456'
export GITHUB_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
export SPEC2PROOF_AGENT_RUNTIME_URL='http://127.0.0.1:8080/invocations'
npm run dev:webhook
```

Agent runtime:

```bash
export SPEC2PROOF_ALLOWED_HOSTS='staging.example.com,api-staging.example.com'
npm run dev:runtime
```

Health endpoints:

```text
GET /healthz   # webhook service
GET /ping      # AgentCore-compatible runtime
```

## PR acceptance format

Spec2Proof fails closed when a PR does not contain a structured YAML block.

```yaml
spec2proof:
  target:
    environment: staging
    base_url: https://staging.example.com
  criteria:
    - id: AC-001
      description: Valid users reach the dashboard
      preconditions:
        - A synthetic active user exists
      automation_class: AUTO
      expected:
        - type: url
          matches: /dashboard
          mode: prefix

    - id: AC-002
      description: Dashboard heading is visible
      expected:
        - type: element
          selector_hint: Dashboard heading
          visible: true

    - id: AC-003
      description: Reviewer confirms the visual brand treatment
      automation_class: HUMAN
      expected:
        - type: human
          reason: Subjective visual review
```

Supported deterministic outcomes:

- `url`
- `text`
- `element`
- `http_status`
- `json_path`

Human and deterministic outcomes must be split into separate criteria.

## PR commands

```text
/spec2proof run
/spec2proof approve
/spec2proof reject <reason>
/spec2proof cancel
/spec2proof rerun-failed
/spec2proof status
```

`approve`, `reject`, `cancel`, and `rerun-failed` require `write`, `maintain`, or `admin` repository permission. Approval is valid only for the exact PR Head SHA used by the plan.

## Trusted result path

```text
approved criterion / step / assertion IDs
→ deterministic browser assertion
→ evidence store-issued ID
→ invocation-local evidence ledger
→ enforced criterion result
→ run verdict
→ GitHub Check conclusion
```

The model cannot supply a replacement expected value or an arbitrary evidence ID to obtain `PASS`. Unknown, blocked, or unverified behavior becomes `NEEDS_HUMAN` or `INCONCLUSIVE`.

## Local deterministic demo

This exercises the domain lifecycle without GitHub, AWS, or a browser:

```bash
npm run dev:demo
```

## Verification

```bash
npm run typecheck
npm test
npm run build
# or
npm run check
```

CI runs the same `npm run check` command for pushes and pull requests.

## Documentation

- [Requirements SPEC v1.0](docs/specs/spec2proof-pr-acceptance-agent-spec-v1.0.md)
- [Initial architecture](docs/architecture/initial-architecture.md)
- [GitHub integration architecture](docs/architecture/github-integration.md)
- [Agent development rules](AGENTS.md)

## Explicit non-goals

- automatic code modification;
- automatic PR approval or merge;
- production-environment execution;
- arbitrary shell access;
- hidden requirements inferred from a diff;
- multi-agent orchestration for the MVP;
- Gate/Owner/Lease/Receipt/Revision/Lineage/Fingerprint/CAS machinery.

## License

MIT License
