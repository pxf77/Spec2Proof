import { randomUUID } from "node:crypto";
import type { AcceptanceRun, CriterionResult } from "../domain/model.js";
import type {
  Clock,
  CriterionResultSink,
  IdGenerator,
  RunPublisher,
  RunStore,
} from "../application/ports.js";

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, AcceptanceRun>();

  public async get(runId: string): Promise<AcceptanceRun | undefined> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  public async save(run: AcceptanceRun): Promise<void> {
    this.runs.set(run.runId, structuredClone(run));
  }
}

export class InMemoryResultSink implements CriterionResultSink {
  private readonly results = new Map<string, CriterionResult>();

  public async record(result: CriterionResult): Promise<void> {
    if (
      (result.status === "PASS" || result.status === "FAIL") &&
      result.evidenceIds.length === 0
    ) {
      throw new Error(
        `Criterion ${result.criterionId} cannot be recorded as ${result.status} without evidence`,
      );
    }
    if (this.results.has(result.criterionId)) {
      throw new Error(`Criterion result already recorded: ${result.criterionId}`);
    }
    this.results.set(result.criterionId, structuredClone(result));
  }

  public all(): CriterionResult[] {
    return [...this.results.values()].map((result) => structuredClone(result));
  }
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class RandomIdGenerator implements IdGenerator {
  public next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

export class ConsoleRunPublisher implements RunPublisher {
  public async planReady(run: AcceptanceRun): Promise<void> {
    console.log(JSON.stringify({ event: "plan.ready", runId: run.runId }));
  }

  public async runStarted(run: AcceptanceRun): Promise<void> {
    console.log(JSON.stringify({ event: "run.started", runId: run.runId }));
  }

  public async runCompleted(run: AcceptanceRun): Promise<void> {
    console.log(
      JSON.stringify({ event: "run.completed", runId: run.runId, verdict: run.verdict }),
    );
  }
}
