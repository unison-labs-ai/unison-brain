import type {
  ApiKeyRecord,
  CreateInvitationResponse,
  CreateKeyResponse,
  InvitationRecord,
  WorkspaceMembershipRecord,
} from "./auth";
import {
  createInvitation,
  createKey,
  listInvitations,
  listKeys,
  listWorkspaces,
  revokeInvitation,
  revokeKey,
} from "./auth";
import { BrainError } from "./errors";
import { routeBrainWritePath } from "./fs-contract";
import { API_VERSION, parseResponse, qs, stripTrailingSlash } from "./http";
import type {
  BrainClientOptions,
  BrainDocument,
  BrainEntity,
  BrainFact,
  BrainJob,
  BrainLink,
  BrainStatus,
  ContextOptions,
  ContextResult,
  CorrectFactInput,
  EditDocMetaInput,
  EntityKind,
  FactsAboutOptions,
  FsEntry,
  GrepOptions,
  IngestInput,
  IngestResult,
  JobStats,
  ListEntitiesOptions,
  ListJobsOptions,
  ListOptions,
  MatchConflict,
  MatchVerdict,
  MergeEvent,
  NeighborsOptions,
  RecordFactInput,
  RememberInput,
  RememberResult,
  SearchOptions,
  SearchResult,
  ShareKind,
  TagInput,
  TimelineOptions,
  UpsertEntityInput,
  WhoAmI,
  WriteDocInput,
  WriteDocsResult,
  WriteInput,
} from "./types";

/** Hosted Unison brain — used when neither `apiUrl` nor `baseUrl` is given. */
export const DEFAULT_API_URL = "https://brain.unisonlabs.ai";

/** Pattern for a valid actor external id — same regex enforced server-side. */
export const ACTOR_ID_RE = /^[A-Za-z0-9._:@-]{1,200}$/;

export interface KeysApi {
  list(opts?: { workspaceId?: string }): Promise<ApiKeyRecord[]>;
  create(params: {
    name?: string;
    scopes?: string[];
    workspaceId?: string;
  }): Promise<CreateKeyResponse>;
  revoke(id: string): Promise<{ revoked: boolean; id: string; note?: string }>;
}

export interface WorkspacesApi {
  list(): Promise<WorkspaceMembershipRecord[]>;
}

export interface InvitationsApi {
  create(params: { email: string; role?: string }): Promise<CreateInvitationResponse>;
  list(): Promise<InvitationRecord[]>;
  revoke(id: string): Promise<{ revoked: boolean; id: string }>;
}

export interface EntitiesApi {
  list(opts?: ListEntitiesOptions): Promise<BrainEntity[]>;
  resolve(name: string, kindHint?: EntityKind): Promise<BrainEntity | null>;
  get(id: string): Promise<BrainEntity>;
  upsert(input: UpsertEntityInput): Promise<BrainEntity>;
}

export interface FactsApi {
  list(opts?: { limit?: number; includeInvalidated?: boolean }): Promise<BrainFact[]>;
  about(entityId: string, opts?: FactsAboutOptions): Promise<BrainFact[]>;
  timeline(entityId: string, opts?: TimelineOptions): Promise<BrainFact[]>;
  record(input: RecordFactInput): Promise<BrainFact>;
  correct(factId: string, input: CorrectFactInput): Promise<BrainFact>;
  invalidate(factId: string): Promise<{ invalidated: boolean }>;
}

export interface LinksApi {
  list(limit?: number): Promise<BrainLink[]>;
  create(fromId: string, toId: string, kind: string): Promise<void>;
}

export interface ReviewApi {
  conflicts(): Promise<MatchConflict[]>;
  resolve(conflictId: string, verdict: MatchVerdict): Promise<{ ok: true }>;
  merges(limit?: number): Promise<MergeEvent[]>;
  undo(mergeEventId: string): Promise<{ ok: true }>;
}

export interface JobsApi {
  list(opts?: ListJobsOptions): Promise<BrainJob[]>;
  stats(): Promise<JobStats>;
  retry(jobId: string): Promise<{ retried: boolean }>;
}

export class BrainClient {
  readonly entities: EntitiesApi;
  readonly facts: FactsApi;
  readonly links: LinksApi;
  readonly review: ReviewApi;
  readonly jobs: JobsApi;

