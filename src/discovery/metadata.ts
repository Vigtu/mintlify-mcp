// =============================================================================
// METADATA EXTRACTION - Extract title and description from markdown
// =============================================================================

import { safeFetch } from "../security";

export interface PageMetadata {
  title: string;
  description: string;
}

/** Extract title from markdown (first H1 heading) */
export function extractTitle(content: string, fallbackPath: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1].trim();
  }
  // Fallback: convert path to title
  const lastSegment =
    fallbackPath.split("/").filter(Boolean).pop() || "Untitled";
  return lastSegment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract description from markdown (first blockquote or paragraph) */
export function extractDescription(content: string): string {
  // Try blockquote first (common in Mintlify docs)
  const blockquoteMatch = content.match(/^>\s*(.+)$/m);
  if (blockquoteMatch) {
    return blockquoteMatch[1].trim();
  }

  // Try first paragraph (skip headings, code blocks, empty lines)
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, headings, code blocks, HTML tags
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("<") ||
      trimmed.startsWith("|") ||
      trimmed.startsWith("-") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }
    // Found a paragraph
    return trimmed.slice(0, 200); // Limit to 200 chars
  }

  return "";
}

/** Extract both title and description from markdown */
export function extractMetadata(
  content: string,
  fallbackPath: string,
): PageMetadata {
  return {
    title: extractTitle(content, fallbackPath),
    description: extractDescription(content),
  };
}

/** Fetch markdown and extract metadata */
export async function fetchWithMetadata(
  url: string,
  path: string,
): Promise<{ content: string; metadata: PageMetadata } | null> {
  try {
    const response = await safeFetch(
      url,
      {
        headers: {
          "User-Agent": "docmole/1.0",
          Accept: "text/markdown, text/plain, */*",
        },
      },
      "documentation page",
    );

    if (!response.ok) {
      return null;
    }

    const content = await response.text();
    const metadata = extractMetadata(content, path);

    return { content, metadata };
  } catch {
    return null;
  }
}
