# Stage 2 verification

The GitHub App PR flow is verified through the repository's standard `npm run check` contract:

1. TypeScript strict type checking;
2. focused Node test suite;
3. production TypeScript build.

The implementation remains behind application ports so GitHub, Agent Runtime, persistence, and publishing adapters can evolve without changing the acceptance domain model.
