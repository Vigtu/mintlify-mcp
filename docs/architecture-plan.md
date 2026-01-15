# Architecture Plan

Research and planning document for mintlify-mcp architecture evolution.

## Project Goal

Create MCPs for any documentation site, publishable to npm, with potential for submodule integration.

## Current Architecture

```
User → bunx mintlify-mcp → TypeScript MCP → Python RAG Server → Knowledge Base
```

### Current Modes

1. **Mintlify API Mode** (`-p <project-id>`)
   - Proxies to Mintlify's AI Assistant API
   - Works for sites with built-in assistant
   - Zero setup, fast response

2. **Local RAG Mode** (`setup` + `serve`)
   - Requires Python server (Agno)
   - Self-hosted embeddings and vector store
   - Complex setup

### Problems

| Issue | Impact |
|-------|--------|
| Python dependency | Not npm-friendly, complex install |
| Cold start (~10s) | Poor UX on first request |
| Multiple servers | Resource heavy for multiple projects |
| Setup complexity | Barrier to adoption |

---

## Proposed Architecture

```
mintlify-mcp (npm)
│
├── 🚀 Remote Mode (default)
│   └── Mintlify API (sites with AI Assistant)
│       - Zero setup
│       - Response ~200ms
│       - Already implemented
│
├── 📦 Embedded Mode (new)
│   └── JavaScript vector store (vectra/hnswlib-node)
│       - NO Python required
│       - Uses OpenAI Embeddings API
│       - Vectors stored in ~/.mintlify-mcp/vectors/<project>/
│       - Single process, npm-ready
│
└── 🔧 External Mode (advanced/submodule)
    └── Connects to external RAG server
        - For custom integrations
        - Submodule in monorepos
        - Self-hosted deployments
```

---

## Mode Comparison

| Aspect | Remote | Embedded | External |
|--------|--------|----------|----------|
| Setup | Zero | `setup --url` | Manual |
| Dependencies | None | OpenAI API key | Python/custom server |
| npm-friendly | ✅ | ✅ | ❌ |
| Cold start | ~200ms | ~500ms | ~10s |
| Offline capable | ❌ | ❌ (needs API) | ✅ |
| Submodule ready | ❌ | Partial | ✅ |
| Resource usage | Zero | Low | High |

---

## Embedded Mode Design

### Technology Options

| Library | Pros | Cons |
|---------|------|------|
| **vectra** | Simple API, TypeScript native | Newer, less battle-tested |
| **hnswlib-node** | Fast, proven algorithm | Native bindings, build issues |
| **faiss-node** | Very fast, Facebook-backed | Complex setup, native deps |
| **chromadb** | Full-featured | Requires server |

**Recommendation**: `vectra` for simplicity and TypeScript compatibility.

### Data Flow

```
setup --url <docs-url> --id <project>
    │
    ├── 1. Discover pages (sitemap/mint.json)
    ├── 2. Fetch markdown content
    ├── 3. Chunk documents
    ├── 4. Generate embeddings (OpenAI API)
    └── 5. Store vectors locally (~/.mintlify-mcp/vectors/<project>/)

serve --project <project>
    │
    ├── 1. Load vectors from disk
    ├── 2. Start MCP server
    └── 3. On query:
        ├── Generate query embedding
        ├── Search vectors (similarity)
        ├── Retrieve top-k chunks
        └── Generate response (LLM)
```

### File Structure

```
~/.mintlify-mcp/
├── projects/
│   └── <project-id>/
│       ├── config.yaml
│       └── vectors/           # New: embedded vector store
│           ├── index.json
│           └── vectors.bin
└── global.yaml
```

### API Design

