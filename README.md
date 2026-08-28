# Spec2Proof

**Spec2Proof** is a GitHub-native PR acceptance execution agent. It converts explicit acceptance criteria into an approved execution plan, verifies the change against a non-production target, captures deterministic evidence, and publishes a merge-oriented GitHub Check.

## Current status

The repository contains the verified Stage 3 runtime architecture and the Stage 4 deployment path:

- GitHub App JWT and Installation Token authentication;
- webhook HMAC verification and persistent delivery deduplication;
- a per-PR FIFO command queue for ordered GitHub events;
- a separate FIFO execution queue for long-running AgentCore work;
- persistent DynamoDB run storage with strongly consistent latest-run pointers;
- lifecycle-conditional writes preventing stale completion from replacing cancellation;
- real PR metadata and bounded changed-file context for planning;
- compact persisted PR context that excludes raw patches;
- structured acceptance-spec parsing from the PR description;
- Strands planning plus reviewer approval;
- AWS SDK invocation of AgentCore Runtime from an execution worker;
- managed AgentCore Browser adapter;
- S3 evidence storage;
- one updatable PR summary and one Check Run per acceptance run;
- GitHub App manifest setup that stores generated credentials directly in Secrets Manager;
- a deterministic DemoShop target with Playwright E2E coverage;
- AWS SAM and AgentCore deployment assets;
- a manual GitHub OIDC deployment workflow with pinned actions and no long-lived AWS keys.

Account-bound AWS authorization, GitHub Pages enablement, and GitHub App installation remain explicit operator actions. Credentials and generated deployment state are not committed.

## Core workflow

```text
GitHub Pull Request comment
→ authenticated webhook Lambda
→ delivery TTL check
→ per-PR FIFO command queue
→ GitHub command worker
→ explicit acceptance criteria + bounded diff context
→ Strands execution plan
→ human approval
→ durable RUNNING transition
→ FIFO execution queue
→ execution worker
→ AgentCore Runtime
→ AgentCore Browser
→ deterministic assertions + S3 evidence
→ lifecycle-conditional DynamoDB completion
→ GitHub Check + singleton PR summary
→ human merge decision
```

`/spec2proof cancel` and `pull_request.synchronize` remain processable while AgentCore execution is running because the command worker does not block on the runtime invocation. A late runtime result cannot overwrite a durable `CANCELLED` verdict.

## Architecture

```text
src/
├── apps/              # local servers, Lambda handlers, workers, AgentCore runtime
├── domain/            # acceptance/run models and verdict rules
├── application/       # thin use-case orchestration and ports
├── agent/             # Strands prompts, schemas, approved-plan guard, tools
├── adapters/          # local execution, Playwright, scheduling adapters
├── aws/               # DynamoDB, SQS, S3, Secrets Manager, AgentCore SDK
├── deployment/        # fail-closed deployment-state parsing
├── execution/         # durable execution-message contract
├── github/            # App auth, PR source, dispatcher, Check/comment publisher
├── webhook/           # authenticated ingress and queued webhook contract
├── security/          # URL allowlist and SSRF guardrails
├── config/            # validated local and AWS environment configuration
└── observability/     # structured redacted logging
```

The project remains one TypeScript package. Planning and execution are separate invocations only because a human approval boundary exists between them. There is no multi-agent graph or expanded workflow state machine.

## Requirements

- Node.js 22+
- npm
- AWS credentials and Bedrock model access for local live planning/execution
- AWS SAM CLI and AgentCore CLI for direct deployment
- an AWS OIDC deployment role for GitHub Actions deployment
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

The local webhook uses direct in-process execution. The deployed AWS control plane uses the separate command and execution queues defined in `deploy/aws/template.yaml`.

## Deploy

Direct operator deployment:

- [AWS, AgentCore, and GitHub App deployment](docs/deployment/aws-and-github-app.md)

GitHub Actions deployment with temporary AWS credentials:

- [GitHub Actions OIDC deployment](docs/deployment/github-actions-oidc.md)

The OIDC workflow is manual-only, accepts only a confirmed non-production host allowlist, runs only from `main`, pins all actions to commit SHAs, and reads the AWS role ARN from `AWS_DEPLOY_ROLE_ARN`. It does not use `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`.

Deployment is split into two explicit stacks:

1. `deploy/aws/foundation.yaml` creates the private evidence bucket and AgentCore execution role.
2. `deploy/aws/template.yaml` creates the GitHub App control plane after the AgentCore Runtime ARN is known.

The GitHub App setup endpoint uses GitHub's manifest flow and requests only Checks write, Contents read, Issues write, and Pull requests read. The callback writes the generated App ID, PEM private key, and webhook secret directly to Secrets Manager.

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

Repeated commands are idempotent at the GitHub publishing boundary. Repeated `/spec2proof run` republishes the active plan, and duplicate execution deliveries re-publish the stored terminal result instead of executing a completed run again.

## Trusted result path

```text
approved criterion / step / assertion IDs
→ deterministic browser assertion
→ evidence store-issued ID
→ invocation-local evidence ledger
→ enforced criterion result
→ lifecycle-conditional persisted verdict
→ GitHub Check conclusion
```

The model cannot supply a replacement expected value or arbitrary evidence ID to obtain PASS. Unknown, blocked, or unverified behavior becomes `NEEDS_HUMAN` or `INCONCLUSIVE`.

## Verification

```bash
npm run check       # strict typecheck, unit tests, build, deployment topology and OIDC workflow checks
npm run check:e2e   # DemoShop browser tests
```

## Documentation

- [Requirements SPEC v1.0](docs/specs/spec2proof-pr-acceptance-agent-spec-v1.0.md)
- [Initial architecture](docs/architecture/initial-architecture.md)
- [GitHub integration architecture](docs/architecture/github-integration.md)
- [AWS and GitHub App deployment](docs/deployment/aws-and-github-app.md)
- [GitHub Actions OIDC deployment](docs/deployment/github-actions-oidc.md)
- [Stage 3 verified completion](docs/implementation/stage-3-complete.md)
- [Stage 4 OIDC deployment automation](docs/implementation/stage-4-oidc-deployment.md)
- [Agent development rules](AGENTS.md)

## Explicit non-goals

- automatic code modification;
- automatic PR approval or merge;
- production-environment execution;
- arbitrary shell access;
- hidden requirements inferred from a diff;
- multi-agent orchestration for the MVP;
- generic Gate/Owner/Lease/Receipt/Revision/Lineage/Fingerprint or CAS protocols.

The storage layer contains one narrow lifecycle precondition because a concrete stale-write race was demonstrated. It is not exposed as a workflow framework or business state machine.

## License

MIT License
