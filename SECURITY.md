# Security

## Supported versions

Security fixes are applied to the **latest release** on the default branch when practical.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for undisclosed security problems.

1. Use [GitHub private vulnerability reporting](https://github.com/bintangtimurlangit/ebay-terapeak-mcp/security/advisories/new) if it is enabled for this repository, **or**
2. Contact the maintainers via a private channel (e.g. email on your GitHub profile).

Include:

- A short description of the issue and its impact
- Steps to reproduce (or a proof-of-concept), if safe to share
- Affected versions or dependency versions, if known

We aim to acknowledge reports within a few days and coordinate disclosure after a fix is available.

## Scope and credential handling

This is a **local MCP server + CLI** that reads eBay Terapeak research data through a **logged-in CloakBrowser session**. Be aware:

- Your **session lives on your machine** under `~/.ebay-research-mcp/profile` (configurable via `EBAY_MCP_PROFILE`). Treat that directory like a password — it grants access to your eBay account. It is never transmitted anywhere by this server, and the repo **gitignores** local profile/state.
- The server is **read-only** — it queries the Seller Hub Research endpoint; there are no account actions.
- It uses a **private endpoint** intended for the Seller Hub web app, driven by your own session. Keep request volume reasonable.

Issues in **eBay's services**, **CloakBrowser / Playwright**, or **upstream** dependencies (e.g. `@modelcontextprotocol/sdk`) should be reported to those projects when appropriate.
