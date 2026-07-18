/**
 * Framework-agnostic search engine for eBay Terapeak Product Research.
 *
 * Both front-ends (the MCP server and the CLI) call `runSearch` here. Keeping it
 * free of any MCP/CLI concerns means the retrieval logic — query building,
 * pagination, server-side filters, and client-side transforms — lives in one
 * place.
 *
 * Which filters are server-side vs client-side was determined empirically by
 * diffing result counts against the live endpoint (see README "Filters"):
 *   - Server-side (the endpoint honors these query params):
 *       exact phrase (quoted keywords), conditionId, minPrice/maxPrice, format
 *   - Client-side (the endpoint ignores/breaks on these, so we do them here):
 *       exclude terms (`-term` returns zero rows), sort, de-duplication
 */
import { EbaySession } from './browser.js';
import {
  splitModules,
  parseAggregates,
  parseResults,
  parsePagination,
  type Aggregates,
  type Listing,
  type Pagination,
} from './parse.js';

const PAGE_LIMIT = 50; // eBay's max results per page on this endpoint
const DAY_MS = 86_400_000;

export type Tab = 'SOLD' | 'ACTIVE';
export type Condition = 'new' | 'used' | number;
export type Format = 'all' | 'auction' | 'fixed';
export type SortKey = 'best_match' | 'sales' | 'units' | 'price' | 'price_asc' | 'recent';

export interface SearchOpts {
  keywords: string;
  tab: Tab;
  days: number;
  categoryId: number;
  maxResults: number;
  marketplace: string;
  /** Wrap keywords in quotes so eBay matches the phrase, not loose tokens. */
  exact?: boolean;
  /** Drop rows whose title/extended title contains any of these (case-insensitive). */
  exclude?: string[];
  /** "new" -> conditionId 1000, "used" -> 3000, or a raw eBay conditionId. */
  condition?: Condition;
  minPrice?: number;
  maxPrice?: number;
  /** "auction"/"fixed" filter server-side; "all" (default) sends no format param. */
  format?: Format;
  /** Client-side ordering of the returned rows. */
  sort?: SortKey;
  /** Return only the aggregate market stats, no per-listing rows. */
  summaryOnly?: boolean;
  /** Include heavy fields (extendedTitle, moreImages). Off by default to keep
   *  the payload small — that was the cause of the token-limit blow-ups. */
  detail?: boolean;
}

/** A row as returned to callers — compact by default, `detail` adds heavy fields. */
export interface OutRow {
  itemId: string | null;
  title: string;
  url: string | null;
  imageUrl: string | null;
  format: string | null;
  // SOLD-tab fields
  avgSoldPrice: number | null;
  avgSoldPriceText: string | null;
  avgShipping: number | null;
  freeShippingPct: number | null;
  totalSold: number | null;
  totalSales: number | null;
  totalSalesText: string | null;
  dateLastSold: string | null;
  // ACTIVE-tab fields
  listingPrice: number | null;
  listingPriceText: string | null;
  listingShipping: number | null;
  watchers: number | null;
  promoted: boolean | null;
  startDate: string | null;
  // Both tabs
  bids: number | null;
  extendedTitle?: string | null;
  moreImages?: string[];
}

export interface SearchResult {
  /** Echo of what was actually queried, including applied filters. */
  query: {
    keywords: string;
    effectiveKeywords: string;
    tab: Tab;
    days: number;
    categoryId: number;
    marketplace: string;
    filters: Record<string, string | number>;
    exclude: string[];
    sort: SortKey;
  };
  aggregates: Aggregates | null;
  resultCount: number;
  results: OutRow[];
  pagination: Pagination | null;
  /** Non-fatal notes for the caller (e.g. how filters affect the numbers). */
  notes: string[];
}

/** Map a condition option to eBay's conditionId. Unknown -> undefined (no filter). */
function conditionId(c: Condition | undefined): number | undefined {
  if (c == null) return undefined;
  if (typeof c === 'number') return c;
  if (c === 'new') return 1000;
  if (c === 'used') return 3000;
  return undefined;
}

/** Build the server-side filter params (only the keys eBay actually honors). */
function filterParams(opts: SearchOpts): Record<string, string | number> {
  const f: Record<string, string | number> = {};
  const cond = conditionId(opts.condition);
  if (cond != null) f.conditionId = cond;
  if (opts.minPrice != null) f.minPrice = opts.minPrice;
  if (opts.maxPrice != null) f.maxPrice = opts.maxPrice;
  // format=ALL returns zero rows on this endpoint, so "all" means omit the param.
  if (opts.format === 'auction') f.format = 'AUCTION';
  else if (opts.format === 'fixed') f.format = 'FIXED_PRICE';
  return f;
}

/** Quote the phrase for exact matching (skip if the caller already quoted it). */
function effectiveKeywords(opts: SearchOpts): string {
  const kw = opts.keywords.trim();
  if (!opts.exact) return kw;
  return kw.startsWith('"') && kw.endsWith('"') ? kw : `"${kw}"`;
}

function buildQuery(params: Record<string, string | number>, modules: string[]): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  for (const m of modules) sp.append('modules', m);
  return sp.toString();
}

function matchesExclude(l: Listing, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const hay = `${l.title} ${l.extendedTitle ?? ''}`.toLowerCase();
  return terms.some((t) => hay.includes(t));
}

