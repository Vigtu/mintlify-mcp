// =============================================================================
// AGENT TOOLS - Search Knowledge Tool
// =============================================================================

import { tool, zodSchema } from "ai";
import { z } from "zod";
import { SEARCH_CONFIG } from "./config";
import type { KnowledgeRetriever } from "./retriever";
import { formatResultsForContext } from "./retriever";

/**
 * Schema for search tool input
 */
const searchInputSchema = z.object({
  query: z
    .string()
    .describe(
      "The search query. Be specific and use relevant keywords. If the first search doesn't yield good results, try rephrasing with different terms.",
    ),
  numDocuments: z
    .number()
    .optional()
    .describe("Maximum number of documents to retrieve (default: 10)"),
});

type SearchInput = z.infer<typeof searchInputSchema>;

/**
 * Create the searchKnowledge tool for the AI SDK agent
 *
 * This tool allows the agent to search the documentation knowledge base.
 * It matches the Python Agno agent's search_knowledge capability.
 *
 * @param retriever - The knowledge retriever instance
 * @param projectId - The project identifier for context
 */
export function createSearchKnowledgeTool(
  retriever: KnowledgeRetriever,
  projectId: string,
) {
  return tool({
    description: `Search the ${projectId} documentation knowledge base. Use this to find information about ${projectId} features, APIs, configuration, and usage.`,

    inputSchema: zodSchema(searchInputSchema),

    execute: async (input: SearchInput) => {
      const limit = input.numDocuments ?? SEARCH_CONFIG.DEFAULT_NUM_DOCS;
      console.error(
        `[Tool] searchKnowledge: "${input.query}" (limit: ${limit})`,
      );

      try {
        const results = await retriever.retrieve(
          input.query,
          input.numDocuments,
        );

        if (!results || results.length === 0) {
          return {
            success: false,
            message: "No relevant documentation found for this query.",
            suggestion:
              "Try rephrasing your query with different keywords or broader terms.",
          };
        }

        // Format results for LLM context
        const context = formatResultsForContext(results);

        // Collect source URLs for citation
        const sources = results
          .map((r) => r.metadata?.source_url)
          .filter((url): url is string => !!url);

        return {
          success: true,
          documentCount: results.length,
          sources: [...new Set(sources)], // Deduplicate URLs
          context,
        };
      } catch (error) {
        console.error("[Tool] searchKnowledge error:", error);
        return {
          success: false,
          message: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });
}

/**
 * Tool result type for searchKnowledge
 */
export interface SearchKnowledgeResult {
  success: boolean;
  message?: string;
  suggestion?: string;
  documentCount?: number;
  sources?: string[];
  context?: string;
}
