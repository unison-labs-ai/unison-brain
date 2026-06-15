# Unison Brain API — Specification

The HTTP contract the **Unison backend** implements and this open-source client
(SDK / CLI / MCP) speaks. It lives in the public client repo so integrators can
build against it directly.

Every operation here is something you can do with the brain — the API is the
product's primary surface; the CLI and SDK are clients of it.

> **🤖 AI agent?** This spec is the full API contract. To *start using* the brain,
> see [`AGENTS.md`](./AGENTS.md) — the four-step path to a working setup.

---

## 1. Design principles

- **Two abstractions, one brain.** The cortex is a **scope-only filesystem** —
  the writable roots are `/private/` (the default — only the caller sees it)
  and `/workspace/` (visible to the whole workspace); teams are a folder
  convention inside `/workspace/teams/<slug>/`. `/system/` (synthesized views)
  and `/sources/` (connector ingest, under `/private/sources/`) are **read-only**.
  *Where the agent writes is who sees it* — sharing is an explicit upgrade by
  qualifying the path. (The legacy roots `/wiki/` and `/skills/` are still
  accepted as a compatibility shim; `/actions/` and `/raw/` no longer exist —
  act via the SDK domain methods, not by writing files.) The cortex is also a
  **knowledge graph** (entities → bitemporal facts → links). The API exposes both.
- **Three surfaces, deliberately different breadth:**
  - **SDK** — *complete*. Every operation, typed. The reference surface.
  - **CLI** — *complete, ergonomic*. Grouped commands, for humans and shell agents.
  - **MCP** — *curated* (8 tools). Only what an agent should call; a small tool
    count keeps an agent's context lean.
- **The client enforces nothing; the server is the only security boundary.** The
  SDK/CLI/MCP attach the bearer token, send the request, and surface whatever the
  server returns. They never check scopes, validate paths, hide operations, or
  pre-authorize — an open-source client cannot be a security boundary, so it isn't
  one. Authentication, scope and permission enforcement, read-only-tier
  enforcement, workspace isolation, rate limiting, and content safety are all enforced
  **server-side** and are out of scope for this client contract.

## 2. Scope

**In scope:** the full brain — documents, entities, facts, links, dedup review,
job visibility, health.

**Out of scope (deliberately):**
- **Agent chat / sessions / streaming** — the AI-agent chat product is a separate, larger surface, not the brain.
- **Connector setup / ingest** (Gmail / Drive / Notion / Slack OAuth + ingest pipelines) — browser OAuth + workspace config; not CLI-shaped. Wiring up connections lives in client backends, not this repo.
- **Internal worker machinery** — embedding, signal promotion, reconcile/merge pipelines, compaction, ingest jobs. Encapsulated behind the job queue; they auto-run.
- **Visualization** — the 3D graph and inline-diff editor. The *data* behind them (`links`, `neighbors`, `entities`) is exposed; the canvas is not.
- **Local FS mirror** — the CLI verbs plus server-side search already give the filesystem feel with no daemon, staleness, or local copy.

---

## 3. Authentication

`Authorization: Bearer <token>` on every request except the unauthenticated
provisioning endpoints. The token is an API key (`usk_...`).

### How `unison auth login` works

Everything happens in the terminal — no browser required.

**Email-OTP (primary).** One command:

```
$ unison auth login
→ enter your email
→ if new: account + key created immediately; OTP sent for verification
→ if existing: recovery OTP sent; enter code → new key issued and stored
```

The account is usable immediately (unverified, with usage caps). Verifying the
emailed code lifts the caps and makes the account durable.

**CI / automation — API key.** `export UNISON_TOKEN=usk_...`; no interaction.
Keys are minted via `unison auth keys create` or the `auth_keys_create` MCP tool.

### Scopes

- `brain:read` — all GETs, key management, invitations
- `brain:write` — document write/delete/tag/share, entity upsert, fact record/correct/invalidate, link
- `brain:admin` — dedup review (merge/unmerge), job retry

A token lacking the required scope gets `403 forbidden`. The client never
pre-checks scopes — it sends the call and surfaces the result.

### Write constraints

Document paths must end in `.md`, and writes/deletes to read-only paths
(`/system/` and the ingest-only `/private/sources/`) return `403`; the writable
scopes are `/private/` and `/workspace/` (teams as `/workspace/teams/<slug>/`;
legacy roots `/wiki/` and `/skills/` are also accepted for compatibility). The client offers
write/delete/tag for any path and lets the server reject — it never hides or
blocks paths itself.

