# Stage 4: GitHub OIDC deployment automation

Stage 4 adds a manual GitHub Actions deployment path that does not require long-lived AWS keys.

## Security contract

- only `workflow_dispatch` can start deployment;
- the workflow job runs only from `refs/heads/main`;
- the operator must select `DEPLOY_NON_PRODUCTION`;
- `contents` remains read-only;
- `id-token: write` is used solely for AWS OIDC;
- the AWS role ARN is stored as a repository variable;
- the GitHub App setup token is stored as a masked repository secret;
- all external actions are pinned to full commit SHAs;
- the AgentCore CLI is pinned to `0.28.1`;
- the workflow never references long-lived AWS access-key variables.

## Deployment sequence

```text
OIDC role session
→ repository checks
→ foundation stack
→ AgentCore Runtime
→ control-plane stack
→ non-secret job summary
```

The runtime ARN is read from the AgentCore CLI's deployed-state structure through a tested fail-closed parser. Missing targets, runtimes, or invalid ARNs stop deployment before the control plane is created.

## Account boundary

The repository cannot create or authorize the initial AWS OIDC role without an existing trusted AWS principal. An account administrator must create the provider and role once, then set `AWS_DEPLOY_ROLE_ARN` and `SPEC2PROOF_SETUP_TOKEN` in GitHub.

See [the OIDC deployment guide](../deployment/github-actions-oidc.md).
