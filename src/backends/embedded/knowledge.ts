// =============================================================================
// EMBEDDED KNOWLEDGE - LanceDB Wrapper
// =============================================================================

import * as lancedb from "@lancedb/lancedb";
import { rerankers, type Table } from "@lancedb/lancedb";
import { SEARCH_CONFIG } from "./config";
import type { Embedder } from "./providers";

/**
 * Document metadata
 */
export interface DocumentMetadata {
  source_url?: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * Document to be added to knowledge base
 */
export interface Document {
  name: string;
  content: string;
  metadata?: DocumentMetadata;
}

/**
 * Search result from knowledge base
 */
export interface SearchResult {
  name: string;
  content: string;
  metadata: DocumentMetadata;
  score?: number;
}

/**
 * Internal record structure for LanceDB
 */
type LanceRecord = {
  id: string;
  name: string;
  content: string;
  metadata: string; // JSON string
  vector: number[];
  [key: string]: unknown;
};

/**
 * EmbeddedKnowledge - LanceDB-based knowledge store
 *
 * Provides hybrid search (vector + full-text) with RRF reranking,
 * matching the Python Agno implementation.
 */
export class EmbeddedKnowledge {
  private dbPath: string;
  private embedder: Embedder;
  private db: lancedb.Connection | null = null;
  private table: Table | null = null;
  private reranker: rerankers.RRFReranker | null = null;

  private static readonly TABLE_NAME = "docs";

  constructor(dbPath: string, embedder: Embedder) {
    this.dbPath = dbPath;
    this.embedder = embedder;
  }

  /**
   * Initialize the knowledge base connection
   */
  async initialize(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    this.reranker = await rerankers.RRFReranker.create();

    // Try to open existing table
    try {
      const tableNames = await this.db.tableNames();
      if (tableNames.includes(EmbeddedKnowledge.TABLE_NAME)) {
        this.table = await this.db.openTable(EmbeddedKnowledge.TABLE_NAME);
      }
    } catch {
      // Table doesn't exist yet, will be created on first add
    }
  }

  /**
   * Check if knowledge base is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }

  /**
   * Check if knowledge base has documents
   */
  async hasDocuments(): Promise<boolean> {
    if (!this.table) return false;
    try {
      const stats = await this.table.countRows();
      return stats > 0;
    } catch {
      return false;
    }
  }

  /**
   * Add a document to the knowledge base
   */
  async addDocument(doc: Document): Promise<void> {
    if (!this.db) {
      throw new Error("Knowledge base not initialized");
    }

    // Generate embedding
    const vector = await this.embedder.embed(doc.content);

    const record: LanceRecord = {
      id: this.generateId(),
      name: doc.name,
      content: doc.content,
      metadata: JSON.stringify(doc.metadata || {}),
      vector,
    };

    if (!this.table) {
      // Create table with first document
      this.table = await this.db.createTable(EmbeddedKnowledge.TABLE_NAME, [
        record,
      ]);

      // Create full-text search index on content
      await this.table.createIndex("content", {
        config: lancedb.Index.fts(),
      });
    } else {
      // Add to existing table
      await this.table.add([record]);
    }
  }

  /**
   * Add multiple documents to the knowledge base
   */
  async addDocuments(docs: Document[]): Promise<void> {
    if (!this.db) {
      throw new Error("Knowledge base not initialized");
    }

    if (docs.length === 0) return;

    // Generate embeddings in batch
    const embeddings = await this.embedder.embedBatch(
      docs.map((d) => d.content),
    );

    const records: LanceRecord[] = docs.map((doc, i) => ({
      id: this.generateId(),
      name: doc.name,
      content: doc.content,
      metadata: JSON.stringify(doc.metadata || {}),
      vector: embeddings[i],
    }));

    if (!this.table) {
      // Create table with first batch
      this.table = await this.db.createTable(
        EmbeddedKnowledge.TABLE_NAME,
        records,
      );

      // Create full-text search index on content
      await this.table.createIndex("content", {
        config: lancedb.Index.fts(),
      });
    } else {
      // Add to existing table
      await this.table.add(records);
    }
  }

  /**
   * Search the knowledge base using hybrid search
   *
   * Combines vector search and full-text search using RRF reranking,
   * matching the Python Agno implementation.
   */
  async search(
    query: string,
    numDocuments: number = SEARCH_CONFIG.DEFAULT_NUM_DOCS,
  ): Promise<SearchResult[]> {
    if (!this.table || !this.reranker) {
      return [];
    }

    try {
      // Generate query embedding
      const queryVector = await this.embedder.embed(query);

      // Perform hybrid search with RRF reranking
      // Fetch more results initially for filtering
      const limit = numDocuments * SEARCH_CONFIG.RETRIEVAL_MULTIPLIER;

      const results = await this.table
        .query()
        .fullTextSearch(query)
        .nearestTo(queryVector)
        .rerank(this.reranker)
        .limit(limit)
        .toArray();

      // Convert to SearchResult format
      return results.map((row) => {
        const metadata = this.parseMetadata(row.metadata);
        return {
          name: row.name as string,
          content: row.content as string,
          metadata,
          score: row._relevance_score as number | undefined,
        };
      });
    } catch (error) {
      // Fallback to vector-only search if hybrid fails
      console.error(
        "[EmbeddedKnowledge] Hybrid search failed, falling back to vector search:",
        error,
      );
      return this.vectorSearch(query, numDocuments);
    }
  }

  /**
   * Vector-only search (fallback)
   */
  private async vectorSearch(
    query: string,
    numDocuments: number,
  ): Promise<SearchResult[]> {
    if (!this.table) {
      return [];
    }

    const queryVector = await this.embedder.embed(query);

    const results = await this.table
      .query()
      .nearestTo(queryVector)
      .limit(numDocuments)
      .toArray();

    return results.map((row) => {
      const metadata = this.parseMetadata(row.metadata);
      return {
        name: row.name as string,
        content: row.content as string,
        metadata,
        score: row._distance as number | undefined,
      };
    });
  }

  /**
   * Clear all documents from the knowledge base
   */
  async clear(): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.dropTable(EmbeddedKnowledge.TABLE_NAME);
      this.table = null;
    } catch {
      // Table might not exist
    }
  }

  /**
   * Close the knowledge base connection
   */
  async close(): Promise<void> {
    if (this.table) {
      this.table.close();
      this.table = null;
    }
    this.db = null;
  }

  /**
   * Get document count
   */
  async countDocuments(): Promise<number> {
    if (!this.table) return 0;
    return this.table.countRows();
  }

  // =============================================================================
  // HELPERS
  // =============================================================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private parseMetadata(metadataStr: unknown): DocumentMetadata {
    if (typeof metadataStr === "string") {
      try {
        return JSON.parse(metadataStr) as DocumentMetadata;
      } catch {
        return {};
      }
    }
    return (metadataStr as DocumentMetadata) || {};
  }
}

/**
 * Create an EmbeddedKnowledge instance
 */
export async function createKnowledge(
  dbPath: string,
  embedder: Embedder,
): Promise<EmbeddedKnowledge> {
  const knowledge = new EmbeddedKnowledge(dbPath, embedder);
  await knowledge.initialize();
  return knowledge;
}
