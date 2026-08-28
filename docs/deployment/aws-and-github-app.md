# Deploy Spec2Proof on AWS and register the GitHub App

This runbook deploys the production control plane, the AgentCore Runtime, AgentCore Browser, persistent run storage, and S3 evidence storage. It intentionally keeps account-bound values out of Git.

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

Install the CLI and prepare account-specific configuration:

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

The bootstrap script patches only account-specific values in the local AgentCore configuration, writes the ignored `agentcore/aws-targets.json`, runs the project checks, validates the AgentCore configuration, and performs a deployment dry run.

The runtime uses:

```text
Strands Agent
+ AWS IAM inbound authentication
+ managed AgentCore Browser
+ S3 evidence store
+ Node.js 22 container
```

Copy the runtime ARN from `agentcore status --json`.

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
- a webhook Lambda that only authenticates, deduplicates, and enqueues;
- a FIFO queue grouped by repository and PR number;
- a worker Lambda for planning, approval, execution, and GitHub publishing;
- a DynamoDB run table and PR-created index;
- a DynamoDB delivery table with TTL;
- a Secrets Manager secret for GitHub App credentials;
- a DLQ for failed webhook records.

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

Install the created App on the repository that will contain the demo PR.

## 6. Publish DemoShop

Run the E2E test locally first:

```bash
npx playwright install chromium
npm run check:e2e
```

Then enable GitHub Pages for the repository with GitHub Actions as the source and manually run:

```text
Deploy DemoShop to GitHub Pages
```

Expected URL:

```text
https://pxf77.github.io/Spec2Proof/
```

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
3. every PASS or FAIL contains deterministic assertion evidence;
4. screenshots and assertion records are present in S3;
5. `agentcore logs --runtime Spec2ProofRuntime` shows the runtime invocation;
6. a new PR commit invalidates an uncompleted old run.

## 8. Failure demonstration

Append this query to the DemoShop target to intentionally expose the expired-coupon defect:

```text
?fault=expired-coupon
```

The application incorrectly applies `EXPIRED20`. Spec2Proof should return FAIL with expected `Coupon expired`, actual `Discount applied`, and unchanged-total assertion evidence.

## 9. Security boundary

- do not point `SPEC2PROOF_ALLOWED_HOSTS` at production;
- do not commit `agentcore/aws-targets.json`, `.env.local`, PEM files, or setup tokens;
- rotate the setup token after registration;
- remove the setup Lambda route after registration in hardened deployments;
- keep GitHub App installation scope limited to selected repositories;
- use synthetic users and synthetic order data only.
