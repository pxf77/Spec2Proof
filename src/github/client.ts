import { createSign } from "node:crypto";

const GITHUB_API_VERSION = "2022-11-28";
const CHECK_NAME = "Spec2Proof";

export interface GitHubPullRequestRecord {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string };
  head: { sha: string; ref: string };
  base: { ref: string };
}

export interface GitHubPullRequestFileRecord {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitHubIssueCommentRecord {
  id: number;
  body: string | null;
}

export interface GitHubCheckRunRecord {
  id: number;
  name: string;
  head_sha: string;
  external_id: string | null;
  status: string;
  conclusion: string | null;
}

export interface GitHubInstallationClient {
  getPullRequest(repository: string, pullRequestNumber: number): Promise<GitHubPullRequestRecord>;
  listPullRequestFiles(
    repository: string,
    pullRequestNumber: number,
  ): Promise<GitHubPullRequestFileRecord[]>;
  getCollaboratorPermission(repository: string, username: string): Promise<string>;
  listIssueComments(
    repository: string,
    issueNumber: number,
  ): Promise<GitHubIssueCommentRecord[]>;
  createIssueComment(
    repository: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubIssueCommentRecord>;
  updateIssueComment(
    repository: string,
    commentId: number,
    body: string,
  ): Promise<GitHubIssueCommentRecord>;
  listCheckRuns(repository: string, ref: string): Promise<GitHubCheckRunRecord[]>;
  createCheckRun(repository: string, body: Record<string, unknown>): Promise<GitHubCheckRunRecord>;
  updateCheckRun(
    repository: string,
    checkRunId: number,
    body: Record<string, unknown>,
  ): Promise<GitHubCheckRunRecord>;
}

export interface GitHubInstallationClientFactory {
  forInstallation(installationId: number): GitHubInstallationClient;
}

export interface GitHubAppTokenProviderOptions {
  appId: number;
  privateKey: string;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

interface CachedInstallationToken {
  token: string;
  expiresAt: number;
}

export class GitHubAppTokenProvider {
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly apiBaseUrl: string;
  private readonly cache = new Map<number, CachedInstallationToken>();

  public constructor(private readonly options: GitHubAppTokenProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.apiBaseUrl = stripTrailingSlash(options.apiBaseUrl ?? "https://api.github.com");
  }

  public async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt - 60_000 > this.now()) {
      return cached.token;
    }

    const response = await this.fetch(
      `${this.apiBaseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.createAppJwt()}`,
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": "Spec2Proof",
        },
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new GitHubApiError(response.status, parseGitHubErrorMessage(text));
    }

    const payload = parseJsonObject(text);
    const token = payload.token;
    const expiresAt = payload.expires_at;
    if (typeof token !== "string" || typeof expiresAt !== "string") {
      throw new Error("GitHub installation token response is missing token or expires_at");
    }
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      throw new Error("GitHub installation token response contains an invalid expires_at");
    }

    this.cache.set(installationId, { token, expiresAt: expiresAtMs });
    return token;
  }

  public createAppJwt(): string {
    const issuedAt = Math.floor(this.now() / 1_000) - 60;
    const header = encodeBase64Url({ alg: "RS256", typ: "JWT" });
    const payload = encodeBase64Url({
      iat: issuedAt,
      exp: issuedAt + 9 * 60,
      iss: this.options.appId,
    });
    const unsigned = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(this.options.privateKey).toString("base64url");
    return `${unsigned}.${signature}`;
  }
}

export class GitHubClientFactory implements GitHubInstallationClientFactory {
  private readonly clients = new Map<number, GitHubApiClient>();

  public constructor(
    private readonly tokenProvider: GitHubAppTokenProvider,
    private readonly apiBaseUrl = "https://api.github.com",
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  public forInstallation(installationId: number): GitHubInstallationClient {
    const existing = this.clients.get(installationId);
    if (existing) {
      return existing;
    }
    const client = new GitHubApiClient(
      installationId,
      this.tokenProvider,
      this.apiBaseUrl,
      this.fetch,
    );
    this.clients.set(installationId, client);
    return client;
  }
}

export class GitHubApiClient implements GitHubInstallationClient {
  private readonly apiBaseUrl: string;

