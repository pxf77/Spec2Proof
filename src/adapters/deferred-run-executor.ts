import type { RunExecutor } from "../application/ports.js";
import type { AcceptanceRun, CriterionResult } from "../domain/model.js";

export class DeferredRunExecutor implements RunExecutor {
  public async execute(_run: AcceptanceRun): Promise<CriterionResult[]> {
    throw new Error("Run execution is delegated to the execution worker");
  }

  public async cancel(_runId: string): Promise<void> {
    // The durable CANCELLED transition prevents a remote result from overwriting
    // the terminal verdict. Cross-process AgentCore invocation abort is best effort.
  }
}