### Auth endpoints

**Email-OTP (unauthenticated — no token required):**
- `POST /v1/auth/provision` — body `{ email }` → `{ apiKey, workspaceId, status, emailSent, joinedExistingWorkspace? }`. Creates account + mints `usk_` key immediately (unverified). `409 email_registered` if the email already has an account — use `/request-key` instead. Joins an inviting workspace if a pending invitation exists.
- `POST /v1/auth/verify` — body `{ email, code }` → `{ verified, apiKey?, workspaceId }`. First-time: flips workspace durable; repeat (recovery): mints a new `usk_` key.
- `POST /v1/auth/request-key` — body `{ email }` → `{ status: "verification_sent" }`. Sends a recovery OTP to a verified account. Responds uniformly (does not leak whether the email is registered).

**Identity:**
- `GET /v1/auth/whoami` → `{ user: { id, email }, workspace: { id, name, verified }, scopes[], actedAs?: { externalId, userId } }`. `actedAs` is present when actor delegation is active.

**Key management (scope: `brain:read`):**
- `GET /v1/auth/keys` → `{ keys: ApiKeyRecord[] }`. Pass `?workspaceId=` to scope to a member workspace. Never returns key hashes.
- `POST /v1/auth/keys` — body `{ name?, scopes?, workspaceId? }` → `{ id, token, scopes, name, workspaceId }` `201`. Token returned once — store it. Requested scopes must be a subset of caller's scopes. `workspaceId` mints into a different member workspace.
- `DELETE /v1/auth/keys/:id` → `{ revoked: true, id, note? }`.

**Workspace membership (scope: `brain:read`):**
- `GET /v1/auth/workspaces` → `{ workspaces: [{ id, name, role, active }] }`. Lists all workspaces the caller is a member of; `active` marks the workspace the current key belongs to.

**Invitations (scope: `brain:read`; owner/admin only for write):**
- `POST /v1/auth/invitations` — body `{ email, role? }` → `{ invitation: InvitationRecord, emailSent }` `201`. Roles: `admin|member|viewer` (default: `member`).
- `GET /v1/auth/invitations` → `{ invitations: InvitationRecord[] }`. Lists pending invitations for the caller's workspace.
- `DELETE /v1/auth/invitations/:id` → `{ revoked: true, id }`.

**Actor delegation (scope: `brain:act-as`):**
- Add `X-Unison-Actor: <externalId>` header to any `/v1` request. The id must match `/^[A-Za-z0-9._:@-]{1,200}$/`.
- Requires the key to carry the `brain:act-as` scope (only grantable by workspace owner/admin via `POST /v1/auth/keys`).
- Shadow users are auto-created server-side on first use; `/private` scoping isolates each actor automatically.
- `GET /v1/auth/whoami` returns `actedAs: { externalId, userId }` when this header is present.

`ApiKeyRecord`: `{ id, name, keyPrefix, scopes[], createdAt, expiresAt|null, revokedAt|null }`.
`InvitationRecord`: `{ id, email, role, status, expiresAt, createdAt }`.
`WorkspaceMembershipRecord`: `{ id, name|null, role, active }`.

---

## 3b. Acting on behalf of end users (service keys)

This pattern mirrors mem0, Zep, and similar memory-layer SDKs: a single service key
manages memory for many end users without each needing their own Unison account.

**Setup:**

1. Workspace owner/admin mints a service key with `brain:act-as` scope:

```ts
const { token } = await client.keys.create({
  name: "my-service",
  scopes: ["brain:read", "brain:write", "brain:act-as"],
});
```

2. Use `withActor(userId)` to scope every call to a shadow user:

```ts
const serviceClient = new BrainClient({ apiUrl, token: serviceKey });

// Each end-user gets their own isolated /private namespace.
const u1 = serviceClient.withActor("user-001");
await u1.write({ path: "/private/notes/chat.md", bodyMd: "user said …" });

const u2 = serviceClient.withActor("user-002");
const results = await u2.search("what did I say?"); // isolated from user-001
```

3. CLI users can pass `--actor <id>` on brain commands, or set `UNISON_ACTOR` globally:

```bash
UNISON_ACTOR=user-001 unison search "what did I say?"
unison write /private/notes/x.md --actor user-001 -m "hello"
```

