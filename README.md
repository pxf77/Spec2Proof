# Spec2Proof

**Spec2Proof** is a PR acceptance execution agent that converts explicit acceptance criteria into executable verification plans, runs them against a test environment, collects deterministic evidence, and publishes the result back to GitHub.

## Project status

The project is currently in the requirements and architecture design phase.

## Core workflow

```text
GitHub Pull Request
→ Explicit Acceptance Criteria
→ Strands Agent execution plan
→ Human plan approval
→ Autonomous browser/API verification
→ Deterministic assertions and evidence
→ GitHub Check result
→ Human merge decision
```

## Documentation

- [Spec2Proof — PR Acceptance Execution Agent Requirements SPEC v1.0](docs/specs/spec2proof-pr-acceptance-agent-spec-v1.0.md)

## Design principles

- Explicit requirements only
- Thin harness
- Evidence-first verification
- Deterministic assertions
- Fail closed
- No automatic code changes or PR merges

## License

MIT License
