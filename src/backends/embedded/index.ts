// =============================================================================
// EMBEDDED BACKEND - Pure TypeScript RAG Implementation
// =============================================================================

import { generateText, stepCountIs } from "ai";
import type { BackendFactory } from "../registry";
import type { AskResult, Backend } from "../types";
import {
  type ConfigOptions,
  createConfigFromOptions,
  type EmbeddedConfig,
  SEARCH_CONFIG,
} from "./config";
import { createAgentInstructions } from "./instructions";
import { createKnowledge, type EmbeddedKnowledge } from "./knowledge";
import { createEmbedder, createLLM, validateProviderConfig } from "./providers";
import { KnowledgeRetriever } from "./retriever";
import { createSearchKnowledgeTool } from "./tools";

/**
 * EmbeddedBackend - Pure TypeScript RAG implementation
 *
 * Features:
 * - LanceDB for hybrid search (vector + full-text)
 * - OpenAI or Ollama for LLM and embeddings
 * - Vercel AI SDK for agent loop with tool calling
 * - Score filtering and deduplication (matching Python/Agno)
 *
 * This backend provides 1:1 feature parity with the Python Agno implementation.
 */
export class EmbeddedBackend implements Backend {
  readonly name = "embedded";
  readonly projectId: string;

  private config: EmbeddedConfig;
  private knowledge: EmbeddedKnowledge | null = null;
  private retriever: KnowledgeRetriever | null = null;
  private initialized = false;

  constructor(projectId: string, config: EmbeddedConfig) {
    this.projectId = projectId;
    this.config = config;
  }

  /**
   * Initialize the backend
   * Must be called before using ask()
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Validate provider config
    validateProviderConfig(this.config);

    // Create embedder
    const embedder = createEmbedder(this.config.embedding);

    // Create knowledge base
    this.knowledge = await createKnowledge(
      this.config.vectorStore.path,
      embedder,
    );

    // Create retriever
    this.retriever = new KnowledgeRetriever(this.knowledge);

    this.initialized = true;
  }

  /**
   * Ask a question to the documentation
   */
  async ask(question: string): Promise<AskResult> {
    if (!this.initialized || !this.retriever) {
      await this.initialize();
    }

    if (!this.retriever) {
      throw new Error("Backend not properly initialized");
    }

    // Check if knowledge base has documents
    const hasDocuments = await this.knowledge?.hasDocuments();
    if (!hasDocuments) {
      return {
        answer:
          "The knowledge base is empty. Please run the setup command to seed documentation first.",
      };
    }

    // Create LLM
    const llm = createLLM(this.config.llm);

    // Create search tool
    const searchKnowledge = createSearchKnowledgeTool(
      this.retriever,
      this.projectId,
    );

    // Create agent instructions
    const systemPrompt = createAgentInstructions(this.projectId);

    try {
      // Run agent with tool calling
      const result = await generateText({
        model: llm,
        system: systemPrompt,
        prompt: question,
        tools: { searchKnowledge },
        stopWhen: stepCountIs(SEARCH_CONFIG.MAX_STEPS),
      });

      return {
        answer: result.text || "No response generated.",
      };
    } catch (error) {
      console.error("[EmbeddedBackend] Generation error:", error);

      if (error instanceof Error) {
        if (error.message.includes("API key")) {
          throw new Error(
            "OpenAI API key is invalid or missing. Set OPENAI_API_KEY environment variable.",
          );
        }
        throw error;
      }

      throw new Error("Unknown error during text generation");
    }
  }

  /**
   * Clear conversation history
   * Note: Embedded backend doesn't maintain conversation state (stateless)
   */
  clearHistory(): void {
    // Embedded backend is stateless - each ask() is independent
    // No conversation history to clear
  }

  /**
   * Check if backend is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      return (
        this.initialized && (await this.knowledge?.hasDocuments()) === true
      );
    } catch {
      return false;
    }
  }

  /**
   * Get the knowledge base instance (for seeding)
   */
  getKnowledge(): EmbeddedKnowledge | null {
    return this.knowledge;
  }

  /**
   * Close the backend and release resources
   */
  async close(): Promise<void> {
    if (this.knowledge) {
      await this.knowledge.close();
      this.knowledge = null;
    }
    this.retriever = null;
    this.initialized = false;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create an EmbeddedBackend with the given options
 */
export async function createEmbeddedBackend(
  projectId: string,
  options: ConfigOptions,
): Promise<EmbeddedBackend> {
  const config = createConfigFromOptions(options);
  const backend = new EmbeddedBackend(projectId, config);
  await backend.initialize();
  return backend;
}

/**
 * Create an EmbeddedBackend with cloud config (OpenAI)
 */
export async function createCloudEmbeddedBackend(
  projectId: string,
  projectPath: string,
): Promise<EmbeddedBackend> {
  return createEmbeddedBackend(projectId, {
    projectPath,
    local: false,
  });
}

/**
 * Create an EmbeddedBackend with local config (Ollama)
 */
export async function createLocalEmbeddedBackend(
  projectId: string,
  projectPath: string,
): Promise<EmbeddedBackend> {
  return createEmbeddedBackend(projectId, {
    projectPath,
    local: true,
  });
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export type { ConfigOptions, EmbeddedConfig } from "./config";
export { createCloudConfig, createLocalConfig, SEARCH_CONFIG } from "./config";
export type { Document, DocumentMetadata, SearchResult } from "./knowledge";
export { createKnowledge, EmbeddedKnowledge } from "./knowledge";
export {
  createEmbedder,
  createLLM,
  OllamaEmbedder,
  OpenAIEmbedder,
} from "./providers";
export type { CleanedResult } from "./retriever";
export { formatResultsForContext, KnowledgeRetriever } from "./retriever";
export { createSearchKnowledgeTool } from "./tools";

// =============================================================================
// BACKEND FACTORY - For registry integration
// =============================================================================

export interface EmbeddedBackendOptions {
  projectId: string;
  projectPath: string;
  local?: boolean;
  llmProvider?: "openai" | "ollama";
  llmModel?: string;
  embeddingProvider?: "openai" | "ollama";
  embeddingModel?: string;
  ollamaBaseUrl?: string;
}

export const backendFactory: BackendFactory<EmbeddedBackendOptions> = {
  displayName: "Embedded (TypeScript RAG)",
  requiredDependencies: ["@lancedb/lancedb", "ai", "openai"],

  async create(options: EmbeddedBackendOptions): Promise<Backend> {
    return createEmbeddedBackend(options.projectId, {
      projectPath: options.projectPath,
      local: options.local,
      llmProvider: options.llmProvider,
      llmModel: options.llmModel,
      embeddingProvider: options.embeddingProvider,
      embeddingModel: options.embeddingModel,
      ollamaBaseUrl: options.ollamaBaseUrl,
    });
  },
};