**Security note:** `brain:act-as` is a privileged scope. Only owner/admin accounts can
mint keys carrying it — regular members cannot grant it to themselves. Service keys
must be treated as secrets and rotated via `keys.revoke` + `keys.create` if compromised.

---

## 4. Conventions

- **Base URL:** `https://brain.unisonlabs.ai` (override with `UNISON_API_URL`; SDK constructor accepts `apiUrl` or legacy `baseUrl`).
- **Versioning:** all paths are prefixed `/v1`.
- **JSON, `camelCase`.** Document paths are passed as query params (they contain slashes).
- **Errors:** `{ "error": { "code": "snake_case", "message": "…" } }`. Codes:
  `unauthenticated` (401), `forbidden` (403, missing scope), `not_found` (404),
  `invalid_path` (400, malformed/non-`.md` path), `conflict` (409, content-hash
  mismatch), `rate_limited` (429), plus a generic `5xx` for server errors.
- **Optimistic concurrency:** `write` accepts `expectedContentHash` (hex16); a stale hash returns `409 conflict`.
- **Rate limiting:** per token; retry `429` responses with backoff.
- **Bitemporal time-travel:** `asOf` (datetime) on `search` / `doc` / `factsAbout` returns "what the brain knew as of then."

---

## 5. Resources

### 5.1 Documents (filesystem tier)

| Endpoint | Notes |
|---|---|
| `GET /v1/brain/search?q&k&kind*&tag*&memoryType&asOf&pathPrefix` | `k` 1–50 (def 10); `kind` ∈ wiki_page\|raw\|note\|log\|index; `memoryType` ∈ episodic\|semantic\|procedural\|auto; `pathPrefix` restricts results to documents under that path. Returns `{ results: RankedHit[] }`, each `{ doc, score, highlight?, sources[] }` — `doc` is a summary (no body) |
| `GET /v1/brain/grep?pattern&caseSensitive&limit` | regex over document bodies; `limit` 1–200 (def 50) |
| `GET /v1/brain/doc?path&asOf` | single document; `404 not_found` when missing |
| `GET /v1/brain/list?prefix&kind*&tag*&limit` | enumerate by prefix / kind / tag |
| `GET /v1/brain/fs?path` | directory listing (dir / file / mtime) |
| `GET /v1/brain/fs/read?path` | raw content of any tier, including read-only ones |
| `PUT /v1/brain/doc` | body: `path` (under a writable scope — `/private/` `/workspace/`, or legacy `/wiki/` `/skills/`; ends in `.md`), `kind` (def note), `title?`, `tldr?`, `bodyMd` (≤200k), `tags[]`, `visibility` workspace\|private, `expectedContentHash?`, `source?{kind,ref}` |
| `PUT /v1/brain/docs` | batch write: body `{ docs: WriteDocInput[] }` → `{ documents: BrainDocument[] }`. Each item has the same fields as `PUT /v1/brain/doc`. |
| `PATCH /v1/brain/doc` | body `{ path, oldStr, newStr, expectedContentHash? }` for a body edit (server-side str_replace, atomic + uniqueness-checked). Also accepts a metadata-only variant `{ path, title?, tldr?, tags? }` to rename/re-summarize/re-tag without touching the body. |
| `DELETE /v1/brain/doc?path` | delete a document |
| `POST /v1/brain/doc/tag` | body `{ path, add[], remove[] }` |
| `POST /v1/brain/share` | body `{ kind: doc\|fact\|entity, id }` → promote private → workspace |
| `GET /v1/brain/neighbors?idOrPath&kind*&limit` | `kind` ∈ mentions\|derived_from\|supersedes\|see_also; `limit` 1–100 (def 20) |

### 5.8 Context recall (`brain:read`)

One-call endpoint that fuses search hits, entity facts, and timeline events into
a single **prompt-ready `contextMd` block** — the fastest way to prime a caller's
LLM with the most relevant memory. The brain does **no** answer generation; the
caller's LLM composes the answer from `contextMd`.

| Endpoint | Notes |
|---|---|
| `GET /v1/brain/context?q&mode&k&maxEntities&pathPrefix&includeBodies` | `q` required; `mode` ∈ auto\|deep\|standard (def auto); `k` 1–50 (def 10); `maxEntities` 0–10 (def 3); `pathPrefix` scopes to a subtree; `includeBodies` inlines clipped doc bodies. |

