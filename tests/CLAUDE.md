# Test Guidelines

## File Organization

```
tests/
├── config.test.ts      # src/config/* (project config, loader)
├── mintlify-api.test.ts # src/backends/mintlify.ts
├── embedded.test.ts    # src/backends/embedded/*
└── <module>.test.ts    # One file per major module
```

**Rule:** One test file per source module. Don't create `embedded.test.ts` if tests belong in `config.test.ts`.

## What Makes a Test Useful

### Good Tests (Keep)

```typescript
// 1. Integration with real systems (LanceDB, APIs)
test("persists data across instances", async () => {
  const kb1 = await createKnowledge(path, embedder);
  await kb1.addDocument({ name: "doc", content: "test" });
  await kb1.close();

  const kb2 = await createKnowledge(path, embedder);
  expect(await kb2.countDocuments()).toBe(1); // Real persistence!
});

// 2. Business logic that can fail
test("deduplicates by source URL (max 2 chunks)", async () => {
  // Tests actual deduplication logic, not just "it runs"
});

// 3. Error handling
test("handles errors gracefully", async () => {
  const mock = { retrieve: async () => { throw new Error("fail"); } };
  const result = await tool.execute({ query: "test" });
  expect(result.success).toBe(false); // Doesn't crash!
});
```

### Bad Tests (Remove)

```typescript
// 1. Testing hardcoded values
test("default model is gpt-4o-mini", () => {
  expect(config.model).toBe("gpt-4o-mini"); // So what? If it changes, is that a bug?
});

// 2. String matching on generated text
test("instructions contain 'agent'", () => {
  expect(instructions).toContain("agent"); // Superficial
});

// 3. Testing library behavior
test("LanceDB returns array", () => {
  expect(Array.isArray(results)).toBe(true); // Test your code, not theirs
});
```

## Before Writing a Test, Ask

1. **What bug would this catch?** If none, skip it.
2. **Is this testing MY code or a library?** Only test your code.
3. **If this fails, is it actually broken?** Changing defaults isn't a bug.

## Integration Tests

```typescript
// Skip if dependencies unavailable
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAIKey)("OpenAI Integration", () => {
  setDefaultTimeout(60_000); // API calls are slow
  // ...
});
```

## Mocking

```typescript
// Type-safe mocks
type MockKnowledge = Pick<EmbeddedKnowledge, "search">;

const mock: MockKnowledge = {
  search: async () => [{ name: "doc", content: "test", metadata: {} }],
};

// Cast safely
const retriever = new Retriever(mock as unknown as EmbeddedKnowledge);
```

## Naming

```typescript
// Describe WHAT it does, not HOW
test("deduplicates by source URL (max 2 chunks per URL)") // Good
test("filters results array with map and reduce")          // Bad

// Test files match source
// src/backends/embedded/* → tests/embedded.test.ts
// src/config/*           → tests/config.test.ts
```

## Running Tests

```bash
bun test                          # All tests
bun test tests/embedded.test.ts   # Single file
bun test --watch                  # Watch mode
```
