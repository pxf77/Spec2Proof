import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { BrowserObservation, BrowserPort } from "../application/ports.js";
import { UrlPolicy } from "../security/url-policy.js";

interface BrowserSession {
  runId: string;
  context: BrowserContext;
  page: Page;
}

export class PlaywrightBrowserAdapter implements BrowserPort {
  private browser: Browser | undefined;
  private readonly sessions = new Map<string, BrowserSession>();

  public constructor(
    private readonly urlPolicy: UrlPolicy,
    private readonly headless = true,
  ) {}

  public async startSession(input: {
    runId: string;
    viewport?: { width: number; height: number };
  }): Promise<string> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: input.viewport ?? { width: 1440, height: 900 },
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      try {
        this.urlPolicy.assertAllowed(route.request().url());
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    const sessionId = `browser-${randomUUID()}`;
    this.sessions.set(sessionId, { runId: input.runId, context, page });
    return sessionId;
  }

  public async navigate(sessionId: string, rawUrl: string): Promise<BrowserObservation> {
    const session = this.requireSession(sessionId);
    const url = this.urlPolicy.assertAllowed(rawUrl);
    await session.page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    this.urlPolicy.assertAllowed(session.page.url());
    return this.observe(sessionId);
  }

  public async observe(sessionId: string): Promise<BrowserObservation> {
    const session = this.requireSession(sessionId);
    const text = await session.page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => "");
    return {
      sessionId,
      url: session.page.url(),
      title: await session.page.title(),
      text: text.slice(0, 12_000),
    };
  }

  public async click(sessionId: string, selector: string): Promise<void> {
    await this.requireSession(sessionId).page.locator(selector).click({ timeout: 10_000 });
  }

  public async fill(sessionId: string, selector: string, value: string): Promise<void> {
    await this.requireSession(sessionId).page.locator(selector).fill(value, { timeout: 10_000 });
  }

  public async textContent(sessionId: string, selector = "body"): Promise<string> {
    return this.requireSession(sessionId).page.locator(selector).innerText({ timeout: 10_000 });
  }

  public async currentUrl(sessionId: string): Promise<string> {
    return this.requireSession(sessionId).page.url();
  }

  public async screenshot(sessionId: string): Promise<Uint8Array> {
    return this.requireSession(sessionId).page.screenshot({ fullPage: true, type: "png" });
  }

  public async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    await session.context.close();
    await this.closeBrowserWhenIdle();
  }

  public async closeRun(runId: string): Promise<void> {
    const sessionIds = [...this.sessions.entries()]
      .filter(([, session]) => session.runId === runId)
      .map(([sessionId]) => sessionId);
    await Promise.all(sessionIds.map((sessionId) => this.closeSession(sessionId)));
  }

  private async getBrowser(): Promise<Browser> {
    this.browser ??= await chromium.launch({ headless: this.headless });
    return this.browser;
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session not found: ${sessionId}`);
    }
    return session;
  }

  private async closeBrowserWhenIdle(): Promise<void> {
    if (this.sessions.size === 0 && this.browser) {
      const browser = this.browser;
      this.browser = undefined;
      await browser.close();
    }
  }
}