Response shape:

```json
{
  "query": "string",
  "mode": "auto | deep | standard",
  "generatedAt": "ISO datetime",
  "topScore": 0.92,
  "weakEvidence": false,
  "hits": [{ "doc": BrainDocumentSummary, "score": 0.9, "highlight?": "…", "sources": ["bm25"|"vector"] }],
  "entities": [{ "entity": { "id", "kind", "slug", "displayName" }, "facts": BrainFact[], "timeline": BrainFact[] }],
  "contextMd": "## Memory\n\n…"
}
```

`weakEvidence` is `true` when `topScore < 0.5`, signalling that the brain has
little relevant content for the query — the caller should caveat or proceed with
less confidence.

### 5.9 Ingest (`brain:write`)

Batch endpoint to stream conversations or documents into the brain's memory
pipeline. Conversations are routed through the signal-extraction pipeline (entity
resolution + fact extraction). Documents are written as extractable notes.

| Endpoint | Notes |
|---|---|
| `POST /v1/brain/ingest` | body `{ items: IngestItem[] }`, 1–100 items per call |

`IngestItem` is a discriminated union:

```ts
// Conversation item
{
  type: "conversation";
  turns: { role: "user" | "assistant" | "system"; content: string; name?: string; }[];
  sourceRef: string;          // stable caller-side id (session / thread id)
  visibility?: "workspace" | "private";  // default "private"
  idempotencyKey?: string;
}

// Document item
{
  type: "document";
  content: string;
  title?: string;
  path?: string;              // brain path; auto-routed if omitted
  tags?: string[];
  visibility?: "workspace" | "private";
  sourceRef?: string;
}
```

Response:

```ts
{ items: (
  | { type: "conversation"; jobId: string }
  | { type: "document"; docId: string; path: string; jobIds: string[] }
)[] }
```

### 5.2 Entities (graph)

| Endpoint | Notes |
|---|---|
| `GET /v1/brain/entities?kind*&status&limit` | `status` ∈ active\|stub\|archived |
| `GET /v1/brain/entities/resolve?name&kindHint` | exact, then fuzzy + alias match → `{ entity: BrainEntity \| null }` |
| `GET /v1/brain/entities/:id` | get one entity by id |
| `POST /v1/brain/entities` | upsert; body `{ kind, displayName, slug?, aliases[], props{}, status }` |

### 5.3 Facts (bitemporal)

| Endpoint | Notes |
|---|---|
| `GET /v1/brain/facts?limit&includeInvalidated` | browse all facts |
| `GET /v1/brain/entities/:id/facts?asOf&includeInvalidated` | facts about one entity |
| `GET /v1/brain/entities/:id/timeline?from&to` | chronological |
| `POST /v1/brain/facts` | `{ subjectId, predicate, factText, objectJson?, objectEntityId?, validFrom?, validTo?, confidence (0–1, def .6), supersedesId? }` |
| `PATCH /v1/brain/facts/:id` | supersede with corrected fields |
| `DELETE /v1/brain/facts/:id` | soft invalidate (sets `validTo = now`) |

### 5.4 Links (graph edges)

| Endpoint | Notes |
|---|---|
| `GET /v1/brain/links?limit` | all directed edges `{ fromId, toId, kind }` |
| `POST /v1/brain/links` | body `{ fromId, toId, kind }` |

### 5.5 Dedup review (`brain:admin`)

| Endpoint | Notes |
|---|---|
| `GET /v1/brain/review/conflicts` | pending merge pairs + reasoning + exemplars |
| `POST /v1/brain/review/conflicts/:id` | body `{ verdict: merge\|distinct }` |
| `GET /v1/brain/review/merges?limit` | recent merges (undo feed) |
| `POST /v1/brain/review/merges/:id/undo` | enqueue an unmerge |

### 5.6 Jobs (`brain:admin`)

| Endpoint | Notes |
|---|---|
| `GET /v1/brain/jobs?status&kind&limit` | queue visibility |
| `GET /v1/brain/jobs/stats` | counts by status |
| `POST /v1/brain/jobs/:id/retry` | re-queue a failed job |

### 5.7 Status

| Endpoint | Returns |
|---|---|
| `GET /v1/brain/status` | `{ docCount, docWithEmbedding, entityCount, factCount, lastIngestAt, pendingJobs, staleWikiPageCount }` |

