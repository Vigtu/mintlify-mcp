# Enterprise Architecture

Production deployment architecture for companies distributing MCPs to developers on private networks.

## Use Case

A company with multiple frameworks/products wants to:
- Provide AI-powered documentation assistants to internal developers
- Keep proprietary documentation within private network
- Scale to multiple documentation sets
- Maintain central control and auditability

## Requirements

| Requirement | Implication |
|-------------|-------------|
| Private network | No external APIs (OpenAI, Mintlify) |
| Proprietary data | Docs cannot leave the network |
| Multiple frameworks | Scale to N documentation sets |
| Multi-developer | Central server, not per-machine |
| Compliance | Audit logs, access control |
| High availability | Production-grade uptime |

---

## Architecture Overview

```
                 ┌─────────────────────────────────────────┐
                 │         Central RAG Server              │
                 │         (Agno / FastAPI)                │
                 │              :7777                      │
                 │                                         │
                 │  ┌─────────┐ ┌─────────┐ ┌───────────┐ │
                 │  │ React   │ │ Python  │ │ Internal  │ │
                 │  │  Docs   │ │  Docs   │ │   APIs    │ │
                 │  │ (kb-1)  │ │ (kb-2)  │ │  (kb-3)   │ │
                 │  └─────────┘ └─────────┘ └───────────┘ │
                 │                                         │
                 │  ┌─────────────────────────────────────┐│
                 │  │   Private LLM (Ollama / vLLM)       ││
                 │  │   Model: llama3, mistral, etc       ││
                 │  └─────────────────────────────────────┘│
                 │                                         │
                 │  ┌─────────────────────────────────────┐│
                 │  │   Local Embeddings                  ││
                 │  │   sentence-transformers / nomic     ││
                 │  └─────────────────────────────────────┘│
                 │                                         │
                 │  ┌─────────────────────────────────────┐│
                 │  │   Vector Store                      ││
                 │  │   PostgreSQL + pgvector / Qdrant    ││
                 │  └─────────────────────────────────────┘│
                 └──────────────────┬──────────────────────┘
                                    │
                              Internal Network
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
    ┌─────▼─────┐            ┌─────▼─────┐            ┌─────▼─────┐
    │   Dev 1   │            │   Dev 2   │            │   Dev 3   │
    │           │            │           │            │           │
    │  Claude   │            │  Claude   │            │  Claude   │
    │   Code    │            │   Code    │            │   Code    │
    │    +      │            │    +      │            │    +      │
    │ MCP thin  │            │ MCP thin  │            │ MCP thin  │
    │  client   │            │  client   │            │  client   │
    └───────────┘            └───────────┘            └───────────┘
```

---

## Components

### 1. Central RAG Server (Agno)

Single server instance managing multiple knowledge bases.

```python
# Server supports multiple agents/knowledge bases
agents = {
    "react-docs": Agent(knowledge=react_kb, model=llm),
    "python-docs": Agent(knowledge=python_kb, model=llm),
    "internal-apis": Agent(knowledge=apis_kb, model=llm),
}
```

**Endpoints:**
```
GET  /agents                    # List available agents
POST /agents/{name}/runs        # Query an agent
POST /seed                      # Add documents to knowledge base
GET  /health                    # Health check
```

### 2. Private LLM

Self-hosted language model for generation.

**Options:**
| Provider | Models | Pros | Cons |
|----------|--------|------|------|
| **Ollama** | llama3, mistral, codellama | Easy setup | Single GPU |
| **vLLM** | Any HuggingFace model | Fast, production-grade | Complex setup |
| **LocalAI** | Multiple formats | OpenAI-compatible | Variable quality |
| **text-generation-inference** | HuggingFace models | Fast | Requires GPU |

**Recommended**: Ollama for small teams, vLLM for production scale.

### 3. Local Embeddings

Self-hosted embedding model for vector search.

**Options:**
| Model | Dimensions | Speed | Quality |
|-------|------------|-------|---------|
| `nomic-embed-text` | 768 | Fast | Good |
| `all-MiniLM-L6-v2` | 384 | Very fast | Decent |
| `bge-large-en` | 1024 | Slow | Excellent |
| `e5-large-v2` | 1024 | Slow | Excellent |

**Recommended**: `nomic-embed-text` via Ollama for simplicity.

### 4. Vector Store

Persistent storage for document embeddings.

**Options:**
| Store | Pros | Cons |
|-------|------|------|
| **PostgreSQL + pgvector** | Familiar, ACID, single DB | Slower at scale |
| **Qdrant** | Fast, purpose-built | Another service |
| **Milvus** | Enterprise features | Complex |
| **Weaviate** | GraphQL, hybrid search | Heavy |

**Recommended**: PostgreSQL + pgvector for simplicity, Qdrant for scale.

