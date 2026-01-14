import { describe, test, expect, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { createMintlifyBackend } from "../src/backends/mintlify";

// API calls can take time
setDefaultTimeout(30_000);

/**
 * Tests for Mintlify API mode
 *
 * Usage: mintlify-mcp -p agno-v2
 * Config: { "command": "bunx", "args": ["mintlify-mcp", "-p", "agno-v2"] }
 */

const CLI_PATH = join(import.meta.dir, "..", "src", "index.ts");

const KNOWN_PROJECTS = {
  "agno-v2": { name: "Agno", domain: "docs.agno.com" },
  resend: { name: "Resend", domain: "resend.com/docs" },
  upstash: { name: "Upstash", domain: "upstash.com/docs" },
  mintlify: { name: "Mintlify", domain: "mintlify.com/docs" },
  vercel: { name: "Vercel", domain: "vercel.com/docs" },
  plain: { name: "Plain", domain: "plain.com/docs" },
};

describe("Mintlify Backend", () => {
  test("creates backend with correct projectId", () => {
    const backend = createMintlifyBackend("agno-v2", "docs.agno.com");

    expect(backend.projectId).toBe("agno-v2");
    expect(backend.name).toBe("mintlify");
  });

  test("creates backend for each known project", () => {
    for (const [projectId, info] of Object.entries(KNOWN_PROJECTS)) {
      const backend = createMintlifyBackend(projectId, info.domain);

      expect(backend.projectId).toBe(projectId);
    }
  });
});

describe("Agno Docs (-p agno-v2)", () => {
  const backend = createMintlifyBackend("agno-v2", "docs.agno.com");

  test("API is available", async () => {
    const available = await backend.isAvailable();
    expect(available).toBe(true);
  });

  test("answers question", async () => {
    const result = await backend.ask("what is an agent?");

    expect(result.answer).toBeDefined();
    expect(result.answer.length).toBeGreaterThan(50);
    expect(result.answer.toLowerCase()).toMatch(/agent/);
  });

  test("returns code examples", async () => {
    const result = await backend.ask("show me code to create an agent");

    expect(result.answer).toBeDefined();
    expect(result.answer).toMatch(/```|`/);
  });
});

describe("Resend Docs (-p resend)", () => {
  const backend = createMintlifyBackend("resend", "resend.com/docs");

  test("API is available", async () => {
    const available = await backend.isAvailable();
    expect(available).toBe(true);
  });

  test("answers question", async () => {
    const result = await backend.ask("how do I send an email?");

    expect(result.answer).toBeDefined();
    expect(result.answer.length).toBeGreaterThan(50);
    expect(result.answer.toLowerCase()).toMatch(/email|send|resend/);
  });
});

describe("Agent Memory", () => {
  test("remembers user name", async () => {
    const backend = createMintlifyBackend("agno-v2", "docs.agno.com");

    await backend.ask("my name is victor");
    const result = await backend.ask("what is my name?");

    expect(result.answer.toLowerCase()).toContain("victor");
  });
});

describe("Clear History", () => {
  test("clearHistory resets conversation", () => {
    const backend = createMintlifyBackend("agno-v2", "docs.agno.com");

    expect(() => backend.clearHistory()).not.toThrow();
  });
});

describe("Response Quality", () => {
  test("response does not contain errors", async () => {
    const backend = createMintlifyBackend("agno-v2", "docs.agno.com");
    const result = await backend.ask("what is agno?");

    expect(result.answer.toLowerCase()).not.toContain("error");
    expect(result.answer.toLowerCase()).not.toContain("failed");
  });
});

describe("MCP Server Startup", () => {
  test("starts MCP server (-p agno-v2)", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "-p", "agno-v2"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    const timeout = setTimeout(() => proc.kill(), 5000);
    const stderr = await new Response(proc.stderr).text();
    clearTimeout(timeout);
    proc.kill();

    expect(stderr).toContain("Agno AI Assistant running");
  });

  test("starts MCP server (-p resend)", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "-p", "resend"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    const timeout = setTimeout(() => proc.kill(), 5000);
    const stderr = await new Response(proc.stderr).text();
    clearTimeout(timeout);
    proc.kill();

    expect(stderr).toContain("Resend AI Assistant running");
  });

  test("custom name with -n flag", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "-p", "agno-v2", "-n", "My Custom Docs"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    const timeout = setTimeout(() => proc.kill(), 5000);
    const stderr = await new Response(proc.stderr).text();
    clearTimeout(timeout);
    proc.kill();

    expect(stderr).toContain("My Custom Docs AI Assistant running");
  });
});
