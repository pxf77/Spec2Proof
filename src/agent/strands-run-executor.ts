import { Agent, type AgentConfig } from "@strands-agents/sdk";
import type { AcceptanceRun, CriterionResult } from "../domain/model.js";
import type { BrowserPort, EvidenceStore, RunExecutor } from "../application/ports.js";
import { InMemoryResultSink } from "../adapters/memory.js";
import { createSpec2ProofTools } from "./tool-registry.js";
import { EXECUTION_SYSTEM_PROMPT } from "./system-prompt.js";

export interface StrandsRunExecutorOptions {
  browser: BrowserPort;
  evidence: EvidenceStore;
  model?: AgentConfig["model"];
  maxTurns?: number;
}

export class StrandsRunExecutor implements RunExecutor {
  private readonly activeControllers = new Map<string, AbortController>();

  public constructor(private readonly options: StrandsRunExecutorOptions) {}

  public async execute(
    run: AcceptanceRun,
    externalSignal?: AbortSignal,
  ): Promise<CriterionResult[]> {
    const controller = new AbortController();
    this.activeControllers.set(run.runId, controller);
    const signal = combineSignals(controller.signal, externalSignal);
    const resultSink = new InMemoryResultSink();
    const tools = createSpec2ProofTools({
      run,
      browser: this.options.browser,
      evidence: this.options.evidence,
      resultSink,
    });
    const agent = new Agent({
      systemPrompt: EXECUTION_SYSTEM_PROMPT,
      tools,
      model: this.options.model,
      printer: false,
      toolExecutor: "sequential",
    });

    try {
      await agent.invoke(
        JSON.stringify({
          task: "Execute the approved PR acceptance plan",
          runId: run.runId,
          repository: run.repository,
          pullRequestNumber: run.pullRequestNumber,
          headSha: run.headSha,
          targetEnvironment: run.targetEnvironment,
          criteria: run.criteria,
          plan: run.plan,
        }),
        {
          invocationState: { runId: run.runId, phase: "execution" },
          cancelSignal: signal,
          limits: {
            turns: this.options.maxTurns ?? 40,
            totalTokens: 80_000,
          },
        },
      );

      const resultsById = new Map(
        resultSink.all().map((result) => [result.criterionId, result]),
      );
      const now = new Date().toISOString();
      return run.criteria.map(
        (criterion) =>
          resultsById.get(criterion.id) ?? {
            criterionId: criterion.id,
            status: "BLOCKED",
            expected: criterion.expectedOutcomes,
            actual: null,
            evidenceIds: [],
            startedAt: run.startedAt ?? now,
            completedAt: now,
            failureCategory: "AGENT",
            explanation: "Agent stopped without recording a criterion result",
          },
      );
    } finally {
      this.activeControllers.delete(run.runId);
      await this.options.browser.closeRun(run.runId);
    }
  }

  public async cancel(runId: string): Promise<void> {
    this.activeControllers.get(runId)?.abort(new Error("Run cancelled"));
    await this.options.browser.closeRun(runId);
  }
}

function combineSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  return secondary ? AbortSignal.any([primary, secondary]) : primary;
}
