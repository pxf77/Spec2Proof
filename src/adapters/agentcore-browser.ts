import { PlaywrightBrowser } from "bedrock-agentcore/browser/playwright";
import type {
  BrowserObservation,
  BrowserPort,
} from "../application/ports.js";
import { UrlPolicy } from "../security/url-policy.js";

interface BrowserSession {
  runId: string;
  browser: PlaywrightBrowser;
}

export class AgentCoreBrowserAdapter implements BrowserPort {
  private readonly sessions = new Map<string, BrowserSession>();

  public constructor(
    private readonly policy: UrlPolicy,
    private readonly options: {
      region: string;
      identifier?: string;
      sessionTimeoutSeconds?: number;
    },
  ) {}

  public async startSession(input: {
    runId: string;
    viewport?: { width: number; height: number };
  }): Promise<string> {
    const browser = new PlaywrightBrowser({
      region: this.options.region,
      identifier: this.options.identifier,
    });
    const session = await browser.startSession({
      sessionName: input.runId.slice(0, 64),
      timeout: this.options.sessionTimeoutSeconds ?? 1_800,
      viewport: input.viewport,
    });
    this.sessions.set(session.sessionId, { runId: input.runId, browser });
    return session.sessionId;
  }

  public async navigate(sessionId: string, rawUrl: string): Promise<BrowserObservation> {
    const target = this.policy.assertAllowed(rawUrl);
    const browser = this.requireSession(sessionId).browser;
    await browser.navigate({ url: target.toString(), waitUntil: "domcontentloaded" });
    return this.observe(sessionId);
  }

  public async observe(sessionId: string): Promise<BrowserObservation> {
    const browser = this.requireSession(sessionId).browser;
    const [url, title, text] = await Promise.all([
      browser.evaluate({ script: "window.location.href" }),
      browser.evaluate({ script: "document.title" }),
      browser.getText(),
    ]);
    const safeUrl = this.policy.assertAllowed(String(url)).toString();
    return { sessionId, url: safeUrl, title: String(title), text };
  }

  public async click(sessionId: string, selector: string): Promise<void> {
    const browser = this.requireSession(sessionId).browser;
    await browser.click({ selector, timeout: 30_000 });
    await this.assertCurrentUrl(browser);
  }

  public async fill(sessionId: string, selector: string, value: string): Promise<void> {
    const browser = this.requireSession(sessionId).browser;
    await browser.fill({ selector, value, timeout: 30_000 });
    await this.assertCurrentUrl(browser);
  }

  public async textContent(sessionId: string, selector?: string): Promise<string> {
    return this.requireSession(sessionId).browser.getText({ selector });
  }

  public async currentUrl(sessionId: string): Promise<string> {
    const browser = this.requireSession(sessionId).browser;
    const value = await browser.evaluate({ script: "window.location.href" });
    return this.policy.assertAllowed(String(value)).toString();
  }

  public async screenshot(sessionId: string): Promise<Uint8Array> {
    const value = await this.requireSession(sessionId).browser.screenshot({
      fullPage: true,
      type: "png",
    });
    return typeof value === "string" ? Buffer.from(value, "base64") : new Uint8Array(value);
  }

  public async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    await session.browser.stopSession();
  }

  public async closeRun(runId: string): Promise<void> {
    const matches = [...this.sessions.entries()].filter(([, session]) => session.runId === runId);
    await Promise.all(matches.map(([sessionId]) => this.closeSession(sessionId)));
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`AgentCore Browser session not found: ${sessionId}`);
    }
    return session;
  }

  private async assertCurrentUrl(browser: PlaywrightBrowser): Promise<void> {
    const value = await browser.evaluate({ script: "window.location.href" });
    this.policy.assertAllowed(String(value));
  }
}
