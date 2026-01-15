import { projectExists, saveProjectConfig } from "../config/loader";
import { ensureDirExists, paths } from "../config/paths";
import {
  createDefaultProjectConfig,
  type ProjectConfig,
} from "../config/schema";
import { discoverPages, isMintlifySite } from "../discovery";
import { seedDocs } from "./seed";
import { startServer, waitForServer } from "./start";
import { stopAllServers } from "./stop";

// =============================================================================
// SETUP COMMAND - One-command setup for local RAG assistant
// =============================================================================

export interface SetupOptions {
  url: string;
  id: string;
  name?: string;
  prefix?: string;
  port?: number;
  verbose?: boolean;
}

export async function setupCommand(options: SetupOptions): Promise<void> {
  const { url, id, name, prefix, port = 7777, verbose = false } = options;

  console.log("\n🚀 Setting up documentation assistant...\n");

  // ==========================================================================
  // STEP 1: Validate inputs
  // ==========================================================================

  // Validate project ID
  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error(
      "❌ Project ID must contain only lowercase letters, numbers, and hyphens.",
    );
    process.exit(1);
  }

  // Check if project already exists
  if (await projectExists(id)) {
    console.error(`❌ Project "${id}" already exists.`);
    console.error("   Use a different ID or delete the existing project.");
    process.exit(1);
  }

  // Validate URL
  let normalizedUrl: string;
  try {
    const parsed = new URL(url);
    normalizedUrl =
      `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    console.error(`❌ Invalid URL: ${url}`);
    process.exit(1);
  }

  // ==========================================================================
  // STEP 2: Discover documentation pages
  // ==========================================================================

  console.log(`📖 Discovering pages from ${normalizedUrl}...`);

  const isMintlify = await isMintlifySite(normalizedUrl);
  if (!isMintlify && verbose) {
    console.log("   (Could not confirm Mintlify site, continuing anyway)");
  }

  const discovery = await discoverPages(normalizedUrl, {
    prefix,
    method: "auto",
    verbose,
  });

  if (discovery.pages.length === 0) {
    console.error("\n❌ No pages found.");
    console.error(
      "   Make sure the URL is correct and the site is accessible.",
    );
    process.exit(1);
  }

  console.log(
    `   Found ${discovery.pages.length} pages via ${discovery.method}`,
  );
  if (discovery.total !== discovery.filtered) {
    console.log(
      `   (${discovery.total} total, ${discovery.filtered} after prefix filter)`,
    );
  }

  // ==========================================================================
  // STEP 3: Create project config
  // ==========================================================================

  console.log(`\n⚙️  Creating project "${id}"...`);

  const config: ProjectConfig = createDefaultProjectConfig(id, normalizedUrl, {
    name: name || extractSiteName(normalizedUrl),
    prefix,
    backend: "agno",
    agnoPort: port,
  });

  config.source.discovery = discovery.method;

  await ensureDirExists(paths.project(id));
  await saveProjectConfig(config);

  console.log(`   Config saved to: ${paths.projectConfig(id)}`);

  // ==========================================================================
  // STEP 4: Start server
  // ==========================================================================

  // Stop any existing servers first
  await stopAllServers(true);

  console.log(`\n🤖 Starting RAG server on port ${port}...`);

  const started = await startServer(id, port, verbose);
  if (!started) {
    console.error("\n❌ Failed to start RAG server.");
    console.error("   Check logs for details.");
    process.exit(1);
  }

  // Wait for server to be ready (30s timeout for dependency loading)
  const ready = await waitForServer(port, 30000);
  if (!ready) {
    console.error("\n❌ RAG server did not become ready in time.");
    process.exit(1);
  }

  console.log(`   Server running on http://localhost:${port}`);

  // ==========================================================================
  // STEP 5: Seed documentation
  // ==========================================================================

  console.log(
    `\n📚 Seeding ${discovery.pages.length} pages to knowledge base...`,
  );

  const seedResult = await seedDocs(id, discovery.pages, port, verbose);

  console.log(`   Success: ${seedResult.success}`);
  if (seedResult.errors > 0) {
    console.log(`   Errors:  ${seedResult.errors}`);
  }

  // ==========================================================================
  // DONE - Show next steps
  // ==========================================================================

  const cliName = "mintlify-mcp"; // TODO: will be renamed

  console.log(`\n${"=".repeat(60)}`);
  console.log("✅ Setup complete!");
  console.log("=".repeat(60));

  console.log("\n📋 Add to Claude Code:\n");
  console.log(
    `   claude mcp add ${id} -- bunx ${cliName} serve --project ${id}`,
  );

  console.log("\n💡 Or add manually to your MCP settings:\n");
  console.log(`   {
     "mcpServers": {
       "${id}": {
         "command": "bunx",
         "args": ["${cliName}", "serve", "--project", "${id}"]
       }
     }
   }`);

  console.log(
    "\n🎉 Done! Restart Claude Code to use your documentation assistant.\n",
  );
}

// =============================================================================
// HELPERS
// =============================================================================

/** Extract a readable name from URL */
function extractSiteName(url: string): string {
  const hostname = new URL(url).hostname;
  const name = hostname
    .replace(/^(docs|www)\./, "")
    .replace(/\.(com|io|dev|ai|org|net)$/, "")
    .replace(/\./g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return `${name} Docs`;
}
