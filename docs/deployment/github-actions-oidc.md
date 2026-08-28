# Deploy from GitHub Actions with AWS OIDC

The `Deploy Spec2Proof to AWS` workflow deploys the foundation stack, AgentCore Runtime, and GitHub App control plane without storing long-lived AWS access keys in GitHub.

The workflow is manual-only, runs only from `main`, and requires an explicit `DEPLOY_NON_PRODUCTION` confirmation.

## 1. Two-job credential boundary

The workflow deliberately separates build-time package execution from AWS authorization:

```text
prepare job
  permissions: contents: read
  no id-token permission
  → install dependencies
  → run repository checks
  → build the SAM application
  → install the pinned AgentCore CLI locally
  → upload a one-day verified deployment bundle

deploy job
  permissions: actions: read, contents: read, id-token: write
  → download the verified bundle
  → request temporary AWS credentials
  → deploy foundation, Runtime, and control plane
```

The deploy job does not check out repository content and does not run `npm install`, `npm ci`, `npm exec`, or `npx`. Project `node_modules` is excluded from the privileged bundle. Only the pinned local AgentCore CLI and prebuilt SAM artifacts cross the credential boundary.

## 2. Create or select an AWS deployment role

Configure the AWS account with the GitHub OIDC provider:

```text
https://token.actions.githubusercontent.com
Audience: sts.amazonaws.com
```

The role trust policy must permit `sts:AssumeRoleWithWebIdentity` from the repository's `main` branch. This repository uses GitHub immutable OIDC subject identifiers:

```text
repo:pxf77@97281763/Spec2Proof@1346848535:ref:refs/heads/main
```

Example trust statement:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:pxf77@97281763/Spec2Proof@1346848535:ref:refs/heads/main"
    }
  }
}
```

Do not use a wildcard subject granting every branch, pull request, or repository access to the role.

The role needs deployment permissions for resources declared in:

```text
deploy/aws/foundation.yaml
deploy/aws/template.yaml
agentcore/agentcore.json
```

This includes CloudFormation, SAM packaging S3 access, the IAM operations required by the templates, Lambda, API Gateway, SQS, DynamoDB, Secrets Manager, ECR, Bedrock, AgentCore, CloudWatch Logs, X-Ray, and narrowly scoped `iam:PassRole`. Do not attach a permanent administrator policy merely to simplify the first run.

## 3. Configure protected GitHub values

Add these repository Actions values:

| Type | Name | Value |
|---|---|---|
| Variable | `AWS_DEPLOY_ROLE_ARN` | ARN of the OIDC-trusted deployment role |
| Secret | `SPEC2PROOF_SETUP_TOKEN` | Random one-time value of at least 24 characters |

Generate the setup token locally:

```bash
openssl rand -hex 24
```

The token is available only to the input-validation and control-plane deployment steps. It is not exposed at workflow or job scope, and it is never printed.

No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` secret is required.

## 4. Run the deployment workflow

Open:

```text
Actions → Deploy Spec2Proof to AWS → Run workflow
```

Select `DEPLOY_NON_PRODUCTION` and review:

- AWS region;
- browser host allowlist;
- Bedrock model ID;
- foundation and control-plane stack names;
- evidence retention period.

The host allowlist accepts hostnames only. Do not enter a URL, path, localhost, private address, or production host.

## 5. Deployment sequence

```text
unprivileged verified bundle
→ GitHub OIDC role session
→ foundation stack
→ AgentCore Runtime
→ Runtime ARN from fail-closed deployed-state parser
→ prebuilt control-plane stack
→ non-secret job summary
```

Every external Action is pinned to a full commit SHA. The AgentCore CLI is pinned to `0.28.1`. Upgrades require a normal reviewed code change.

## 6. Complete GitHub App registration

The job summary contains a `SetupUrlTemplate` with a placeholder. Replace the placeholder locally with `SPEC2PROOF_SETUP_TOKEN`, then open the URL and create the GitHub App.

The callback stores the generated App ID, PEM private key, and webhook secret directly in AWS Secrets Manager. It does not display those values.

Install the App only on the selected demo repository, then rotate or remove the setup token and disable the setup route in a hardened deployment.

## 7. Rollback and failure handling

The workflow uses `--no-fail-on-empty-changeset`, so an unchanged redeployment is safe. Failed CloudFormation and AgentCore operations remain visible in their native deployment records.

Before retrying:

1. inspect the failing stack event or AgentCore output;
2. correct role policy, model access, allowlist, or template configuration;
3. do not weaken Runtime URL policy, lifecycle transitions, or evidence requirements;
4. rerun the manual workflow from `main`.

Failed webhook and execution messages remain in their respective DLQs for investigation.
