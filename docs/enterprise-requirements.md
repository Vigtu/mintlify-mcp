# Enterprise Requirements

Security, compliance, and data governance requirements for enterprise deployments.

## Data Sovereignty

### The Core Requirement

**Enterprise documentation often contains sensitive information that cannot leave the corporate network.**

Examples of sensitive content:
- Internal API specifications
- Authentication flows and secrets patterns
- Infrastructure architecture details
- Proprietary algorithms and business logic
- Customer data handling procedures
- Security policies and procedures

### Solution: Complete Air-Gap Capability

```
┌─────────────────────────────────────────────────────────┐
│                   Corporate Network                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │              RAG Server Stack                     │  │
│  │                                                    │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │  │
│  │  │ Agno Server │  │ Local LLM   │  │ pgvector │ │  │
│  │  │   :7777     │  │ (Ollama)    │  │   DB     │ │  │
│  │  │             │  │   :11434    │  │  :5432   │ │  │
│  │  └─────────────┘  └─────────────┘  └──────────┘ │  │
│  │                                                    │  │
│  │  ┌─────────────────────────────────────────────┐ │  │
│  │  │         Local Embeddings Model              │ │  │
│  │  │      (nomic-embed-text via Ollama)          │ │  │
│  │  └─────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────┘  │
│                           │                             │
│                    No external calls                    │
│                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │  Dev 1  │  │  Dev 2  │  │  Dev 3  │  │  Dev N  │   │
│  │ Claude  │  │ Claude  │  │ Claude  │  │ Claude  │   │
│  │  Code   │  │  Code   │  │  Code   │  │  Code   │   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
                           ╳
                    No data egress
                           ╳
              ┌─────────────────────────┐
              │     Public Internet      │
              │  (OpenAI, Mintlify, etc) │
              └─────────────────────────┘
```

### Data Flow Guarantees

| Component | Data Location | External Calls |
|-----------|---------------|----------------|
| Documentation content | Internal DB | None |
| Vector embeddings | Internal DB | None |
| LLM inference | Internal server | None |
| Query logs | Internal logs | None |
| User questions | Internal only | None |

---

## Compliance Requirements

### SOC 2

| Control | How Addressed |
|---------|---------------|
| Access Control | API key / mTLS / SSO integration |
| Audit Logging | All queries logged with user, timestamp, content |
| Data Encryption | TLS in transit, encryption at rest |
| Change Management | Version-controlled configs, deployment pipelines |

### HIPAA (Healthcare)

| Requirement | Implementation |
|-------------|----------------|
| PHI Protection | No PHI in queries (policy + monitoring) |
| Access Logging | Full audit trail |
| Minimum Necessary | Role-based access to doc sets |
| BAA Coverage | Self-hosted = no BAA needed with vendors |

### GDPR (EU)

| Requirement | Implementation |
|-------------|----------------|
| Data Residency | Deploy in EU region |
| Right to Erasure | Clear user query history on request |
| Purpose Limitation | Docs only, no secondary use |
| Data Minimization | No PII stored beyond audit logs |

### Financial Services (SOX, PCI-DSS)

| Requirement | Implementation |
|-------------|----------------|
| Segregation of Duties | Separate admin/user roles |
| Audit Trail | Immutable query logs |
| Access Reviews | Integration with IAM systems |
| Encryption | AES-256 at rest, TLS 1.3 in transit |

---

## Authentication & Authorization

### Authentication Options

```typescript
// Option 1: API Key (Simple)
headers: { 'Authorization': `Bearer ${API_KEY}` }

// Option 2: mTLS (High Security)
// Client certificate authentication

// Option 3: SSO Integration (Enterprise Standard)
// OAuth 2.0 / OIDC with corporate IdP
```

### Authorization Model

```yaml
# Role-based access to documentation sets
roles:
  - name: "platform-team"
    access:
      - "platform-docs"
      - "infrastructure-docs"
      - "api-docs"

  - name: "frontend-team"
    access:
      - "react-docs"
      - "design-system-docs"
      - "api-docs"

  - name: "all-engineers"
    access:
      - "onboarding-docs"
      - "general-guidelines"
```

### SSO Integration

| IdP | Integration Method |
|-----|-------------------|
| Okta | OIDC / SAML 2.0 |
| Azure AD | OIDC / SAML 2.0 |
| Google Workspace | OIDC |
| Auth0 | OIDC |
| Custom LDAP | LDAP bind |

---

## Audit Logging

### Log Schema

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "event_type": "query",
  "user": {
    "id": "user-123",
    "email": "dev@company.com",
    "groups": ["platform-team"]
  },
  "request": {
    "agent": "internal-apis",
    "question": "How do I authenticate with the payments API?",
    "session_id": "sess-abc123"
  },
  "response": {
    "tokens_used": 450,
    "latency_ms": 1200,
    "sources": ["api-auth.md", "payments-guide.md"]
  },
  "metadata": {
    "client_ip": "10.0.1.50",
    "user_agent": "claude-code/1.0"
  }
}
```

### Log Retention

| Log Type | Retention | Storage |
|----------|-----------|---------|
| Query logs | 90 days | Hot storage |
| Audit logs | 7 years | Cold storage |
| Error logs | 30 days | Hot storage |
| Metrics | 1 year | Time-series DB |

### Log Integration

```yaml
# Export to enterprise logging systems
logging:
  exports:
    - type: "splunk"
      endpoint: "https://splunk.internal:8088"
      token: "${SPLUNK_HEC_TOKEN}"

    - type: "datadog"
      api_key: "${DD_API_KEY}"

    - type: "elasticsearch"
      endpoint: "https://elk.internal:9200"
