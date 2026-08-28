import type {
  AcceptanceRun,
  CriterionResult,
  ExecutionPlan,
  PrepareRunInput,
  RunLifecycle,
} from "../domain/model.js";

export interface PlanGenerator {
  generate(input: PrepareRunInput & { runId: string }): Promise<ExecutionPlan>;
}

export interface RunExecutor {
  execute(run: AcceptanceRun, signal?: AbortSignal): Promise<CriterionResult[]>;
  cancel?(runId: string): Promise<void>;
}

export interface RunStore {
  get(runId: string): Promise<AcceptanceRun | undefined>;
  findLatest(repository: string, pullRequestNumber: number): Promise<AcceptanceRun | undefined>;
  save(run: AcceptanceRun): Promise<void>;
  saveIfLifecycle(run: AcceptanceRun, expected: RunLifecycle): Promise<boolean>;
}

export interface RunPublisher {
  planReady(run: AcceptanceRun): Promise<void>;
  runStarted(run: AcceptanceRun): Promise<void>;
  runCompleted(run: AcceptanceRun): Promise<void>;
}

export interface PullRequestReader {
  read(input: {
    installationId: number;
    repository: string;
    pullRequestNumber: number;
  }): Promise<PrepareRunInput>;
  getHeadSha(input: {
    installationId: number;
    repository: string;
    pullRequestNumber: number;
  }): Promise<string>;
}

export interface ReviewerAuthorizer {
  canApprove(input: {
    installationId: number;
    repository: string;
    username: string;
  }): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface BrowserObservation {
  sessionId: string;
  url: string;
  title: string;
  text: string;
}

export interface BrowserPort {
  startSession(input: {
    runId: string;
    viewport?: { width: number; height: number };
  }): Promise<string>;
  navigate(sessionId: string, url: string): Promise<BrowserObservation>;
  observe(sessionId: string): Promise<BrowserObservation>;
  click(sessionId: string, selector: string): Promise<void>;
  fill(sessionId: string, selector: string, value: string): Promise<void>;
  textContent(sessionId: string, selector?: string): Promise<string>;
  currentUrl(sessionId: string): Promise<string>;
  screenshot(sessionId: string): Promise<Uint8Array>;
  closeSession(sessionId: string): Promise<void>;
  closeRun(runId: string): Promise<void>;
}

export interface EvidenceRecord {
  id: string;
  location: string;
  contentType: string;
}

export interface EvidenceStore {
  save(input: {
    runId: string;
    criterionId: string;
    kind: string;
    contentType: string;
    content: string | Uint8Array;
  }): Promise<EvidenceRecord>;
}

export interface CriterionResultSink {
  record(result: CriterionResult): Promise<void>;
  all(): CriterionResult[];
}
