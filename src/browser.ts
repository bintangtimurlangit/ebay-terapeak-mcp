/**
 * Persistent Playwright session against eBay Seller Hub.
 *
 * The whole point: rather than scraping cookies and replaying them with a plain
 * HTTP client (which eBay's bot detection — Akamai + perfdrive — flags), we keep
 * a real logged-in Chromium profile alive and run the API `fetch` *inside* the
 * page. That request carries every session cookie, satisfies bot detection, and
 * lets the real browser rotate the short-lived anti-bot cookies itself. That is
 * what defeats the cookie-staleness problem.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import os from "node:os";
import path from "node:path";

const RESEARCH_URL =
  "https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD";
const SEARCH_API = "https://www.ebay.com/sh/research/api/search";

/** Where the logged-in browser profile lives (override with EBAY_MCP_PROFILE). */
export const PROFILE_DIR =
  process.env.EBAY_MCP_PROFILE ||
  path.join(os.homedir(), ".ebay-research-mcp", "profile");

/** Thrown when the session isn't authenticated (or got logged out). */
export class NotLoggedInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotLoggedInError";
  }
}

async function launch(headless: boolean): Promise<BrowserContext> {
  const opts = {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  };
  // Prefer the real Chrome channel (better against bot detection); fall back to
  // Playwright's bundled Chromium if Chrome isn't installed.
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      ...opts,
    });
  } catch {
    return await chromium.launchPersistentContext(PROFILE_DIR, opts);
  }
}

export class EbaySession {
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private startPromise: Promise<void> | null = null;
  /** Serializes access to the single shared page so overlapping tool calls
   *  don't navigate/fetch on top of each other. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private headless = true) {}

  private async start(): Promise<void> {
    if (this.ctx) return;
    if (!this.startPromise) {
      this.startPromise = (async () => {
        this.ctx = await launch(this.headless);
        // Fail fast instead of hanging if a bot-challenge page never settles.
        this.ctx.setDefaultNavigationTimeout(45_000);
        this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
      })();
    }
    await this.startPromise;
  }

  /** Run `fn` exclusively (mutex over the shared page). */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next as Promise<T>;
  }

  private async ensureReady(): Promise<void> {
    await this.start();
    const page = this.page!;
    if (!page.url().startsWith("https://www.ebay.com/sh/research")) {
      await page.goto(RESEARCH_URL, { waitUntil: "domcontentloaded" });
    }
    if (page.url().includes("signin.ebay.com")) {
      throw new NotLoggedInError(
        "eBay session is not authenticated. Run `npm run login` (with the MCP " +
          "server stopped) to sign in, then retry.",
      );
    }
  }

  /** True if the stored profile is currently logged into Seller Hub. */
  async isLoggedIn(): Promise<boolean> {
    return this.run(async () => {
      await this.start();
      await this.page!.goto(RESEARCH_URL, { waitUntil: "domcontentloaded" });
      return !this.page!.url().includes("signin.ebay.com");
    });
  }

  /**
   * Call the research search endpoint with a prebuilt query string and return
   * the raw response body (concatenated JSON modules).
   */
  async fetchSearch(queryString: string): Promise<string> {
    return this.run(async () => {
      await this.ensureReady();
      const url = `${SEARCH_API}?${queryString}`;
      const res = await this.page!.evaluate(async (u: string) => {
        const r = await fetch(u, {
          headers: { "x-requested-with": "XMLHttpRequest", accept: "*/*" },
          credentials: "include",
        });
        return {
          status: r.status,
          contentType: r.headers.get("content-type") ?? "",
          body: await r.text(),
        };
      }, url);

      if (!res.contentType.includes("application/json")) {
        throw new NotLoggedInError(
          `eBay returned a non-JSON response (HTTP ${res.status}). The session ` +
            "is likely stale or bot detection triggered. Run `npm run login` to " +
            "refresh it.",
        );
      }
      return res.body;
    });
  }

  async close(): Promise<void> {
    await this.ctx?.close();
    this.ctx = null;
    this.page = null;
    this.startPromise = null;
  }
}

/**
 * One-time interactive login. Opens a headed browser using the SAME persistent
 * profile the server uses, lets the user sign in by hand (incl. 2FA), and waits
 * until Seller Hub Research loads. Must be run while the server is NOT running
 * (a profile directory can only be opened by one browser at a time).
 */
export async function loginInteractive(): Promise<void> {
  const ctx = await launch(false);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(RESEARCH_URL, { waitUntil: "domcontentloaded" });

  console.error(
    "\nA browser window has opened.\n" +
      "  1. Sign into your eBay account (complete any 2FA).\n" +
      "  2. Wait until the 'Research products' page loads.\n" +
      "Waiting up to 5 minutes for sign-in...\n",
  );

  const deadline = Date.now() + 5 * 60 * 1000;
  let ok = false;
  while (Date.now() < deadline) {
    const url = page.url();
    if (
      url.startsWith("https://www.ebay.com/sh/research") &&
      !url.includes("signin.ebay.com")
    ) {
      const hasResearch = await page
        .getByRole("heading", { name: "Research products" })
        .count()
        .catch(() => 0);
      if (hasResearch) {
        ok = true;
        break;
      }
    }
    await page.waitForTimeout(1500);
  }

  if (ok) {
    console.error(
      "\n✅ Login detected and saved to the profile. You can close this window.\n" +
        "   The MCP server will now reuse this session.\n",
    );
  } else {
    console.error(
      "\n⚠️  Timed out waiting for sign-in. Re-run `npm run login` and try again.\n",
    );
  }
  await ctx.close();
}