```

---

## High Availability

### Architecture

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │   (internal)    │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │ RAG Server  │   │ RAG Server  │   │ RAG Server  │
    │  Replica 1  │   │  Replica 2  │   │  Replica 3  │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
           └─────────────────┼─────────────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │   (Primary)     │
                    │   + pgvector    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │   (Replica)     │
                    └─────────────────┘
```

### SLA Targets

| Metric | Target |
|--------|--------|
| Availability | 99.9% (8.76 hrs downtime/year) |
| Response time (p50) | < 500ms |
| Response time (p99) | < 2s |
| Recovery time (RTO) | < 15 minutes |
| Data loss (RPO) | < 1 minute |

---

## Deployment Options

### Docker Compose (Small Teams)

```yaml
version: '3.8'
services:
  rag-server:
    image: docmole-server:latest
    ports: ["7777:7777"]
    environment:
      - OLLAMA_HOST=http://ollama:11434
      - DATABASE_URL=postgresql://postgres:pass@db:5432/rag

  ollama:
    image: ollama/ollama:latest
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  db:
    image: pgvector/pgvector:pg16
```

### Kubernetes (Production)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rag-server
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: rag-server
          resources:
            requests:
              memory: "2Gi"
              cpu: "1"
            limits:
              memory: "4Gi"
              cpu: "2"
```

### Terraform (Infrastructure as Code)

```hcl
module "mintlify_mcp" {
  source = "github.com/company/terraform-docmole"

  cluster_name    = "rag-cluster"
  replicas        = 3
  gpu_type        = "nvidia-t4"
  db_instance     = "db.r5.large"

  vpc_id          = var.vpc_id
  subnet_ids      = var.private_subnet_ids
}
```

---

## Network Security

### Network Segmentation

```
┌─────────────────────────────────────────────────────┐
│                    VPC / VNET                        │
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │            Private Subnet (RAG)              │   │
│  │                                               │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐     │   │
│  │  │   RAG   │  │  Ollama │  │   DB    │     │   │
│  │  │ Server  │  │         │  │         │     │   │
│  │  └─────────┘  └─────────┘  └─────────┘     │   │
│  │                                               │   │
│  └─────────────────────────────────────────────┘   │
│                         │                           │
│              Security Group: internal only          │
│                         │                           │
│  ┌─────────────────────────────────────────────┐   │
│  │           Private Subnet (Devs)              │   │
│  │                                               │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐     │   │
│  │  │  Dev 1  │  │  Dev 2  │  │  Dev 3  │     │   │
│  │  └─────────┘  └─────────┘  └─────────┘     │   │
│  │                                               │   │
│  └─────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Firewall Rules

| Source | Destination | Port | Protocol | Allow |
|--------|-------------|------|----------|-------|
| Dev subnet | RAG server | 7777 | TCP | Yes |
| RAG server | Ollama | 11434 | TCP | Yes |
| RAG server | PostgreSQL | 5432 | TCP | Yes |
| Any | Any | Any | Any | Deny |

---

## Disaster Recovery

### Backup Strategy

| Component | Backup Frequency | Retention | Method |
|-----------|------------------|-----------|--------|
| PostgreSQL | Every 6 hours | 30 days | pg_dump + S3 |
| Vector data | Daily | 7 days | LanceDB export |
| Configs | On change | Forever | Git |

### Recovery Procedures

```bash
# 1. Restore PostgreSQL
pg_restore -d rag /backups/rag-latest.dump

# 2. Rebuild vectors (if needed)
docmole admin seed --server http://localhost:7777 --all --force

# 3. Verify
curl http://localhost:7777/health
```

---

## Cost Model

### Infrastructure Costs (Self-Hosted)

| Component | Specification | Monthly Cost |
|-----------|--------------|--------------|
| GPU Server | 1x NVIDIA T4 | ~$300-500 |
| Database | PostgreSQL (managed) | ~$50-100 |
| Storage | 100GB SSD | ~$10 |
| Network | Internal only | ~$0 |
| **Total** | | **~$400-600/mo** |

### Cost Comparison

| Query Volume | OpenAI API | Self-Hosted | Winner |
|--------------|------------|-------------|--------|
| 10K/month | $100 | $500 | Cloud |
| 50K/month | $500 | $500 | Tie |
| 100K/month | $1,000 | $500 | Self-hosted |
| 500K/month | $5,000 | $500 | Self-hosted |

**Break-even point**: ~50,000 queries/month

---

## Implementation Checklist

### Pre-Deployment

- [ ] Security review of architecture
- [ ] Network segmentation approved
- [ ] SSO integration configured
- [ ] Audit logging requirements defined
- [ ] Backup/DR procedures documented
- [ ] Compliance requirements mapped

### Deployment

- [ ] Infrastructure provisioned (Terraform/K8s)
- [ ] SSL certificates installed
- [ ] Firewall rules configured
- [ ] Monitoring/alerting set up
- [ ] Initial documentation seeded
- [ ] Load testing completed

### Post-Deployment

- [ ] User access provisioned
- [ ] Training completed
- [ ] Runbooks documented
- [ ] On-call rotation established
- [ ] First compliance audit scheduled
