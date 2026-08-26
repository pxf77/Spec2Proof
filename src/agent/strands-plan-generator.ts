import { Agent } from "@strands-agents/sdk";
import type { ExecutionPlan, PrepareRunInput } from "../domain/model.js";
import type { PlanGenerator } from "../application/ports.js";
import { executionPlanSchema } from "./schemas.js";
import { PLANNING_SYSTEM_PROMPT } from "./system-prompt.js";

export class StrandsPlanGenerator implements PlanGenerator {
  private readonly agent: Agent;

  public constructor(agent?: Agent) {
    this.agent =
      agent ??
      new Agent({
        systemPrompt: PLANNING_SYSTEM_PROMPT,
        printer: false,
      });
  }

  public async generate(
    input: PrepareRunInput & { runId: string },
  ): Promise<ExecutionPlan> {
    const result = await this.agent.invoke(
      JSON.stringify({
        task: "Create an executable acceptance plan",
        input,
      }),
      {
        structuredOutputSchema: executionPlanSchema,
        invocationState: { runId: input.runId, phase: "planning" },
        limits: { turns: 8, totalTokens: 20_000 },
      },
    );

    return executionPlanSchema.parse(result.structuredOutput) as ExecutionPlan;
  }
}
