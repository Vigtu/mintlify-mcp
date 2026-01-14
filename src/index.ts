#!/usr/bin/env bun

import { createCommand } from "./cli/create";
import { serveCommand } from "./cli/serve";
import { seedCommand } from "./cli/seed";
import { startCommand } from "./cli/start";
import { stopCommand, stopAllCommand } from "./cli/stop";
import { listCommand } from "./cli/list";

// Mintlify API mode imports
import { createMintlifyBackend } from "./backends/mintlify";
import { startMcpServer } from "./server";

// =============================================================================
// KNOWN DOCUMENTATION SITES (Mintlify API mode)
// =============================================================================

const KNOWN_DOCS: Record<string, { name: string; domain: string }> = {
  "agno-v2": { name: "Agno", domain: "docs.agno.com" },
  resend: { name: "Resend", domain: "resend.com/docs" },
  upstash: { name: "Upstash", domain: "upstash.com/docs" },
  mintlify: { name: "Mintlify", domain: "mintlify.com/docs" },
  vercel: { name: "Vercel", domain: "vercel.com/docs" },
  plain: { name: "Plain", domain: "plain.com/docs" },
};

// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

function showHelp(): void {
  console.log(`
mintlify-mcp - Query any Mintlify-powered documentation from Claude Code

COMMANDS:
  create    Create a new documentation project
  serve     Start MCP server for Claude Code
  seed      Seed documentation into knowledge base
  start     Start AgentOS server (for Agno backend)
  stop      Stop AgentOS server
  list      List all projects

USAGE:
  mintlify-mcp create --url <docs-url> --id <project-id> [options]
  mintlify-mcp serve --project <id>
  mintlify-mcp seed --project <id>
  mintlify-mcp start --project <id>
  mintlify-mcp stop --project <id>
  mintlify-mcp list

CREATE OPTIONS:
  --url <url>           Documentation site URL (required)
  --id <id>             Project ID (required)
  --name <name>         Display name (optional)
  --prefix <path>       Only include pages under this path (optional)
  --backend <type>      Backend type: agno or mintlify (default: agno)
  --download            Download all markdown files locally
  --parallel <n>        Concurrent downloads (default: 3)

SERVE OPTIONS:
  --project <id>        Project ID (required)

MINTLIFY API (for sites with AI Assistant feature):
  mintlify-mcp -p <mintlify-project-id>
  mintlify-mcp -p <mintlify-project-id> -n <name>

KNOWN MINTLIFY PROJECT IDs:
${Object.entries(KNOWN_DOCS)
  .map(([id, info]) => `  ${id.padEnd(12)} ${info.name}`)
  .join("\n")}

EXAMPLES:
  # Mintlify API: Use site's built-in AI Assistant
  mintlify-mcp -p agno-v2
  mintlify-mcp -p resend -n "Resend Docs"

  # Local Agent: Create your own AI Assistant (works with ANY Mintlify site)
  mintlify-mcp create --url https://docs.example.com --id my-docs
  mintlify-mcp create --url https://docs.example.com --id my-docs --prefix /guides
  mintlify-mcp create --url https://docs.example.com --id my-docs --download
  mintlify-mcp start --project my-docs
  mintlify-mcp seed --project my-docs
  mintlify-mcp serve --project my-docs

CLAUDE CODE CONFIGURATION:
  claude mcp add my-docs -- bunx mintlify-mcp serve --project my-docs
`);
}

