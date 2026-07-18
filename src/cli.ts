/**
 * CLI front-end. Shares the exact search engine (core.ts) with the MCP server,
 * so anything the MCP tools can do is available from the terminal too:
 *
 *   node dist/index.js search "Players Pins" --exact --condition new --sort sales
 *   node dist/index.js search "Players Pins" --active --min-price 20 --max-price 60 --json
 */
import { EbaySession, NotLoggedInError } from './browser.js';
import { runSearch, type SearchOpts, type SortKey } from './core.js';

const USAGE = `
eBay Terapeak research — CLI

Usage:
  node dist/index.js search "<keywords>" [options]

Options:
  --sold                 Search SOLD listings (default)
  --active               Search ACTIVE listings
  --exact                Match the exact phrase (quotes the keywords)
  --exclude a,b,c        Drop rows whose title contains any of these (client-side)
  --condition new|used   Filter by condition (server-side)
  --min-price N          Minimum price (server-side)
  --max-price N          Maximum price (server-side)
  --format auction|fixed Listing format (server-side; omit for all)
  --sort KEY             best_match|sales|units|price|price_asc|recent
  --days N               Lookback window in days (default 90, max 1095)
  --category ID          eBay category id (default 0 = all)
  --limit N              Max rows to return (default 50, max 500)
  --marketplace ID       e.g. EBAY-US, EBAY-GB (default EBAY-US)
  --summary              Print only the aggregate market stats
  --detail               Include extendedTitle / extra image URLs (JSON only)
  --json                 Emit raw JSON instead of a table
  -h, --help             Show this help
`;

interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Map<string, string>;
}

/** Minimal flag parser: `--flag`, `--flag value`, and `--flag=value`. */
function parseFlags(argv: string[]): Flags {
  const boolFlags = new Set(['sold', 'active', 'exact', 'summary', 'detail', 'json', 'help', 'h']);
  const positional: string[] = [];
  const bool = new Set<string>();
  const value = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') && !(a === '-h')) {
      positional.push(a);
      continue;
    }
    const name = a.replace(/^--?/, '');
    const [key, inlineVal] = name.includes('=') ? name.split(/=(.*)/s) : [name, undefined];
    if (boolFlags.has(key)) {
      bool.add(key);
    } else if (inlineVal !== undefined) {
      value.set(key, inlineVal);
    } else {
      value.set(key, argv[++i] ?? '');
    }
  }
  return { positional, bool, value };
}

function num(f: Flags, key: string): number | undefined {
  const v = f.value.get(key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`--${key} expects a number, got "${v}"`);
  return n;
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

function printTable(res: Awaited<ReturnType<typeof runSearch>>): void {
  const a = res.aggregates;
  const q = res.query;
  console.log('');
  console.log(`  Query:   ${q.effectiveKeywords}  (${q.tab}, ${q.days}d, ${q.marketplace})`);
  if (Object.keys(q.filters).length) console.log(`  Filters: ${JSON.stringify(q.filters)}`);
  if (q.exclude.length) console.log(`  Exclude: ${q.exclude.join(', ')}`);
  if (a) {
    const label = q.tab === 'SOLD' ? 'Avg sold' : 'Avg listing';
    console.log('');
    console.log(
      `  ${label}: ${a.raw['Avg sold price'] ?? a.raw['Avg listing price'] ?? '-'}` +
        `   Range: ${a.soldPriceRange ?? a.raw['Listing price range'] ?? '-'}` +
        (a.totalSold != null ? `   Total sold: ${a.totalSold}` : '') +
        (a.sellThrough ? `   Sell-through: ${a.sellThrough}` : '') +
        (a.totalItemSales != null ? `   Total sales: $${a.totalItemSales}` : ''),
    );
  }
  if (res.results.length) {
    console.log('');
    if (q.tab === 'SOLD') {
      console.log(
        `  ${pad('PRICE', 10)}${pad('UNITS', 7)}${pad('SALES', 12)}${pad('LAST SOLD', 14)}TITLE`,
      );
      console.log('  ' + '-'.repeat(90));
      for (const r of res.results) {
        console.log(
          '  ' +
            pad(r.avgSoldPriceText ?? '-', 10) +
            pad(r.totalSold != null ? String(r.totalSold) : '-', 7) +
            pad(r.totalSalesText ?? '-', 12) +
            pad(r.dateLastSold ?? '-', 14) +
            pad(r.title, 48),
        );
      }
    } else {
      console.log(
        `  ${pad('PRICE', 10)}${pad('WATCH', 7)}${pad('PROMO', 7)}${pad('LISTED', 14)}TITLE`,
      );
      console.log('  ' + '-'.repeat(90));
      for (const r of res.results) {
        console.log(
          '  ' +
            pad(r.listingPriceText ?? '-', 10) +
            pad(r.watchers != null ? String(r.watchers) : '-', 7) +
            pad(r.promoted ? 'yes' : '-', 7) +
            pad(r.startDate ?? '-', 14) +
            pad(r.title, 48),
        );
      }
    }
  }
  console.log('');
  console.log(`  ${res.resultCount} row(s).`);
  for (const n of res.notes) console.log(`  note: ${n}`);
  console.log('');
}

export async function runCli(argv: string[]): Promise<void> {
  const f = parseFlags(argv);
  if (f.bool.has('help') || f.bool.has('h') || f.positional.length === 0) {
    console.log(USAGE);
    return;
  }

  const keywords = f.positional.join(' ');
  const condition = f.value.get('condition');
  if (condition && condition !== 'new' && condition !== 'used') {
    throw new Error(`--condition must be new|used, got "${condition}"`);
  }
  const format = f.value.get('format');
  if (format && !['auction', 'fixed', 'all'].includes(format)) {
    throw new Error(`--format must be auction|fixed, got "${format}"`);
  }
  const sort = (f.value.get('sort') as SortKey | undefined) ?? 'best_match';

  const opts: SearchOpts = {
    keywords,
    tab: f.bool.has('active') ? 'ACTIVE' : 'SOLD',
    days: num(f, 'days') ?? 90,
    categoryId: num(f, 'category') ?? 0,
    maxResults: num(f, 'limit') ?? 50,
    marketplace: f.value.get('marketplace') ?? 'EBAY-US',
    exact: f.bool.has('exact'),
    exclude: (f.value.get('exclude') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    condition: condition as 'new' | 'used' | undefined,
    minPrice: num(f, 'min-price'),
    maxPrice: num(f, 'max-price'),
    format: (format as 'auction' | 'fixed' | 'all' | undefined) ?? 'all',
    sort,
    summaryOnly: f.bool.has('summary'),
    detail: f.bool.has('detail'),
  };

  const session = new EbaySession(process.env.EBAY_MCP_HEADLESS !== '0');
  try {
    const res = await runSearch(opts, session);
    if (f.bool.has('json')) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      printTable(res);
    }
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      console.error(`\n${e.message}\n`);
      process.exitCode = 2;
    } else {
      throw e;
    }
  } finally {
    await session.close().catch(() => {});
  }
}
