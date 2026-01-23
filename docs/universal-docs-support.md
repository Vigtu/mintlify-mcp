# Universal Documentation Support

Research and implementation plan for supporting any documentation source, making docmole completely agnostic.

## Problem Statement

Currently, docmole has limited source support:

```
Current State:
├── Mintlify API Mode    → Only sites with Mintlify AI Assistant
└── Local RAG Mode       → Only Mintlify sites (requires mint.json)

                         ❌ What about:
                         - Generic documentation sites?
                         - GitHub repositories without docs?
                         - Internal company documentation?
```

**Goal**: Support ANY documentation source to enable enterprise adoption and remove Mintlify dependency.

---

## Research Findings

### SuperDocs Analysis

[superdocs.cloud](https://www.superdocs.cloud/) generates documentation from GitHub repos using AI.

**How it works:**
1. User provides GitHub repo URL
2. Backend clones/analyzes code
3. AI generates structured documentation
4. Hosts on `{project}.superdocs.cloud`

**Status**: Closed source (GitHub repo returns 404)

**CLI**: `superdocs-cli` on npm (calls their API)

### Mintlify Open Source Analysis

| Component | Open Source? | License | Useful? |
|-----------|--------------|---------|---------|
| Platform/Backend | No | - | N/A |
| AI Assistant API | No | - | Only via reverse engineering |
| `mintlify/mdx` | Yes | MIT | **Parser for MDX** |
| `mintlify/starter` | Yes | MIT | Doc structure templates |
| `mintlify/writer` | Yes | MIT | Discontinued |

**Conclusion**: Cannot fork Mintlify - core backend is closed source.

### Open Source Alternatives Found

| Project | Stars | Description | Link |
|---------|-------|-------------|------|
| **divar-ir/ai-doc-gen** | 689 | Multi-agent doc generator (Python) | [GitHub](https://github.com/divar-ir/ai-doc-gen) |
| **context-labs/autodoc** | - | Auto-generate docs from code | [GitHub](https://github.com/context-labs/autodoc) |
| **OpenBMB/RepoAgent** | - | LLM-powered repo docs (Python only) | [GitHub](https://github.com/OpenBMB/RepoAgent) |
| **repomix** | - | Pack codebase for AI analysis | [repomix.com](https://repomix.com/) |

---

## Proposed Solution: Option C (Hybrid Approach)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    docmole setup                        │
│                                                              │
│   SOURCE DETECTION                         OUTPUT            │
│   ─────────────────                        ──────            │
│                                                              │
│   --url https://docs.mintlify.com  ──┐                      │
│   (Mintlify site)                    │                      │
│                                      ├──→  Markdown  ──→ RAG │
│   --url https://any-docs.com     ───┤     Files          │
│   (Generic docs site)                │                      │
│                                      │                      │
│   --repo https://github.com/x/y  ───┘                      │
│   (Code repository)              [Future]                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Agno Backend  │
                    │   (Local RAG)   │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   MCP Server    │
                    │   (ask tool)    │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Claude Code   │
                    └─────────────────┘
```

### Source Types

| Source Type | Detection | Extraction Method | Priority |
|-------------|-----------|-------------------|----------|
| Mintlify site | `mint.json` exists | Already implemented | ✅ Done |
| Generic docs site | No `mint.json` | HTML → Readability → Markdown | **Phase 1** |
| GitHub repo | `--repo` flag | AI generates docs | Phase 2 |
| Local codebase | `--path` flag | AI generates docs | Phase 2 |

---

## Business & Product Analysis

### Target Audiences

| Audience | Current Support | With Universal Support |
|----------|-----------------|------------------------|
| Devs using Mintlify docs | ✅ Works | ✅ Works |
| Devs using other docs | ❌ Not supported | ✅ **Phase 1** |
| Enterprise with internal docs | ❌ Not supported | ✅ **Phase 1** |
| Teams without docs | ❌ Not supported | ✅ Phase 2 |

### Value Proposition by Approach

#### Approach A: Extract existing docs only
- **Pros**: Simple, fast to implement
- **Cons**: Only works if docs already exist
- **Value**: Low - just facilitates access

#### Approach B: Generate docs from code only
- **Pros**: Creates value where none existed
- **Cons**: Complex, LLM costs, quality varies
- **Value**: High - creates new documentation

#### Approach C: Hybrid (Recommended)
- **Pros**: Covers all use cases, phased delivery
- **Cons**: More total work
- **Value**: Maximum - serves entire market

### Decision: Approach C (Hybrid)

**Rationale:**
1. Phase 1 covers 70% of use cases (existing docs)
2. Phase 1 is fast to implement (days, not weeks)
3. Phase 2 adds differentiation (code → docs)
4. Phased approach reduces risk

---

## Implementation Plan

### Phase 1: Generic Documentation Site Support

**Goal**: Support any documentation website (not just Mintlify)

**Timeline**: ~3-5 days

#### Tasks

##### 1.1 Generic Page Discovery
```typescript
// src/discovery/generic.ts

interface DiscoveryResult {
  pages: string[];
  method: 'sitemap' | 'crawl' | 'manual';
}

async function discoverPages(baseUrl: string): Promise<DiscoveryResult> {
  // 1. Try sitemap.xml
  const sitemapPages = await trySitemap(baseUrl);
  if (sitemapPages.length > 0) {
    return { pages: sitemapPages, method: 'sitemap' };
  }

  // 2. Try common sitemap locations
  const commonSitemaps = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/docs/sitemap.xml',
  ];

  // 3. Fallback: crawl links from homepage
  return { pages: await crawlLinks(baseUrl), method: 'crawl' };
}
```

##### 1.2 HTML Content Extraction
```typescript
// src/extraction/html-to-markdown.ts

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

interface ExtractedContent {
  title: string;
  content: string;  // Markdown
  url: string;
}

async function extractContent(url: string): Promise<ExtractedContent> {
  // 1. Fetch HTML
  const html = await fetch(url).then(r => r.text());

  // 2. Parse DOM
  const dom = new JSDOM(html, { url });

  // 3. Extract main content (removes nav, footer, ads, etc.)
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error(`Could not extract content from ${url}`);
  }

  // 4. Convert to Markdown
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  const markdown = turndown.turndown(article.content);

  return {
    title: article.title,
    content: markdown,
    url,
  };
}
```

##### 1.3 Update Setup Command
```typescript
// src/cli/setup.ts

// Add detection logic
async function detectSourceType(url: string): Promise<'mintlify' | 'generic'> {
  // Check for mint.json
  try {
    const mintJson = await fetch(`${url}/mint.json`);
    if (mintJson.ok) return 'mintlify';
  } catch {}

  return 'generic';
}

// Update setup flow
async function setup(options: SetupOptions) {
  const sourceType = await detectSourceType(options.url);

  if (sourceType === 'mintlify') {
    // Existing Mintlify flow
    return setupMintlify(options);
  }

  // New generic flow
  return setupGeneric(options);
}
```

##### 1.4 Dependencies to Add
```json
{
  "dependencies": {
    "@mozilla/readability": "^0.5.0",
    "turndown": "^7.1.2",
    "jsdom": "^24.0.0"
  }
}
```

#### Acceptance Criteria - Phase 1

- [ ] `docmole setup --url https://any-docs-site.com --id my-docs` works
- [ ] Automatically detects Mintlify vs generic sites
- [ ] Extracts clean markdown from HTML pages
- [ ] Discovers pages via sitemap.xml or link crawling
- [ ] Indexes extracted content in Agno
- [ ] MCP `ask` tool works with extracted docs

---

### Phase 2: Code-to-Documentation Generation (Future)

**Goal**: Generate documentation from source code using AI

**Timeline**: ~2-3 weeks

#### High-Level Tasks

##### 2.1 Code Analysis
- Clone/read repository
- Parse code structure (files, functions, classes)
- Identify important files (entry points, APIs, configs)

##### 2.2 AI Documentation Generation
- Design prompts for different doc types:
  - Overview/README
  - API reference
  - Architecture guide
  - Getting started
- Support multiple LLM providers (OpenAI, Anthropic, Ollama)

##### 2.3 CLI Commands
```bash
# From GitHub repo
docmole setup --repo https://github.com/user/project --id my-project

# From local path
docmole setup --path ./my-project --id my-project
```

#### Reference Implementation

Study [divar-ir/ai-doc-gen](https://github.com/divar-ir/ai-doc-gen) for:
- Multi-agent architecture
- Prompt engineering for code analysis
- Document structure generation

---

## Technical Considerations

### Content Quality

| Source | Quality Control |
|--------|-----------------|
| Mintlify | High - structured MDX |
| Generic HTML | Medium - Readability extraction |
| AI-generated | Variable - depends on code quality |

### Rate Limiting

```typescript
// For generic site scraping
const REQUESTS_PER_SECOND = 2;
const DELAY_BETWEEN_REQUESTS = 500; // ms

async function fetchWithRateLimit(urls: string[]) {
  const results = [];
  for (const url of urls) {
    results.push(await fetch(url));
    await sleep(DELAY_BETWEEN_REQUESTS);
  }
  return results;
}
```

### Caching

```
~/.docmole/
└── projects/
    └── <project-id>/
        ├── config.yaml
        ├── cache/
        │   ├── pages.json      # Discovered pages
        │   └── content/        # Extracted markdown
        │       ├── page-1.md
        │       └── page-2.md
        └── vectors/            # Agno index (if embedded mode)
```

---

## CLI Usage Examples

### Phase 1 (Generic Sites)

```bash
# Setup from any documentation site
docmole setup --url https://docs.python.org --id python-docs
docmole setup --url https://react.dev --id react-docs
docmole setup --url https://internal.company.com/docs --id internal-docs

# Serve (same as before)
docmole serve --project python-docs
```

### Phase 2 (Code Repos)

```bash
# Setup from GitHub repo
docmole setup --repo https://github.com/fastapi/fastapi --id fastapi-docs

# Setup from local code
docmole setup --path ~/projects/my-app --id my-app-docs

# With AI provider config
docmole setup --repo https://github.com/x/y --id project \
  --llm-provider openai \
  --llm-model gpt-4o-mini
```

---

## Success Metrics

### Phase 1
- [ ] Works with 5+ different documentation sites (non-Mintlify)
- [ ] Content extraction accuracy > 90%
- [ ] Setup time < 2 minutes for typical doc site

### Phase 2
- [ ] Generates useful docs for Python/TypeScript repos
- [ ] AI cost < $0.10 per repository
- [ ] Generated docs answer basic "how to use" questions

---

## Open Questions

1. **Incremental updates**: How to detect changed pages and re-index?
2. **Authentication**: Support for docs behind login?
3. **Multi-language**: Support non-English documentation?
4. **Quality scoring**: How to measure extraction quality?

---

## References

- [Mozilla Readability](https://github.com/mozilla/readability) - Content extraction
- [Turndown](https://github.com/mixmark-io/turndown) - HTML to Markdown
- [divar-ir/ai-doc-gen](https://github.com/divar-ir/ai-doc-gen) - AI doc generation reference
- [SuperDocs](https://www.superdocs.cloud/) - Commercial reference
- [Mintlify MDX Parser](https://github.com/mintlify/mdx) - MDX parsing (MIT)
