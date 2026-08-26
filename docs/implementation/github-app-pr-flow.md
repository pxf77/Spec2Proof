# GitHub App PR acceptance flow

This implementation slice connects the authenticated GitHub webhook boundary to the Spec2Proof application core.

## Included

- GitHub App JWT signing and installation-token exchange;
- installation-scoped GitHub REST client;
- bounded pull-request metadata and changed-file patch retrieval;
- structured `spec2proof` acceptance criteria parsing from the pull-request body;
- repository permission checks for approval, rejection, cancellation, and rerun commands;
- one marker-based pull-request summary comment;
- one Check Run per Spec2Proof run;
- AgentCore-compatible execution client;
- stale Head SHA invalidation;
- cancellation that remains terminal while an execution request unwinds.

## Preserved constraints

The implementation keeps one Spec2Proof Agent role, two invocations separated by the mandatory human approval boundary, and the three-state run lifecycle. It does not introduce multi-agent orchestration, event sourcing, Lease, CAS, or additional workflow gates.

## Verification

The branch is accepted only when the repository CI completes the following command successfully:

```bash
npm run check
```

This command performs TypeScript type checking, the focused Node test suite, and the production build.
