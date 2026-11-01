# Codebase Explorer — one-day assignment prototype

Standalone React UI and Node.js API for source-grounded code explanations. This is **not** a product or a VS Code extension.

## Run

Requirements: Node.js 20+ and npm. No database needed for the implemented slice.

```sh
# Terminal 1: from repository root
REPO_ROOT="$PWD/server" node server/index.mjs
# Terminal 2
cd web && npm install && npm run dev
```

Open http://127.0.0.1:5173. Click **Index repository**, then ask a question. The default sample is the server source itself; set `REPO_ROOT` to an authorized local JS/TS project for another codebase. Do not point it at untrusted or sensitive source trees. Only local access is supported.

Optional OpenAI-compatible LLM endpoint (server-side environment only): `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Without it the app returns retrieval evidence, not a generated explanation. Never expose the key in frontend configuration.

## Implemented

- Local JS/TS source scanning (file count and size bounds; symlinks skipped).
- Lightweight symbols/import extraction and lexical evidence ranking.
- Bounded context to optional LLM; server-supplied file/line citations.
- Revision-scoped **exact** request-response cache (100 entries, 10-minute TTL, cleared on reindex).
- React chat UI, status, error handling, source references.
- Node test runner: `REPO_ROOT="$PWD/server" node --test server/index.test.mjs`.

## Not implemented

Graph DB, vector DB, embeddings, semantic similarity cache, MCP integration, full CodeSight graph reuse, commit-based indexing, multi-user authorization, production observability, and robust semantic citation verification. See [architecture](docs/ARCHITECTURE.md) for the intended design. This partial implementation must not be represented as having those features.

## Design tradeoffs

Lexical retrieval is a minimal executable slice and may miss conceptual matches. Regex extraction is not an AST and does not establish accurate call graphs. Cache key includes a hash of indexed source; it does not assert semantic equivalence. Source citations are selected from retrieved files, not invented by the LLM, but the explanation is not independently fact-checked. No untrusted remote repository cloning is provided.

## Productionization

Use a real parser and graph index, embedding search, version-aware semantic cache with evidence validation, repository-level authz, job isolation, incremental indexing, structured logs, tracing, request quotas and citation checks. Evaluate these before adopting additional services.

## AI-assisted development

Architecture and implementation drafted with AI assistance; tests must be executed and reported separately. AI output is not proof of correctness.
