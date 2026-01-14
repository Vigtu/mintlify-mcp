import { loadProjectConfig } from "../config/loader";
import { paths, ensureDirExists, fileExists, remove } from "../config/paths";
import { isAgentOSRunning } from "../backends/agno";

// =============================================================================
// START COMMAND - Start AgentOS server for a project
// =============================================================================

export interface StartOptions {
  project: string;
  port?: number;
  verbose?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const { project, verbose = false } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    console.error("Run 'mintlify-mcp list' to see available projects.");
    process.exit(1);
  }

  if (config.backend !== "agno") {
    console.error(`Project "${project}" uses Mintlify backend, not Agno.`);
    console.error("AgentOS is only needed for Agno-based projects.");
    process.exit(1);
  }

  const port = options.port || config.agno?.port || 7777;

  // Check if already running
  if (await isAgentOSRunning(port)) {
    console.log(`AgentOS is already running on port ${port}`);
    return;
  }

  // Check if PID file exists (stale)
  const pidFile = paths.projectPid(project);
  if (await fileExists(pidFile)) {
    // Remove stale PID file
    await remove(pidFile);
  }

  // Find Python script path
  const pythonScript = await findPythonScript();
  if (!pythonScript) {
    console.error("Python AgentOS script not found.");
    console.error("Make sure python/mintlify_os/main.py exists.");
    process.exit(1);
  }

  console.log(`Starting AgentOS for project "${project}" on port ${port}...`);

  // Ensure logs directory exists
  await ensureDirExists(paths.projectLogs(project));

  // Start AgentOS in background using Bun.spawn
  const logFile = `${paths.projectLogs(project)}/agent.log`;
  const env = {
    ...process.env,
    MINTLIFY_DATA_DIR: paths.root,
    MINTLIFY_PROJECT_ID: project,
    MINTLIFY_PORT: String(port),
  };

  const proc = Bun.spawn(
    ["python", "-m", "mintlify_os.main", project, "--port", String(port)],
    {
      cwd: findPythonDir(),
      env,
      stdout: Bun.file(logFile),
      stderr: Bun.file(logFile),
    }
  );

  // Save PID
  await Bun.write(pidFile, String(proc.pid));

  if (verbose) {
    console.log(`PID: ${proc.pid}`);
    console.log(`Log: ${logFile}`);
  }

  // Wait a bit and check if it started
  await Bun.sleep(2000);

  if (await isAgentOSRunning(port)) {
    console.log(`AgentOS started successfully on http://localhost:${port}`);
    console.log(`\nTo use with Claude Code:`);
    console.log(`  mintlify-mcp serve --project ${project}`);
  } else {
    console.error("AgentOS failed to start. Check logs:");
    console.error(`  cat ${logFile}`);
    process.exit(1);
  }
}

/** Find the Python directory */
function findPythonDir(): string {
  // Look relative to this file's location
  const possiblePaths = [
    `${import.meta.dir}/../../python`,
    `${process.cwd()}/python`,
    `${paths.root}/python`,
  ];

  for (const p of possiblePaths) {
    // We'll just return the first one, actual check happens in startCommand
    return p;
  }

  return `${process.cwd()}/python`;
}

/** Find the Python script */
async function findPythonScript(): Promise<string | null> {
  const possiblePaths = [
    `${import.meta.dir}/../../python/mintlify_os/main.py`,
    `${process.cwd()}/python/mintlify_os/main.py`,
    `${paths.root}/python/mintlify_os/main.py`,
  ];

  for (const p of possiblePaths) {
    if (await fileExists(p)) {
      return p;
    }
  }

  return null;
}
