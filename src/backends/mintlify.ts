import type { AskResult, Backend, MintlifyBackendConfig } from "./types";

// =============================================================================
// MINTLIFY BACKEND - Calls Mintlify AI Assistant API
// =============================================================================

interface MessagePart {
  type: string;
  text?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  parts: MessagePart[];
  revisionId?: string;
}

interface ConversationState {
  messages: Message[];
  threadId?: string;
}

const MINTLIFY_API_BASE = "https://leaves.mintlify.com/api/assistant";

export class MintlifyBackend implements Backend {
  readonly name = "mintlify";
  readonly projectId: string;
  private domain: string;
  private state: ConversationState = { messages: [] };

  constructor(config: MintlifyBackendConfig) {
    this.projectId = config.projectId;
    this.domain = config.domain;
  }

  async ask(question: string): Promise<AskResult> {
    const timestamp = new Date().toISOString();

    const newMessage: Message = {
      id: this.generateId(),
      role: "user",
      content: question,
      createdAt: timestamp,
      parts: [{ type: "text", text: question }],
    };

    const messages = [...this.state.messages, newMessage];

    const requestBody: Record<string, unknown> = {
      id: this.projectId,
      fp: this.projectId,
      messages,
    };

    if (this.state.threadId) {
      requestBody.threadId = this.state.threadId;
    }

    const response = await fetch(
      `${MINTLIFY_API_BASE}/${this.projectId}/message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: `https://${this.domain}`,
          Referer: `https://${this.domain}/`,
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Mintlify API error: ${response.status} ${response.statusText}`,
      );
    }

    const newThreadId =
      response.headers.get("X-Thread-Id") || this.state.threadId;
    const text = await response.text();
    const baseUrl = `https://${this.domain}`;
    const { answer, messageId } = this.parseStreamedResponse(text, baseUrl);

    // Update conversation state
    this.state.threadId = newThreadId;
    this.state.messages.push(newMessage);
    this.state.messages.push({
      id: messageId || `msg-${this.generateId()}`,
      role: "assistant",
      content: answer,
      createdAt: new Date().toISOString(),
      parts: [{ type: "step-start" }, { type: "text", text: answer }],
      revisionId: this.generateId(),
    });

    return { answer, messageId };
  }

  clearHistory(): void {
    this.state = { messages: [], threadId: undefined };
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple check - try to reach Mintlify API
      const response = await fetch(
        `${MINTLIFY_API_BASE}/${this.projectId}/message`,
        {
          method: "OPTIONS",
          headers: { Origin: `https://${this.domain}` },
        },
      );
      return response.ok || response.status === 405;
    } catch {
      return false;
    }
  }

  private parseStreamedResponse(
    rawResponse: string,
    baseUrl: string,
  ): { answer: string; messageId?: string } {
    const lines = rawResponse.split("\n");
    const textChunks: string[] = [];
    let messageId: string | undefined;

    for (const line of lines) {
      if (line.startsWith("f:")) {
        try {
          const metadata = JSON.parse(line.slice(2));
          messageId = metadata.messageId;
        } catch {
          // Ignore parse errors
        }
      } else if (line.startsWith("0:")) {
        try {
          const text = JSON.parse(line.slice(2));
          if (typeof text === "string") {
            textChunks.push(text);
          }
        } catch {
          const text = line.slice(2).replace(/^"|"$/g, "");
          if (text) textChunks.push(text);
        }
      }
    }

    let answer =
      textChunks.join("").trim() ||
      "No response generated. Please try rephrasing your question.";

    answer = this.fixMarkdownLinks(answer, baseUrl);

    return { answer, messageId };
  }

  private fixMarkdownLinks(text: string, baseUrl: string): string {
    // Fix inverted markdown links: (text)[url] → [text](url)
    let fixed = text.replace(/\(([^)]+)\)\[([^\]]+)\]/g, "[$1]($2)");
    // Convert relative URLs to absolute
    fixed = fixed.replace(/\[([^\]]+)\]\(\/([^)]+)\)/g, `[$1](${baseUrl}/$2)`);
    return fixed;
  }

  private generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}

/** Create a Mintlify backend from config */
export function createMintlifyBackend(
  projectId: string,
  domain: string,
): MintlifyBackend {
  return new MintlifyBackend({ type: "mintlify", projectId, domain });
}
