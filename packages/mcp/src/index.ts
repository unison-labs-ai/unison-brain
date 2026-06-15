#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  BrainClient,
  createInvitation,
  createKey,
  listKeys,
  listWorkspaces,
  provisionAccount,
  requestKey,
  revokeKey,
  verifyEmail,
} from "@unisonlabs/sdk";
import { z } from "zod";

// Read from package.json at runtime so the server reports the real published
// version (npm includes package.json next to dist/ in the tarball). Resolved
// relative to this module, so it works both from dist/ and `bun run src`.
const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const apiUrl = process.env.UNISON_API_URL ?? "https://brain.unisonlabs.ai";
const token = process.env.UNISON_TOKEN;

// UNISON_ACTOR sets actor delegation for all tools in this MCP instance.
// Service-key users (e.g. mem0/Zep-style integrations) set this to the
// end-user id so every brain operation is scoped to that actor.
const actorFromEnv = process.env.UNISON_ACTOR?.trim() || undefined;

const client = new BrainClient({ baseUrl: apiUrl, token, actor: actorFromEnv });

function ensureAuth(): void {
  if (!token) {
    throw new Error(
      "UNISON_TOKEN is not set. Run `unison auth login` (CLI) or call the auth_provision tool to create an account and get an API key. Then set UNISON_TOKEN (and optionally UNISON_API_URL).",
    );
  }
}

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "unison-brain", version: VERSION });

server.tool(
  "brain_context",
  "One-call recall: retrieve the most relevant memory for a natural-language query and get back a prompt-ready `contextMd` block. Use this BEFORE answering any question that may depend on the user's or team's history, decisions, conventions, or relationships. The brain does NO answer generation — pass `contextMd` verbatim into your system prompt or user turn and let your LLM compose the answer from it.",
  {
    query: z.string().describe("Natural-language question to recall context for"),
    mode: z
      .enum(["auto", "deep", "standard"])
      .optional()
      .describe(
        "Retrieval depth: auto (default) = server decides; deep = multi-hop graph expansion; standard = single-pass vector",
      ),
    k: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max semantic hits to return (default 10)"),
    maxEntities: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Max entity summaries to include (default 3)"),
    pathPrefix: z
      .string()
      .optional()
      .describe("Scope retrieval to a path subtree, e.g. /private/notes/"),
    includeBodies: z
      .boolean()
      .optional()
      .describe(
        "Inline full (clipped) document bodies into contextMd — set true when you will not follow up with doc reads",
      ),
  },
  async ({ query, mode, k, maxEntities, pathPrefix, includeBodies }) => {
    ensureAuth();
    return asText(await client.context({ query, mode, k, maxEntities, pathPrefix, includeBodies }));
  },
);

server.tool(
  "brain_ingest",
  "Stream conversations or documents into brain memory. Conversations are routed through the signal-extraction pipeline and produce entities + facts. Documents land as extractable notes. Use this to persist important context from the current session so it survives future sessions.",
  {
    items: z
      .array(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("conversation"),
            turns: z
              .array(
                z.object({
                  role: z.enum(["user", "assistant", "system"]),
                  content: z.string(),
                  name: z.string().optional(),
                }),
              )
              .describe("The conversation turns to ingest"),
            sourceRef: z
              .string()
              .describe("Stable caller-side identifier for this conversation (session/thread id)"),
            visibility: z.enum(["workspace", "private"]).optional(),
            idempotencyKey: z.string().optional(),
          }),
          z.object({
            type: z.literal("document"),
            content: z.string().describe("Markdown content of the document"),
            title: z.string().optional(),
            path: z
              .string()
              .optional()
              .describe("Brain path to write the document to (e.g. /private/notes/foo.md)"),
            tags: z.array(z.string()).optional(),
            visibility: z.enum(["workspace", "private"]).optional(),
            sourceRef: z.string().optional(),
          }),
        ]),
      )
      .min(1)
      .max(100)
      .describe("1–100 items: conversations or documents"),
  },
  async ({ items }) => {
    ensureAuth();
    return asText(await client.ingest({ items }));
  },
);

