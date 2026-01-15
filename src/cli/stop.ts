import { listProjects, loadProjectConfig } from "../config/loader";
import { fileExists, paths, remove } from "../config/paths";

// =============================================================================
// STOP COMMAND - Stop server for a project
// =============================================================================

export interface StopOptions {
  project: string;
  force?: boolean;
}

export async function stopCommand(options: StopOptions): Promise<void> {
  const { project, force = false } = options;

  // Load project config
  const config = await loadProjectConfig(project);
  if (!config) {
    console.error(`Project "${project}" not found.`);
    process.exit(1);
  }

  const pidFile = paths.projectPid(project);

  if (!(await fileExists(pidFile))) {
    console.log(`No running server found for project "${project}".`);
    return;
  }

  // Read PID using Bun.file()
  const pidContent = await Bun.file(pidFile).text();
  const pid = parseInt(pidContent.trim(), 10);

  if (Number.isNaN(pid)) {
    console.error("Invalid PID file. Removing...");
    await remove(pidFile);
    return;
  }

  console.log(`Stopping server (PID: ${pid})...`);

  // Kill the process using process.kill (Bun native)
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // Process may already be dead
  }

  // Wait a bit for graceful shutdown
  if (!force) {
    await Bun.sleep(1000);
  }

  // Remove PID file
  await remove(pidFile);

  console.log("Server stopped.");
}

/** Stop all running server instances */
export async function stopAllServers(silent: boolean = false): Promise<number> {
  const projectIds = await listProjects();
  let stoppedCount = 0;

  for (const projectId of projectIds) {
    const pidFile = paths.projectPid(projectId);

    if (!(await fileExists(pidFile))) {
      continue;
    }

    const pidContent = await Bun.file(pidFile).text();
    const pid = parseInt(pidContent.trim(), 10);

    if (!Number.isNaN(pid)) {
      if (!silent) console.log(`Stopping ${projectId} (PID: ${pid})...`);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may already be dead
      }
      stoppedCount++;
    }

    await remove(pidFile);
  }

  return stoppedCount;
}

/** CLI command: Stop all servers */
export async function stopAllCommand(): Promise<void> {
  const stoppedCount = await stopAllServers();

  if (stoppedCount === 0) {
    console.log("No running server instances found.");
  } else {
    console.log(`Stopped ${stoppedCount} server instance(s).`);
  }
}