```typescript
// Backend interface (unchanged)
interface Backend {
  ask(question: string): Promise<AskResult>;
  clearHistory(): void;
  isAvailable(): Promise<boolean>;
}

// New embedded backend
class EmbeddedBackend implements Backend {
  private vectorStore: VectraIndex;
  private openai: OpenAI;

  async ask(question: string): Promise<AskResult> {
    // 1. Embed query
    const queryVector = await this.embed(question);

    // 2. Search similar chunks
    const results = await this.vectorStore.query(queryVector, { topK: 5 });

    // 3. Build context
    const context = results.map(r => r.text).join('\n\n');

    // 4. Generate response
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Answer based on this documentation:\n${context}` },
        { role: 'user', content: question }
      ]
    });

    return { answer: response.choices[0].message.content };
  }
}
```

---

## Implementation Phases

### Phase 1: npm Release (Embedded Mode)

**Goal**: Self-contained npm package, no Python dependency.

**Tasks**:
- [ ] Add `vectra` dependency
- [ ] Implement `EmbeddedBackend`
- [ ] Implement chunking strategy
- [ ] Update `setup` command to use embedded mode by default
- [ ] Update `serve` command to auto-detect mode
- [ ] Add `OPENAI_API_KEY` requirement for embedded mode
- [ ] Test with multiple documentation sites
- [ ] Publish to npm

**CLI Changes**:
```bash
# Embedded mode (new default for local)
bunx mintlify-mcp setup --url https://docs.example.com --id my-docs

# Explicit mode selection
bunx mintlify-mcp setup --url https://docs.example.com --id my-docs --mode embedded
bunx mintlify-mcp setup --url https://docs.example.com --id my-docs --mode external
```

### Phase 2: Optimization

**Goal**: Improve performance and reduce API costs.

**Tasks**:
- [ ] Cache embeddings to avoid re-computation
- [ ] Implement incremental updates (only new/changed pages)
- [ ] Add local embedding model option (transformers.js)
- [ ] Optimize chunk size and overlap
- [ ] Add compression for vector storage

### Phase 3: Submodule Support

**Goal**: Enable integration as submodule in larger projects.

**Tasks**:
- [ ] Expose programmatic API
- [ ] Support custom vector stores
- [ ] Support custom LLM providers
- [ ] Add webhook/event system
- [ ] Document integration patterns

---

## Backend Selection Logic

```typescript
async function createBackend(projectId: string): Promise<Backend> {
  const config = await loadProjectConfig(projectId);

  // 1. Check for Mintlify API (fastest)
  if (config.backend === 'mintlify' && config.mintlify) {
    return createMintlifyBackend(config.mintlify.project_id, config.mintlify.domain);
  }

  // 2. Check for embedded vectors (npm-friendly)
  if (config.backend === 'embedded' || await hasLocalVectors(projectId)) {
    return createEmbeddedBackend(projectId);
  }

  // 3. Check for external server (advanced)
  if (config.backend === 'external' && config.external) {
    return createExternalBackend(config.external.url);
  }

  // 4. Auto-detect Mintlify API availability
  if (await hasMintlifyAssistant(config.source.url)) {
    return createMintlifyBackend(/* auto-discover */);
  }

  throw new Error('No backend available. Run setup first.');
}
```

---

## Cost Considerations

### Embedded Mode Costs (OpenAI API)

| Operation | Model | Cost |
|-----------|-------|------|
| Embedding | text-embedding-3-small | $0.02 / 1M tokens |
| Query | gpt-4o-mini | $0.15 / 1M input, $0.60 / 1M output |

**Example**: 100 doc pages (~500 tokens each)
- Initial embedding: 50K tokens = $0.001
- Per query: ~2K tokens = $0.0003

### Optimization Strategies

1. **Cache embeddings**: Only re-embed changed pages
2. **Batch requests**: Embed multiple chunks per API call
3. **Local embeddings**: Use transformers.js for free embeddings (slower)
4. **Hybrid**: Use local for embedding, API for generation

---

## Open Questions

1. **Chunking strategy**: How to split documents effectively?
   - By headers? Fixed size? Semantic?

2. **Embedding model**:
   - `text-embedding-3-small` (cheap, good) vs `text-embedding-3-large` (better, costly)

3. **Local LLM option**:
   - Should we support Ollama/local models?

4. **Multi-project optimization**:
   - Share embedding model across projects?
   - Global vector store with project namespacing?

---

## References

- [Vectra](https://github.com/Stevenic/vectra) - Local vector database for TypeScript
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [RAG Best Practices](https://www.anthropic.com/research/rag)
