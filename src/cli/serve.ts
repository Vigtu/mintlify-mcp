import { loadProjectConfig } from "../config/loader";
import { createMintlifyBackend } from "../backends/mintlify";
import { createAgnoBackend, isAgentOSRunning } from "../backends/agno";
import type { Backend } from "../backends/types";
import { startMcpServer } from "../server";

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
    console.error("Run 'mintlify-mcp list' to see available projects.");
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
      config.mintlify.domain
    );
  } else {
    // Use Agno backend
    const port = config.agno?.port || 7777;

    // Check if AgentOS is running
    if (!(await isAgentOSRunning(port))) {
      console.error(`AgentOS is not running on port ${port}.`);
      console.error(`Start it with: mintlify-mcp start --project ${project}`);
      console.error("\nOr run both with:");
      console.error(
        `  mintlify-mcp start --project ${project} && mintlify-mcp serve --project ${project}`
      );
      process.exit(1);
    }

    backend = createAgnoBackend(project, port);
  }

  // Start MCP server
  console.error(`Starting MCP server for "${config.name}"...`);
  await startMcpServer(backend, config.name);
}
