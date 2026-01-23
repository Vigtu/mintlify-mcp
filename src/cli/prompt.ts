import * as readline from "node:readline";

// =============================================================================
// INTERACTIVE PROMPTS
// =============================================================================

/**
 * Prompt user for input with a question
 */
export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // Use stderr to not interfere with MCP stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Check if stdin is interactive (TTY)
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Ensure OPENAI_API_KEY is available, prompting if needed
 * Returns true if key is available, false if user cancelled
 */
export async function ensureOpenAIApiKey(): Promise<boolean> {
  // Already have it
  if (process.env.OPENAI_API_KEY) {
    return true;
  }

  // Can't prompt if not interactive
  if (!isInteractive()) {
    console.error("❌ OPENAI_API_KEY environment variable is required.");
    console.error("   Export it: export OPENAI_API_KEY=sk-...");
    return false;
  }

  // Prompt for API key
  console.log("\n🔑 OpenAI API key is required for embedded mode.\n");
  console.log("   You can get one at: https://platform.openai.com/api-keys\n");

  const apiKey = await prompt("   Enter your OpenAI API key (sk-...): ");

  if (!apiKey) {
    console.error("\n❌ No API key provided.");
    return false;
  }

  // Basic validation
  if (!apiKey.startsWith("sk-")) {
    console.error("\n❌ Invalid API key format. It should start with 'sk-'.");
    return false;
  }

  // Set for current process
  process.env.OPENAI_API_KEY = apiKey;

  console.log("\n   ✓ API key set for this session.");
  console.log("   💡 Tip: Add to your shell profile for persistence:");
  console.log(
    `      export OPENAI_API_KEY=${apiKey.slice(0, 7)}...${apiKey.slice(-4)}\n`,
  );

  return true;
}
