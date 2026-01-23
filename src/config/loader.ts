import YAML from "yaml";
import { validateProjectId } from "../security";
import { ensureDirExists, fileExists, listDir, paths, remove } from "./paths";
import {
  DEFAULT_GLOBAL_CONFIG,
  type GlobalConfig,
  type ProjectConfig,
} from "./schema";

// =============================================================================
// CONFIG LOADER - Using Bun's native file APIs
// =============================================================================

/** Load project config from YAML */
export async function loadProjectConfig(
  projectId: string,
): Promise<ProjectConfig | null> {
  // Validate project ID to prevent path traversal
  const validation = validateProjectId(projectId);
  if (!validation.valid) {
    console.error(`Invalid project ID: ${validation.error}`);
    return null;
  }

  const configPath = paths.projectConfig(validation.sanitized!);

  if (!(await fileExists(configPath))) {
    return null;
  }

  const file = Bun.file(configPath);
  const content = await file.text();
  return YAML.parse(content) as ProjectConfig;
}

/** Save project config to YAML */
export async function saveProjectConfig(config: ProjectConfig): Promise<void> {
  const projectDir = paths.project(config.id);
  const configPath = paths.projectConfig(config.id);

  // Ensure project directory exists
  await ensureDirExists(projectDir);

  // Write config using Bun.write
  const content = YAML.stringify(config, { indent: 2 });
  await Bun.write(configPath, content);
}

/** Load global config from YAML */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const configPath = paths.globalConfig;

  if (!(await fileExists(configPath))) {
    return DEFAULT_GLOBAL_CONFIG;
  }

  const file = Bun.file(configPath);
  const content = await file.text();
  return { ...DEFAULT_GLOBAL_CONFIG, ...YAML.parse(content) };
}

/** Save global config to YAML */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await ensureDirExists(paths.root);
  const content = YAML.stringify(config, { indent: 2 });
  await Bun.write(paths.globalConfig, content);
}

/** List all project IDs */
export async function listProjects(): Promise<string[]> {
  return listDir(paths.projects);
}

/** Get all project configs */
export async function getAllProjects(): Promise<ProjectConfig[]> {
  const projectIds = await listProjects();
  const configs: ProjectConfig[] = [];

  for (const id of projectIds) {
    const config = await loadProjectConfig(id);
    if (config) {
      configs.push(config);
    }
  }

  return configs;
}

/** Delete a project */
export async function deleteProject(projectId: string): Promise<void> {
  // Validate project ID to prevent path traversal
  const validation = validateProjectId(projectId);
  if (!validation.valid) {
    throw new Error(`Invalid project ID: ${validation.error}`);
  }
  await remove(paths.project(validation.sanitized!));
}

/** Check if project exists */
export async function projectExists(projectId: string): Promise<boolean> {
  // Validate project ID to prevent path traversal
  const validation = validateProjectId(projectId);
  if (!validation.valid) {
    return false;
  }
  return fileExists(paths.projectConfig(validation.sanitized!));
}

/** Update project config partially */
export async function updateProjectConfig(
  projectId: string,
  updates: Partial<ProjectConfig>,
): Promise<ProjectConfig | null> {
  const config = await loadProjectConfig(projectId);
  if (!config) return null;

  const updated = { ...config, ...updates };
  await saveProjectConfig(updated);
  return updated;
}

/** Update seeding status */
export async function updateSeedingStatus(
  projectId: string,
  status: ProjectConfig["seeding"],
): Promise<void> {
  const config = await loadProjectConfig(projectId);
  if (!config) return;

  config.seeding = status;
  await saveProjectConfig(config);
}