function sortRows(rows: Listing[], sort: SortKey): Listing[] {
  const num = (v: number | null) => (v == null ? -Infinity : v);
  const asc = (v: number | null) => (v == null ? Infinity : v);
  const time = (s: string | null) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  // Use the sold-tab field when present, else fall back to the active-tab
  // equivalent, so sorting works on both SOLD and ACTIVE results.
  const price = (l: Listing) => l.avgSoldPrice ?? l.listingPrice;
  const date = (l: Listing) => l.dateLastSold ?? l.startDate;
  const by = {
    best_match: null,
    sales: (a: Listing, b: Listing) => num(b.totalSales) - num(a.totalSales),
    units: (a: Listing, b: Listing) => num(b.totalSold) - num(a.totalSold),
    price: (a: Listing, b: Listing) => num(price(b)) - num(price(a)),
    price_asc: (a: Listing, b: Listing) => asc(price(a)) - asc(price(b)),
    recent: (a: Listing, b: Listing) => time(date(b)) - time(date(a)),
  }[sort];
  return by ? [...rows].sort(by) : rows;
}

function project(l: Listing, detail: boolean): OutRow {
  const row: OutRow = {
    itemId: l.itemId,
    title: l.title,
    url: l.url,
    imageUrl: l.imageUrl,
    format: l.format,
    avgSoldPrice: l.avgSoldPrice,
    avgSoldPriceText: l.avgSoldPriceText,
    avgShipping: l.avgShipping,
    freeShippingPct: l.freeShippingPct,
    totalSold: l.totalSold,
    totalSales: l.totalSales,
    totalSalesText: l.totalSalesText,
    dateLastSold: l.dateLastSold,
    listingPrice: l.listingPrice,
    listingPriceText: l.listingPriceText,
    listingShipping: l.listingShipping,
    watchers: l.watchers,
    promoted: l.promoted,
    startDate: l.startDate,
    bids: l.bids,
  };
  if (detail) {
    row.extendedTitle = l.extendedTitle;
    row.moreImages = l.moreImages;
  }
  return row;
}

/**
 * Run the search, paginating until we have `maxResults` rows that survive the
 * client-side filters (exclude/dedup) or run out of pages. Aggregates are
 * fetched once, from the first page, and reflect the *server-side* filters only.
 */
export async function runSearch(opts: SearchOpts, session: EbaySession): Promise<SearchResult> {
  const endDate = Date.now();
  const startDate = endDate - opts.days * DAY_MS;
  const tz = process.env.EBAY_MCP_TZ || 'UTC';
  const exclude = (opts.exclude ?? []).map((t) => t.toLowerCase()).filter(Boolean);
  const sort: SortKey = opts.sort ?? 'best_match';
  const filters = filterParams(opts);
  const keywords = effectiveKeywords(opts);

  let aggregates: Aggregates | null = null;
  let pagination: Pagination | null = null;
  const kept: Listing[] = [];
  const seen = new Set<string>();
  const notes: string[] = [];

  // Fetch enough pages to fill maxResults after client-side filtering. Cap the
  // page count so a heavy exclude filter can't loop over the whole catalog.
  const wantRows = opts.summaryOnly ? 0 : opts.maxResults;
  const maxPages = Math.max(1, Math.ceil((wantRows || PAGE_LIMIT) / PAGE_LIMIT) + 4);

  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const base: Record<string, string | number> = {
      marketplace: opts.marketplace,
      keywords,
      dayRange: opts.days,
      startDate,
      endDate,
      categoryId: opts.categoryId,
      offset,
      limit: PAGE_LIMIT,
      tabName: opts.tab,
      tz,
      ...filters,
    };
    const modules =
      page === 0 ? ['aggregates', 'searchResults', 'resultsHeader'] : ['searchResults'];

    const body = await session.fetchSearch(buildQuery(base, modules));
    const mods = splitModules(body);

    if (!aggregates && mods['aggregates']) {
      aggregates = parseAggregates(mods['aggregates']);
    }
    const sr = mods['searchResults'];
    if (!sr) break;

    const rows = parseResults(sr);
    if (rows.length === 0) break;

    for (const r of rows) {
      if (matchesExclude(r, exclude)) continue;
      const id = r.itemId ?? `${r.title}|${r.dateLastSold}`;
      if (seen.has(id)) continue; // de-dupe eBay's occasional repeated rows
      seen.add(id);
      kept.push(r);
    }

    pagination = parsePagination(sr);
    if (opts.summaryOnly) break;
    if (kept.length >= opts.maxResults) break;
    if (!pagination.hasNext) break;
    offset += PAGE_LIMIT;
  }

  const ordered = sortRows(kept, sort).slice(0, opts.summaryOnly ? 0 : opts.maxResults);

  if (Object.keys(filters).length || opts.exact) {
    notes.push('Aggregates reflect the server-side filters (condition/price/format/exact phrase).');
  }
  if (exclude.length) {
    notes.push(
      `Excluded ${exclude.length} term(s) client-side; aggregate totals still include them.`,
    );
  }
  if (sort !== 'best_match') {
    notes.push(
      `Rows sorted by '${sort}' within the ${kept.length} retrieved (not a full-catalog sort — raise max_results for a wider ranking).`,
    );
  }

  return {
    query: {
      keywords: opts.keywords,
      effectiveKeywords: keywords,
      tab: opts.tab,
      days: opts.days,
      categoryId: opts.categoryId,
      marketplace: opts.marketplace,
      filters,
      exclude,
      sort,
    },
    aggregates,
    resultCount: ordered.length,
    results: ordered.map((r) => project(r, !!opts.detail)),
    pagination,
    notes,
  };
}
