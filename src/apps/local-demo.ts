import { RunService } from "../application/run-service.js";
import {
  ConsoleRunPublisher,
  InMemoryRunStore,
  RandomIdGenerator,
  SystemClock,
} from "../adapters/memory.js";
import { DeterministicPlanGenerator, ScriptedRunExecutor } from "../adapters/local.js";

const service = new RunService({
  planGenerator: new DeterministicPlanGenerator(),
  executor: new ScriptedRunExecutor(),
  store: new InMemoryRunStore(),
  publisher: new ConsoleRunPublisher(),
  clock: new SystemClock(),
  ids: new RandomIdGenerator(),
});

const prepared = await service.prepareRun({
  repository: "pxf77/Spec2Proof",
  pullRequestNumber: 1,
  headSha: "0123456789abcdef",
  targetEnvironment: "local-demo",
  criteria: [
    {
      id: "AC-001",
      sourceRef: "PR#1",
      description: "After a valid login, the user reaches /dashboard",
      preconditions: ["A synthetic active user exists"],
      expectedOutcomes: [{ type: "url", matches: "/dashboard", mode: "prefix" }],
      automationClass: "AUTO",
    },
    {
      id: "AC-002",
      sourceRef: "PR#1",
      description: "A reviewer confirms the visual brand treatment",
      preconditions: [],
      expectedOutcomes: [{ type: "human", reason: "Subjective visual review" }],
      automationClass: "HUMAN",
    },
  ],
});

await service.approveRun(prepared.runId, "demo-reviewer", prepared.headSha);
const completed = await service.executeRun(prepared.runId);
console.log(JSON.stringify(completed, null, 2));
