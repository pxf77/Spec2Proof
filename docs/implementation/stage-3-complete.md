# Stage 3 verified completion

Stage 3 was merged through PR #2 on August 28, 2026.

## Verified main baseline

```text
Main SHA: 7240f3776f2b9fb3eb14bf255ce840633e90cf42
Merge method: squash
PR: https://github.com/pxf77/Spec2Proof/pull/2
```

The merged commit contains:

- AWS SAM control-plane templates;
- AgentCore Runtime configuration;
- managed AgentCore Browser and S3 evidence adapters;
- GitHub App manifest setup through Secrets Manager;
- persistent webhook delivery deduplication;
- per-PR command queue plus separate execution queue;
- DynamoDB run items with strongly consistent latest-run pointers;
- lifecycle-conditional state transitions;
- compact persisted PR context without raw patches;
- deterministic DemoShop and Playwright E2E tests.

## Verification contract

The feature-branch Head SHA `688cf77cb7e6cb981fcce3e87e51788d324b74f6` passed:

```text
CI
DemoShop E2E
```

After squash merge, `main` was verified again with:

```text
npm run check
npm run check:e2e
```

`npm run check` covers strict TypeScript checking, focused Node tests, production compilation, and deployment-topology validation. `npm run check:e2e` exercises the valid and expired coupon paths in Chromium.

## Production defects closed before merge

1. A late execution result can no longer overwrite a durable cancellation.
2. `/spec2proof rerun-failed` rereads the current SPEC and preserves target configuration.
3. Raw PR patches are not persisted in DynamoDB run items.
4. Latest-run lookup no longer depends on an eventually consistent GSI.
5. Long AgentCore execution no longer blocks `/cancel` or PR Head invalidation for the same PR.
6. Repeated terminal publication is idempotent through Check/comment upserts.

## Remaining account-bound operations

The repository does not contain AWS credentials, GitHub App private keys, setup tokens, or deployed resource identifiers. The following require the operator's AWS and GitHub accounts:

1. deploy the foundation stack;
2. deploy AgentCore Runtime;
3. deploy the control-plane stack;
4. register and install the GitHub App;
5. enable GitHub Pages and publish DemoShop;
6. execute the first live `run → approve → AgentCore Browser → Check Run` PR.

Follow [the deployment runbook](../deployment/aws-and-github-app.md).
