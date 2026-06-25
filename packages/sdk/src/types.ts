export interface BrainClientOptions {
  /**
   * Base URL of the Unison API, e.g. https://brain.unisonlabs.ai
   * Accepts `apiUrl` as an alias (preferred) or `baseUrl` (legacy). Provide one
   * — if both are set they must be identical, otherwise the constructor throws.
   */
  apiUrl?: string;
  /** @deprecated Use `apiUrl` instead. */
  baseUrl?: string;
  /** Bearer token: an API key (`usk_...`) or a browser-login access token. */
  token?: string;
  /**
   * Actor external id for delegation (`X-Unison-Actor` header).
   * Requires the key to carry the `brain:act-as` scope.
   * Must match `/^[A-Za-z0-9._:@-]{1,200}$/`.
   */
  actor?: string;
  /** Override the fetch implementation (used in tests). */
  fetch?: typeof fetch;
}

// ── Documents (filesystem tier) ────────────────────────────────────────────

export type DocKind = "wiki_page" | "raw" | "note" | "log" | "index" | "skill" | "skill_proposed";
export type Visibility = "workspace" | "private";
export type MemoryType = "episodic" | "semantic" | "procedural" | "auto";

export interface BrainDocument {
  id: string;
  path: string;
  kind: string;
  title: string | null;
  tldr: string | null;
  bodyMd: string;
  tags: string[];
  visibility: Visibility;
  updatedAt: string | null;
  contentHash?: string | null;
}

/**
 * A document summary as returned by search hits — metadata only, NO body.
 * The search endpoint never includes `bodyMd` (SPEC §5.1: "doc is a summary
 * (no body)"); fetch the full document with `client.get(path)`.
 */
export type BrainDocumentSummary = Omit<BrainDocument, "bodyMd">;

/** A ranked search hit — the document is nested under `doc` (matches cortex.search). */
export interface SearchResult {
  doc: BrainDocumentSummary;
  score: number;
  highlight?: string;
  sources: ("bm25" | "vector")[];
}

export interface FsEntry {
  type: "dir" | "file";
  path: string;
  name: string;
  mtime: string | null;
}

export interface SearchOptions {
  limit?: number;
  kinds?: DocKind[];
  tags?: string[];
  memoryType?: MemoryType;
  asOf?: string;
  /** Restrict results to documents under this path prefix (e.g. "/private/notes"). */
  pathPrefix?: string;
}

// ── Context recall ─────────────────────────────────────────────────────────

export type ContextMode = "auto" | "deep" | "standard";

export interface ContextOptions {
  /** Natural-language question to recall context for. */
  query: string;
  /** Retrieval depth: auto (default) = the server decides; deep = multi-hop graph expansion; standard = single-pass vector. */
  mode?: ContextMode;
  /** Max semantic hits to return (1–50, default 10). */
  k?: number;
  /** Max entity summaries to include (0–10, default 3). */
  maxEntities?: number;
  /** Scope retrieval to a path subtree, e.g. "/private/notes/". */
  pathPrefix?: string;
  /** Inline full (clipped) document bodies into contextMd — for single-shot readers that won't follow up with reads. */
  includeBodies?: boolean;
}

/** A single ranked semantic hit from /v1/brain/context. */
export interface SemanticHit {
  doc: BrainDocumentSummary;
  score: number;
  highlight?: string;
  sources: ("bm25" | "vector")[];
}

/** An entity summary bundle inside a ContextResult. */
export interface ContextEntity {
  entity: { id: string; kind: string; slug: string; displayName: string };
  facts: BrainFact[];
  timeline: BrainFact[];
}

/**
 * The response from GET /v1/brain/context.
 * `contextMd` is a prompt-ready markdown block containing the most relevant
 * memory for `query`. Pass it verbatim into your system prompt or user turn;
 * the brain does NO answer generation — the caller's LLM composes the answer.
 */
export interface ContextResult {
  query: string;
  mode: ContextMode;
  generatedAt: string;
  topScore: number | null;
  weakEvidence: boolean;
  hits: SemanticHit[];
  entities: ContextEntity[];
  contextMd: string;
}

// ── Ingest ─────────────────────────────────────────────────────────────────

export interface IngestDocumentItem {
  type: "document";
  content: string;
  title?: string;
  /** Brain path to write the document to (e.g. "/private/notes/foo.md"). */
  path?: string;
  tags?: string[];
  visibility?: Visibility;
  /** Stable source reference for idempotency. */
  sourceRef?: string;
}

export type IngestItem = IngestDocumentItem;

export interface IngestInput {
  /** 1–100 items per call. */
  items: IngestItem[];
}

export interface IngestDocumentResult {
  type: "document";
  docId: string;
  path: string;
  jobIds: string[];
}

export type IngestItemResult = IngestDocumentResult;

export interface IngestResult {
  items: IngestItemResult[];
}

// ── Remember ───────────────────────────────────────────────────────────────

/** A dump to "remember": freeform text, conversation turns, or a raw session log. */
export type RememberDump =
  | string
  | { turns: Array<{ role: string; content: string }> }
  | { sessionJsonl: string };

export interface RememberInput {
  /** What to remember — the same behavior as the `/remember` skill. */
  dump: RememberDump;
  /** Provenance label, e.g. "claude-code-session" | "meeting". */
  source?: string;
  /** Stable id → idempotent re-remember (same dump is a no-op). */
  sourceRef?: string;
  /** Optional steering, e.g. "focus on decisions". */
  hints?: string;
}

