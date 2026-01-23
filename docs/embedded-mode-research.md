# Embedded Mode Research - Parity com Python/Agno

Research e validação para implementar Embedded Mode com paridade 1:1 com o backend Python/Agno.

## Objetivo

Replicar todas as features do Python/Agno em TypeScript puro, eliminando a dependência de Python para o caso de uso npm.

## Validação Enterprise

**Status**: ✅ Validado contra `docs/enterprise-architecture.md`

O Embedded Mode está alinhado com a implementação Python atual (ambos usam LanceDB + OpenAI). O doc de enterprise architecture descreve um estado futuro aspiracional (pgvector, Ollama) que ainda não foi implementado.

Para suportar stack full local (enterprise/air-gapped), o design inclui **Provider Abstraction** que permite trocar OpenAI por Ollama sem mudanças no core logic.

---

## Features Python/Agno a Replicar

| Feature | Python Implementation | Criticidade |
|---------|----------------------|-------------|
| Vector Store | LanceDB com hybrid search | Alta |
| Hybrid Search | SearchType.hybrid (vector + tantivy) | Alta |
| Embeddings | OpenAI text-embedding-3-small | Alta |
| Score Filtering | MIN_SCORE = 0.015 | Média |
| Deduplication | Max 2 chunks per source_url | Média |
| Agent Loop | tool_call_limit=3 | Alta |
| LLM | gpt-4o-mini (configurable) | Alta |
| Custom Instructions | Language-aware, markdown | Média |
| Seeding | add_content_async() | Alta |

---

## Provider Abstraction (Local Stack Support)

Para suportar tanto cloud (OpenAI) quanto local (Ollama), o design usa abstração de providers.

### Configuração

```typescript
// src/backends/embedded/config.ts

export interface EmbeddedConfig {
  // LLM Provider
  llm: {
    provider: 'openai' | 'ollama';
    model: string;
    baseUrl?: string;  // Para Ollama: http://localhost:11434
  };

  // Embedding Provider
  embedding: {
    provider: 'openai' | 'ollama';
    model: string;
    baseUrl?: string;
  };

  // Vector store (sempre LanceDB)
  vectorStore: {
    type: 'lancedb';
    path: string;
  };
}
```

### Presets

```typescript
// Cloud mode (default) - requer OPENAI_API_KEY
const CLOUD_CONFIG: EmbeddedConfig = {
  llm: { provider: 'openai', model: 'gpt-4o-mini' },
  embedding: { provider: 'openai', model: 'text-embedding-3-small' },
  vectorStore: { type: 'lancedb', path: '~/.docmole/projects/{id}/lancedb' }
};

// Local mode - requer Ollama rodando
const LOCAL_CONFIG: EmbeddedConfig = {
  llm: { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
  embedding: { provider: 'ollama', model: 'nomic-embed-text' },
  vectorStore: { type: 'lancedb', path: '~/.docmole/projects/{id}/lancedb' }
};
```

### Factory Pattern

```typescript
// src/backends/embedded/providers.ts

import { openai } from "@ai-sdk/openai";
import { ollama } from "ollama-ai-provider";

export function createLLM(config: EmbeddedConfig['llm']) {
  switch (config.provider) {
    case 'openai':
      return openai(config.model);
    case 'ollama':
      return ollama(config.model, { baseUrl: config.baseUrl });
  }
}

export function createEmbedder(config: EmbeddedConfig['embedding']) {
  switch (config.provider) {
    case 'openai':
      return new OpenAIEmbedder(config.model);
    case 'ollama':
      return new OllamaEmbedder(config.model, config.baseUrl);
  }
}
```

### CLI Usage

```bash
# Cloud mode (default) - requer OPENAI_API_KEY
bunx docmole serve --project my-docs

# Local mode - requer Ollama rodando
bunx docmole serve --project my-docs --local

# Custom config
bunx docmole serve --project my-docs \
  --llm-provider ollama \
  --llm-model llama3.2 \
  --embedding-provider ollama \
  --embedding-model nomic-embed-text
```

### Dificuldade de Adaptação Cloud → Local

| Componente | Mudança Necessária | Dificuldade |
|------------|-------------------|-------------|
| LLM | Trocar import do provider | Fácil |
| Embeddings | Trocar embedder class | Fácil |
| Vector Store | Nenhuma (LanceDB) | Zero |
| Agent Loop | Nenhuma (AI SDK) | Zero |
| Tool Calling | Depende do modelo* | Média |

