# Spec2Proof

**Spec2Proof** is a GitHub-native PR acceptance execution agent. It converts explicit acceptance criteria into an approved execution plan, verifies the change against a non-production target, captures deterministic evidence, and publishes a merge-oriented GitHub Check.

## Current status

The repository now contains a deployable Stage 3 architecture:

- GitHub App JWT and Installation Token authentication;
- webhook HMAC verification and persistent delivery deduplication;
- FIFO webhook queueing grouped by repository and pull request;
- persistent DynamoDB run storage;
- real PR metadata and bounded changed-file context;
- structured acceptance-spec parsing from the PR description;
- Strands planning plus reviewer approval;
- AWS SDK invocation of AgentCore Runtime;
- managed AgentCore Browser adapter;
- S3 evidence storage;
- one updatable PR summary and one Check Run per acceptance run;
- GitHub App manifest setup that stores generated credentials directly in Secrets Manager;
- a deterministic DemoShop target with Playwright E2E coverage;
- AWS SAM and AgentCore deployment assets.

Account-bound AWS provisioning and GitHub App installation are performed with the deployment runbook; credentials and generated deployment state are not committed.

## Core workflow

```text
GitHub Pull Request comment
→ authenticated webhook Lambda
→ delivery TTL check
→ per-PR FIFO queue
→ GitHub worker
→ explicit acceptance criteria + bounded diff context
→ Strands execution plan
→ human approval
→ AgentCore Runtime
→ AgentCore Browser
→ deterministic assertions + S3 evidence
→ DynamoDB run result
→ GitHub Check + singleton PR summary
→ human merge decision
```

## Architecture

```text
src/
├── apps/              # local servers, Lambda handlers, AgentCore runtime
├── domain/            # acceptance/run models and verdict rules
├── application/       # thin use-case orchestration and ports
├── agent/             # Strands prompts, schemas, approved-plan guard, tools
├── adapters/          # local Playwright and managed AgentCore Browser
├── aws/               # DynamoDB, SQS, S3, Secrets Manager, AgentCore SDK
├── github/            # App auth, PR source, dispatcher, Check/comment publisher
├── webhook/           # authenticated ingress and queued message contract
├── security/          # URL allowlist and SSRF guardrails
├── config/            # validated local and AWS environment configuration
└── observability/     # structured redacted logging
```

The project remains one TypeScript package. Planning and execution are separate invocations only because a human approval boundary exists between them. There is no multi-agent graph or expanded workflow state machine.

## Requirements

- Node.js 22+
- npm
- AWS credentials and Bedrock model access for live planning/execution
- AWS SAM CLI and AgentCore CLI for deployment
- Playwright Chromium for DemoShop E2E verification

## Install and verify

```bash
npm install
cp .env.example .env
npm run check
npx playwright install chromium
npm run check:e2e
```

## Local development

Deterministic lifecycle demo:

```bash
npm run dev:demo
```

DemoShop:

```bash
npm run dev:demo-shop
```

Local webhook and runtime:

```bash
npm run dev:runtime
npm run dev:webhook
```

## Deploy

Follow the complete runbook:

- [AWS, AgentCore, and GitHub App deployment](docs/deployment/aws-and-github-app.md)

Deployment is split into two explicit stacks:

1. `deploy/aws/foundation.yaml` creates the private evidence bucket and AgentCore execution role.
2. `deploy/aws/template.yaml` creates the GitHub webhook/control plane after the AgentCore Runtime ARN is known.

The GitHub App setup endpoint uses GitHub's manifest flow and requests only Checks write, Contents read, Issues write, and Pull requests read. The callback writes the generated App ID, PEM, and webhook secret directly to Secrets Manager.

## DemoShop

`demo-shop/` is a static deterministic application for the public demonstration:

- `SAVE20` reduces `100.00` to `80.00`;
- `EXPIRED20` returns `Coupon expired` and keeps `100.00`;
- synthetic checkout reaches `#/order/success`;
- `?fault=expired-coupon` deliberately exposes a defect for the failure demo.

Run `DemoShop E2E` in Actions for browser verification. After GitHub Pages is enabled, manually run `Deploy DemoShop to GitHub Pages`.

Prepared acceptance criteria:

- [Demo PR body](docs/demo/pr-body.md)

## PR acceptance format

Spec2Proof fails closed when the PR does not contain a structured YAML block.

```yaml
spec2proof:
  target:
    environment: demo
    base_url: https://pxf77.github.io/Spec2Proof/
  criteria:
    - id: AC-001
      description: SAVE20 reduces the order total to 80.00
      preconditions:
        - DemoShop is open
      automation_class: AUTO
      expected:
        - type: text
          selector: '[data-testid="order-total"]'
          value: "80.00"
          mode: exact
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
→ persisted run verdict
→ GitHub Check conclusion
```

The model cannot supply a replacement expected value or arbitrary evidence ID to obtain PASS. Unknown, blocked, or unverified behavior becomes `NEEDS_HUMAN` or `INCONCLUSIVE`.

## Verification

```bash
npm run check       # strict typecheck, unit tests, build, deployment template checks
npm run check:e2e   # DemoShop browser tests
```

## Documentation

- [Requirements SPEC v1.0](docs/specs/spec2proof-pr-acceptance-agent-spec-v1.0.md)
- [Initial architecture](docs/architecture/initial-architecture.md)
- [GitHub integration architecture](docs/architecture/github-integration.md)
- [AWS and GitHub App deployment](docs/deployment/aws-and-github-app.md)
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
