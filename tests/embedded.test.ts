import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EmbeddedKnowledge, SearchResult } from "../src/backends/embedded";
import type { KnowledgeRetriever } from "../src/backends/embedded/retriever";

// =============================================================================
// MOCK TYPES
// =============================================================================

type MockKnowledge = Pick<EmbeddedKnowledge, "search">;
type MockRetriever = Pick<KnowledgeRetriever, "retrieve">;

// =============================================================================
// TEST SETUP
// =============================================================================

const TEST_DATA_DIR = join(import.meta.dir, ".test-embedded-data");

beforeAll(async () => {
  process.env.DOCMOLE_DATA_DIR = TEST_DATA_DIR;
  await mkdir(TEST_DATA_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
});

// =============================================================================
// KNOWLEDGE BASE TESTS (Integration - Uses LanceDB)
// =============================================================================

describe("EmbeddedKnowledge", () => {
  const testDbPath = join(TEST_DATA_DIR, "test-knowledge");

  // Mock embedder that returns deterministic vectors
  const mockEmbedder = {
    dimensions: 4,
    embed: async (text: string) => {
      const hash = text.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      return [hash % 10, (hash * 2) % 10, (hash * 3) % 10, (hash * 4) % 10];
    },
    embedBatch: async (texts: string[]) => {
      return Promise.all(texts.map((t) => mockEmbedder.embed(t)));
    },
  };

  beforeEach(async () => {
    await rm(testDbPath, { recursive: true, force: true });
  });

  test("creates and initializes knowledge base", async () => {
    const { createKnowledge } = await import(
      "../src/backends/embedded/knowledge"
    );

    const knowledge = await createKnowledge(testDbPath, mockEmbedder);

    expect(knowledge.isInitialized()).toBe(true);
    expect(await knowledge.hasDocuments()).toBe(false);

    await knowledge.close();
  });

  test("adds single document", async () => {
    const { createKnowledge } = await import(
      "../src/backends/embedded/knowledge"
    );

    const knowledge = await createKnowledge(testDbPath, mockEmbedder);

    await knowledge.addDocument({
      name: "test-doc",
      content: "This is test content for the knowledge base.",
      metadata: {
        title: "Test Document",
        source_url: "https://example.com/test",
      },
    });

    expect(await knowledge.hasDocuments()).toBe(true);
    expect(await knowledge.countDocuments()).toBe(1);

    await knowledge.close();
  });

  test("adds multiple documents in batch", async () => {
    const { createKnowledge } = await import(
      "../src/backends/embedded/knowledge"
    );

    const knowledge = await createKnowledge(testDbPath, mockEmbedder);

    await knowledge.addDocuments([
      { name: "doc1", content: "Content for document one" },
      { name: "doc2", content: "Content for document two" },
      { name: "doc3", content: "Content for document three" },
    ]);

    expect(await knowledge.countDocuments()).toBe(3);

    await knowledge.close();
  });

  test("searches documents by vector similarity", async () => {
    const { createKnowledge } = await import(
      "../src/backends/embedded/knowledge"
    );

    const knowledge = await createKnowledge(testDbPath, mockEmbedder);

    await knowledge.addDocuments([
      {
        name: "agents",
        content: "Agents are autonomous programs that can make decisions.",
        metadata: { title: "Agents Guide" },
      },
      {
        name: "tools",
        content: "Tools allow agents to interact with external systems.",
        metadata: { title: "Tools Reference" },
      },
      {
        name: "memory",
        content: "Memory helps agents remember past interactions.",
        metadata: { title: "Memory System" },
      },
    ]);

    const results = await knowledge.search("agents", 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBeDefined();
    expect(results[0].content).toBeDefined();

    await knowledge.close();
  });

  test("clears all documents", async () => {
    const { createKnowledge } = await import(
      "../src/backends/embedded/knowledge"
    );

    const knowledge = await createKnowledge(testDbPath, mockEmbedder);

    await knowledge.addDocument({
      name: "test",
      content: "Test content",
    });

    expect(await knowledge.hasDocuments()).toBe(true);

    await knowledge.clear();

    expect(await knowledge.hasDocuments()).toBe(false);

    await knowledge.close();
  });

  test("persists data across instances", async () => {
    const { createKnowledge } = await import(
      "../src/backends/embedded/knowledge"
    );

    const knowledge1 = await createKnowledge(testDbPath, mockEmbedder);
    await knowledge1.addDocument({
      name: "persistent-doc",
      content: "This should persist",
    });
    await knowledge1.close();

    const knowledge2 = await createKnowledge(testDbPath, mockEmbedder);
    expect(await knowledge2.hasDocuments()).toBe(true);
    expect(await knowledge2.countDocuments()).toBe(1);
    await knowledge2.close();
  });
});

// =============================================================================
// RETRIEVER TESTS (Business Logic)
// =============================================================================

describe("KnowledgeRetriever", () => {
  test("deduplicates by source URL (max 2 chunks per URL)", async () => {
    const { KnowledgeRetriever } = await import(
      "../src/backends/embedded/retriever"
    );

    const mockKnowledge: MockKnowledge = {
      search: async (): Promise<SearchResult[]> => [
        {
          name: "chunk1",
          content: "First chunk",
          metadata: { source_url: "https://example.com/page" },
          score: 0.9,
        },
        {
          name: "chunk2",
          content: "Second chunk",
          metadata: { source_url: "https://example.com/page" },
          score: 0.8,
        },
        {
          name: "chunk3",
          content: "Third chunk (should be filtered)",
          metadata: { source_url: "https://example.com/page" },
          score: 0.7,
        },
        {
          name: "chunk4",
          content: "Different page",
          metadata: { source_url: "https://example.com/other" },
          score: 0.6,
        },
      ],
    };

    const retriever = new KnowledgeRetriever(
      mockKnowledge as unknown as EmbeddedKnowledge,
    );
    const results = await retriever.retrieve("test query", 10);

    // Count chunks per URL
    const urlCounts = new Map<string, number>();
    for (const r of results || []) {
      const url = r.metadata?.source_url || "";
      urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
    }

    // Should have max 2 chunks per URL
    for (const count of urlCounts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  test("filters by score threshold", async () => {
    const { KnowledgeRetriever } = await import(
      "../src/backends/embedded/retriever"
    );

    const mockKnowledge: MockKnowledge = {
      search: async (): Promise<SearchResult[]> => [
        { name: "high", content: "High score", metadata: {}, score: 0.5 },
        { name: "medium", content: "Medium score", metadata: {}, score: 0.02 },
        { name: "low", content: "Below threshold", metadata: {}, score: 0.01 },
      ],
    };

    const retriever = new KnowledgeRetriever(
      mockKnowledge as unknown as EmbeddedKnowledge,
    );
    const results = await retriever.retrieve("test", 10);

    // Should filter out low score (0.01 < MIN_SCORE of 0.015)
    // But if all filtered, falls back to top results
    expect(results).not.toBeNull();
    expect(results?.length).toBeGreaterThan(0);
  });

  test("returns null for empty search", async () => {
    const { KnowledgeRetriever } = await import(
      "../src/backends/embedded/retriever"
    );

    const mockKnowledge: MockKnowledge = {
      search: async (): Promise<SearchResult[]> => [],
    };

    const retriever = new KnowledgeRetriever(
      mockKnowledge as unknown as EmbeddedKnowledge,
    );
    const results = await retriever.retrieve("test", 10);

    expect(results).toBeNull();
  });
});

// =============================================================================
// TOOL TESTS (Error Handling)
// =============================================================================

describe("Search Knowledge Tool", () => {
  test("returns success with results", async () => {
    const { createSearchKnowledgeTool } = await import(
      "../src/backends/embedded/tools"
    );

    const mockRetriever: MockRetriever = {
      retrieve: async () => [
        {
          name: "doc1",
          content: "Test content",
          metadata: {
            title: "Test Doc",
            source_url: "https://example.com/doc1",
          },
        },
      ],
    };

    const tool = createSearchKnowledgeTool(
      mockRetriever as unknown as KnowledgeRetriever,
      "test",
    );
    const result = await tool.execute({ query: "test query" });

    expect(result.success).toBe(true);
    expect(result.documentCount).toBe(1);
    expect(result.sources).toContain("https://example.com/doc1");
    expect(result.context).toContain("Test content");
  });

  test("returns failure when no results", async () => {
    const { createSearchKnowledgeTool } = await import(
      "../src/backends/embedded/tools"
    );

    const mockRetriever: MockRetriever = {
      retrieve: async () => null,
    };

    const tool = createSearchKnowledgeTool(
      mockRetriever as unknown as KnowledgeRetriever,
      "test",
    );
    const result = await tool.execute({ query: "test query" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("No relevant documentation");
    expect(result.suggestion).toBeDefined();
  });

  test("handles errors gracefully", async () => {
    const { createSearchKnowledgeTool } = await import(
      "../src/backends/embedded/tools"
    );

    const mockRetriever: MockRetriever = {
      retrieve: async () => {
        throw new Error("Search failed");
      },
    };

    const tool = createSearchKnowledgeTool(
      mockRetriever as unknown as KnowledgeRetriever,
      "test",
    );
    const result = await tool.execute({ query: "test query" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Search failed");
  });

  test("deduplicates source URLs in response", async () => {
    const { createSearchKnowledgeTool } = await import(
      "../src/backends/embedded/tools"
    );

    const mockRetriever: MockRetriever = {
      retrieve: async () => [
        {
          name: "doc1",
          content: "Content 1",
          metadata: { source_url: "https://example.com/same" },
        },
        {
          name: "doc2",
          content: "Content 2",
          metadata: { source_url: "https://example.com/same" },
        },
      ],
    };

    const tool = createSearchKnowledgeTool(
      mockRetriever as unknown as KnowledgeRetriever,
      "test",
    );
    const result = await tool.execute({ query: "test" });

    // Sources should be deduplicated
    expect(result.sources?.length).toBe(1);
  });
});

// =============================================================================
// INTEGRATION TESTS (Requires OPENAI_API_KEY)
// =============================================================================

const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAIKey)("Embedded Backend Integration", () => {
  setDefaultTimeout(60_000);

  const integrationDbPath = join(TEST_DATA_DIR, "integration-test");

  beforeEach(async () => {
    await rm(integrationDbPath, { recursive: true, force: true });
  });

  test("creates backend and reports unavailable when empty", async () => {
    const { createEmbeddedBackend } = await import("../src/backends/embedded");

    const backend = await createEmbeddedBackend("test-project", {
      projectPath: integrationDbPath,
      local: false,
    });

    expect(backend.name).toBe("embedded");
    expect(backend.projectId).toBe("test-project");
    expect(await backend.isAvailable()).toBe(false);

    await backend.close();
  });

  test("OpenAI embedder generates correct dimension vectors", async () => {
    const { OpenAIEmbedder } = await import(
      "../src/backends/embedded/providers"
    );

    const embedder = new OpenAIEmbedder("text-embedding-3-small");
    const vector = await embedder.embed("Hello, world!");

    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBe(1536);
    expect(typeof vector[0]).toBe("number");
  });

  test("OpenAI embedder batch processing", async () => {
    const { OpenAIEmbedder } = await import(
      "../src/backends/embedded/providers"
    );

    const embedder = new OpenAIEmbedder("text-embedding-3-small");
    const vectors = await embedder.embedBatch(["Hello", "World", "Test"]);

    expect(vectors.length).toBe(3);
    for (const v of vectors) {
      expect(v.length).toBe(1536);
    }
  });

  test("full RAG flow: seed docs and query", async () => {
    const { createEmbeddedBackend } = await import("../src/backends/embedded");

    const backend = await createEmbeddedBackend("test-project", {
      projectPath: integrationDbPath,
      local: false,
    });

    const knowledge = backend.getKnowledge();
    expect(knowledge).not.toBeNull();

    // Seed documentation
    await knowledge?.addDocuments([
      {
        name: "agents",
        content: `# Agents

Agents are autonomous AI programs that can:
- Make decisions based on context
- Use tools to interact with external systems

## Creating an Agent

\`\`\`python
from framework import Agent
agent = Agent(name="my-agent", model="gpt-4")
\`\`\``,
        metadata: {
          title: "Agents Guide",
          source_url: "https://docs.example.com/agents",
        },
      },
      {
        name: "tools",
        content: `# Tools

Tools allow agents to interact with external systems.

## Built-in Tools
- SearchTool: Search the web
- CalculatorTool: Perform math`,
        metadata: {
          title: "Tools Reference",
          source_url: "https://docs.example.com/tools",
        },
      },
    ]);

    expect(await backend.isAvailable()).toBe(true);

    // Query
    const result = await backend.ask("How do I create an agent?");

    expect(result.answer).toBeDefined();
    expect(result.answer.length).toBeGreaterThan(50);
    expect(result.answer.toLowerCase()).toMatch(/agent/);

    await backend.close();
  });
});