/** Remember runs as a background job; poll `jobs.get(jobId)` for status. */
export interface RememberResult {
  jobId: string;
}

// ── Batch doc write ────────────────────────────────────────────────────────

export interface WriteDocInput {
  path: string;
  bodyMd: string;
  kind?: DocKind;
  title?: string;
  tldr?: string;
  tags?: string[];
  visibility?: Visibility;
  expectedContentHash?: string;
}

export interface WriteDocsResult {
  documents: BrainDocument[];
}

// ── Metadata-only patch ────────────────────────────────────────────────────

export interface EditDocMetaInput {
  path: string;
  title?: string;
  tldr?: string;
  tags?: string[];
}

export interface GrepOptions {
  caseSensitive?: boolean;
  limit?: number;
}

export interface ListOptions {
  prefix?: string;
  kinds?: DocKind[];
  tags?: string[];
  limit?: number;
}

export interface WriteInput {
  path: string;
  bodyMd: string;
  kind?: DocKind;
  title?: string;
  tldr?: string;
  tags?: string[];
  visibility?: Visibility;
  expectedContentHash?: string;
  source?: { kind: string; ref: string };
}

export interface TagInput {
  add?: string[];
  remove?: string[];
}

export type ShareKind = "doc" | "fact" | "entity";

// ── Entities (knowledge graph) ─────────────────────────────────────────────

export type EntityKind =
  | "person"
  | "company"
  | "project"
  | "decision"
  | "topic"
  | "mail_thread"
  | "event"
  | "task"
  | "doc";
export type EntityStatus = "active" | "stub" | "archived";

export interface BrainEntity {
  id: string;
  kind: string;
  displayName: string;
  slug: string;
  aliases: string[];
  props: Record<string, unknown>;
  status: EntityStatus;
}

export interface ListEntitiesOptions {
  kinds?: string[];
  status?: EntityStatus;
  limit?: number;
}

export interface UpsertEntityInput {
  kind: EntityKind;
  displayName: string;
  slug?: string;
  aliases?: string[];
  props?: Record<string, unknown>;
  status?: EntityStatus;
}

// ── Facts (bitemporal) ─────────────────────────────────────────────────────

export interface BrainFact {
  id: string;
  subjectId: string;
  predicate: string;
  factText: string;
  objectJson: unknown | null;
  objectEntityId: string | null;
  validFrom: string | null;
  validTo: string | null;
  recordedAt: string;
  confidence: number;
}

export interface RecordFactInput {
  subjectId: string;
  predicate: string;
  factText: string;
  objectJson?: unknown;
  objectEntityId?: string;
  validFrom?: string;
  validTo?: string;
  confidence?: number;
  supersedesId?: string;
}

export interface CorrectFactInput {
  predicate?: string;
  factText?: string;
  objectJson?: unknown;
  objectEntityId?: string;
  confidence?: number;
}

export interface FactsAboutOptions {
  asOf?: string;
  includeInvalidated?: boolean;
}

export interface TimelineOptions {
  from?: string;
  to?: string;
}

// ── Links (graph edges) ────────────────────────────────────────────────────

export type LinkKind = "mentions" | "derived_from" | "supersedes" | "see_also";

export interface BrainLink {
  fromId: string;
  toId: string;
  kind: string;
}

export interface NeighborsOptions {
  kinds?: LinkKind[];
  limit?: number;
}

// ── Dedup review ───────────────────────────────────────────────────────────

export interface MatchConflict {
  id: string;
  pairType: string;
  aId: string;
  bId: string;
  engineReasoning: string;
  engineVerdict: string;
  calibratedConfidence: number;
  aDescription: string;
  bDescription: string;
  exemplars: unknown[];
}

export interface MergeEvent {
  id: string;
  type: string;
  survivorId: string;
  loserId: string;
  decidedBy: string;
  judgeReasoning: string;
  createdAt: string;
  survivorName: string;
  loserName: string;
}

export type MatchVerdict = "merge" | "distinct";

// ── Jobs (operator) ────────────────────────────────────────────────────────

export type JobStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface BrainJob {
  id: string;
  kind: string;
  lane: string;
  priority: number;
  status: JobStatus;
  attempt: number;
  error: string | null;
  createdAt: string;
}

export interface JobStats {
  pending: number;
  running: number;
  done: number;
  failed: number;
  skipped: number;
}

export interface ListJobsOptions {
  status?: JobStatus;
  kind?: string;
  limit?: number;
}

// ── Status / identity ──────────────────────────────────────────────────────

export interface BrainStatus {
  docCount: number;
  docWithEmbedding: number;
  entityCount: number;
  factCount: number;
  lastIngestAt: string | null;
  pendingJobs: number;
  staleWikiPageCount: number;
}

export interface WhoAmI {
  user: { id: string; email: string | null };
  workspace: { id: string; name: string | null };
  scopes: string[];
  /** Present when actor delegation is active (`X-Unison-Actor` + `brain:act-as` scope). */
  actedAs?: { externalId: string; userId: string };
}

// ── Multi-workspace ────────────────────────────────────────────────────────

export interface WorkspaceMembership {
  id: string;
  name: string | null;
  role: string;
  /** Whether this is the workspace currently associated with the bearer key. */
  active: boolean;
}

// ── Auth ───────────────────────────────────────────────────────────────────
// Note: auth types (ProvisionResponse, VerifyResponse, ApiKeyRecord, etc.)
// live in auth.ts and are re-exported from index.ts.