*Nem todos modelos Ollama suportam tool calling. Modelos recomendados: `llama3.2`, `qwen2.5`, `mistral`.

### Packages para Local Mode

| Componente | Package | Versão |
|------------|---------|--------|
| LLM | `ollama-ai-provider` | ^1.0.0 |
| Embeddings | `@lancedb/lancedb` (built-in) | ^0.14.0 |

**Sources:**
- [Ollama AI Provider](https://github.com/sgomez/ollama-ai-provider)
- [AI SDK Ollama Docs](https://ai-sdk.dev/providers/community-providers/ollama)
- [LanceDB Ollama Embeddings](https://lancedb.com/documentation/embeddings/available_embedding_models/text_embedding_functions/ollama_embedding/)

---

## Research: Opções por Componente

### 1. Vector Store com Hybrid Search

| Opção | Hybrid Search | Full-Text | Node.js SDK | Maturidade |
|-------|---------------|-----------|-------------|------------|
| **LanceDB** | ✅ Sim (dez/2024) | ✅ tantivy | ✅ @lancedb/lancedb | Alta |
| Weaviate | ✅ BM25 + vector | ✅ | ✅ | Alta |
| Meilisearch | ✅ | ✅ | ✅ | Alta |
| Qdrant | ❌ | ❌ | ✅ | Alta |
| vectra | ❌ | ❌ | ✅ | Média |
| ChromaDB | ❌ | ❌ | ✅ | Média |

**Descoberta crítica**: LanceDB Node.js **agora suporta hybrid search** (merged em dez/2024, issue #1921).

**Recomendação**: LanceDB - mesma tech que Python, garantia de paridade.

### 2. LanceDB Node.js - Hybrid Search API

```typescript
import * as lancedb from "@lancedb/lancedb";
import "@lancedb/lancedb/embedding/openai";

// Hybrid search com reranker RRF (mesmo que Python)
const results = await table
  .query()
  .fullTextSearch("search terms")           // BM25/tantivy
  .nearestTo(queryEmbedding)                 // Vector search
  .rerank(new lancedb.RRFReranker())         // Combina resultados
  .select(["text", "metadata"])
  .limit(10)
  .toArray();
```

**Sources:**
- [LanceDB Hybrid Search Docs](https://docs.lancedb.com/search/hybrid-search)
- [GitHub Issue #1921 - COMPLETED](https://github.com/lancedb/lancedb/issues/1921)

### 3. Agent Framework com Tool Calling

| Opção | Tool Calling | Agent Loop | Maturity | Bundle Size |
|-------|--------------|------------|----------|-------------|
| **Vercel AI SDK** | ✅ | ✅ stepCountIs(N) | Muito alta | ~50KB |
| @openai/agents | ✅ | ✅ Runner.run() | Baixa (v0.3) | ~30KB |
| OpenAI SDK direto | ✅ | Manual (while loop) | Alta | ~20KB |
| LangChain.js | ✅ | ✅ | Alta | ~500KB+ |

**Vercel AI SDK 6** (lançado recentemente):
- 20M+ downloads/mês
- Suporte nativo a RAG com tools
- `stopWhen: stepCountIs(5)` para controlar iterações
- Type-safe tools com Zod

```typescript
import { tool, generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const searchDocs = tool({
  description: "Search documentation",
  parameters: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    // LanceDB hybrid search
    return await vectorStore.hybridSearch(query);
  },
});

const result = await generateText({
  model: openai("gpt-4o-mini"),
  tools: { searchDocs },
  maxSteps: 3, // Equivalente ao tool_call_limit=3
  system: AGENT_INSTRUCTIONS,
  prompt: userQuestion,
});
```

**Sources:**
- [Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6)
- [AI SDK RAG Guide](https://ai-sdk.dev/cookbook/guides/rag-chatbot)
- [@openai/agents GitHub](https://github.com/openai/openai-agents-js)

### 4. Embeddings

| Opção | Modelo | Custo | Latência |
|-------|--------|-------|----------|
| **OpenAI API** | text-embedding-3-small | $0.02/1M tokens | ~100ms |
| OpenAI API | text-embedding-3-large | $0.13/1M tokens | ~150ms |
| Ollama (local) | nomic-embed-text | Free | ~50ms |
| transformers.js | various | Free | ~500ms |

**Recomendação**: OpenAI text-embedding-3-small (mesmo que Python) para paridade.

Para enterprise/offline: Ollama pode ser adicionado como opção futura.

---

## Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EmbeddedBackend (TypeScript)                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Provider Layer                            │   │
│  │                                                               │   │
│  │   createLLM(config)              createEmbedder(config)      │   │
│  │        │                                │                     │   │
│  │   ┌────┴────┐                      ┌────┴────┐               │   │
│  │   │ openai  │ ← default            │ openai  │ ← default     │   │
│  │   │ ollama  │ ← --local            │ ollama  │ ← --local     │   │
│  │   └─────────┘                      └─────────┘               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Vercel AI SDK                             │   │
│  │                                                               │   │
│  │   generateText({                                              │   │
│  │     model: llmProvider,          ← from createLLM()          │   │
│  │     tools: { searchKnowledge },                              │   │
│  │     maxSteps: 3,                 ← tool_call_limit=3         │   │
│  │     system: instructions,        ← custom instructions       │   │
│  │   })                                                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                searchKnowledge Tool                          │   │
│  │                                                               │   │
│  │   1. Query embedding (via embedder) ← from createEmbedder()  │   │
│  │   2. Hybrid search (LanceDB)                                 │   │
│  │   3. Score filtering (MIN_SCORE)                             │   │
│  │   4. Deduplication (max 2 per URL)                           │   │
│  │   5. Return formatted results                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    LanceDB (TypeScript)                      │   │
│  │                                                               │   │
│  │   table.query()                                               │   │
│  │     .fullTextSearch(query)    ← tantivy full-text           │   │
│  │     .nearestTo(embedding)     ← vector search               │   │
│  │     .rerank(RRFReranker())    ← hybrid fusion               │   │
│  │     .limit(20)                                                │   │
│  │     .toArray()                                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Dependências Necessárias

### Core (sempre instalado)

```json
{
  "dependencies": {
    "@lancedb/lancedb": "^0.14.0",
    "ai": "^4.0.0",
    "zod": "^3.23.0"
  }
}
```

### Cloud Mode (default)

```json
{
  "dependencies": {
    "@ai-sdk/openai": "^1.0.0"
  }
}
```

### Local Mode (opcional)

```json
{
  "optionalDependencies": {
    "ollama-ai-provider": "^1.0.0"
  }
}
```

**Tamanho estimado**:
- Core + Cloud: ~100KB
- Core + Local: ~80KB
- Core + Both: ~120KB

---

## Comparação: Python vs TypeScript Parity

| Feature | Python/Agno | TypeScript/Embedded | Paridade |
|---------|-------------|---------------------|----------|
| Vector store | LanceDB | LanceDB | ✅ 100% |
| Hybrid search | SearchType.hybrid | .fullTextSearch().nearestTo() | ✅ 100% |
| Reranker | RRFReranker | RRFReranker | ✅ 100% |
| Embeddings | text-embedding-3-small | text-embedding-3-small | ✅ 100% |
| Score filtering | MIN_SCORE = 0.015 | Custom filter | ✅ 100% |
| Deduplication | seen_urls dict | Map<url, count> | ✅ 100% |
| Agent loop | tool_call_limit=3 | maxSteps: 3 | ✅ 100% |
| LLM | gpt-4o-mini | gpt-4o-mini | ✅ 100% |
| Instructions | dedent string | template string | ✅ 100% |
| Streaming | ❌ não usado | ✅ disponível | ➕ Bônus |

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| LanceDB Node.js hybrid search bugs | Baixa | Alto | Fallback para vector-only |
| Vercel AI SDK breaking changes | Baixa | Médio | Pin versions, monitor changelogs |
| OpenAI API rate limits | Média | Médio | Retry logic, exponential backoff |
| Bundle size > 200KB | Média | Baixo | Tree-shaking, lazy loading |

---

## Plano de Implementação

### Fase 1: Provider Abstraction + Core
1. Criar `src/backends/embedded/config.ts` (EmbeddedConfig interface)
2. Criar `src/backends/embedded/providers.ts` (createLLM, createEmbedder factories)
3. Instalar dependências (LanceDB, AI SDK, OpenAI provider)
4. Criar `src/backends/embedded/knowledge.ts` (LanceDB wrapper)
5. Implementar `searchKnowledge` tool com:
   - Query embedding via provider
   - Hybrid search (LanceDB)
   - Score filtering (MIN_SCORE = 0.015)
   - Deduplication (max 2 per URL)
6. Criar `src/backends/embedded/index.ts` (EmbeddedBackend class)

### Fase 2: CLI Integration
1. Atualizar `setup` command para modo embedded
2. Atualizar `serve` command para detectar modo
3. Adicionar flags:
   - `--mode embedded|agno`
   - `--local` (shortcut para Ollama)
   - `--llm-provider`, `--embedding-provider`
4. Migrar seeding para TypeScript (usar LanceDB diretamente)
5. Atualizar `config.yaml` schema para embedded config

### Fase 3: Local Mode (Ollama)
1. Adicionar `ollama-ai-provider` como optional dependency
2. Implementar OllamaEmbedder para LanceDB
3. Testar tool calling com modelos Ollama
4. Documentar modelos recomendados

### Fase 4: Testing & Validation
1. Testes unitários para cada componente
2. Testes de integração (end-to-end)
3. Comparação de resultados Python vs TypeScript
4. Performance benchmarks (latência, memória)
5. Documentação e exemplos

### Estrutura de Arquivos

```
src/backends/embedded/
├── index.ts           # EmbeddedBackend class (implements Backend)
├── config.ts          # EmbeddedConfig interface + presets
├── providers.ts       # createLLM(), createEmbedder() factories
├── knowledge.ts       # EmbeddedKnowledge class (LanceDB wrapper)
├── tools.ts           # searchKnowledge tool definition
├── retriever.ts       # Score filtering + deduplication logic
└── instructions.ts    # Agent system prompt
```

---

## Conclusão

**Viabilidade: ALTA**

A pesquisa confirma que é possível implementar paridade 1:1 com Python/Agno usando:

1. **LanceDB Node.js** - Hybrid search disponível desde dez/2024
2. **Vercel AI SDK** - Agent loop maduro com tool calling
3. **Provider Abstraction** - Suporte a OpenAI (cloud) e Ollama (local)

### Trade-offs

| Aspecto | Impacto | Mitigação |
|---------|---------|-----------|
| Bundle size ~100KB | Baixo | Tree-shaking, lazy loading |
| Ollama tool calling | Médio | Documentar modelos compatíveis |
| Dependência de AI SDK | Baixo | SDK maduro, 20M+ downloads/mês |

### Benefícios do Design

1. **Paridade 1:1** com Python atual (LanceDB + OpenAI)
2. **Future-proof** para stack local (Ollama)
3. **Flexível** para adicionar novos providers (Azure, Anthropic, etc.)
4. **npm-native** sem dependência de Python
5. **Enterprise-ready** com suporte a air-gapped environments

---

## Sources

### LanceDB
- [LanceDB Hybrid Search Docs](https://docs.lancedb.com/search/hybrid-search)
- [LanceDB GitHub Issue #1921 - Hybrid Search in Node.js](https://github.com/lancedb/lancedb/issues/1921)
- [LanceDB Ollama Embeddings](https://lancedb.com/documentation/embeddings/available_embedding_models/text_embedding_functions/ollama_embedding/)

### Vercel AI SDK
- [Vercel AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6)
- [AI SDK RAG Chatbot Guide](https://ai-sdk.dev/cookbook/guides/rag-chatbot)
- [AI SDK Ollama Community Provider](https://ai-sdk.dev/providers/community-providers/ollama)

### Ollama Integration
- [ollama-ai-provider GitHub](https://github.com/sgomez/ollama-ai-provider)
- [ai-sdk-ollama npm](https://www.npmjs.com/package/ai-sdk-ollama)
- [How to Use Local LLM with Vercel AI SDK](https://belcaid.medium.com/how-to-use-a-local-llm-with-vercel-ai-sdk-efa9ef5c08b3)

### OpenAI
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-js)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [OpenAI Cookbook - Building an Agent](https://cookbook.openai.com/examples/how_to_build_an_agent_with_the_node_sdk)
