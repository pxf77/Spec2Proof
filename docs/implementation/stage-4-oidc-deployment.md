# Stage 4: GitHub OIDC deployment automation

Stage 4 adds a manual GitHub Actions deployment path that uses temporary AWS credentials rather than long-lived access keys.

## Security contract

- only `workflow_dispatch` can start deployment;
- jobs run only for `refs/heads/main` after `DEPLOY_NON_PRODUCTION` confirmation;
- the prepare job has `contents: read` and no OIDC permission;
- the deploy job alone has `id-token: write`;
- dependency installation, tests, SAM build, and AgentCore CLI installation finish before any OIDC token can be requested;
- the deploy job downloads a one-day verified artifact and does not check out mutable source;
- project `node_modules` is excluded from the privileged artifact;
- the AWS role ARN is stored as repository variable `AWS_DEPLOY_ROLE_ARN`;
- the GitHub App setup token is scoped to two required steps only;
- all external Actions are pinned to full commit SHAs;
- the AgentCore CLI is pinned to `0.28.1`;
- no workflow path references `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`.

## Deployment sequence

```text
prepare without OIDC
→ verify source and build SAM
→ upload verified bundle
→ deploy job obtains OIDC session
→ foundation stack
→ AgentCore Runtime
→ control-plane stack
→ non-secret summary
```

The Runtime ARN is read from AgentCore CLI deployed state through a tested fail-closed parser. Missing targets, runtimes, or invalid ARNs stop deployment before the control plane is created.

## Account boundary

The repository cannot authorize its own initial AWS OIDC role. An AWS account administrator must create the provider and role once, then set `AWS_DEPLOY_ROLE_ARN` and `SPEC2PROOF_SETUP_TOKEN` in GitHub.

See [the OIDC deployment guide](../deployment/github-actions-oidc.md).