---

## 6. Surface mapping — REST → CLI → SDK → MCP

MCP column: ✓ = exposed as an agent tool; — = SDK/CLI only.

| Operation | CLI | SDK method | MCP |
|---|---|---|---|
| context recall | `unison context "<q>" [--deep --k --max-entities --path-prefix --include-bodies --json]` | `brain.context()` | ✓ `brain_context` |
| migration in/out | `unison migrate` (wizard) / `migrate markdown\|json`, `unison export <dir>` | `brain.writeDocs()` / `brain.list()` | — (client-side, no new endpoints) |
| ingest | `unison ingest [--file --conversation --source-ref --visibility]` | `brain.ingest()` | ✓ `brain_ingest` |
| batch write docs | — | `brain.writeDocs()` | — |
| patch doc metadata | — | `brain.patchDocMeta()` | — |
| search | `unison search <q> [-k --kind --tag --memory-type --as-of --path-prefix]` | `brain.search()` | ✓ `brain_search` |
| grep | `unison grep <pattern> [--case-sensitive]` | `brain.grep()` | — |
| read doc | `unison get <path> [--json --as-of]` (alias `cat`) | `brain.get()` | ✓ `brain_get` |
| list docs | `unison ls [path] [--docs --kind --tag]` | `brain.list()` | ✓ `brain_list` |
| fs tree / raw | `unison tree [path]` / `unison get --raw <path>` | `brain.listFs()` / `brain.readFs()` | — |
| find by glob | `unison find <glob>` | `brain.list()` | — |
| write doc | `unison write <path> [-m --title --tldr --tag --visibility --if-match]` | `brain.write()` | ✓ `brain_write` |
| delete doc | `unison rm <path>` | `brain.delete()` | — |
| tag doc | `unison tag <path> [--add --remove]` | `brain.tag()` | — |
| share | `unison share <doc\|fact\|entity> <id>` | `brain.share()` | — |
| neighbors | `unison neighbors <idOrPath>` | `brain.neighbors()` | — |
| list entities | `unison entity ls [--kind --status]` | `brain.entities.list()` | — |
| resolve entity | `unison entity resolve <name>` | `brain.entities.resolve()` | ✓ `brain_resolve_entity` |
| get entity | `unison entity get <id>` | `brain.entities.get()` | — |
| upsert entity | `unison entity set <kind> <name> [--alias --prop]` | `brain.entities.upsert()` | — |
| list facts | `unison fact ls [--all]` | `brain.facts.list()` | — |
| facts about | `unison fact ls --entity <id>` | `brain.facts.about()` | ✓ `brain_facts_about` |
| timeline | `unison timeline <entityId> [--from --to]` | `brain.facts.timeline()` | — |
| record fact | `unison fact add <entityId> <predicate> <text> [--confidence]` | `brain.facts.record()` | ✓ `brain_record_fact` |
| correct fact | `unison fact correct <factId> […]` | `brain.facts.correct()` | — |
| invalidate fact | `unison fact rm <factId>` | `brain.facts.invalidate()` | — |
| list links | `unison links` | `brain.links.list()` | — |
| create link | `unison link <fromId> <toId> --kind <k>` | `brain.links.create()` | — |
| review conflicts | `unison review ls` | `brain.review.conflicts()` | — |
| resolve match | `unison review merge\|distinct <id>` | `brain.review.resolve()` | — |
| recent merges | `unison review merges` | `brain.review.merges()` | — |
| unmerge | `unison review undo <mergeId>` | `brain.review.undo()` | — |
| jobs | `unison jobs ls [--status] \| jobs stats \| jobs retry <id>` | `brain.jobs.*()` | — |
| status | `unison status` | `brain.status()` | ✓ `brain_status` |
| auth | `unison auth login\|logout\|status` | `createKey()` / `listKeys()` / `revokeKey()` | — |

MCP tool set: the brain tools — `brain_context`, `brain_ingest`,
`brain_search`, `brain_get`, `brain_list`, `brain_write`, `brain_edit`,
`brain_resolve_entity`, `brain_facts_about`, `brain_record_fact`, `brain_status`.

---

## 7. Availability

The hosted brain is live at `https://brain.unisonlabs.ai` — the default base URL for
the SDK, CLI, and MCP server. To target a different backend, override with
`UNISON_API_URL`, or
`unison auth login --api-url <url>`.
