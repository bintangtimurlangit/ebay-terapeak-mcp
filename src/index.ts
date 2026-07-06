#!/usr/bin/env node
/**
 * Entry point.
 *   node dist/index.js                     -> start the MCP server (stdio)
 *   node dist/index.js login               -> one-time interactive eBay sign-in
 *   node dist/index.js search "<kw>" ...   -> run a research search from the CLI
 */
import { loginInteractive } from "./browser.js";
import { startServer } from "./server.js";
import { runCli } from "./cli.js";

const cmd = process.argv[2];

if (cmd === "login") {
  loginInteractive()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else if (cmd === "search") {
  runCli(process.argv.slice(3))
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
} else {
  startServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
