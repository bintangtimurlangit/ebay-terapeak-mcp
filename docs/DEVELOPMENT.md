# Development

## Scripts

| Command             | Description                                         |
| ------------------- | --------------------------------------------------- |
| `npm install`       | Install dependencies                                |
| `npm run login`     | One-time: build, then sign into eBay in the browser |
| `npm run build`     | Compile TypeScript to `dist/` (`tsc`)               |
| `npm run dev`       | Watch mode: `tsc -w`                                |
| `npm run start`     | Build and run the server                            |
| `npm run lint`      | ESLint over the repo                                |
| `npm run format`    | Prettier write; `npm run format:check` to verify    |
| `npm run typecheck` | `tsc --noEmit`                                      |

## Project layout

```
src/
  index.ts    # entry: `login` / `search` (CLI) commands vs. start server
  browser.ts  # persistent Playwright session (login + in-page fetch)
  parse.ts    # deep mapping of eBay's module/TextualDisplay JSON -> flat objects
  core.ts     # framework-agnostic search engine: query build, filters, pagination
  server.ts   # MCP server + tool schemas (thin wrapper over core)
  cli.ts      # CLI front-end (arg parsing + table output over core)
reference/
  ebay_terapeak.py   # standalone cookie-replay script (no browser) — reference only
```

## How the endpoint is driven

The server wraps eBay's internal endpoint `GET /sh/research/api/search` and keeps a **persistent, logged-in [CloakBrowser](https://github.com/CloakHQ/cloakbrowser) session** (a fingerprint-patched Chromium) alive so requests are made from inside a real browser. That carries your session cookies, passes eBay's bot detection (Akamai + perfdrive), and lets the browser rotate the short-lived anti-bot cookies itself. CloakBrowser's context is Playwright-API-compatible, so `playwright` is kept only for its types.

The endpoint honors some refinements as query params (server-side: `exact`, `condition`, price range, `format`) and ignores others (client-side here: `exclude`, `sort`, de-dup). See the README's **Filters** section.

## Build output

`npm run build` emits JavaScript under **`dist/`**. The repo **gitignores** `dist/`.

## Tech stack

- TypeScript, **strict**
- Zod for MCP tool input validation
- `@modelcontextprotocol/sdk` (stdio), CloakBrowser (+ Playwright types)
