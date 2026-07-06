/**
 * Parsing helpers for eBay Seller Hub "Product Research" (Terapeak) responses.
 *
 * The endpoint returns several JSON objects concatenated with newlines, each an
 * eBay "module". Values are wrapped in a verbose TextualDisplay / TextSpan UI
 * format, so everything here is about digging the plain data back out.
 */

/** Join the plain text out of a TextualDisplay / TextSpan wrapper. */
export function textOf(node: any): string {
  if (!node || typeof node !== "object") return "";
  const spans = node.textSpans ?? [];
  return spans
    .map((s: any) => (s && typeof s.text === "string" ? s.text : ""))
    .join("")
    .trim();
}

/** "$5,478.54" -> 5478.54 ; "-" / "" -> null. Handles leading +, $, commas. */
export function parseMoney(s: string): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** "247,663" -> 247663 ; "-" -> null. */
export function parseIntSafe(s: string): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** "96% Free shipping" -> 96 ; "Free shipping" with no number -> null. */
export function parsePercent(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

/** Normalize eBay protocol-relative image URLs ("//i.ebayimg.com/...") . */
function normalizeUrl(u?: string | null): string | null {
  if (!u) return null;
  return u.startsWith("//") ? "https:" + u : u;
}

/**
 * The endpoint body is multiple JSON objects, one per module, separated by a
 * newline that precedes the next object's "{". Split and index them by name.
 */
export function splitModules(body: string): Record<string, any> {
  const mods: Record<string, any> = {};
  for (const chunk of body.split(/\n(?=\{)/)) {
    const t = chunk.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      const name = o?.meta?.name ?? o?._type ?? "unknown";
      mods[name] = o;
    } catch {
      /* ignore non-JSON fragments */
    }
  }
  return mods;
}

export interface Aggregates {
  avgSoldPrice: number | null;
  soldPriceRange: string | null;
  avgShipping: number | null;
  freeShippingPct: number | null;
  totalSold: number | null;
  sellThrough: string | null;
  totalSellers: number | null;
  totalItemSales: number | null;
  /** Every label/value pair exactly as eBay returned it, for anything unmapped. */
  raw: Record<string, string>;
}

/** Parse the ResearchAggregateModule (the top-of-page summary stats). */
export function parseAggregates(mod: any): Aggregates {
  const raw: Record<string, string> = {};
  for (const section of mod?.sections ?? []) {
    for (const item of section?.dataItems ?? []) {
      const label = textOf(item.header);
      if (label) raw[label] = textOf(item.value);
    }
  }
  return {
    avgSoldPrice: parseMoney(raw["Avg sold price"] ?? ""),
    soldPriceRange: raw["Sold price range"] ?? null,
    avgShipping: parseMoney(raw["Avg shipping"] ?? ""),
    freeShippingPct: parsePercent(raw["Free shipping"] ?? ""),
    totalSold: parseIntSafe(raw["Total sold"] ?? ""),
    sellThrough: raw["Sell-through"] ?? null,
    totalSellers: parseIntSafe(raw["Total sellers"] ?? ""),
    totalItemSales: parseMoney(raw["Total item sales"] ?? ""),
    raw,
  };
}

export interface Listing {
  itemId: string | null;
  title: string;
  extendedTitle: string | null;
  url: string | null;
  imageUrl: string | null;
  moreImages: string[];
  format: string | null;
  // SOLD-tab fields (null on ACTIVE rows):
  avgSoldPrice: number | null;
  avgSoldPriceText: string | null;
  avgShipping: number | null;
  freeShippingPct: number | null;
  totalSold: number | null;
  totalSales: number | null;
  totalSalesText: string | null;
  dateLastSold: string | null;
  // ACTIVE-tab fields (null on SOLD rows):
  listingPrice: number | null;
  listingPriceText: string | null;
  listingShipping: number | null;
  watchers: number | null;
  promoted: boolean | null;
  startDate: string | null;
  // Both tabs:
  bids: number | null;
}

/** Parse the SearchResultsModule rows into flat listing objects. */
export function parseResults(mod: any): Listing[] {
  const rows: any[] = mod?.results ?? [];
  return rows.map((row: any): Listing => {
    const listing = row.listing ?? {};
    const priceGroup = row.avgsalesprice ?? {};
    const shipGroup = row.avgshipping ?? {};
    const priceActive = row.listingPrice ?? {};
    const promotedText = textOf(row.promoted?.text);
    const itemId: string | null = listing?.itemId?.value ?? null;
    const format =
      textOf(priceGroup.format) ||
      (Array.isArray(listing.formatList) && listing.formatList[0]
        ? textOf(listing.formatList[0])
        : null);
    return {
      itemId,
      title: textOf(listing.title),
      extendedTitle: listing?.extendedTitle?.value ?? null,
      url:
        listing?.title?.action?.URL ??
        (itemId ? `https://www.ebay.com/itm/${itemId}` : null),
      imageUrl: normalizeUrl(listing?.image?.URL),
      moreImages: Array.isArray(listing.moreImages)
        ? listing.moreImages
            .map((i: any) => normalizeUrl(i?.URL))
            .filter((u: string | null): u is string => !!u)
        : [],
      format: format || null,
      // SOLD-tab fields
      avgSoldPrice: parseMoney(textOf(priceGroup.avgsalesprice)),
      avgSoldPriceText: textOf(priceGroup.avgsalesprice) || null,
      avgShipping: parseMoney(textOf(shipGroup.avgshipping)),
      freeShippingPct: parsePercent(textOf(shipGroup.freeshipping)),
      totalSold: parseIntSafe(textOf(row.itemssold)),
      totalSales: parseMoney(textOf(row.totalsales)),
      totalSalesText: textOf(row.totalsales) || null,
      dateLastSold: textOf(row.datelastsold) || null,
      // ACTIVE-tab fields
      listingPrice: parseMoney(textOf(priceActive.listingPrice)),
      listingPriceText: textOf(priceActive.listingPrice) || null,
      listingShipping: parseMoney(textOf(priceActive.listingShipping)),
      watchers: parseIntSafe(textOf(row.watchers)),
      promoted: promotedText ? promotedText !== "-" : null,
      startDate: textOf(row.startDate) || null,
      // Both tabs
      bids: parseIntSafe(textOf(row.bids)),
    };
  });
}

export interface Pagination {
  summary: string | null;
  currentPage: number | null;
  hasNext: boolean;
}

/** Parse the pagination block; hasNext drives the "fetch every page" loop. */
export function parsePagination(mod: any): Pagination {
  const p = mod?.pagination ?? {};
  return {
    summary: textOf(p.summary) || null,
    currentPage: typeof p.currentPageNum === "number" ? p.currentPageNum : null,
    hasNext: p?.next ? p.next.disabled === false : false,
  };
}
