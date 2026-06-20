# Unison SDK — agent method reference (v1.7.0)

Generated from the `@unisonlabs/sdk` type declarations. Call the brain
through the SDK, never by hand-rolling `fetch()` to `/v1/…` paths:

```ts
import { BrainClient } from "@unisonlabs/sdk";
const u = new BrainClient({ baseUrl: Deno.env.get("UNISON_API_URL"), token: Deno.env.get("UNISON_TOKEN") });
```

## brain

Documents + filesystem on the brain — called directly on the client.

### `u.search`

```ts
search(query: string, opts?: SearchOptions): Promise<SearchResult[]>
```

`opts?` (`SearchOptions`):
- `limit?: number`
- `kinds?: DocKind[]`
- `tags?: string[]`
- `memoryType?: MemoryType`
- `asOf?: string`
- `pathPrefix?: string` — Restrict results to documents under this path prefix (e.g. "/private/notes").

### `u.grep`

```ts
grep(pattern: string, opts?: GrepOptions): Promise<BrainDocument[]>
```

`opts?` (`GrepOptions`):
- `caseSensitive?: boolean`
- `limit?: number`

### `u.get`

```ts
get(path: string): Promise<BrainDocument>
```

### `u.list`

```ts
list(opts?: ListOptions): Promise<BrainDocument[]>
```

`opts?` (`ListOptions`):
- `prefix?: string`
- `kinds?: DocKind[]`
- `tags?: string[]`
- `limit?: number`

### `u.listFs`

```ts
listFs(path?: string): Promise<FsEntry[]>
```

### `u.getRaw`

```ts
getRaw(path: string): Promise<{ content: string | null; path: string; }>
```

### `u.write`

```ts
write(input: WriteInput): Promise<BrainDocument>
```

`input` (`WriteInput`):
- `path: string`
- `bodyMd: string`
- `kind?: DocKind`
- `title?: string`
- `tldr?: string`
- `tags?: string[]`
- `visibility?: Visibility`
- `expectedContentHash?: string`
- `source?: { kind: string; ref: string; }`

### `u.editDoc`

```ts
editDoc(input: { path: string; oldStr: string; newStr: string; expectedContentHash?: string; }): Promise<BrainDocument>
```

Surgical in-place edit, mirroring Claude Code's `Edit`: replace an exact
`oldStr` with `newStr`. `oldStr` must match the document body exactly once,
or the edit refuses (add surrounding context to disambiguate).

Routes to `PATCH /brain/doc`, which performs the match + replace
server-side inside the write transaction — atomic and uniqueness-checked,
so there is no racy client read-modify-write and metadata is preserved.
Pass `expectedContentHash` for optimistic-concurrency on hot docs.

### `u.context`

```ts
context(opts: ContextOptions): Promise<ContextResult>
```

One-call recall — fetch the most relevant memory for a natural-language
query and get back a prompt-ready `contextMd` block.

The brain does NO answer generation. Pass `contextMd` verbatim into your
system prompt or user turn; the caller's LLM composes the answer.

Scope: `brain:read`.

`opts` (`ContextOptions`):
- `query: string` — Natural-language question to recall context for.
- `mode?: ContextMode` — Retrieval depth: auto (default) = the server decides; deep = multi-hop graph expansion; standard = single-pass vector.
- `k?: number` — Max semantic hits to return (1–50, default 10).
- `maxEntities?: number` — Max entity summaries to include (0–10, default 3).
- `pathPrefix?: string` — Scope retrieval to a path subtree, e.g. "/private/notes/".
- `includeBodies?: boolean` — Inline full (clipped) document bodies into contextMd — for single-shot readers that won't follow up with reads.

### `u.ingest`

```ts
ingest(input: IngestInput): Promise<IngestResult>
```

Stream conversations or documents into the brain's memory pipeline.

Conversations are routed through the signal-extraction pipeline and produce
entities + facts. Documents are written as extractable notes.

Scope: `brain:write`.

`input` (`IngestInput`):
- `items: IngestItem[]` — 1–100 items per call.

### `u.remember`

```ts
remember(input: RememberInput): Promise<RememberResult>
```

"Remember" a dump (a Claude Code session, a conversation, or freeform text)
exactly the way the `/remember` skill does after a session: it applies the
save-or-skip filter, dedupes against existing notes, and files curated
`/private/kb` notes + entity facts. Runs as a background job — poll
`jobs.get(jobId)` for status.

Scope: `brain:write`.

`input` (`RememberInput`):
- `dump: RememberDump` — What to remember — the same behavior as the `/remember` skill.
- `source?: string` — Provenance label, e.g. "claude-code-session" | "meeting".
- `sourceRef?: string` — Stable id → idempotent re-remember (same dump is a no-op).
- `hints?: string` — Optional steering, e.g. "focus on decisions".

### `u.writeDocs`

```ts
writeDocs(docs: WriteDocInput[]): Promise<BrainDocument[]>
```

Batch write multiple documents in a single call.
Equivalent to calling `write()` on each document but with one round-trip.

Scope: `brain:write`.

`docs` (`WriteDocInput[]`):
- `path: string`
- `bodyMd: string`
- `kind?: DocKind`
- `title?: string`
- `tldr?: string`
- `tags?: string[]`
- `visibility?: Visibility`
- `expectedContentHash?: string`