server.tool(
  "brain_remember",
  "Remember a dump (the current session, a conversation, or freeform text) the way the /remember skill does: it applies the save-or-skip filter, dedupes against existing notes, and files curated /private/kb notes + entity facts. Runs as a background job — poll brain_job for status. Use this at the end of a session to persist what's worth keeping.",
  {
    dump: z
      .union([
        z.string().describe("Freeform text to remember"),
        z
          .object({
            turns: z.array(z.object({ role: z.string(), content: z.string() })),
          })
          .describe("Conversation turns"),
        z.object({ sessionJsonl: z.string() }).describe("Raw Claude Code session log (.jsonl)"),
      ])
      .describe("What to remember"),
    source: z.string().optional().describe('Provenance label, e.g. "claude-code-session"'),
    sourceRef: z.string().optional().describe("Stable id → idempotent re-remember"),
    hints: z.string().optional().describe('Optional steering, e.g. "focus on decisions"'),
  },
  async ({ dump, source, sourceRef, hints }) => {
    ensureAuth();
    return asText(await client.remember({ dump, source, sourceRef, hints }));
  },
);

server.tool(
  "brain_search",
  "Search the Unison brain (hybrid keyword + semantic). Use before answering questions that may rely on the user's prior decisions, conventions, or notes.",
  {
    query: z.string().describe("Natural-language or keyword query"),
    limit: z.number().int().positive().optional().describe("Max results (default 10)"),
    memoryType: z
      .enum(["episodic", "semantic", "procedural", "auto"])
      .optional()
      .describe("Memory tier filter"),
    pathPrefix: z
      .string()
      .optional()
      .describe("Restrict results to documents under this path prefix (e.g. /private/notes)"),
  },
  async ({ query, limit, memoryType, pathPrefix }) => {
    ensureAuth();
    return asText(await client.search(query, { limit, memoryType, pathPrefix }));
  },
);

server.tool(
  "brain_get",
  "Read a single document from the Unison brain by its path.",
  { path: z.string().describe("Document path, e.g. /workspace/projects/architecture.md") },
  async ({ path }) => {
    ensureAuth();
    return asText(await client.get(path));
  },
);

server.tool(
  "brain_list",
  "List documents in the Unison brain under a path prefix.",
  {
    prefix: z.string().optional().describe("Path prefix, e.g. /private or /workspace/people"),
    limit: z.number().int().positive().optional().describe("Max items (default 100)"),
  },
  async ({ prefix, limit }) => {
    ensureAuth();
    return asText(await client.list({ prefix, limit }));
  },
);

server.tool(
  "brain_write",
  "Write or update a document in the Unison brain so the knowledge persists across sessions and machines. Writable roots: /private/… (e.g. /private/notes/<slug>.md), /workspace/… (e.g. /workspace/people/<slug>.md), and /teams/<slug>/… . A bare name routes to /private/notes/; legacy /wiki, /actions, /skills roots are gone.",
  {
    path: z.string().describe("Document path, e.g. /private/notes/auth-decision.md"),
    bodyMd: z.string().describe("Markdown content"),
    title: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ path, bodyMd, title, tags }) => {
    ensureAuth();
    return asText(await client.write({ path, bodyMd, title, tags }));
  },
);

server.tool(
  "brain_edit",
  "Surgically edit a brain document in place: replace an exact substring (oldStr) with newStr. oldStr must match exactly once — add surrounding context to disambiguate. Cheaper and safer than rewriting the whole doc with brain_write.",
  {
    path: z.string().describe("Document path, e.g. /private/notes/auth-decision.md"),
    oldStr: z.string().describe("Exact text to replace (must occur exactly once)"),
    newStr: z.string().describe("Replacement text"),
  },
  async ({ path, oldStr, newStr }) => {
    ensureAuth();
    return asText(await client.editDoc({ path, oldStr, newStr }));
  },
);

server.tool(
  "brain_delete",
  "Delete a document from the Unison brain by path. Use to clean up docs you created that are no longer needed (e.g. scratch or superseded notes). Irreversible.",
  {
    path: z.string().describe("Document path, e.g. /private/notes/obsolete-note.md"),
  },
  async ({ path }) => {
    ensureAuth();
    return asText(await client.delete(path));
  },
);

server.tool(
  "brain_resolve_entity",
  "Find a knowledge-graph entity (person, company, project, etc.) by name. Use when a name is mentioned and you need its id or context.",
  {
    name: z.string().describe("Entity display name"),
    kindHint: z
      .enum([
        "person",
        "company",
        "project",
        "decision",
        "topic",
        "mail_thread",
        "event",
        "task",
        "doc",
      ])
      .optional(),
  },
  async ({ name, kindHint }) => {
    ensureAuth();
    return asText(await client.entities.resolve(name, kindHint));
  },
);

