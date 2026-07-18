# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0/). For **how** we version, tag, and publish, see [docs/RELEASES.md](./docs/RELEASES.md).

## [Unreleased]

### Added

- Standardized project scaffolding: `LICENSE` (MIT), `.editorconfig`, `.env.example`, ESLint + Prettier, Conventional Commits (commitlint), Husky pre-commit hooks, CI + release workflows, issue/PR templates, and a `docs/` guide set.

### Changed

- **Browser engine: switched from vanilla Playwright to [CloakBrowser](https://github.com/CloakHQ/cloakbrowser)** (a fingerprint-patched Chromium), aligning the anti-detection stack with the other browser-based MCP servers. CloakBrowser ships its own binary, so the separate `npx playwright install chromium` step is gone; `playwright` is retained only for its types. No tool or API changes.

## [0.2.0] - 2026-07-06

### Added

- MCP server **and CLI** for eBay **Terapeak Product Research** (sold & active listings) via a persistent Playwright session.
- **3 tools:** `search_sold_listings`, `search_active_listings`, `session_status`, with server-side and client-side filters (exact phrase, condition, price range, format, exclude, sort).
- Structured response shape with aggregates + per-listing rows; compact-by-default rows (`detail: true` for heavy fields).

[Unreleased]: https://github.com/bintangtimurlangit/ebay-terapeak-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bintangtimurlangit/ebay-terapeak-mcp/releases/tag/v0.2.0
