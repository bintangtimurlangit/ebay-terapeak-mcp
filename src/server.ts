/**
 * MCP server exposing eBay Terapeak product research as tools.
 *
 * The search logic lives in core.ts (shared with the CLI); this file only maps
 * MCP tool inputs onto `runSearch` and formats the output.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EbaySession, NotLoggedInError } from './browser.js';
import { runSearch, type SearchOpts, type Tab } from './core.js';

let session: EbaySession | null = null;
function getSession(): EbaySession {
  if (!session) {
    // Headless by default; set EBAY_MCP_HEADLESS=0 if bot detection blocks it.
    session = new EbaySession(process.env.EBAY_MCP_HEADLESS !== '0');
  }
  return session;
}

/** Shared Zod shape for both search tools. */
const searchInputShape = {
  keywords: z.string().describe('Search terms, or a product identifier (MPN/UPC/EPID/EAN/ISBN).'),
  exact: z
    .boolean()
    .default(false)
    .describe(
      'Wrap keywords in quotes so eBay matches the exact phrase instead of loose ' +
        "tokens. Cuts noise dramatically (e.g. exact 'Players Pins' drops unrelated " +
        'dominoes/DJ players).',
    ),
  exclude: z
    .array(z.string())
    .default([])
    .describe(
      'Terms to exclude. Applied client-side to the title/extended title (this ' +
        "endpoint ignores '-term' exclusion), so aggregate totals still include them.",
    ),
  condition: z
    .enum(['new', 'used'])
    .optional()
    .describe('Filter by item condition (server-side: new=1000, used=3000).'),
  min_price: z.number().optional().describe('Minimum price filter (server-side).'),
  max_price: z.number().optional().describe('Maximum price filter (server-side).'),
  format: z
    .enum(['all', 'auction', 'fixed'])
    .default('all')
    .describe("Listing format filter (server-side). 'all' applies no format filter."),
  sort: z
    .enum(['best_match', 'sales', 'units', 'price', 'price_asc', 'recent'])
    .default('best_match')
    .describe(
      'Client-side ordering of returned rows: sales/units/price (desc), price_asc, ' +
        "recent (last sold), or best_match (eBay's order).",
    ),
  summary_only: z
    .boolean()
    .default(false)
    .describe('Return only the aggregate market stats, no per-listing rows.'),
  detail: z
    .boolean()
    .default(false)
    .describe(
      'Include heavy per-row fields (extendedTitle, moreImages). Off by default to ' +
        'keep the payload small; turn on when you need the extra images/text.',
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(1095)
    .default(90)
    .describe('Lookback window in days. Max 1095 (3 years). Default 90.'),
  category_id: z
    .number()
    .int()
    .default(0)
    .describe('eBay category id to scope the search. 0 = all categories.'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe('Max listings to return. Paginated 50/page. Default 50.'),
  marketplace: z
    .string()
    .default('EBAY-US')
    .describe('Marketplace id, e.g. EBAY-US, EBAY-GB, EBAY-DE.'),
};

type SearchArgs = {
  keywords: string;
  exact: boolean;
  exclude: string[];
  condition?: 'new' | 'used';
  min_price?: number;
  max_price?: number;
  format: 'all' | 'auction' | 'fixed';
  sort: 'best_match' | 'sales' | 'units' | 'price' | 'price_asc' | 'recent';
  summary_only: boolean;
  detail: boolean;
  days: number;
  category_id: number;
  max_results: number;
  marketplace: string;
};

/** Translate MCP tool args into core SearchOpts. */
function toOpts(args: SearchArgs, tab: Tab): SearchOpts {
  return {
    keywords: args.keywords,
    tab,
    days: args.days,
    categoryId: args.category_id,
    maxResults: args.max_results,
    marketplace: args.marketplace,
    exact: args.exact,
    exclude: args.exclude,
    condition: args.condition,
    minPrice: args.min_price,
    maxPrice: args.max_price,
    format: args.format,
    sort: args.sort,
    summaryOnly: args.summary_only,
    detail: args.detail,
  };
}

function toContent(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function toError(e: unknown) {
  const msg =
    e instanceof NotLoggedInError
      ? e.message
      : `Error: ${e instanceof Error ? e.message : String(e)}`;
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

export async function startServer(): Promise<void> {
  const server = new McpServer({
    name: 'ebay-research-mcp',
    version: '0.2.0',
  });

  server.tool(
    'search_sold_listings',
    'Search eBay SOLD listings (Terapeak Product Research). Returns aggregate ' +
      'market stats (avg sold price, total sold, sell-through, total sales, etc.) ' +
      'plus per-listing rows. Supports server-side filters (exact phrase, condition, ' +
      'price range, format) and client-side sort/exclude. Paginates up to max_results.',
    searchInputShape,
    async (args) => {
      try {
        return toContent(await runSearch(toOpts(args as SearchArgs, 'SOLD'), getSession()));
      } catch (e) {
        return toError(e);
      }
    },
  );

  server.tool(
    'search_active_listings',
    'Search eBay ACTIVE listings (Terapeak Product Research). Same shape and ' +
      'filters as search_sold_listings but for currently-listed items.',
    searchInputShape,
    async (args) => {
      try {
        return toContent(await runSearch(toOpts(args as SearchArgs, 'ACTIVE'), getSession()));
      } catch (e) {
        return toError(e);
      }
    },
  );

  server.tool(
    'session_status',
    'Check whether the Playwright browser profile is currently signed into eBay ' +
      'Seller Hub. If not logged in, run `npm run login` (with the server stopped).',
    {},
    async () => {
      try {
        const loggedIn = await getSession().isLoggedIn();
        return toContent({
          loggedIn,
          hint: loggedIn
            ? 'Session is active.'
            : 'Not signed in. Stop the server and run `npm run login`.',
        });
      } catch (e) {
        return toError(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ebay-research-mcp server running on stdio.');

  const shutdown = async () => {
    await session?.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
