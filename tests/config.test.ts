import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createAgnoBackend } from "../src/backends/agno";
import {
  deleteProject,
  listProjects,
  loadGlobalConfig,
  loadProjectConfig,
  projectExists,
  saveProjectConfig,
  updateProjectConfig,
} from "../src/config/loader";
import {
  createDefaultProjectConfig,
  DEFAULT_AGNO_CONFIG,
  DEFAULT_EMBEDDED_CONFIG,
} from "../src/config/schema";

// =============================================================================
// TEST SETUP
// =============================================================================

const TEST_DATA_DIR = join(import.meta.dir, ".test-config-data");

beforeAll(async () => {
  process.env.MINTLIFY_DATA_DIR = TEST_DATA_DIR;
  await mkdir(TEST_DATA_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
});

// =============================================================================
// PROJECT CONFIG FACTORY
// =============================================================================

describe("createDefaultProjectConfig", () => {
  test("creates embedded config with defaults (new default)", () => {
    const config = createDefaultProjectConfig(
      "test-id",
      "https://docs.example.com",
    );

    expect(config.id).toBe("test-id");
    expect(config.name).toBe("test-id");
    expect(config.backend).toBe("embedded");
    expect(config.embedded?.llm_provider).toBe(
      DEFAULT_EMBEDDED_CONFIG.llm_provider,
    );
    expect(config.embedded?.llm_model).toBe(DEFAULT_EMBEDDED_CONFIG.llm_model);
    expect(config.seeding?.status).toBe("pending");
  });

  test("agno backend with custom host/port", () => {
    const config = createDefaultProjectConfig(
      "test-id",
      "https://docs.example.com",
      {
        backend: "agno",
        agnoHost: "192.168.1.100",
        agnoPort: 8080,
      },
    );

    expect(config.backend).toBe("agno");
    expect(config.agno?.host).toBe("192.168.1.100");
    expect(config.agno?.port).toBe(8080);
    expect(config.agno?.model).toBe(DEFAULT_AGNO_CONFIG.model);
  });

  test("mintlify backend extracts domain from URL", () => {
    const config = createDefaultProjectConfig(
      "test-id",
      "https://docs.mysite.com/api",
      {
        backend: "mintlify",
      },
    );

    expect(config.backend).toBe("mintlify");
    expect(config.mintlify?.domain).toBe("docs.mysite.com");
    expect(config.mintlify?.project_id).toBe("test-id");
  });

  test("embedded local mode uses ollama defaults", () => {
    const config = createDefaultProjectConfig(
      "test-id",
      "https://docs.example.com",
      {
        backend: "embedded",
        local: true,
      },
    );

    expect(config.backend).toBe("embedded");
    expect(config.embedded?.local).toBe(true);
    expect(config.embedded?.llm_provider).toBe("ollama");
    expect(config.embedded?.embedding_provider).toBe("ollama");
  });
});

// =============================================================================
// PROJECT LOADER (real I/O)
// =============================================================================

describe("Project Loader", () => {
  const testProjectId = "test-loader-project";

  test("save and load roundtrip preserves data", async () => {
    const config = createDefaultProjectConfig(
      testProjectId,
      "https://example.com",
      {
        name: "Test Project",
        backend: "embedded",
      },
    );
    await saveProjectConfig(config);

    const loaded = await loadProjectConfig(testProjectId);

    expect(loaded?.id).toBe(testProjectId);
    expect(loaded?.name).toBe("Test Project");
    expect(loaded?.backend).toBe("embedded");
    expect(loaded?.embedded?.llm_provider).toBe("openai");
  });

  test("projectExists detects saved projects", async () => {
    expect(await projectExists(testProjectId)).toBe(true);
    expect(await projectExists("nonexistent-xyz")).toBe(false);
  });

  test("listProjects includes saved project", async () => {
    const projects = await listProjects();
    expect(projects).toContain(testProjectId);
  });

  test("updateProjectConfig persists changes", async () => {
    await updateProjectConfig(testProjectId, { name: "Updated Name" });

    const loaded = await loadProjectConfig(testProjectId);
    expect(loaded?.name).toBe("Updated Name");
  });

  test("deleteProject removes project", async () => {
    const deleteTestId = "test-delete-project";
    await saveProjectConfig(
      createDefaultProjectConfig(deleteTestId, "https://example.com"),
    );
    expect(await projectExists(deleteTestId)).toBe(true);

    await deleteProject(deleteTestId);
    expect(await projectExists(deleteTestId)).toBe(false);
  });

  test("loadGlobalConfig returns defaults when no file", async () => {
    const config = await loadGlobalConfig();
    expect(config.default_backend).toBe("embedded");
  });
});

// =============================================================================
// AGNO BACKEND FACTORY
// =============================================================================

describe("createAgnoBackend", () => {
  test("agent endpoint uses projectId-assistant naming convention", () => {
    const backend = createAgnoBackend("my-docs", 7777, "localhost");

    // Business logic: agent name = ${projectId}-assistant
    expect(backend.getAgentEndpoint()).toBe(
      "http://localhost:7777/agents/my-docs-assistant/runs",
    );
  });
});
