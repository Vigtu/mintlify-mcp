import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  isAgentRunning,
  isServerRunning,
} from "../backends/agno";
import {
  type BackendType,
  getBackend,
  loadBackend,
} from "../backends/registry";
import type { Backend } from "../backends/types";
import { loadProjectConfig } from "../config/loader";
import { paths } from "../config/paths";
import { startMcpServer } from "../server";
import { ensureOpenAIApiKey } from "./prompt";
import { startServer, stopServer, waitForServer } from "./start";

// =============================================================================
// SERVE COMMAND - Start MCP server for Claude Code
// =============================================================================

/** Server startup timeout in milliseconds */
const SERVER_STARTUP_TIMEOUT_MS = 15_000;

export interface ServeOptions {
  project: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const { project } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    console.error("Run 'list' command to see available projects.");
    process.exit(1);
  }

  const backendType = config.backend as BackendType;

  // Validate backend is available before proceeding
  const loadResult = await loadBackend(backendType);
  if (!loadResult.success) {
    const error = loadResult.error!;
    console.error(`\nBackend Error: ${error.message}`);
    if (error.details) {
      console.error(`Details: ${error.details}`);
    }
    if (error.suggestion) {
      console.error(`\n${error.suggestion}`);
    }
    process.exit(1);
  }

  let backend: Backend;

  // Backend-specific initialization logic
  switch (backendType) {
    case "mintlify":
      backend = await createMintlifyBackendFromConfig(config);
      break;

    case "embedded":
      backend = await createEmbeddedBackendFromConfig(config);
      break;

    case "agno":
      backend = await createAgnoBackendFromConfig(config, project);
      break;

    default:
      // This should never happen if loadBackend succeeded
      console.error(`Unknown backend type: ${backendType}`);
      process.exit(1);
  }

  // Start MCP server
  console.error(`Starting MCP server for "${config.name}"...`);
  await startMcpServer(backend, config.name);
}

// =============================================================================
// BACKEND CREATION HELPERS
// =============================================================================

/**
 * Create Mintlify backend from project config
 */
async function createMintlifyBackendFromConfig(
  config: NonNullable<Awaited<ReturnType<typeof loadProjectConfig>>>,
): Promise<Backend> {
  if (!config.mintlify) {
    console.error("Mintlify configuration missing in project config.");
    process.exit(1);
  }

  const factory = await getBackend("mintlify");
  return factory.create({
    projectId: config.mintlify.project_id,
    domain: config.mintlify.domain,
  });
}

/**
 * Create embedded backend from project config
 */
async function createEmbeddedBackendFromConfig(
  config: NonNullable<Awaited<ReturnType<typeof loadProjectConfig>>>,
): Promise<Backend> {
  // Validate environment for cloud mode (prompt if interactive)
  if (!config.embedded?.local) {
    const hasApiKey = await ensureOpenAIApiKey();
    if (!hasApiKey) {
      console.error(
        "Tip: Reconfigure the project with --local flag for Ollama.",
      );
      process.exit(1);
    }
  }

  console.error(
    `Loading embedded backend (${config.embedded?.local ? "local" : "cloud"} mode)...`,
  );

  const factory = await getBackend("embedded");
  const backend = await factory.create({
    projectId: config.id,
    projectPath: paths.project(config.id),
    local: config.embedded?.local,
    llmProvider: config.embedded?.llm_provider,
    llmModel: config.embedded?.llm_model,
    embeddingProvider: config.embedded?.embedding_provider,
    embeddingModel: config.embedded?.embedding_model,
    ollamaBaseUrl: config.embedded?.ollama_base_url,
  });

  // Check if knowledge base has documents
  const isAvailable = await backend.isAvailable();
  if (!isAvailable) {
    console.error(
      "Warning: Knowledge base is empty or unavailable. Run setup again.",
    );
  }

  return backend;
}

/**
 * Create Agno backend from project config
 * Handles Python server lifecycle
 */
async function createAgnoBackendFromConfig(
  config: NonNullable<Awaited<ReturnType<typeof loadProjectConfig>>>,
  project: string,
): Promise<Backend> {
  const host = config.agno?.host || DEFAULT_HOST;
  const port = config.agno?.port || DEFAULT_PORT;

  // Check if the correct agent is running
  const agentExists = await isAgentRunning(project, port, host);

  if (!agentExists) {
    // Server might be running with different project - need to restart
    if (await isServerRunning(port, host)) {
      console.error(`Stopping existing server on port ${port}...`);
      await stopServer(port);
      await Bun.sleep(1000); // Wait for graceful shutdown
    }

    console.error(`Starting RAG server for "${project}" on port ${port}...`);

    const started = await startServer(project, port, false);
    if (!started) {
      console.error("Failed to start RAG server.");
      process.exit(1);
    }

    // Wait for server and agent to be ready
    const ready = await waitForServer(port, SERVER_STARTUP_TIMEOUT_MS, host);
    if (!ready) {
      console.error("RAG server did not become ready in time.");
      process.exit(1);
    }

    console.error("RAG server started.");
  }

  const factory = await getBackend("agno");
  return factory.create({
    projectId: project,
    host,
    port,
  });
}
