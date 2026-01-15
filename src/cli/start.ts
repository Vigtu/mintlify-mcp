import { isServerRunning } from "../backends/agno";
import { loadProjectConfig } from "../config/loader";
import { ensureDirExists, fileExists, paths, remove } from "../config/paths";

// =============================================================================
// START - Start RAG server for a project
// =============================================================================

export interface StartOptions {
  project: string;
  port?: number;
  verbose?: boolean;
}

/** Start server (exported for use by setup command) */
export async function startServer(
  project: string,
  port: number,
  verbose: boolean = false,
): Promise<boolean> {
  // Check if already running
  if (await isServerRunning(port)) {
    if (verbose) {
      console.log(`   Server already running on port ${port}`);
    }
    return true;
  }

  // Check if PID file exists (stale)
  const pidFile = paths.projectPid(project);
  if (await fileExists(pidFile)) {
    await remove(pidFile);
  }

  // Find Python script path
  const pythonScript = await findPythonScript();
  if (!pythonScript) {
    if (verbose) {
      console.error("   Python server script not found.");
    }
    return false;
  }

  // Ensure logs directory exists
  await ensureDirExists(paths.projectLogs(project));

  // Start server in background
  const logFile = `${paths.projectLogs(project)}/server.log`;
  const env = {
    ...process.env,
    AGNO_DATA_DIR: paths.root,
    AGNO_PROJECT_ID: project,
    AGNO_PORT: String(port),
  };

  const proc = Bun.spawn(
    [
      "uv",
      "run",
      "python",
      "-m",
      "server.main",
      "--project",
      project,
      "--port",
      String(port),
    ],
    {
      cwd: findPythonDir(),
      env,
      stdout: Bun.file(logFile),
      stderr: Bun.file(logFile),
    },
  );

  // Save PID
  await Bun.write(pidFile, String(proc.pid));

  if (verbose) {
    console.log(`   PID: ${proc.pid}`);
    console.log(`   Log: ${logFile}`);
  }

  return true;
}

/** Wait for server to be ready (exported for use by setup/serve) */
export async function waitForServer(
  port: number,
  timeoutMs: number = 10000,
): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    if (await isServerRunning(port)) {
      return true;
    }
    await Bun.sleep(checkInterval);
  }

  return false;
}

/** CLI command handler */
export async function startCommand(options: StartOptions): Promise<void> {
  const { project, verbose = false } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    console.error("Run 'list' command to see available projects.");
    process.exit(1);
  }

  if (config.backend !== "agno") {
    console.error(`Project "${project}" uses remote API backend.`);
    console.error("Local server is only needed for local RAG projects.");
    process.exit(1);
  }

  const port = options.port || config.agno?.port || 7777;

  // Check if already running
  if (await isServerRunning(port)) {
    console.log(`Server already running on port ${port}`);
    return;
  }

  console.log(`Starting server for "${project}" on port ${port}...`);

  const started = await startServer(project, port, verbose);
  if (!started) {
    console.error("Failed to start server.");
    process.exit(1);
  }

  // Wait for server to be ready
  const ready = await waitForServer(port, 10000);
  if (ready) {
    console.log(`Server started successfully on http://localhost:${port}`);
  } else {
    const logFile = `${paths.projectLogs(project)}/server.log`;
    console.error("Server failed to start. Check logs:");
    console.error(`  cat ${logFile}`);
    process.exit(1);
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/** Find the Python directory */
function findPythonDir(): string {
  const possiblePaths = [
    `${import.meta.dir}/../../python`,
    `${process.cwd()}/python`,
    `${paths.root}/python`,
  ];

  for (const p of possiblePaths) {
    return p;
  }

  return `${process.cwd()}/python`;
}

/** Find the Python script */
async function findPythonScript(): Promise<string | null> {
  const possiblePaths = [
    `${import.meta.dir}/../../python/server/main.py`,
    `${process.cwd()}/python/server/main.py`,
    `${paths.root}/python/server/main.py`,
  ];

  for (const p of possiblePaths) {
    if (await fileExists(p)) {
      return p;
    }
  }

  return null;
}
