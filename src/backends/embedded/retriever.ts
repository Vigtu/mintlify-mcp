// =============================================================================
// KNOWLEDGE RETRIEVER - Score Filtering & Deduplication
// =============================================================================

import { SEARCH_CONFIG } from "./config";
import type { EmbeddedKnowledge, SearchResult } from "./knowledge";

/**
 * Cleaned search result with normalized metadata
 */
export interface CleanedResult {
  name: string;
  content: string;
  metadata: {
    source_url?: string;
    title?: string;
  };
}

/**
 * Knowledge Retriever
 *
 * Wraps EmbeddedKnowledge with:
 * - Score filtering (MIN_SCORE threshold)
 * - Deduplication (max chunks per URL)
 * - Metadata cleaning
 *
 * Matches the Python Agno create_knowledge_retriever() implementation.
 */
export class KnowledgeRetriever {
  private knowledge: EmbeddedKnowledge;

  constructor(knowledge: EmbeddedKnowledge) {
    this.knowledge = knowledge;
  }

  /**
   * Retrieve relevant documents for a query
   *
   * @param query - The search query
   * @param numDocuments - Maximum number of documents to return
   * @returns Cleaned and filtered search results
   */
  async retrieve(
    query: string,
    numDocuments: number = SEARCH_CONFIG.DEFAULT_NUM_DOCS,
  ): Promise<CleanedResult[] | null> {
    // Search knowledge base
    const results = await this.knowledge.search(
      query,
      numDocuments * SEARCH_CONFIG.RETRIEVAL_MULTIPLIER,
    );

    if (results.length === 0) {
      return null;
    }

    // Apply score filtering
    const filtered = this.filterByScore(results);

    if (filtered.length === 0) {
      // If all results filtered out, return top results anyway
      // (better to have something than nothing)
      console.error(
        `[Retriever] All results filtered by score threshold (${SEARCH_CONFIG.MIN_SCORE}), returning top results`,
      );
      return this.deduplicateAndClean(
        results.slice(0, numDocuments),
        numDocuments,
      );
    }

    // Apply deduplication and cleaning
    return this.deduplicateAndClean(filtered, numDocuments);
  }

  /**
   * Filter results by minimum score threshold
   *
   * Matches Python: filtered_df = raw_results[raw_results[score_col] >= MIN_SCORE]
   */
  private filterByScore(results: SearchResult[]): SearchResult[] {
    // Check if we have scores
    const hasScores = results.some((r) => r.score !== undefined);

    if (!hasScores) {
      console.error("[Retriever] No score column found, skipping score filter");
      return results;
    }

    // Log score range for debugging
    const scores = results
      .map((r) => r.score)
      .filter((s): s is number => s !== undefined);
    if (scores.length > 0) {
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      console.error(
        `[Retriever] Score range: min=${min.toFixed(6)}, max=${max.toFixed(6)}, mean=${mean.toFixed(6)}`,
      );
    }

    // Filter by score
    // Note: For _distance, lower is better; for _relevance_score, higher is better
    // LanceDB hybrid search returns _relevance_score (higher = better)
    const filtered = results.filter((r) => {
      if (r.score === undefined) return true;
      return r.score >= SEARCH_CONFIG.MIN_SCORE;
    });

    console.error(
      `[Retriever] After score filter (>= ${SEARCH_CONFIG.MIN_SCORE}): ${filtered.length} / ${results.length} results`,
    );

    return filtered;
  }

  /**
   * Deduplicate results by source URL and clean metadata
   *
   * Matches Python:
   * - Max 2 chunks per source URL
   * - Remove internal fields (chunk, chunk_size, path)
   */
  private deduplicateAndClean(
    results: SearchResult[],
    numDocuments: number,
  ): CleanedResult[] {
    const seenUrls = new Map<string, number>();
    const finalResults: CleanedResult[] = [];

    for (const result of results) {
      if (finalResults.length >= numDocuments) {
        break;
      }

      // Get source URL for deduplication
      const sourceUrl = result.metadata?.source_url || result.name;

      // Max N chunks per source URL
      const count = seenUrls.get(sourceUrl) || 0;
      if (count >= SEARCH_CONFIG.MAX_CHUNKS_PER_URL) {
        continue;
      }
      seenUrls.set(sourceUrl, count + 1);

      // Clean metadata - remove internal fields
      const cleanedMetadata = this.cleanMetadata(result.metadata);

      finalResults.push({
        name: result.name,
        content: result.content,
        metadata: cleanedMetadata,
      });
    }

    console.error(
      `[Retriever] Final results after dedup: ${finalResults.length}`,
    );

    return finalResults;
  }

  /**
   * Clean metadata - remove internal fields
   *
   * Matches Python: cleaned_meta = {k: v for k, v in meta.items() if k not in ("chunk", "chunk_size", "path")}
   */
  private cleanMetadata(
    metadata: SearchResult["metadata"],
  ): CleanedResult["metadata"] {
    const internalFields = new Set(["chunk", "chunk_size", "path"]);

    const cleaned: CleanedResult["metadata"] = {};

    for (const [key, value] of Object.entries(metadata || {})) {
      if (!internalFields.has(key)) {
        if (key === "source_url" && typeof value === "string") {
          cleaned.source_url = value;
        } else if (key === "title" && typeof value === "string") {
          cleaned.title = value;
        }
      }
    }

    return cleaned;
  }
}

/**
 * Format retrieval results for LLM context
 */
export function formatResultsForContext(
  results: CleanedResult[] | null,
): string {
  if (!results || results.length === 0) {
    return "No relevant documentation found.";
  }

  const formatted = results.map((r, i) => {
    const header = r.metadata?.title || r.name;
    const url = r.metadata?.source_url || "";
    const urlLine = url ? `Source: ${url}` : "";

    return `--- Document ${i + 1}: ${header} ---
${urlLine}

${r.content}`;
  });

  return formatted.join("\n\n");
}