interface ParsedArgs {
  command?: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = { flags: {}, positional: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.flags.help = true;
    } else if (arg === "--verbose" || arg === "-v") {
      result.flags.verbose = true;
    } else if (arg === "--force" || arg === "-f") {
      result.flags.force = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        result.flags[key] = next;
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const next = args[i + 1];
      // Map short flags to long flags
      const longKey =
        key === "p" ? "project" :
        key === "n" ? "name" :
        key === "u" ? "url" :
        key === "i" ? "id" :
        key === "d" ? "download" :
        key;

      if (next && !next.startsWith("-")) {
        result.flags[longKey] = next;
        i++;
      } else {
        result.flags[longKey] = true;
      }
    } else if (!result.command) {
      result.command = arg;
    } else {
      result.positional.push(arg);
    }
  }

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const parsed = parseArgs(args);

  if (parsed.flags.help) {
    showHelp();
    process.exit(0);
  }

  // Handle commands
  switch (parsed.command) {
    case "create":
      if (!parsed.flags.url || !parsed.flags.id) {
        console.error("Error: --url and --id are required for create command");
        console.error("Usage: mintlify-mcp create --url <docs-url> --id <project-id>");
        process.exit(1);
      }
      await createCommand({
        url: parsed.flags.url as string,
        id: parsed.flags.id as string,
        name: parsed.flags.name as string | undefined,
        prefix: parsed.flags.prefix as string | undefined,
        backend: (parsed.flags.backend as "agno" | "mintlify") || "agno",
        download: Boolean(parsed.flags.download),
        parallel: parsed.flags.parallel ? parseInt(parsed.flags.parallel as string) : undefined,
        verbose: Boolean(parsed.flags.verbose),
      });
      break;

    case "serve":
      if (!parsed.flags.project) {
        console.error("Error: --project is required for serve command");
        console.error("Usage: mintlify-mcp serve --project <id>");
        process.exit(1);
      }
      await serveCommand({ project: parsed.flags.project as string });
      break;

    case "seed":
      if (!parsed.flags.project) {
        console.error("Error: --project is required for seed command");
        console.error("Usage: mintlify-mcp seed --project <id>");
        process.exit(1);
      }
      await seedCommand({
        project: parsed.flags.project as string,
        force: Boolean(parsed.flags.force),
        verbose: Boolean(parsed.flags.verbose),
      });
      break;

    case "start":
      if (!parsed.flags.project) {
        console.error("Error: --project is required for start command");
        console.error("Usage: mintlify-mcp start --project <id>");
        process.exit(1);
      }
      await startCommand({
        project: parsed.flags.project as string,
        port: parsed.flags.port ? parseInt(parsed.flags.port as string) : undefined,
        verbose: Boolean(parsed.flags.verbose),
      });
      break;

    case "stop":
      if (parsed.flags.all) {
        await stopAllCommand();
      } else if (!parsed.flags.project) {
        console.error("Error: --project is required for stop command");
        console.error("Usage: mintlify-mcp stop --project <id>");
        process.exit(1);
      } else {
        await stopCommand({
          project: parsed.flags.project as string,
          force: Boolean(parsed.flags.force),
        });
      }
      break;

    case "list":
      await listCommand();
      break;

    case "help":
      showHelp();
      break;

    default:
      // MINTLIFY API MODE: If no command but --project flag, use Mintlify's API
      if (parsed.flags.project) {
        const projectId = parsed.flags.project as string;
        const knownDoc = KNOWN_DOCS[projectId];

        if (knownDoc) {
          // Use Mintlify backend for known docs
          const backend = createMintlifyBackend(projectId, knownDoc.domain);
          const projectName = (parsed.flags.name as string) || knownDoc.name;
          await startMcpServer(backend, projectName);
        } else {
          // Try to load from config
          const { loadProjectConfig } = await import("./config/loader");
          const config = await loadProjectConfig(projectId);

          if (config) {
            await serveCommand({ project: projectId });
          } else {
            // Fallback to Mintlify API with guessed domain
            const domain = `${projectId}.mintlify.app`;
            const backend = createMintlifyBackend(projectId, domain);
            const projectName = (parsed.flags.name as string) || projectId;
            await startMcpServer(backend, projectName);
          }
        }
      } else if (parsed.command) {
        console.error(`Unknown command: ${parsed.command}`);
        console.error("Run 'mintlify-mcp --help' for usage information.");
        process.exit(1);
      } else {
        showHelp();
      }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
