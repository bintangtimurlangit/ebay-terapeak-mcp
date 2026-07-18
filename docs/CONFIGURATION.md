# Configuration

For installing and building, see **[Setup](../README.md#setup)** in the README.

> **Login required.** This server reads Seller Hub research data through a saved browser session. Run `npm run login` once before use. There are no API keys — authentication is the CloakBrowser session under `~/.ebay-research-mcp/profile`. **Stop the server before running `npm run login`** — a profile can only be open in one browser at a time.

---

## Environment variables

All optional. Set them in your MCP client's **`env`** block, or copy `.env.example` to `.env` when developing from a checkout.

| Variable            | Default                        | Description                                             |
| ------------------- | ------------------------------ | ------------------------------------------------------- |
| `EBAY_MCP_PROFILE`  | `~/.ebay-research-mcp/profile` | Browser profile dir (holds your session).               |
| `EBAY_MCP_HEADLESS` | `1`                            | Set `0` to run headed if bot detection blocks headless. |
| `EBAY_MCP_TZ`       | `UTC`                          | Timezone string sent to eBay (e.g. `Asia/Jakarta`).     |

---

## MCP configuration (all clients)

This server uses **stdio**. Point it at the built entry file `dist/index.js`.

### Claude Code

```bash
claude mcp add ebay-terapeak -- node /ABSOLUTE/PATH/TO/ebay-terapeak-mcp/dist/index.js
```

### `mcpServers` JSON (any host)

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

Use an **absolute** path to `dist/index.js`. If bot detection blocks headless, add `"env": { "EBAY_MCP_HEADLESS": "0" }`.

## Claude Desktop

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Use the same **`mcpServers`** JSON as above.

## Other editors

Cursor, Zed, Windsurf, and any other **stdio MCP host** use the same pattern: a server whose command is `node` plus the path to `dist/index.js`.
