#!/usr/bin/env bun

// docmole - AI documentation assistant that digs through any docs site
import { createMintlifyBackend } from "./backends/mintlify";
// Legacy commands (kept for backward compatibility)
import { createCommand } from "./cli/create";
import { listCommand } from "./cli/list";
import { seedCommand } from "./cli/seed";
import { serveCommand } from "./cli/serve";
import { setupCommand } from "./cli/setup";
import { startCommand } from "./cli/start";
import { stopAllCommand, stopCommand } from "./cli/stop";
import { startMcpServer } from "./server";

// =============================================================================
// KNOWN DOCUMENTATION SITES (Mintlify API mode - for sites with AI Assistant)
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
// CLI
// =============================================================================

const CLI_NAME = "docmole";

function showHelp(): void {
  console.log(`
${CLI_NAME} - AI documentation assistant for Claude Code

QUICK START:
  ${CLI_NAME} setup --url <docs-url> --id <project-id>

  This will:
  1. Discover all documentation pages
  2. Create embedded vector store (no Python needed!)
  3. Seed knowledge base
  4. Show Claude Code configuration

COMMANDS:
  setup     Set up a new documentation assistant (recommended)
  serve     Start MCP server for Claude Code
  list      List all configured projects
  stop      Stop background RAG server (Agno mode only)

SETUP OPTIONS:
  --url <url>       Documentation site URL (required)
  --id <id>         Project ID (required)
  --name <name>     Display name (optional)
  --prefix <path>   Only include pages under this path (optional)
  --backend <type>  Backend: embedded (default), agno (Python)

ADVANCED OPTIONS:
  --llm-model <model>       LLM model name (default: gpt-4o-mini)
  --embedding-model <model> Embedding model name (default: text-embedding-3-small)

EXAMPLES:
  # Set up assistant for any documentation site (requires OPENAI_API_KEY)
  ${CLI_NAME} setup --url https://docs.example.com --id my-docs

  # After setup, add to Claude Code:
  claude mcp add my-docs -- bunx ${CLI_NAME} serve --project my-docs

MINTLIFY API (for sites with built-in AI Assistant):
  ${CLI_NAME} -p <project-id>

  Known projects: ${Object.keys(KNOWN_DOCS).join(", ")}

MANAGEMENT:
  ${CLI_NAME} list                     List all projects
  ${CLI_NAME} stop --project <id>      Stop RAG server (Agno mode)
  ${CLI_NAME} stop --all               Stop all servers
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
    } else if (arg === "--all") {
      result.flags.all = true;
    } else if (arg === "--local") {
      result.flags.local = true;
    } else if (arg === "--embedded") {
      result.flags.backend = "embedded";
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        // Convert kebab-case to camelCase for consistency
        const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        result.flags[camelKey] = next;
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const next = args[i + 1];
      // Map short flags to long flags
      const longKey =
        key === "p"
          ? "project"
          : key === "n"
            ? "name"
            : key === "u"
              ? "url"
              : key === "i"
                ? "id"
                : key;

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
    // =========================================================================
    // PRIMARY COMMANDS
    // =========================================================================

    case "setup":
      if (!parsed.flags.url || !parsed.flags.id) {
        console.error("Error: --url and --id are required for setup command");
        console.error(
          `Usage: ${CLI_NAME} setup --url <docs-url> --id <project-id>`,
        );
        process.exit(1);
      }
      await setupCommand({
        url: parsed.flags.url as string,
        id: parsed.flags.id as string,
        name: parsed.flags.name as string | undefined,
        prefix: parsed.flags.prefix as string | undefined,
        backend: (parsed.flags.backend as "agno" | "embedded") || "embedded",
        local: Boolean(parsed.flags.local),
        port: parsed.flags.port
          ? parseInt(parsed.flags.port as string, 10)
          : undefined,
        llmProvider: parsed.flags.llmProvider as
          | "openai"
          | "ollama"
          | undefined,
        llmModel: parsed.flags.llmModel as string | undefined,
        embeddingProvider: parsed.flags.embeddingProvider as
          | "openai"
          | "ollama"
          | undefined,
        embeddingModel: parsed.flags.embeddingModel as string | undefined,
        verbose: Boolean(parsed.flags.verbose),
      });
      break;

    case "serve":
      if (!parsed.flags.project) {
        console.error("Error: --project is required for serve command");
        console.error(`Usage: ${CLI_NAME} serve --project <id>`);
        process.exit(1);
      }
      await serveCommand({ project: parsed.flags.project as string });
      break;

    case "list":
      await listCommand();
      break;

    case "stop":
      if (parsed.flags.all) {
        await stopAllCommand();
      } else if (!parsed.flags.project) {
        console.error("Error: --project or --all is required for stop command");
        console.error(`Usage: ${CLI_NAME} stop --project <id>`);
        process.exit(1);
      } else {
        await stopCommand({
          project: parsed.flags.project as string,
          force: Boolean(parsed.flags.force),
        });
      }
      break;

    // =========================================================================
    // LEGACY COMMANDS (backward compatibility)
    // =========================================================================

    case "create":
      if (!parsed.flags.url || !parsed.flags.id) {
        console.error("Error: --url and --id are required");
        process.exit(1);
      }
      await createCommand({
        url: parsed.flags.url as string,
        id: parsed.flags.id as string,
        name: parsed.flags.name as string | undefined,
        prefix: parsed.flags.prefix as string | undefined,
        backend: (parsed.flags.backend as "agno" | "mintlify") || "agno",
        download: Boolean(parsed.flags.download),
        parallel: parsed.flags.parallel
          ? parseInt(parsed.flags.parallel as string, 10)
          : undefined,
        verbose: Boolean(parsed.flags.verbose),
      });
      break;

    case "seed":
      if (!parsed.flags.project) {
        console.error("Error: --project is required");
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
        console.error("Error: --project is required");
        process.exit(1);
      }
      await startCommand({
        project: parsed.flags.project as string,
        port: parsed.flags.port
          ? parseInt(parsed.flags.port as string, 10)
          : undefined,
        verbose: Boolean(parsed.flags.verbose),
      });
      break;

    case "help":
      showHelp();
      break;

    // =========================================================================
    // MINTLIFY API MODE (shorthand: -p <project-id>)
    // =========================================================================

    default:
      if (parsed.flags.project) {
        const projectId = parsed.flags.project as string;
        const knownDoc = KNOWN_DOCS[projectId];

        if (knownDoc) {
          // Use Mintlify backend for known docs
          const backend = createMintlifyBackend(projectId, knownDoc.domain);
          const projectName = (parsed.flags.name as string) || knownDoc.name;
          await startMcpServer(backend, projectName);
        } else {
          // Try to load from local config
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
        console.error(`Run '${CLI_NAME} --help' for usage information.`);
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
