# Deploy from GitHub Actions with AWS OIDC

The `Deploy Spec2Proof to AWS` workflow performs the foundation, AgentCore Runtime, and control-plane deployments without storing long-lived AWS access keys in GitHub.

The workflow is manual-only, runs only from `main`, requires an explicit `DEPLOY_NON_PRODUCTION` confirmation, and requests only:

```yaml
permissions:
  contents: read
  id-token: write
```

## 1. Create or select an AWS deployment role

Configure the AWS account with the GitHub OIDC provider:

```text
https://token.actions.githubusercontent.com
Audience: sts.amazonaws.com
```

The role trust policy must permit `sts:AssumeRoleWithWebIdentity` from the repository's `main` branch. This repository was created after GitHub introduced immutable OIDC subject identifiers, so the expected subject is:

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

Do not use a wildcard subject that grants every branch, pull request, or repository access to the deployment role.

The role needs deployment permissions for the resources declared in:

```text
deploy/aws/foundation.yaml
deploy/aws/template.yaml
agentcore/agentcore.json
```

That includes CloudFormation, SAM packaging S3 access, IAM role and policy management required by the templates, Lambda, API Gateway, SQS, DynamoDB, Secrets Manager, ECR, Bedrock, AgentCore, CloudWatch Logs, X-Ray, and `iam:PassRole` for the created execution roles. Apply the narrowest policy compatible with the deployment in the target account; do not attach a permanent administrator policy merely to simplify the first run.

## 2. Configure GitHub protected values

In the repository settings, add:

| Type | Name | Value |
|---|---|---|
| Actions variable | `AWS_DEPLOY_ROLE_ARN` | ARN of the OIDC-trusted deployment role |
| Actions secret | `SPEC2PROOF_SETUP_TOKEN` | Random one-time value of at least 24 characters |

Generate the setup token locally:

```bash
openssl rand -hex 24
```

The token protects the temporary GitHub App manifest setup endpoint. The workflow passes it to CloudFormation as a `NoEcho` parameter and never prints it in logs or the job summary.

No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` secret is required.

## 3. Run the deployment workflow

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

## 4. What the workflow does

```text
GitHub OIDC token
→ temporary AWS role session
→ npm verification
→ deploy foundation stack
→ read evidence bucket and Runtime role outputs
→ validate and deploy AgentCore Runtime
→ read runtime ARN from AgentCore deployed state
→ build and deploy control-plane stack
→ publish non-secret outputs to the job summary
```

The workflow pins every third-party action to an immutable commit SHA and pins the AgentCore CLI version. Upgrades must be reviewed as normal code changes.

## 5. Complete GitHub App registration

The job summary contains a `SetupUrlTemplate` with a placeholder. Replace the placeholder locally with the protected `SPEC2PROOF_SETUP_TOKEN`, open the URL, and create the GitHub App.

The callback stores the generated App ID, PEM private key, and webhook secret directly in AWS Secrets Manager. It does not display those values.

Install the App only on the selected demo repository, then rotate or remove the setup token and disable the setup route in a hardened deployment.

## 6. Rollback and failure handling

The workflow uses `--no-fail-on-empty-changeset`, so re-running an unchanged deployment is safe. A failed CloudFormation deployment remains visible in the stack events. AgentCore deployment state remains in the ephemeral runner only and is not committed.

Before retrying:

1. inspect the failing CloudFormation stack event or AgentCore deployment output;
2. correct the role policy, model access, allowlist, or template issue;
3. do not weaken the Runtime URL policy or evidence contract;
4. rerun the manual workflow from `main`.

Failed webhook and execution messages remain in their respective DLQs for investigation.
