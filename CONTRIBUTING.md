# Contributing to ebay-terapeak-mcp

Thanks for helping improve this MCP server.

## Prerequisites

- [Node.js](https://nodejs.org/) **18+** (tested on v24)
- Google Chrome installed (preferred), or the bundled Chromium (`npx playwright install chromium`)
- An eBay account with access to Seller Hub → Research
- Git

## Getting started

```bash
git clone https://github.com/bintangtimurlangit/ebay-terapeak-mcp.git
cd ebay-terapeak-mcp
npm install
npx playwright install chromium   # optional fallback; Chrome is used if present
npm run build
npm run login   # one-time: sign into eBay in the browser window
```

More detail: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## Workflow

1. **Fork** the repository and create a **branch** from `main` (`feat/...`, `fix/...`, etc.).
2. Make focused changes; match existing **style**, **types**, and **patterns** in the codebase.
3. **Run checks** before opening a PR:

   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm run build
   ```

4. **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(core): ...`, `fix(parse): ...`, `docs: ...`). A `commit-msg` hook enforces this.
5. Open a **pull request** with a clear description of what changed and why.

## What to contribute

- Bug fixes with steps to reproduce when possible
- Documentation improvements (`README.md`, `docs/`)
- Features that fit the project's scope: **read-only** Terapeak research (sold & active listings) via MCP and the CLI. This drives your own logged-in Seller Hub session; account actions are out of scope.

## AI-assisted contributions

If a change was produced or heavily guided by an **AI coding agent or assistant**, disclose that in the PR description and **name the model** (e.g. _Claude Opus 4.8_, _GPT-5_).