### 5. MCP Thin Client

Lightweight client that connects to central server.

```typescript
// Enterprise mode - just a thin client
class EnterpriseBackend implements Backend {
  constructor(private serverUrl: string, private agentName: string) {}

  async ask(question: string): Promise<AskResult> {
    const response = await fetch(`${this.serverUrl}/agents/${this.agentName}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question }),
    });
    const result = await response.json();
    return { answer: result.content };
  }
}
```

---

## Deployment

### Docker Compose (Simple)

```yaml
version: '3.8'

services:
  rag-server:
    image: docmole-server:latest
    ports:
      - "7777:7777"
    environment:
      - OLLAMA_HOST=http://ollama:11434
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/rag
    depends_on:
      - ollama
      - db

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  db:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=rag
    volumes:
      - pg_data:/var/lib/postgresql/data

volumes:
  ollama_data:
  pg_data:
```

### Kubernetes (Production)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rag-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: rag-server
  template:
    spec:
      containers:
        - name: rag-server
          image: docmole-server:latest
          ports:
            - containerPort: 7777
          env:
            - name: OLLAMA_HOST
              value: "http://ollama-service:11434"
          resources:
            requests:
              memory: "2Gi"
              cpu: "1"
            limits:
              memory: "4Gi"
              cpu: "2"
---
apiVersion: v1
kind: Service
metadata:
  name: rag-server
spec:
  selector:
    app: rag-server
  ports:
    - port: 7777
  type: ClusterIP
```

---

## Developer Setup

### 1. Install MCP (one-time)

```bash
# Via npm
npm install -g docmole

# Or via Claude Code
claude mcp add react-docs -- docmole connect --server http://rag.internal:7777 --agent react-docs
```

### 2. Configure via Environment

```bash
# .env or shell config
export MINTLIFY_MCP_SERVER=http://rag.internal:7777
```

### 3. Add to Claude Code

```json
{
  "mcpServers": {
    "react-docs": {
      "command": "docmole",
      "args": ["connect", "--server", "http://rag.internal:7777", "--agent", "react-docs"]
    },
    "python-docs": {
      "command": "docmole",
      "args": ["connect", "--server", "http://rag.internal:7777", "--agent", "python-docs"]
    }
  }
}
```

### 4. Centralized Config (Optional)

Distribute MCP config via internal package:

```bash
# Install company's MCP config
npm install @company/mcp-config

# Automatically configures all internal doc assistants
npx @company/mcp-config install
```

---

## Admin Operations

### Adding New Documentation

```bash
# From admin machine
docmole admin seed \
  --server http://rag.internal:7777 \
  --agent new-framework-docs \
  --url https://internal-docs.company.com/new-framework \
  --create-agent
```

### Updating Documentation

```bash
# Incremental update (only changed pages)
docmole admin update \
  --server http://rag.internal:7777 \
  --agent react-docs

# Full reseed
docmole admin seed \
  --server http://rag.internal:7777 \
  --agent react-docs \
  --force
```

### Monitoring

```bash
# Health check
curl http://rag.internal:7777/health

# List agents
curl http://rag.internal:7777/agents

# Metrics (if enabled)
curl http://rag.internal:7777/metrics
```

---

## Security Considerations

### Network

- RAG server on internal network only
- No external API calls
- mTLS between services (optional)

### Authentication

```typescript
// Option 1: API Key
headers: { 'Authorization': `Bearer ${API_KEY}` }

// Option 2: mTLS
// Client cert authentication

// Option 3: Internal SSO
// OAuth/OIDC integration
```

### Audit Logging

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "user": "dev@company.com",
  "agent": "internal-apis",
  "query": "How do I authenticate with the payments API?",
  "response_tokens": 450
}
```

---

## Cost Comparison

| Item | Cloud (OpenAI) | Self-Hosted |
|------|----------------|-------------|
| LLM | $0.15-15/1M tokens | GPU cost (~$500/mo) |
| Embeddings | $0.02/1M tokens | Included |
| Storage | Per-query cost | Fixed infra cost |
| **Break-even** | ~100K queries/mo | |

**Recommendation**: Self-hosted if >50K queries/month or data sensitivity requirements.

---

## Migration Path

### From Standalone to Enterprise

1. Export existing vectors (if any)
2. Deploy central server
3. Seed knowledge bases
4. Update developer MCP configs
5. Deprecate local setups

### Hybrid Mode

Run both modes during transition:

```json
{
  "mcpServers": {
    "react-docs-cloud": {
      "command": "docmole",
      "args": ["-p", "react"]
    },
    "react-docs-internal": {
      "command": "docmole",
      "args": ["connect", "--server", "http://rag.internal:7777", "--agent", "react-docs"]
    }
  }
}
```
