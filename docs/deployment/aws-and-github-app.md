# Deploy Spec2Proof on AWS and register the GitHub App

This runbook deploys the production control plane, AgentCore Runtime, managed AgentCore Browser, persistent run storage, and S3 evidence storage. Account-bound values remain outside Git.

## 1. Prerequisites

- Node.js 22 or later;
- AWS CLI, AWS SAM CLI, AWS CDK, and Docker/Podman/Finch;
- `@aws/agentcore` CLI;
- AWS credentials with permission to deploy CloudFormation, Lambda, API Gateway, SQS, DynamoDB, S3, IAM, Secrets Manager, Bedrock, and AgentCore;
- Bedrock access for the configured model;
- a public HTTPS target that is not a production system.

```bash
npm install
npm install -g @aws/agentcore
npm run check
aws sts get-caller-identity
```

## 2. Deploy the evidence foundation

```bash
sam deploy \
  --template-file deploy/aws/foundation.yaml \
  --stack-name spec2proof-foundation \
  --capabilities CAPABILITY_IAM \
  --guided
```

Record these outputs:

```text
EvidenceBucketName
RuntimeExecutionRoleArn
RuntimeManagedPolicyArn
```

The evidence bucket is private, encrypted, and lifecycle-managed. The execution role is scoped to Bedrock model invocation, AgentCore Browser session operations, telemetry, and the evidence bucket.

## 3. Configure and deploy the AgentCore Runtime

```bash
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="us-west-2"
export SPEC2PROOF_EVIDENCE_BUCKET="<EvidenceBucketName>"
export SPEC2PROOF_AGENTCORE_EXECUTION_ROLE_ARN="<RuntimeExecutionRoleArn>"
export SPEC2PROOF_ALLOWED_HOSTS="pxf77.github.io"

node scripts/bootstrap-agentcore.mjs
agentcore deploy -y
agentcore status --json
```

The bootstrap script patches account-specific values only in the local AgentCore configuration, writes the ignored `agentcore/aws-targets.json`, runs project checks, validates AgentCore configuration, and performs a deployment dry run.

The runtime uses:

```text
Strands Agent
+ AWS IAM inbound authentication
+ managed AgentCore Browser
+ S3 evidence store
+ Node.js 22 container
```

Copy the Runtime ARN from `agentcore status --json`.

## 4. Deploy the GitHub control plane

Generate a one-time setup token with at least 24 random characters:

```bash
export SPEC2PROOF_SETUP_TOKEN="$(openssl rand -hex 24)"
```

Deploy:

```bash
sam build --template-file deploy/aws/template.yaml
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name spec2proof-control-plane \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AgentRuntimeArn="<AgentCore Runtime ARN>" \
    SetupToken="$SPEC2PROOF_SETUP_TOKEN" \
  --guided
```

The stack creates:

- an API Gateway HTTP API;
- a webhook Lambda that authenticates, deduplicates, and enqueues deliveries;
- a per-PR FIFO command queue and DLQ;
- a command worker for PR context, planning, approval, cancellation, invalidation, and GitHub publication;
- a separate FIFO execution queue and DLQ;
- an execution worker that invokes AgentCore Runtime and commits the terminal result;
- a DynamoDB run table containing run items and strongly consistent latest-run pointer items;
- lifecycle-conditional run updates preventing stale execution completion from replacing cancellation;
- a DynamoDB delivery table with TTL;
- a Secrets Manager secret for GitHub App credentials.

The command worker never waits for AgentCore execution. This preserves ordered handling of `/cancel` and `pull_request.synchronize` while the execution worker is active.

## 5. Register the GitHub App from the manifest

Open the stack output `SetupUrlTemplate`, replace the placeholder with the setup token, and follow the page:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/setup/github-app?token=<setup-token>
```

The manifest requests only:

| Permission | Level |
|---|---|
| Checks | Write |
| Contents | Read |
| Issues | Write |
| Pull requests | Read |

Events:

```text
issue_comment
pull_request
```

GitHub redirects to the callback. The callback exchanges the temporary manifest code and writes the App ID, PEM private key, and webhook secret directly to AWS Secrets Manager. The browser response never displays those secrets.

Install the created App only on the repository or repositories used for Spec2Proof verification.

## 6. Publish DemoShop

Run the E2E test locally first:

```bash
npx playwright install chromium
npm run check:e2e
```

Enable GitHub Pages for the repository with **GitHub Actions** as its source, then manually run:

```text
Deploy DemoShop to GitHub Pages
```

Expected URL:

```text
https://pxf77.github.io/Spec2Proof/
```

Confirm the target is reachable before adding `pxf77.github.io` to the AgentCore Runtime allowlist.

## 7. Execute the real PR flow

Use [the prepared Demo PR body](../demo/pr-body.md), create a PR, and comment:

```text
/spec2proof run
```

After the plan appears:

```text
/spec2proof approve
```

Expected observable outputs:

1. one `Spec2Proof` Check Run moves from queued to in progress to completed;
2. one marker-based PR summary comment is updated in place;
3. approval returns after durable scheduling rather than waiting for browser execution;
4. every PASS or FAIL contains deterministic assertion evidence;
5. screenshots and assertion records are present in S3;
6. AgentCore logs show the runtime invocation;
7. a new PR commit can cancel an uncompleted run while execution is active;
8. a late execution response cannot replace the stored `CANCELLED` verdict.

## 8. Failure demonstration

Append this query to the DemoShop target to expose the deliberate expired-coupon defect:

```text
?fault=expired-coupon
```

The application incorrectly applies `EXPIRED20`. Spec2Proof should return FAIL with expected `Coupon expired`, actual `Discount applied`, and total assertion evidence.

After the target is fixed, `/spec2proof rerun-failed` rereads the current PR SPEC, verifies the same Head SHA, retains the current target URL, and plans only failed or blocked criteria.

## 9. Operational checks

```bash
aws cloudformation describe-stacks --stack-name spec2proof-foundation
aws cloudformation describe-stacks --stack-name spec2proof-control-plane
agentcore status --json
```

Check the following resources:

```text
WebhookQueue / WebhookDeadLetterQueue
ExecutionQueue / ExecutionDeadLetterQueue
RunsTable
DeliveriesTable
GitHubWorkerFunction
RunExecutionWorkerFunction
GitHubAppCredentialsSecret
```

No PR patch body is persisted in the Runs table. The patch is planning context only, and the stored run retains file metadata without raw patch text.

## 10. Security boundary

- do not point `SPEC2PROOF_ALLOWED_HOSTS` at production;
- do not commit `agentcore/aws-targets.json`, `.env.local`, PEM files, or setup tokens;
- rotate or remove the setup token after registration;
- remove the setup route after registration in hardened deployments;
- limit GitHub App installation scope to selected repositories;
- use synthetic users and synthetic order data only;
- investigate DLQ records before redrive;
- do not weaken lifecycle-conditional writes or evidence requirements to recover a failed run.