  /** API-key management (list, create, revoke). Scope: brain:read. */
  readonly keys: KeysApi;
  /** Workspace membership listing. Scope: brain:read. */
  readonly workspaces: WorkspacesApi;
  /** Workspace invitation management (create, list, revoke). Owner/admin only. */
  readonly invitations: InvitationsApi;

  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly actorId?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BrainClientOptions) {
    const resolvedUrl = opts.apiUrl ?? opts.baseUrl ?? DEFAULT_API_URL;
    if (opts.apiUrl && opts.baseUrl && opts.apiUrl !== opts.baseUrl) {
      throw new Error(
        `BrainClient: \`apiUrl\` (${opts.apiUrl}) and \`baseUrl\` (${opts.baseUrl}) are both set and differ — use one.`,
      );
    }
    if (opts.actor !== undefined && opts.actor !== null) {
      if (!ACTOR_ID_RE.test(opts.actor)) {
        throw new Error(
          `BrainClient: invalid actor id "${opts.actor}" — must match /^[A-Za-z0-9._:@-]{1,200}$/`,
        );
      }
    }
    this.baseUrl = stripTrailingSlash(resolvedUrl);
    this.token = opts.token;
    this.actorId = opts.actor;
    this.fetchImpl = opts.fetch ?? fetch;

    this.entities = {
      list: (o = {}) =>
        this.req<{ entities: BrainEntity[] }>(
          "GET",
          `/brain/entities?${qs({ kind: o.kinds, status: o.status, limit: o.limit })}`,
        ).then((d) => d.entities),
      resolve: (name, kindHint) =>
        this.req<{ entity: BrainEntity | null }>(
          "GET",
          `/brain/entities/resolve?${qs({ name, kindHint })}`,
        ).then((d) => d.entity),
      get: (id) => this.req<BrainEntity>("GET", `/brain/entities/${encodeURIComponent(id)}`),
      upsert: (input) => this.req<BrainEntity>("POST", "/brain/entities", input),
    };

    this.facts = {
      list: (o = {}) =>
        this.req<{ facts: BrainFact[] }>(
          "GET",
          `/brain/facts?${qs({ limit: o.limit, includeInvalidated: o.includeInvalidated })}`,
        ).then((d) => d.facts),
      about: (entityId, o = {}) =>
        this.req<{ facts: BrainFact[] }>(
          "GET",
          `/brain/entities/${encodeURIComponent(entityId)}/facts?${qs({ asOf: o.asOf, includeInvalidated: o.includeInvalidated })}`,
        ).then((d) => d.facts),
      timeline: (entityId, o = {}) =>
        this.req<{ facts: BrainFact[] }>(
          "GET",
          `/brain/entities/${encodeURIComponent(entityId)}/timeline?${qs({ from: o.from, to: o.to })}`,
        ).then((d) => d.facts),
      record: (input) => this.req<BrainFact>("POST", "/brain/facts", input),
      correct: (factId, input) =>
        this.req<BrainFact>("PATCH", `/brain/facts/${encodeURIComponent(factId)}`, input),
      invalidate: (factId) =>
        this.req<{ invalidated: boolean }>("DELETE", `/brain/facts/${encodeURIComponent(factId)}`),
    };

    this.links = {
      list: (limit) =>
        this.req<{ links: BrainLink[] }>("GET", `/brain/links?${qs({ limit })}`).then(
          (d) => d.links,
        ),
      create: (fromId, toId, kind) =>
        this.req<void>("POST", "/brain/links", { fromId, toId, kind }),
    };

    this.review = {
      conflicts: () =>
        this.req<{ conflicts: MatchConflict[] }>("GET", "/brain/review/conflicts").then(
          (d) => d.conflicts,
        ),
      resolve: (conflictId, verdict) =>
        this.req<{ ok: true }>(
          "POST",
          `/brain/review/conflicts/${encodeURIComponent(conflictId)}`,
          { verdict },
        ),
      merges: (limit) =>
        this.req<{ merges: MergeEvent[] }>("GET", `/brain/review/merges?${qs({ limit })}`).then(
          (d) => d.merges,
        ),
      undo: (mergeEventId) =>
        this.req<{ ok: true }>(
          "POST",
          `/brain/review/merges/${encodeURIComponent(mergeEventId)}/undo`,
        ),
    };

    this.jobs = {
      list: (o = {}) =>
        this.req<{ jobs: BrainJob[] }>(
          "GET",
          `/brain/jobs?${qs({ status: o.status, kind: o.kind, limit: o.limit })}`,
        ).then((d) => d.jobs),
      stats: () => this.req<JobStats>("GET", "/brain/jobs/stats"),
      retry: (jobId) =>
        this.req<{ retried: boolean }>("POST", `/brain/jobs/${encodeURIComponent(jobId)}/retry`),
    };

    this.keys = {
      list: (opts = {}) => listKeys(this.baseUrl, this.token ?? "", opts, this.fetchImpl),
      create: (params) => createKey(this.baseUrl, this.token ?? "", params, this.fetchImpl),
      revoke: (id) => revokeKey(this.baseUrl, this.token ?? "", id, this.fetchImpl),
    };

    this.workspaces = {
      list: () => listWorkspaces(this.baseUrl, this.token ?? "", this.fetchImpl),
    };

    this.invitations = {
      create: (params) => createInvitation(this.baseUrl, this.token ?? "", params, this.fetchImpl),
      list: () => listInvitations(this.baseUrl, this.token ?? "", this.fetchImpl),
      revoke: (id) => revokeInvitation(this.baseUrl, this.token ?? "", id, this.fetchImpl),
    };
  }

  // ── Documents ──────────────────────────────────────────────────────────

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const data = await this.req<{ results: SearchResult[] }>(
      "GET",
      `/brain/search?${qs({ q: query, k: opts.limit, kind: opts.kinds, tag: opts.tags, memoryType: opts.memoryType, asOf: opts.asOf, pathPrefix: opts.pathPrefix })}`,
    );
    return data.results;
  }

  async grep(pattern: string, opts: GrepOptions = {}): Promise<BrainDocument[]> {
    const data = await this.req<{ results: BrainDocument[] }>(
      "GET",
      `/brain/grep?${qs({ pattern, caseSensitive: opts.caseSensitive, limit: opts.limit })}`,
    );
    return data.results;
  }

  get(path: string): Promise<BrainDocument> {
    // Point-in-time reads (asOf) exist on search/facts, not on doc-by-path —
    // the /v1/brain/doc route reads only `path`. Don't advertise a param the
    // backend ignores; wire it here + in cortex.read together if we ever want
    // versioned doc reads.
    return this.req<BrainDocument>("GET", `/brain/doc?${qs({ path })}`);
  }

  async list(opts: ListOptions = {}): Promise<BrainDocument[]> {
    const data = await this.req<{ documents: BrainDocument[] }>(
      "GET",
      `/brain/list?${qs({ prefix: opts.prefix, kind: opts.kinds, tag: opts.tags, limit: opts.limit })}`,
    );
    return data.documents;
  }

  async listFs(path = ""): Promise<FsEntry[]> {
    const data = await this.req<{ entries: FsEntry[] }>("GET", `/brain/fs?${qs({ path })}`);
    return data.entries;
  }

  getRaw(path: string): Promise<{ content: string | null; path: string }> {
    return this.req<{ content: string | null; path: string }>(
      "GET",
      `/brain/fs/read?${qs({ path })}`,
    );
  }

  async write(input: WriteInput): Promise<BrainDocument> {
    // Route through the FS contract: bare/unqualified paths default to
    // /private/notes/<slug>.md; non-contract namespaces fail fast. The server's
    // checkWritable remains authoritative — this just turns a 4xx into a clear
    // client error and applies the same default routing the in-app agent gets.
    // async so a routing error surfaces as a rejection, not a sync throw.
    const path = routeBrainWritePath(input.path);
    return this.req<BrainDocument>("PUT", "/brain/doc", { ...input, path });
  }

  /**
   * Surgical in-place edit, mirroring Claude Code's `Edit`: replace an exact
   * `oldStr` with `newStr`. `oldStr` must match the document body exactly once,
   * or the edit refuses (add surrounding context to disambiguate).
   *
   * Routes to `PATCH /brain/doc`, which performs the match + replace
   * server-side inside the write transaction — atomic and uniqueness-checked,
   * so there is no racy client read-modify-write and metadata is preserved.
   * Pass `expectedContentHash` for optimistic-concurrency on hot docs.
   */
  async editDoc(input: {
    path: string;
    oldStr: string;
    newStr: string;
    expectedContentHash?: string;
  }): Promise<BrainDocument> {
    if (input.oldStr === input.newStr) {
      throw new BrainError(
        "edit_noop",
        "oldStr and newStr are identical — nothing to change.",
        422,
      );
    }
    return this.req<BrainDocument>("PATCH", "/brain/doc", input);
  }

  /**
   * One-call recall — fetch the most relevant memory for a natural-language
   * query and get back a prompt-ready `contextMd` block.
   *
   * The brain does NO answer generation. Pass `contextMd` verbatim into your
   * system prompt or user turn; the caller's LLM composes the answer.
   *
   * Scope: `brain:read`.
   */
  context(opts: ContextOptions): Promise<ContextResult> {
    return this.req<ContextResult>(
      "GET",
      `/brain/context?${qs({
        q: opts.query,
        mode: opts.mode,
        k: opts.k,
        maxEntities: opts.maxEntities,
        pathPrefix: opts.pathPrefix,
        includeBodies: opts.includeBodies,
      })}`,
    );
  }

  /**
   * Stream conversations or documents into the brain's memory pipeline.
   *
   * Conversations are routed through the signal-extraction pipeline and produce
   * entities + facts. Documents are written as extractable notes.
   *
   * Scope: `brain:write`.
   */
  ingest(input: IngestInput): Promise<IngestResult> {
    return this.req<IngestResult>("POST", "/brain/ingest", input);
  }

  /**
   * "Remember" a dump (a Claude Code session, a conversation, or freeform text)
   * exactly the way the `/remember` skill does after a session: it applies the
   * save-or-skip filter, dedupes against existing notes, and files curated
   * `/private/kb` notes + entity facts. Runs as a background job — poll
   * `jobs.get(jobId)` for status.
   *
   * Scope: `brain:write`.
   */
  remember(input: RememberInput): Promise<RememberResult> {
    return this.req<RememberResult>("POST", "/brain/remember", input);
  }

  /**
   * Batch write multiple documents in a single call.
   * Equivalent to calling `write()` on each document but with one round-trip.
   *
   * Scope: `brain:write`.
   */
  async writeDocs(docs: WriteDocInput[]): Promise<BrainDocument[]> {
    const data = await this.req<WriteDocsResult>("PUT", "/brain/docs", { docs });
    return data.documents;
  }

  /**
   * Patch metadata (title, tldr, tags) on an existing document without
   * touching its body. Accepts both the full edit-doc form (oldStr/newStr)
   * and a metadata-only form — pass `title`, `tldr`, or `tags` to update
   * metadata only.
   *
   * The oldStr/newStr form is unchanged: use `editDoc()` for body edits.
   * Use this overload when you only need to rename, re-summarize, or re-tag.
   *
   * Scope: `brain:write`.
   */
  patchDocMeta(input: EditDocMetaInput): Promise<BrainDocument> {
    return this.req<BrainDocument>("PATCH", "/brain/doc", input);
  }

  delete(path: string): Promise<{ deleted: boolean }> {
    return this.req<{ deleted: boolean }>("DELETE", `/brain/doc?${qs({ path })}`);
  }

  tag(path: string, input: TagInput): Promise<BrainDocument> {
    return this.req<BrainDocument>("POST", "/brain/doc/tag", { path, ...input });
  }

  share(kind: ShareKind, id: string): Promise<{ shared: boolean }> {
    return this.req<{ shared: boolean }>("POST", "/brain/share", { kind, id });
  }

  async neighbors(idOrPath: string, opts: NeighborsOptions = {}): Promise<BrainDocument[]> {
    const data = await this.req<{ documents: BrainDocument[] }>(
      "GET",
      `/brain/neighbors?${qs({ idOrPath, kind: opts.kinds, limit: opts.limit })}`,
    );
    return data.documents;
  }

  status(): Promise<BrainStatus> {
    return this.req<BrainStatus>("GET", "/brain/status");
  }

  whoami(): Promise<WhoAmI> {
    return this.req<WhoAmI>("GET", "/auth/whoami");
  }

  /**
   * Return a derived client that sends `X-Unison-Actor: <externalId>` on every
   * request. The key must carry the `brain:act-as` scope. Shadow users are
   * auto-created server-side; `/private` scoping isolates actors automatically.
   *
   * Pass `null` or `undefined` to clear the actor (return a client without
   * the header).
   *
   * Throws synchronously if `externalId` is non-null and fails the format check.
   */
  withActor(externalId: string | null | undefined): BrainClient {
    return new BrainClient({
      apiUrl: this.baseUrl,
      token: this.token,
      actor: externalId ?? undefined,
      fetch: this.fetchImpl,
    });
  }

  // ── transport ──────────────────────────────────────────────────────────

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.actorId) headers["x-unison-actor"] = this.actorId;
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await this.fetchImpl(`${this.baseUrl}/${API_VERSION}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parseResponse<T>(res);
  }
}
