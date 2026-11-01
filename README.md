# Code Documentation Assistant — assignment proof

**Option 2** from the AI FDE assignment. Standalone React + TypeScript UI and Node.js backend. This is a proof-of-concept, not a production service.

## Setup and run

Node.js 20+ and npm required.

```sh
cd server
npm install
npm start
```

In another terminal:

```sh
cd web
npm install
npm run dev
```

Open **http://127.0.0.1:5173**, upload a **ZIP of JS/TS source**, wait for indexing, and ask questions. The server accepts ZIPs up to 5 MiB compressed. It does not accept remote GitHub URLs. A new browser session starts with no codebase context.

Optional LLM: set backend environment variables `LLM_BASE_URL` (OpenAI-compatible base ending in `/v1`), `LLM_API_KEY`, `LLM_MODEL`. Without these, the app returns relevant source references but not an AI explanation. Never put credentials in `web/`.

## Core implemented

- ZIP upload through React; bounded server-side decoding with fflate.
- Session-scoped in-memory CodeGraph: symbols, imports and heuristic possible-call edges.
- Lexical graph-assisted retrieval and server-generated file/line references.
- Optional LLM explanation using bounded retrieved code context.
- Session-local exact request-response cache (50 entries); idle expiry after 30 minutes.
- End-session action discards indexed source, graph and cache; process restart also discards them.

## Final proof (execute before submitting)

```sh
cd server && npm test
cd ../web && npm run build
```

Manual proof: upload sample ZIP; ask a symbol question; repeat to observe cache hit; end session; verify chat is disabled until another upload. **Tests/build are not claimed as passed until executed.**

## Architecture, tradeoffs and productionization

See [deep architecture and Mermaid diagrams](docs/IMPLEMENTATION-AND-DESIGN.md). Earlier [architecture proposal](docs/ARCHITECTURE.md) describes the planned hybrid vector/graph/semantic-cache direction, **not** the implemented proof. The proof uses an in-memory graph and exact cache. No vector DB, graph DB, embeddings, MCP or true semantic cache exists in runtime.

The intended future architecture includes AST CodeGraph indexing, hybrid graph/vector retrieval, versioned semantic cache, authz, sandboxed ZIP processing, observability, managed queues and cloud deployment. These are design-only, not hidden dependencies.

## Engineering standards and omissions

One session owns source, graph and cached answers. Backend validates archive limits and owns citations. The prototype binds to loopback; no persistent code storage. Skipped full parser correctness, auth, worker isolation and deployment because the assignment prioritizes an end-to-end working slice. ZIP source may contain prompt injection; do not upload secrets. A generated explanation is not independently verified against source semantics.

## AI tool usage

AI assistance was used to draft code and architecture. Review the code and run final proof tests before treating the result as correct. Record screenshots from a real running browser, not mockups. The engineering decisions and tradeoffs should be checked and adapted by the submitter rather than presented as independently validated.
