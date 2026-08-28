import type { RunExecutionScheduler } from "../application/ports.js";
import { RunService } from "../application/run-service.js";

export class DirectRunExecutionScheduler implements RunExecutionScheduler {
  public constructor(private readonly service: RunService) {}

  public async schedule(runId: string): Promise<void> {
    await this.service.executeRun(runId);
  }
}
