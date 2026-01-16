# Business Value Proposition

Product value proposition and target audiences for mintlify-mcp.

## Problem Statement

Developers lose significant time context-switching between code and documentation:

| Pain Point | Impact |
|------------|--------|
| Manual doc searches | 15-30 min/day per developer |
| Slow onboarding | 2-4 weeks until new hires are productive |
| Fragmented internal knowledge | Inconsistent answers, repeated questions |
| Underutilized documentation | Investment in docs not paying off |

## Solution

**"Documentation as AI Assistant"** — Transform any documentation site into a conversational interface integrated directly into the developer's workflow.

```
Developer in terminal:
> "How do I authenticate with the payments API?"
→ Instant answer from internal documentation
→ No browser, no searching, no context switching
```

---

## Target Audiences

### 1. Individual Developers

**Profile**: Developers using Claude Code who want faster access to library/framework documentation.

**Problem**:
- Learning new libraries is slow
- Searching docs breaks flow
- Copy-pasting examples is tedious

**Solution**: Zero-config access to any Mintlify-powered documentation.

```bash
# One-time setup
claude mcp add agno-docs -- bunx mintlify-mcp -p agno-v2

# Usage: just ask in Claude Code
"How do I create an agent with memory in Agno?"
```

**Value**:
- 5-15 minutes saved per documentation lookup
- Stay in terminal, maintain flow state
- Contextual code examples

**Pricing Model**: Free (uses public Mintlify API)

---

### 2. Startups / Small Teams

**Profile**: Teams building products who want to integrate documentation assistants without infrastructure overhead.

**Problem**:
- Need docs for internal tools/APIs
- Don't have DevOps capacity for self-hosting
- Want npm-installable solution

**Solution**: Embedded mode with local vector store + OpenAI API.

```bash
# Setup (once)
bunx mintlify-mcp setup --url https://docs.yourproduct.com --id your-docs

# Serve (in Claude Code config)
bunx mintlify-mcp serve --project your-docs
```

**Value**:
- No Python, no servers, just npm
- ~$0.01 per query (OpenAI API)
- Works with any documentation site

**Pricing Model**: Pay-per-use (OpenAI API costs)

| Usage | Estimated Cost |
|-------|---------------|
| 1K queries/month | ~$10 |
| 10K queries/month | ~$100 |

---

### 3. Enterprise / Large Companies

**Profile**: Companies with proprietary documentation, compliance requirements, and multiple development teams.

**Problem**:
- Sensitive internal documentation cannot leave network
- Need audit trails and access control
- Multiple documentation sets (APIs, platforms, frameworks)
- Compliance requirements (SOC2, HIPAA, GDPR)

**Solution**: Self-hosted RAG server with local LLM and vector store.

```
┌─────────────────────────────────────────────┐
│     Central RAG Server (internal network)    │
│                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ API     │ │ Platform│ │Framework│       │
│  │ Docs    │ │  Docs   │ │  Docs   │       │
│  └─────────┘ └─────────┘ └─────────┘       │
│                                              │
│  Local LLM (Ollama/vLLM) + pgvector         │
│  Data NEVER leaves the network              │
└─────────────────────────────────────────────┘
```

**Value**:
- Complete data sovereignty
- Audit logging for compliance
- Scales to any number of documentation sets
- Fixed infrastructure cost (no per-query fees at scale)

**Pricing Model**: Infrastructure cost only

| Scale | Cloud (OpenAI) | Self-Hosted |
|-------|----------------|-------------|
| 10K queries/mo | ~$100 | $500 (fixed) |
| 50K queries/mo | ~$500 | $500 (fixed) |
| 200K queries/mo | ~$2,000 | $500 (fixed) |
| **Break-even** | ~50K queries/mo | |

---

## Deployment Modes

| Mode | Target | Setup | Data Location | LLM |
|------|--------|-------|---------------|-----|
| **Remote** | Individual devs | Zero | Mintlify servers | Mintlify |
| **Embedded** | Startups | `setup` command | Local vectors | OpenAI API |
| **Self-hosted** | Enterprise | Docker/K8s | Internal network | Ollama/vLLM |

---

## Key Metrics

### Developer Productivity

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Doc lookup time | 10 min | 30 sec | 20x faster |
| Context switches/day | 15+ | 5 | 66% reduction |
| Onboarding time | 4 weeks | 2 weeks | 50% faster |

### Enterprise ROI

| Metric | Calculation |
|--------|-------------|
| Time saved per dev | 30 min/day × $100/hr = $50/day |
| Team of 50 devs | $2,500/day = $50K/month |
| Infrastructure cost | ~$500-2K/month |
| **ROI** | 25-100x |

---

## Competitive Advantages

1. **Zero-config for public docs** — Works immediately with Mintlify API
2. **npm-native** — Embedded mode requires no Python or external servers
3. **Enterprise-ready** — Full self-hosted option with local LLM
4. **Open source** — Customizable, auditable, no vendor lock-in
5. **MCP-native** — First-class Claude Code integration

---

## Roadmap Alignment

| Phase | Focus | Audience |
|-------|-------|----------|
| Current | Mintlify API + Agno backend | Individual devs |
| Next | Embedded mode (vectra) | Startups |
| Future | Enterprise features | Large companies |

See @docs/architecture-plan.md for technical implementation details.
See @docs/enterprise-requirements.md for enterprise-specific requirements.
