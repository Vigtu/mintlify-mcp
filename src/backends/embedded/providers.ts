// =============================================================================
// PROVIDER FACTORIES
// =============================================================================

import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { EmbeddingConfig, LLMConfig } from "./config";

// =============================================================================
// LLM PROVIDERS
// =============================================================================

/**
 * Create LLM provider based on config
 */
export function createLLM(config: LLMConfig): LanguageModel {
  switch (config.provider) {
    case "openai":
      return openai(config.model);

    case "ollama":
      // Ollama provider will be loaded dynamically to avoid bundling if not used
      throw new Error(
        "Ollama LLM provider not yet implemented. Use --llm-provider openai for now.",
      );

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

// =============================================================================
// EMBEDDING PROVIDERS
// =============================================================================

/**
 * Embedder interface for generating embeddings
 */
export interface Embedder {
  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for multiple texts */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Get the embedding dimensions */
  readonly dimensions: number;
}

/**
 * OpenAI Embedder using the OpenAI API
 */
export class OpenAIEmbedder implements Embedder {
  private model: string;
  readonly dimensions: number;

  constructor(model = "text-embedding-3-small") {
    this.model = model;
    // text-embedding-3-small = 1536, text-embedding-3-large = 3072
    this.dimensions = model.includes("large") ? 3072 : 1536;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}

/**
 * Ollama Embedder using local Ollama server
 */
export class OllamaEmbedder implements Embedder {
  private model: string;
  private baseUrl: string;
  readonly dimensions: number;

  constructor(model = "nomic-embed-text", baseUrl = "http://localhost:11434") {
    this.model = model;
    this.baseUrl = baseUrl;
    // nomic-embed-text = 768, mxbai-embed-large = 1024
    this.dimensions = model.includes("large") ? 1024 : 768;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't support batch embeddings natively, so we parallelize
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

/**
 * Create embedder based on config
 */
export function createEmbedder(config: EmbeddingConfig): Embedder {
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbedder(config.model);

    case "ollama":
      return new OllamaEmbedder(config.model, config.baseUrl);

    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

// =============================================================================
// PROVIDER VALIDATION
// =============================================================================

/**
 * Validate that required environment variables are set
 */
export function validateProviderConfig(config: {
  llm: LLMConfig;
  embedding: EmbeddingConfig;
}): void {
  if (
    config.llm.provider === "openai" ||
    config.embedding.provider === "openai"
  ) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for OpenAI provider",
      );
    }
  }
}

/**
 * Check if Ollama is available
 */
export async function isOllamaAvailable(
  baseUrl = "http://localhost:11434",
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
