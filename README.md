# ebay-terapeak-mcp

[![license](https://img.shields.io/github/license/bintangtimurlangit/ebay-terapeak-mcp?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/bintangtimurlangit/ebay-terapeak-mcp/ci.yml?branch=main&style=flat-square)](https://github.com/bintangtimurlangit/ebay-terapeak-mcp/actions)
[![GitHub Repo](https://img.shields.io/badge/GitHub-ebay--terapeak--mcp-24292f?style=flat-square&logo=github)](https://github.com/bintangtimurlangit/ebay-terapeak-mcp)

An MCP server **and CLI** that lets an AI agent (Claude, etc.) — or you, from the
terminal — search eBay's **Terapeak "Product Research"** data (sold & active
listings) without opening the Seller Hub UI.

It wraps eBay's internal endpoint `GET /sh/research/api/search` and keeps a
**persistent, logged-in [CloakBrowser](https://github.com/CloakHQ/cloakbrowser)
session** (a fingerprint-patched Chromium) alive so requests are made from inside
a real browser. That carries your session cookies, passes eBay's bot
detection (Akamai + perfdrive), and lets the browser rotate the short-lived
anti-bot cookies itself — which is what avoids constant cookie-staleness.

> ⚠️ **Unofficial.** This uses a private endpoint intended for the Seller Hub
> web app, driven by your own logged-in session. It is not an eBay-supported API
> and can break if eBay changes the endpoint. Use it for your own research and
> keep request volume reasonable. For a supported alternative, see eBay's
> **Marketplace Insights API**.

**Full reference:** [Documentation](./docs/README.md) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md) · **Versioning & releases:** [docs/RELEASES.md](./docs/RELEASES.md)

---

## Requirements

- Node.js 18+ (tested on v24)
- A display (or `xvfb` on a headless server) — the session runs a real browser
- An eBay account with access to Seller Hub → Research

## Setup

```bash
cd ebay-terapeak-mcp
npm install          # also downloads the CloakBrowser binary (~200 MB, cached)
npm run build
```

### One-time login

Sign into eBay once. This opens a real browser window and saves the session to a
persistent profile (`~/.ebay-research-mcp/profile` by default).

```bash
npm run login
```

Sign in (complete any 2FA) and wait until the **"Research products"** page loads.
The window closes itself once login is detected.

> The login step and the running server both use the same browser profile, and a
> profile can only be open in one browser at a time. **Stop the MCP server before
> running `npm run login`.**

## Use with Claude Code

Register the server (point it at the built entry file):

```bash
claude mcp add ebay-terapeak -- node /ABSOLUTE/PATH/TO/ebay-terapeak-mcp/dist/index.js
```

Or add it to your MCP config JSON:

```json
{
  "mcpServers": {
    "ebay-terapeak": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/ebay-terapeak-mcp/dist/index.js"]
    }
  }
}
```

Then ask, e.g.: _"Search eBay sold listings for 'nintendo switch oled' over the
last 90 days."_

## Tools

| Tool                     | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `search_sold_listings`   | Sold-listing research: aggregate stats + per-listing rows. |
| `search_active_listings` | Same for currently-active listings.                        |
| `session_status`         | Report whether the browser profile is still logged in.     |

### Tool annotations

Per the [MCP annotations spec](https://modelcontextprotocol.io/) — all tools are read-only, with no side effects.

| Tool                     | Read-only | Idempotent | Destructive |
| ------------------------ | :-------: | :--------: | :---------: |
| `search_sold_listings`   |     ✓     |     ✓      |      –      |
| `search_active_listings` |     ✓     |     ✓      |      –      |
| `session_status`         |     ✓     |     ✓      |      –      |

### Parameters (both search tools)

| Param                     | Default      | Notes                                                           |
| ------------------------- | ------------ | --------------------------------------------------------------- |
| `keywords`                | —            | Search terms or a product id (MPN/UPC/EPID/EAN/ISBN).           |
| `exact`                   | `false`      | Quote the phrase so eBay matches it exactly (big noise cut).    |
| `exclude`                 | `[]`         | Terms to drop from results (client-side title match).           |
| `condition`               | —            | `new` or `used` (server-side).                                  |
| `min_price` / `max_price` | —            | Price range filter (server-side).                               |
| `format`                  | `all`        | `auction`, `fixed`, or `all` (server-side).                     |
| `sort`                    | `best_match` | `sales`, `units`, `price`, `price_asc`, `recent`, `best_match`. |
| `summary_only`            | `false`      | Return only aggregate stats, no rows.                           |
| `detail`                  | `false`      | Include heavy fields (`extendedTitle`, `moreImages`).           |
| `days`                    | `90`         | Lookback window in days (max 1095 = 3 years).                   |
| `category_id`             | `0`          | eBay category id; `0` = all.                                    |
| `max_results`             | `50`         | Listings to return; paginated 50/page (max 500).                |
| `marketplace`             | `EBAY-US`    | e.g. `EBAY-US`, `EBAY-GB`, `EBAY-DE`.                           |

### Filters: server-side vs client-side

The endpoint honors some refinements as query params and ignores others. Which
is which was verified empirically (by diffing result counts against the live
endpoint), not assumed:

- **Server-side** (narrows the data _and_ the aggregate stats): `exact` phrase,
  `condition` (`conditionId`), `min_price`/`max_price` (`minPrice`/`maxPrice`),
  `format` (`AUCTION`/`FIXED_PRICE`).
- **Client-side** (applied here after fetch; aggregates still reflect the
  unfiltered-by-these market): `exclude` (the endpoint returns _zero_ rows for
  `-term` exclusion), `sort`, and de-duplication of repeated rows.

Sorting orders the rows actually retrieved (up to `max_results`), so raise
`max_results` for a wider ranking.

### Response shape

```jsonc
{
  "query": { "keywords": "...", "tab": "SOLD", "days": 90, ... },
  "aggregates": {
    "avgSoldPrice": 117.78,
    "soldPriceRange": "$0.01 - $16,497.50",
    "avgShipping": 11.85,
    "freeShippingPct": 73,
    "totalSold": 247663,
    "sellThrough": "-",
    "totalSellers": 50063,
    "totalItemSales": 29169748.14,
    "raw": { "Avg sold price": "$117.78", ... }
  },
  "resultCount": 100,
  "results": [
    {
      "itemId": "366324079285",
      "title": "For Nintendo Switch OLED/NS/Lite Console ...",
      "extendedTitle": "...",
      "url": "https://www.ebay.com/itm/366324079285...",
      "imageUrl": "https://i.ebayimg.com/images/g/.../s-l1200.webp",
      "moreImages": [ "..." ],
      "format": "Fixed price",
      "avgSoldPrice": 11.27,
      "avgSoldPriceText": "$11.27",
      "avgShipping": 11.78,
      "freeShippingPct": 96,
      "totalSold": 486,
      "totalSales": 5478.54,
      "totalSalesText": "$5,478.54",
      "dateLastSold": "Jul 5, 2026",

      // ACTIVE-tab rows populate these instead of the sold-* fields above:
      "listingPrice": null,
      "listingPriceText": null,
      "listingShipping": null,
      "watchers": null,
      "promoted": null,
      "startDate": null,
      "bids": null
      // `extendedTitle` and `moreImages` appear only when detail=true
    }
  ],
  "pagination": { "summary": "Results: 1 - 50", "currentPage": 1, "hasNext": true },
  "notes": [ "Aggregates reflect the server-side filters ...", "..." ]
}
```

> **SOLD** rows carry `avgSoldPrice` / `totalSold` / `totalSales` / `dateLastSold`;
> **ACTIVE** rows carry `listingPrice` / `watchers` / `promoted` / `startDate`.
> The other tab's fields are `null`. Rows are **compact by default** (no
> `extendedTitle`/`moreImages`) to keep responses small — pass `detail: true` to
> include them.

## CLI

The same search engine is available from the terminal (no MCP client needed):

```bash
node dist/index.js search "Players Pins" --exact --sort sales --limit 15
node dist/index.js search "Players Pins" --active --exact --min-price 20 --max-price 60
node dist/index.js search "Players Pins" --exact --condition new --summary
node dist/index.js search "Players Pins" --exact --json > results.json
```

Run `node dist/index.js search --help` for all flags. Flags map 1:1 to the tool
params above (`--min-price`/`--max-price`, `--limit` = `max_results`,
`--category` = `category_id`, `--sold`/`--active` pick the tab). `--json` emits
the full structured result; otherwise a compact table is printed.

## Configuration (env vars)

| Var                 | Default                        | Purpose                                                 |
| ------------------- | ------------------------------ | ------------------------------------------------------- |
| `EBAY_MCP_PROFILE`  | `~/.ebay-research-mcp/profile` | Browser profile dir (holds your session).               |
| `EBAY_MCP_HEADLESS` | `1`                            | Set `0` to run headed if bot detection blocks headless. |
| `EBAY_MCP_TZ`       | `UTC`                          | Timezone string sent to eBay (e.g. `Asia/Jakarta`).     |

## Troubleshooting

- **`NotLoggedInError` / "non-JSON response"** — session expired or got flagged.
  Stop the server, run `npm run login`, restart.
- **Headless getting blocked** — set `EBAY_MCP_HEADLESS=0` in the MCP server env.
- **`profile ... already in use`** — the server and the login command can't run
  at the same time. Stop one.

## Layout

```
src/
  index.ts    entry: `login` / `search` (CLI) commands vs. start server
  browser.ts  persistent Playwright session (login + in-page fetch)
  parse.ts    deep mapping of eBay's module/TextualDisplay JSON -> flat objects
  core.ts     framework-agnostic search engine: query build, filters, pagination
  server.ts   MCP server + tool schemas (thin wrapper over core)
  cli.ts      CLI front-end (arg parsing + table output over core)
reference/
  ebay_terapeak.py   standalone cookie-replay script (no browser) — reference only
```

## Development

Lint, format, typecheck, and build with `npm run lint`, `npm run format`, `npm run typecheck`, and `npm run build`. Full guide: **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**.

## Contributing & security

[CONTRIBUTING.md](./CONTRIBUTING.md) · [SECURITY.md](./SECURITY.md) · [Code of Conduct](./CODE_OF_CONDUCT.md)

## License

[MIT](./LICENSE)

---

## Disclaimer

This is an **unofficial** project. It is **not affiliated with, authorized, maintained, sponsored, or endorsed by eBay Inc.**

It drives a **private endpoint** intended for the Seller Hub web app via your own logged-in session; it is not an eBay-supported API and can break if eBay changes the endpoint or its bot detection. For a supported alternative, see eBay's **Marketplace Insights API**. It reads only research data your account can already access and performs no account actions.

You are responsible for using this software in compliance with [eBay's User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement) and applicable law. Keep request volume reasonable. All product names, logos, and brands are property of their respective owners.
