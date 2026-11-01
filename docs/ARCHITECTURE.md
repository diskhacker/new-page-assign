# Code Intelligence Architecture

**Status:** Proposed; implementation unverified.

```mermaid
flowchart TD
  UI[React UI] --> API[Node API]
  API --> AUTH[Server authorization]
  AUTH --> CACHE[Versioned semantic request-response cache]
  CACHE -->|Validated hit| RESULT[Grounded response]
  CACHE -->|Miss| RET[Hybrid retrieval]
  RET --> GRAPH[(CodeGraph relationship index)]
  RET --> VECTOR[(Vector index)]
  RET --> SOURCE[Git source at commit SHA]
  GRAPH --> EVID[Bounded evidence]
  VECTOR --> EVID
  SOURCE --> EVID
  EVID --> LLM[LLM]
  LLM --> VALID[Validate citations]
  VALID -->|Pass| CACHE
  VALID -->|Fail| ERROR[Safe failure]
```

## Indexing

```mermaid
flowchart LR
  GIT[Git commit] --> PARSER[Existing CodeGraph analyzer]
  PARSER --> EDGES[Symbols, imports, calls]
  PARSER --> CHUNKS[Source chunks]
  EDGES --> GRAPH[(Graph index)]
  CHUNKS --> EMB[Embedding model]
  EMB --> VECTOR[(Vector index)]
```

## Source of truth

- Git commit: authoritative source.
- CodeGraph relationships: derived, rebuildable index.
- Vector embeddings: derived, rebuildable index.
- Semantic request-response cache: derived, versioned, bounded, invalidatable.
- Authentication and authorization: server authority, checked before cache access.

## Cache contract

Partition by tenant, repository, commit SHA, authorized scope, embedding version and answer-policy version. An exact cache match may reuse a validated answer. A semantically similar match requires independent equivalence and evidence validation; similarity alone is insufficient. TTL, capacity, eviction and invalidation are mandatory. Reject reuse when revision, access, evidence or policy changes.

## Request sequence

```mermaid
sequenceDiagram
  participant UI
  participant API
  participant Cache
  participant Retrieval
  participant LLM
  UI->>API: Question, repository, commit
  API->>API: Authenticate and authorize
  API->>Cache: Version-scoped lookup
  alt Validated hit
    Cache-->>API: Answer with evidence
  else Miss or invalid
    API->>Retrieval: Graph + vector + source
    Retrieval-->>API: Bounded evidence
    API->>LLM: Grounded prompt
    LLM-->>API: Candidate answer
    API->>API: Validate paths and lines
    opt Validation succeeds
      API->>Cache: Store with TTL
    end
  end
  API-->>UI: Answer or safe failure
```

## Acceptance gates — UNVERIFIED

1. First query retrieves evidence and generates a validated answer.
2. Identical repeat uses cache without another LLM call.
3. Equivalent wording only reuses evidence-valid results.
4. Changed commit or revoked access rejects stale cache.
5. Unsupported citations fail safely.
6. Bounded storage, eviction and cache-outage fallback are tested.

## Scope and costs

One-day prototype target: one sample repository, basic graph relationships, vector search, semantic cache, grounded explanation and minimal React UI. Defer incremental indexing, distributed scaling and multi-repository administration. Runtime costs include embedding/index storage and LLM calls on cache misses. Maintenance centers on index versioning and invalidation. Database choice and dependency weight remain unverified. **Explicit approval required** before adding a database dependency or changing architecture.

The graph and vector databases represent *logical capabilities*, not necessarily separate products. Verify existing database functionality before choosing a new one.