server.tool(
  "brain_facts_about",
  "List the known facts about an entity (by entity id).",
  {
    entityId: z.string().describe("Entity id (from brain_resolve_entity)"),
    includeInvalidated: z.boolean().optional(),
  },
  async ({ entityId, includeInvalidated }) => {
    ensureAuth();
    return asText(await client.facts.about(entityId, { includeInvalidated }));
  },
);

server.tool(
  "brain_record_fact",
  "Record a new fact about an entity so it persists in the brain.",
  {
    subjectId: z.string().describe("Entity id the fact is about"),
    predicate: z.string().describe("Relation, e.g. 'works_at'"),
    factText: z.string().describe("The fact in natural language"),
    confidence: z.number().min(0).max(1).optional(),
  },
  async ({ subjectId, predicate, factText, confidence }) => {
    ensureAuth();
    return asText(await client.facts.record({ subjectId, predicate, factText, confidence }));
  },
);

server.tool(
  "brain_status",
  "Show Unison brain health and document/entity/fact counts.",
  {},
  async () => {
    ensureAuth();
    return asText(await client.status());
  },
);

// Bootstrap auth tools — these do NOT require UNISON_TOKEN; they let an agent
// create + verify its own account headlessly, then use the returned key.
server.tool(
  "auth_provision",
  "Create a new Unison account for an email with no browser/dashboard. Returns a working (unverified) API key — set it as UNISON_TOKEN. Then verify the emailed code via auth_verify to lift free-tier caps.",
  { email: z.string().describe("Email to anchor the account to") },
  async ({ email }) => asText(await provisionAccount(apiUrl, { email })),
);

server.tool(
  "auth_verify",
  "Verify the code emailed during provisioning (or key recovery). Makes the account durable; recovery codes also return a fresh API key.",
  {
    email: z.string().describe("The account email"),
    code: z.string().describe("The verification code from the email"),
  },
  async ({ email, code }) => asText(await verifyEmail(apiUrl, { email, code })),
);

server.tool(
  "auth_request_key",
  "Email a recovery code for an existing verified account (lost key / new machine). Complete it with auth_verify.",
  { email: z.string().describe("The account email") },
  async ({ email }) => asText(await requestKey(apiUrl, { email })),
);

// ── Key management tools ──────────────────────────────────────────────────────

server.tool(
  "auth_keys_list",
  "List the API keys for the authenticated account. Never returns key hashes. Requires UNISON_TOKEN.",
  {},
  async () => {
    ensureAuth();
    return asText(await listKeys(apiUrl, token ?? ""));
  },
);

server.tool(
  "auth_keys_create",
  "Mint a new API key for the authenticated account. The token is returned ONCE — store it immediately. Requires UNISON_TOKEN.",
  {
    name: z.string().optional().describe("Key name (default: 'api key')"),
    scopes: z
      .array(z.string())
      .optional()
      .describe(
        "Scopes (default: brain:read brain:write). Must be a subset of your current scopes.",
      ),
  },
  async ({ name, scopes }) => {
    ensureAuth();
    return asText(await createKey(apiUrl, token ?? "", { name, scopes }));
  },
);

server.tool(
  "auth_keys_revoke",
  "Revoke one of the authenticated account's API keys by id. The currently-used key can be revoked. Requires UNISON_TOKEN.",
  { id: z.string().describe("Key id to revoke") },
  async ({ id }) => {
    ensureAuth();
    return asText(await revokeKey(apiUrl, token ?? "", id));
  },
);

// ── Invitation tool ───────────────────────────────────────────────────────────

server.tool(
  "auth_invite",
  "Invite an email address to the authenticated account's workspace. Caller must be owner or admin. Requires UNISON_TOKEN.",
  {
    email: z.string().describe("Email address to invite"),
    role: z
      .enum(["admin", "member", "viewer"])
      .optional()
      .describe("Role to assign (default: member)"),
  },
  async ({ email, role }) => {
    ensureAuth();
    return asText(await createInvitation(apiUrl, token ?? "", { email, role }));
  },
);

// ── Workspace membership ──────────────────────────────────────────────────────

server.tool(
  "auth_workspaces_list",
  "List all workspaces the authenticated account is a member of. Returns id, name, role, and whether each is the currently-active workspace. Requires UNISON_TOKEN.",
  {},
  async () => {
    ensureAuth();
    return asText(await listWorkspaces(apiUrl, token ?? ""));
  },
);

await server.connect(new StdioServerTransport());
