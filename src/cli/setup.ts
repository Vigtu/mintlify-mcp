import { DEFAULT_HOST, DEFAULT_PORT } from "../backends/agno";
import { projectExists, saveProjectConfig } from "../config/loader";
import { ensureDirExists, paths } from "../config/paths";
import {
  createDefaultProjectConfig,
  type ProjectConfig,
} from "../config/schema";
import { discoverPages, isMintlifySite } from "../discovery";
import { ensureOpenAIApiKey } from "./prompt";
import { seedDocs } from "./seed";
import { startServer, waitForServer } from "./start";
import { stopAllServers } from "./stop";

// =============================================================================
// SETUP COMMAND - One-command setup for local RAG assistant
// =============================================================================

/** Server startup timeout for setup (longer due to dependency loading) */
const SETUP_SERVER_TIMEOUT_MS = 30_000;

export interface SetupOptions {
  url: string;
  id: string;
  name?: string;
  prefix?: string;
  // Backend selection
  backend?: "agno" | "embedded";
  local?: boolean;
  // Agno options
  host?: string;
  port?: number;
  // Embedded options (advanced)
  llmProvider?: "openai" | "ollama";
  llmModel?: string;
  embeddingProvider?: "openai" | "ollama";
  embeddingModel?: string;
  // General
  verbose?: boolean;
}

export async function setupCommand(options: SetupOptions): Promise<void> {
  const {
    url,
    id,
    name,
    prefix,
    backend = "embedded",
    local = false,
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    llmProvider,
    llmModel,
    embeddingProvider,
    embeddingModel,
    verbose = false,
  } = options;

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

  // Validate environment for RAG backends (embedded & agno both need OpenAI)
  if (backend === "embedded" || backend === "agno") {
    // Local mode (Ollama) is not yet implemented for embedded
    if (backend === "embedded" && local) {
      console.error("❌ Local mode (Ollama) is not yet implemented.");
      console.error("   Please use OpenAI mode with OPENAI_API_KEY for now.");
      process.exit(1);
    }

    // Ensure API key is available (prompt if interactive)
    const hasApiKey = await ensureOpenAIApiKey();
    if (!hasApiKey) {
      process.exit(1);
    }
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
    backend,
    // Agno options
    agnoHost: host,
    agnoPort: port,
    // Embedded options
    local,
    llmProvider: llmProvider ?? (local ? "ollama" : "openai"),
    llmModel,
    embeddingProvider: embeddingProvider ?? (local ? "ollama" : "openai"),
    embeddingModel,
  });

  config.source.discovery = discovery.method;

  await ensureDirExists(paths.project(id));
  await saveProjectConfig(config);

  console.log(`   Config saved to: ${paths.projectConfig(id)}`);

  // ==========================================================================
  // STEP 4: Seed documentation (backend-specific)
  // ==========================================================================

  if (backend === "embedded") {
    await setupEmbeddedBackend(config, discovery.pages, verbose);
  } else {
    await setupAgnoBackend(config, discovery.pages, port, host, verbose);
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
// BACKEND-SPECIFIC SETUP
// =============================================================================

/**
 * Setup embedded backend - seed directly using TypeScript RAG
 */
async function setupEmbeddedBackend(
  config: ProjectConfig,
  pages: Array<{ url: string; path: string }>,
  verbose: boolean,
): Promise<void> {
  console.log(
    `\n📚 Seeding ${pages.length} pages to embedded knowledge base...`,
  );

  const modeLabel = config.embedded?.local
    ? "local (Ollama)"
    : "cloud (OpenAI)";
  console.log(`   Mode: ${modeLabel}`);

  // Dynamic import to avoid loading embedded module if not needed
  const { createEmbeddedBackend } = await import("../backends/embedded");
  const { fetchWithMetadata, getMarkdownUrl } = await import("../discovery");

  // Create embedded backend
  const backend = await createEmbeddedBackend(config.id, {
    projectPath: paths.project(config.id),
    local: config.embedded?.local,
    llmProvider: config.embedded?.llm_provider,
    llmModel: config.embedded?.llm_model,
    embeddingProvider: config.embedded?.embedding_provider,
    embeddingModel: config.embedded?.embedding_model,
    ollamaBaseUrl: config.embedded?.ollama_base_url,
  });

  // Get knowledge base for direct seeding
  const knowledge = backend.getKnowledge();
  if (!knowledge) {
    console.error("❌ Failed to initialize knowledge base.");
    process.exit(1);
  }

  let successCount = 0;
  let errorCount = 0;

  // Process pages in batches to show progress
  const batchSize = 5;
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (page) => {
        try {
          const mdUrl = getMarkdownUrl(page);
          const result = await fetchWithMetadata(mdUrl, page.path);

          if (!result) {
            return { success: false, error: `Failed to fetch: ${mdUrl}` };
          }

          const { content, metadata } = result;
          const docName =
            page.path.replace(/^\//, "").replace(/\//g, "-") || "index";

          await knowledge.addDocument({
            name: docName,
            content,
            metadata: {
              path: page.path,
              title: metadata.title,
              description: metadata.description,
              section: extractSection(page.path),
              source_url: page.url,
            },
          });

          return { success: true };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }),
    );

    for (const result of results) {
      if (result.success) {
        successCount++;
      } else {
        errorCount++;
        if (verbose && result.error) {
          console.error(`   Error: ${result.error}`);
        }
      }
    }

    if (!verbose) {
      process.stdout.write(
        `\r   Seeding: ${successCount + errorCount}/${pages.length} pages...`,
      );
    } else {
      console.log(
        `   [${successCount + errorCount}/${pages.length}] batch complete`,
      );
    }
  }

  if (!verbose) {
    console.log(); // New line after progress
  }

  console.log(`   Success: ${successCount}`);
  if (errorCount > 0) {
    console.log(`   Errors:  ${errorCount}`);
  }

  // Update seeding status
  const { updateSeedingStatus } = await import("../config/loader");
  await updateSeedingStatus(config.id, {
    status: "completed",
    documents_count: successCount,
    last_seeded: new Date().toISOString(),
  });
}

/**
 * Setup Agno backend - start Python server and seed via HTTP
 */
async function setupAgnoBackend(
  config: ProjectConfig,
  pages: Array<{ url: string; path: string }>,
  port: number,
  host: string,
  verbose: boolean,
): Promise<void> {
  // Stop any existing servers first
  await stopAllServers(true);

  console.log(`\n🤖 Starting RAG server on port ${port}...`);

  const started = await startServer(config.id, port, verbose);
  if (!started) {
    console.error("\n❌ Failed to start RAG server.");
    console.error("   Check logs for details.");
    process.exit(1);
  }

  // Wait for server to be ready (longer timeout for dependency loading)
  const ready = await waitForServer(port, SETUP_SERVER_TIMEOUT_MS, host);
  if (!ready) {
    console.error("\n❌ RAG server did not become ready in time.");
    process.exit(1);
  }

  console.log(`   Server running on http://${host}:${port}`);

  console.log(`\n📚 Seeding ${pages.length} pages to knowledge base...`);

  const seedResult = await seedDocs(config.id, pages, port, host, verbose);

  console.log(`   Success: ${seedResult.success}`);
  if (seedResult.errors > 0) {
    console.log(`   Errors:  ${seedResult.errors}`);
  }
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

/** Extract section from path (first segment after root) */
function extractSection(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[0] || "root";
}
