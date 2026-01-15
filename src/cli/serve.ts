import { createAgnoBackend, isServerRunning } from "../backends/agno";
import { createMintlifyBackend } from "../backends/mintlify";
import type { Backend } from "../backends/types";
import { loadProjectConfig } from "../config/loader";
import { startMcpServer } from "../server";
import { startServer, waitForServer } from "./start";

// =============================================================================
// SERVE COMMAND - Start MCP server for Claude Code
// =============================================================================

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
    const port = config.agno?.port || 7777;

    // Auto-start server if not running
    if (!(await isServerRunning(port))) {
      console.error(`Starting RAG server on port ${port}...`);

      const started = await startServer(project, port, false);
      if (!started) {
        console.error("Failed to start RAG server.");
        process.exit(1);
      }

      // Wait for server to be ready
      const ready = await waitForServer(port, 15000);
      if (!ready) {
        console.error("RAG server did not become ready in time.");
        process.exit(1);
      }

      console.error("RAG server started.");
    }

    backend = createAgnoBackend(project, port);
  }

  // Start MCP server
  console.error(`Starting MCP server for "${config.name}"...`);
  await startMcpServer(backend, config.name);
}