  public constructor(
    private readonly installationId: number,
    private readonly tokenProvider: GitHubAppTokenProvider,
    apiBaseUrl = "https://api.github.com",
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.apiBaseUrl = stripTrailingSlash(apiBaseUrl);
  }

  public async getPullRequest(
    repository: string,
    pullRequestNumber: number,
  ): Promise<GitHubPullRequestRecord> {
    const path = repositoryPath(repository);
    return this.request("GET", `${path}/pulls/${pullRequestNumber}`);
  }

  public async listPullRequestFiles(
    repository: string,
    pullRequestNumber: number,
  ): Promise<GitHubPullRequestFileRecord[]> {
    const path = repositoryPath(repository);
    return this.paginate(`${path}/pulls/${pullRequestNumber}/files`);
  }

  public async getCollaboratorPermission(
    repository: string,
    username: string,
  ): Promise<string> {
    const path = repositoryPath(repository);
    const response = await this.request<{ permission?: unknown }>(
      "GET",
      `${path}/collaborators/${encodeURIComponent(username)}/permission`,
    );
    return typeof response.permission === "string" ? response.permission : "none";
  }

  public async listIssueComments(
    repository: string,
    issueNumber: number,
  ): Promise<GitHubIssueCommentRecord[]> {
    const path = repositoryPath(repository);
    return this.paginate(`${path}/issues/${issueNumber}/comments`);
  }

  public async createIssueComment(
    repository: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubIssueCommentRecord> {
    const path = repositoryPath(repository);
    return this.request("POST", `${path}/issues/${issueNumber}/comments`, { body });
  }

  public async updateIssueComment(
    repository: string,
    commentId: number,
    body: string,
  ): Promise<GitHubIssueCommentRecord> {
    const path = repositoryPath(repository);
    return this.request("PATCH", `${path}/issues/comments/${commentId}`, { body });
  }

  public async listCheckRuns(
    repository: string,
    ref: string,
  ): Promise<GitHubCheckRunRecord[]> {
    const path = repositoryPath(repository);
    const response = await this.request<{ check_runs?: unknown }>(
      "GET",
      `${path}/commits/${encodeURIComponent(ref)}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&filter=all&per_page=100`,
    );
    return Array.isArray(response.check_runs)
      ? (response.check_runs as GitHubCheckRunRecord[])
      : [];
  }

  public async createCheckRun(
    repository: string,
    body: Record<string, unknown>,
  ): Promise<GitHubCheckRunRecord> {
    const path = repositoryPath(repository);
    return this.request("POST", `${path}/check-runs`, body);
  }

  public async updateCheckRun(
    repository: string,
    checkRunId: number,
    body: Record<string, unknown>,
  ): Promise<GitHubCheckRunRecord> {
    const path = repositoryPath(repository);
    return this.request("PATCH", `${path}/check-runs/${checkRunId}`, body);
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const pageItems = await this.request<T[]>(
        "GET",
        `${path}${separator}per_page=100&page=${page}`,
      );
      items.push(...pageItems);
      if (pageItems.length < 100) {
        break;
      }
    }
    return items;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const token = await this.tokenProvider.getInstallationToken(this.installationId);
    const response = await this.fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": GITHUB_API_VERSION,
        "user-agent": "Spec2Proof",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new GitHubApiError(response.status, parseGitHubErrorMessage(text));
    }
    if (text.length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

export class GitHubApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`GitHub API returned HTTP ${status}: ${message}`);
    this.name = "GitHubApiError";
  }
}

function repositoryPath(repository: string): string {
  const separator = repository.indexOf("/");
  if (separator <= 0 || separator === repository.length - 1) {
    throw new Error(`Invalid repository name: ${repository}`);
  }
  const owner = repository.slice(0, separator);
  const name = repository.slice(separator + 1);
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function encodeBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object from GitHub");
  }
  return parsed as Record<string, unknown>;
}

function parseGitHubErrorMessage(value: string): string {
  try {
    const payload = parseJsonObject(value);
    if (typeof payload.message === "string") {
      return payload.message.slice(0, 500);
    }
  } catch {
    // Fall through to a compact text response.
  }
  const compact = value.replace(/\s+/gu, " ").trim().slice(0, 500);
  return compact || "request failed";
}
