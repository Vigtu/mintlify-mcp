import {
  createAgnoBackend,
  DEFAULT_HOST,
  DEFAULT_PORT,
  isAgentRunning,
  isServerRunning,
} from "../backends/agno";
import { createMintlifyBackend } from "../backends/mintlify";
import type { Backend } from "../backends/types";
import { loadProjectConfig } from "../config/loader";
import { startMcpServer } from "../server";
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

  let backend: Backend;

  if (config.backend === "mintlify") {
    // Use Mintlify API backend
    if (!config.mintlify) {
      console.error("Mintlify configuration missing in project config.");
      process.exit(1);
    }

    backend = createMintlifyBackend(
      config.mintlify.project_id,
      config.mintlify.domain,
    );
  } else {
    // Use local RAG backend
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

    backend = createAgnoBackend(project, port, host);
  }

  // Start MCP server
  console.error(`Starting MCP server for "${config.name}"...`);
  await startMcpServer(backend, config.name);
}