### `u.patchDocMeta`

```ts
patchDocMeta(input: EditDocMetaInput): Promise<BrainDocument>
```

Patch metadata (title, tldr, tags) on an existing document without
touching its body. Accepts both the full edit-doc form (oldStr/newStr)
and a metadata-only form — pass `title`, `tldr`, or `tags` to update
metadata only.

The oldStr/newStr form is unchanged: use `editDoc()` for body edits.
Use this overload when you only need to rename, re-summarize, or re-tag.

Scope: `brain:write`.

`input` (`EditDocMetaInput`):
- `path: string`
- `title?: string`
- `tldr?: string`
- `tags?: string[]`

### `u.delete`

```ts
delete(path: string): Promise<{ deleted: boolean; }>
```

### `u.tag`

```ts
tag(path: string, input: TagInput): Promise<BrainDocument>
```

`input` (`TagInput`):
- `add?: string[]`
- `remove?: string[]`

### `u.share`

```ts
share(kind: ShareKind, id: string): Promise<{ shared: boolean; }>
```

### `u.neighbors`

```ts
neighbors(idOrPath: string, opts?: NeighborsOptions): Promise<BrainDocument[]>
```

`opts?` (`NeighborsOptions`):
- `kinds?: LinkKind[]`
- `limit?: number`

### `u.status`

```ts
status(): Promise<BrainStatus>
```

### `u.whoami`

```ts
whoami(): Promise<WhoAmI>
```

### `u.withActor`

```ts
withActor(externalId: string | null | undefined): BrainClient
```

Return a derived client that sends `X-Unison-Actor: <externalId>` on every
request. The key must carry the `brain:act-as` scope. Shadow users are
auto-created server-side; `/private` scoping isolates actors automatically.

Pass `null` or `undefined` to clear the actor (return a client without
the header).

Throws synchronously if `externalId` is non-null and fails the format check.

## entities

Knowledge-graph entities (people, companies, projects, …).

### `u.entities.list`

```ts
list(opts?: ListEntitiesOptions): Promise<BrainEntity[]>
```

`opts?` (`ListEntitiesOptions`):
- `kinds?: string[]`
- `status?: EntityStatus`
- `limit?: number`

### `u.entities.resolve`

```ts
resolve(name: string, kindHint?: EntityKind): Promise<BrainEntity | null>
```

### `u.entities.get`

```ts
get(id: string): Promise<BrainEntity>
```

### `u.entities.upsert`

```ts
upsert(input: UpsertEntityInput): Promise<BrainEntity>
```

`input` (`UpsertEntityInput`):
- `kind: EntityKind`
- `displayName: string`
- `slug?: string`
- `aliases?: string[]`
- `props?: Record<string, unknown>`
- `status?: EntityStatus`

## facts

Bitemporal facts about entities.

### `u.facts.list`

```ts
list(opts?: { limit?: number; includeInvalidated?: boolean; }): Promise<BrainFact[]>
```

### `u.facts.about`

```ts
about(entityId: string, opts?: FactsAboutOptions): Promise<BrainFact[]>
```

`opts?` (`FactsAboutOptions`):
- `asOf?: string`
- `includeInvalidated?: boolean`

### `u.facts.timeline`

```ts
timeline(entityId: string, opts?: TimelineOptions): Promise<BrainFact[]>
```

`opts?` (`TimelineOptions`):
- `from?: string`
- `to?: string`

### `u.facts.record`

```ts
record(input: RecordFactInput): Promise<BrainFact>
```

`input` (`RecordFactInput`):
- `subjectId: string`
- `predicate: string`
- `factText: string`
- `objectJson?: unknown`
- `objectEntityId?: string`
- `validFrom?: string`
- `validTo?: string`
- `confidence?: number`
- `supersedesId?: string`

### `u.facts.correct`

```ts
correct(factId: string, input: CorrectFactInput): Promise<BrainFact>
```

`input` (`CorrectFactInput`):
- `predicate?: string`
- `factText?: string`
- `objectJson?: unknown`
- `objectEntityId?: string`
- `confidence?: number`

### `u.facts.invalidate`

```ts
invalidate(factId: string): Promise<{ invalidated: boolean; }>
```

## links

Edges between graph entities.

### `u.links.list`

```ts
list(limit?: number): Promise<BrainLink[]>
```

### `u.links.create`

```ts
create(fromId: string, toId: string, kind: string): Promise<void>
```

## review

Entity-resolution conflicts + merge review.

### `u.review.conflicts`

```ts
conflicts(): Promise<MatchConflict[]>
```

### `u.review.resolve`

```ts
resolve(conflictId: string, verdict: MatchVerdict): Promise<{ ok: true; }>
```

### `u.review.merges`

```ts
merges(limit?: number): Promise<MergeEvent[]>
```

### `u.review.undo`

```ts
undo(mergeEventId: string): Promise<{ ok: true; }>
```

## jobs

Background brain maintenance jobs.

### `u.jobs.list`

```ts
list(opts?: ListJobsOptions): Promise<BrainJob[]>
```

`opts?` (`ListJobsOptions`):
- `status?: JobStatus`
- `kind?: string`
- `limit?: number`

### `u.jobs.stats`

```ts
stats(): Promise<JobStats>
```

### `u.jobs.retry`

```ts
retry(jobId: string): Promise<{ retried: boolean; }>
```

