# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- **`POST /v1/brain/ingest` is now document-only.** The `type: "conversation"` variant has been
  removed from `IngestItem`. Use `POST /v1/brain/remember` (or `unison remember` / `brain_remember`
  / `client.remember()`) for conversations and session logs.
- **SDK:** `ConversationTurn`, `IngestConversationItem`, and `IngestConversationResult` types
  removed. `IngestItem` and `IngestItemResult` are now aliases for the document variants.
- **CLI:** `unison ingest --conversation` option removed; stdin conversation JSON no longer
  accepted. Pass `--file <path>` for documents; use `unison remember` for conversations.
- **MCP:** `brain_ingest` tool schema no longer accepts `type: "conversation"` items.

## [1.7.1] - 2026-06-23

### Added
- **Agent docs cover the whole surface, not just memory.** `skill/SKILL.md` gained a dedicated **"Ingest documents — bulk-load existing files"** section (`unison migrate markdown <dir>` / `ingest --file` / `migrate json`, with the extraction-pipeline note) so agents can answer "upload my docs" without digging through the migration prose, plus an **"Other surfaces"** section pointing to the SDK (for code) and MCP (for no-shell). The skill `description` now triggers on upload/ingest/import intents, not only "remember this".
- **`unison remember` is now documented in the skill + reference.** The server-side `/remember` engine (filter → dedupe → file curated `/private/kb` notes + entity facts; accepts a Claude Code `--session <jsonl>`, `--file`, `--text`, or stdin) was already shipped and exposed via the CLI, the `brain_remember` MCP tool, and `client.remember()` — but the skill only taught manual `write`/`fact add`. Agents now know to hand a whole dump to `remember` and let the brain decide what's durable.
- **MCP server now ships `instructions`** (`packages/mcp/src/index.ts`): MCP-only agents — which never read `SKILL.md` — receive the recall-first / capture-before-finish protocol, the people rule, the bulk-upload guidance, and the read-only-data framing directly from the server.
- **AGENTS.md self-onboarding** branches the three first-party surfaces — CLI (default), MCP (no shell), and a new **"Building an app? Use the SDK"** step pointing to the auto-generated `packages/sdk/AGENT-REFERENCE.md`.

### Fixed
- Docs: AGENTS.md called the MCP server "a curated 8-tool set" while listing 21 names; corrected to the actual **23** `brain_*` / `auth_*` tools (`brain_delete` and `auth_workspaces_list` were missing from the list).

## [1.7.0] - 2026-06-20

_Changelog reconciliation: the 1.6.0–1.7.0 line shipped without per-version CHANGELOG sections. The entries below accumulated across those releases (actor delegation, multi-workspace, `remember`, the default-host change) and are consolidated here as available as of 1.7.0._

### Fixed
- CLI: `migrate markdown`/`json` now exit `6` (not `1`) when every write in the batch is blocked by the free-tier quota, so callers can distinguish the cap from other failures (found by the 1.5.1 QA fleet).

### Changed

- **Default API URL** updated from `https://api.unisonlabs.ai` to `https://brain.unisonlabs.ai`
  across SDK, CLI, and MCP packages. The old hostname remains a working server-side alias; no
  action required for existing `UNISON_API_URL` overrides or configs that already specify a URL.

### Added

- **Actor delegation** — `BrainClientOptions.actor` + `client.withActor(externalId)` (SDK):
  sets `X-Unison-Actor: <id>` on every request. Shadow users are auto-created server-side;
  `/private` scoping isolates each actor. Requires the key to carry `brain:act-as` scope.
  Validate the id format (`/^[A-Za-z0-9._:@-]{1,200}$/`) client-side before the request.
  `withActor(null)` returns a derived client with the header cleared.

- **`client.workspaces`** (SDK): `{ list() }` — `GET /v1/auth/workspaces` → list of all workspace
  memberships with `{ id, name, role, active }`.

- **`client.keys.list({ workspaceId? })`** (SDK): optional `workspaceId` scopes the listing to
  keys minted for a specific member workspace.

- **`client.keys.create({ ..., workspaceId? })`** (SDK): optional `workspaceId` mints the key
  into a different workspace the caller is a member of (must be owner/admin to add `brain:act-as`).

- **`WhoAmI.actedAs`** (SDK type): `{ externalId, userId }` — present when actor delegation
  is active on the request.

- **`WorkspaceMembershipRecord`** (SDK type): exported from `@unisonlabs/sdk`.

- **`unison workspaces ls [--json]`** (CLI): table of all workspace memberships, marks active.

- **`unison switch <workspaceIdOrName>`** (CLI): resolves workspace by id prefix or unique name match,
  mints (or recalls from cache) a key for that workspace, stores it as the new active credential.
  Keeps a per-apiUrl/per-workspaceId key cache in `~/.config/unison/config.json` so switching back
  is instant without re-minting.

- **`--actor <id>`** on brain commands (write, search, context, ingest, get, ls) (CLI):
  per-command actor delegation. `UNISON_ACTOR` env var sets a global default.

- **`UNISON_ACTOR`** env var (CLI + MCP): service-key users set this once to act as all
  requests under a fixed end-user id. MCP: applies to all tools in the server instance.

- **`auth_workspaces_list`** (MCP): new tool — lists workspace memberships. Requires `UNISON_TOKEN`.

- **`listWorkspaces(baseUrl, token, fetchImpl?)`** (SDK standalone helper): exported from
  `@unisonlabs/sdk`.

- **`ACTOR_ID_RE`** (SDK): exported regex constant for the actor id format validation.

## [1.5.1] - 2026-06-12

### Added
- MCP: `brain_delete` tool — MCP agents can now clean up documents they created (found by the 1.5.0 QA fleet).

### Fixed
- CLI: `quota_exceeded` now exits with its own code `6` (was `4`, colliding with auth failures) and suggests verifying the email or deleting docs; skill docs updated.

## [1.5.0] - 2026-06-12

### Added
- `unison migrate` — guided one-shot migration wizard: detects memory systems on the machine (coding-agent memory directories, Obsidian vaults, custom markdown/JSON paths), imports what you pick, and prints the cutover checklist.
- `unison migrate json <file>` — import any memory system's JSON export (field aliases auto-detected).
- `unison migrate markdown <dir>` — import any markdown tree (knowledge base, Obsidian vault, any tool's markdown export) onto a brain path prefix. Frontmatter-aware (title, tags), idempotent: diffs against the brain and writes only new/changed docs, so re-running is an incremental sync. `--dry-run` prints the plan.
- `unison export <dir>` — the backward path: dump brain docs to a markdown directory with lossless frontmatter (`unison-path`, tags, kind, visibility). No lock-in, full round-trip.
- Skill: new **Precedence** section — when multiple memory systems exist, the brain is canonical; recall from it first, capture to it by default.

### Changed
- Rewrote the agent skill (`skill/SKILL.md`) as the primary entry point for agents: self-contained setup (install, email-OTP login, headless `UNISON_TOKEN`, multi-workspace, `--actor`), a `unison context`-first recall protocol, a capture-as-you-work memory protocol with explicit save triggers, and the output contract. `unison skill install` now also ships `reference.md`, a full command/flag reference; `unison skill print --reference` prints it.
- `unison search` gained `--path-prefix` (SDK already supported it).
- README, AGENTS.md, and llms.txt now funnel agents to the skill first; stale browser-PKCE login references replaced with the email-OTP flow.

## [1.4.1] - 2026-06-12

### Added
- SDK `context()` accepts `pathPrefix` (subtree scoping) and `includeBodies` (inline clipped doc bodies for single-shot readers); CLI `unison context --path-prefix/--include-bodies`; MCP `brain_context` exposes both params.
- SDK `BrainClient` defaults `apiUrl` to `https://brain.unisonlabs.ai` when omitted (parity with the CLI/MCP defaults).

## [1.4.0] - 2026-06-12

### Changed — Breaking: auth surface replaced

The PKCE loopback and device-code auth flows are **removed** from the client.
The server no longer exposes those endpoints. The new auth surface is email-OTP
only — simpler, no browser required, works on every machine including headless.

**Migration:**

| Was | Now |
|---|---|
| `unison auth login` (opens browser) | `unison auth login` (prompts for email) |
| `unison auth login --device` | removed — `unison auth login` works headlessly |
| Keys minted in the dashboard | `unison auth keys create` / `auth_keys_create` MCP tool |
| `buildAuthorizeUrl`, `exchangeCode`, `generatePkce`, `randomState`, `startDeviceAuth`, `pollDeviceToken` (SDK) | removed |
| `TokenResponse`, `PkcePair`, `AuthorizeUrlParams`, `ExchangeCodeParams`, `DeviceCodeResponse` (types) | removed |

### Added

- **`unison auth login`** — email-OTP as the single sign-in path. Prompts for email
  (or `--email`). New accounts: key stored immediately + inline OTP prompt.
  Existing accounts: recovery OTP sent → collect code → new key stored.
  `--with-token` (stdin) still works for CI pipelines.

- **`unison auth verify [code]`** — stand-alone OTP verification (for non-TTY flows
  or when verification was skipped during login).

- **`unison auth keys`** (CLI subcommands):
  - `unison auth keys ls` — table of all keys (id, name, prefix, scopes, created, status)
  - `unison auth keys create [--name <n>] [--scopes ...]` — mint a key; token printed once
  - `unison auth keys revoke <id>` — revoke a key by id

- **`unison invite <email> [--role admin|member|viewer]`** — invite an email to your workspace.

- **`unison invites`** — list pending invitations; `unison invites revoke <id>` to revoke.

- **`client.keys`** (SDK): `{ list(), create({ name?, scopes? }), revoke(id) }` on `BrainClient`.

- **`client.invitations`** (SDK): `{ create({ email, role? }), list(), revoke(id) }` on `BrainClient`.

- Standalone SDK auth helpers: `listKeys`, `createKey`, `revokeKey`,
  `createInvitation`, `listInvitations`, `revokeInvitation`.

- New types exported from `@unisonlabs/sdk`: `ApiKeyRecord`, `CreateKeyResponse`,
  `InvitationRecord`, `CreateInvitationResponse`, `KeysApi`, `InvitationsApi`.

- **`auth_keys_list`**, **`auth_keys_create`**, **`auth_keys_revoke`**, **`auth_invite`** (MCP):
  four new tools for key management and workspace invitations.

- MCP error message for missing `UNISON_TOKEN` now points to `unison auth login`
  and `auth_provision` instead of "the dashboard".

- **`brain.context()`** (SDK): one-call recall — `GET /v1/brain/context?q&mode&k&maxEntities`.
  Returns `ContextResult` with `hits`, `entities`, and a prompt-ready `contextMd` block.
  The brain does NO answer generation; pass `contextMd` verbatim into your LLM's prompt.
  Scope: `brain:read`.

- **`brain.ingest()`** (SDK): batch memory ingestion — `POST /v1/brain/ingest`.
  Accepts up to 100 conversation or document items per call. Conversations are routed
  through the signal-extraction pipeline (entity resolution + fact extraction). Documents
  land as extractable notes. Scope: `brain:write`.

- **`brain.writeDocs(docs[])`** (SDK): batch document write — `PUT /v1/brain/docs`.
  Single round-trip equivalent of calling `write()` on each document. Scope: `brain:write`.

- **`brain.patchDocMeta()`** (SDK): metadata-only `PATCH /v1/brain/doc` — update `title`,
  `tldr`, or `tags` without touching the body. Complement to `editDoc()` (body edits).
  Scope: `brain:write`.

- **`unison context "<query>" [--deep] [-k N] [--max-entities N] [--json]`** (CLI):
  prints `contextMd` by default; `--json` for the full structured response; `--deep`
  activates multi-hop graph expansion.

- **`unison ingest [--file <path>] [--conversation <json>] [--source-ref <ref>] [--visibility workspace|private]`**
  (CLI): ingest a markdown file as a document (`--file`) or a conversation JSON array of
  `{role,content}` turns (`--conversation` or stdin). Scope: `brain:write`.

- **`brain_context`** (MCP): wraps `brain.context()`. Description emphasises: use this
  BEFORE answering any question that may depend on the user's/team's history — pass
  `contextMd` verbatim into your prompt.

- **`brain_ingest`** (MCP): wraps `brain.ingest()`. Accepts `conversation` and `document`
  items via a discriminated-union `items[]` array.

- **`brain_search` `pathPrefix` param** (MCP + SDK): `GET /v1/brain/search` now accepts a
  `pathPrefix` query param to restrict results to documents under a given path.

- New types exported from `@unisonlabs/sdk`: `ContextOptions`, `ContextResult`,
  `ContextMode`, `SemanticHit`, `ContextEntity`, `IngestInput`, `IngestItem`,
  `IngestConversationItem`, `IngestDocumentItem`, `IngestResult`, `IngestItemResult`,
  `ConversationTurn`, `WriteDocInput`, `WriteDocsResult`, `EditDocMetaInput`.

### Removed

- `buildAuthorizeUrl`, `exchangeCode`, `generatePkce`, `randomState` (PKCE helpers) from SDK
- `startDeviceAuth`, `pollDeviceToken`, `PollStatus`, `PollResult` (device-flow helpers) from SDK
- `TokenResponse`, `PkcePair`, `AuthorizeUrlParams`, `ExchangeCodeParams`, `DeviceCodeResponse` types from SDK
- `open` npm dependency from `@unisonlabs/cli` (was used only for the browser loopback)

## [1.2.0]

### Added

- **Scoped device-code login.** `startDeviceAuth(baseUrl, { scopes }, fetchImpl?)`
  (SDK) now forwards the requested scopes to `/v1/auth/device/code` as a
  space-joined `scope` field, and the `unison auth login --device` flow requests
  the same scope set as the browser loopback flow. Previously the device flow
  sent no scopes, so headless logins were silently limited to the server's
  brain-only default and couldn't reach `work` / `chat` / `agent`. The server
  clamps every minted key to the approving user's role, so requesting the full
  set is safe.

## [1.0.0]

**Breaking change.** The server collapsed `/v1/tasks`, `/v1/workspace`, and
`/v1/crm` into a single `/v1/work` surface with an operation-DSL apply endpoint.
This release tracks that change: the `tasks`, `workspace`, and `crm` domains are
**removed** (no compat alias — they would 404 against a current server) and a new
`work` domain replaces them. Pin `@unisonlabs/sdk@^0.2` if you still talk to a
pre-`/v1/work` server.

### Removed

- `u.tasks.*`, `u.workspace.*`, `u.crm.*` (SDK); the `tasks`, `crm`, and
  `workspace` CLI command groups; and the `tasks_*` / `workspace_*` / `crm_*`
  MCP tools. All of `/v1/tasks/*`, `/v1/workspace/*`, and `/v1/crm/*` are gone.

### Added

- **`u.work.*`** (SDK): `apply({ operations, dryRun? })` — the one write entry
  point, taking the canonical operation DSL — plus `query`, `search`, `inspect`,
  `tree`, `folder`, `artifact`, `tableSchema`, `viewQuery`, and
  `assets.upload / create / readUrl`. Operation types ship as
  `WorkOperation` (a snapshot of the server's `@unison/agent-shared` schemas).
- **`unison work`** CLI: `apply`, `query`, `search`, `inspect`, `tree`,
  `folder`, `artifact`, `table`, `view`.
- **`work_apply` / `work_query` / `work_search` / `work_inspect` / `work_tree` /
  `work_folder` / `work_artifact`** MCP tools (a focused set — `work_apply`
  takes the op DSL directly rather than fanning out 47 per-op tools).
- **Surgical editing**: `u.brain.editDoc({ path, oldStr, newStr })` (SDK — an
  atomic server-side `str_replace` via `PATCH /brain/doc`, matched + applied in
  one transaction with a uniqueness check, matching Claude Code's `Edit`
  semantics), the `unison edit <path> --old … --new …` CLI command, and the
  `brain_edit` MCP tool.
- **Web search**: `u.research.search(query)` (SDK), `unison web-search <query>`
  (CLI), and the `web_search` MCP tool — a server-side proxy that is the
  client's route to the open web.
- **FS-contract write routing**: `client.write` now routes through the brain FS
  contract — a bare or unqualified `*.md` write lands in `/private/notes/<slug>.md`,
  and a non-contract namespace (legacy `/wiki/`, `/actions/`, `/skills/`, …)
  fails fast with a clear message before the round-trip. The server's
  `checkWritable` remains authoritative. Exported as `routeBrainWritePath` /
  `WRITABLE_BRAIN_ROOTS` / `BrainContractError`.

#### Migration

| Was (`0.2.x`) | Now (`1.0.0`) |
|---|---|
| `u.tasks.list(...)` / `u.tasks.create(...)` | `u.work.query({ viewId })` / `u.work.apply({ operations: [{ op: "record.upsert", tableId, values }] })` |
| `u.crm.searchRecords(...)` / `u.crm.createNote(...)` | `u.work.search({ query })` / `u.work.apply({ operations: [...] })` |
| `u.workspace.tree(id)` / `u.workspace.createArtifact(...)` | `u.work.tree({ folderId })` / `u.work.apply({ operations: [{ op: "artifact.mount", ... }] })` |
| `unison tasks list` / `unison crm …` / `unison workspace …` | `unison work query …` / `unison work search …` / `unison work apply` |
| `write /wiki/x.md` | `write /private/notes/x.md` (bare names auto-route) |

### Previously unreleased (folded into 1.0.0)

- A pixel-art brain mascot (`assets/brain.svg`) in the README header.

### Fixed

- `unison --version` now reports the real package version (read from
  `package.json` at runtime) instead of a hardcoded string that drifted out of
  sync with the published release.
- The MCP server (`@unisonlabs/mcp`) now reports its version from `package.json`
  at runtime instead of a hardcoded `0.1.0` that had drifted from the published
  package.

## [0.1.0] - 2026-05-23

First public release: the open-source client (SDK, CLI, MCP server, and Agent
Skill) for the hosted Unison brain at `https://brain.unisonlabs.ai`.

### Added

- `@unisonlabs/sdk` — typed client covering the full brain surface (documents,
  entities, facts, links, dedup review, jobs, status) plus PKCE and device-flow
  auth helpers.
- `@unisonlabs/cli` — the `unison` command: `auth login` (browser PKCE loopback,
  `--device` fallback, `--with-token` for CI), `search`, `grep`, `get`, `ls`,
  `write`, `rm`, `tag`, `share`, `neighbors`, `links`, `link`, `entity *`,
  `fact *`, `timeline`, `review *`, `jobs *`, `status`.
- `@unisonlabs/mcp` — MCP server exposing 8 curated brain tools.
- Filesystem navigation: `ls` (directory view by default, `--docs` for titles),
  `tree`, `find` (path glob), `cat` (alias of `get`).
- `unison skill install` — installs the Agent Skill into `~/.claude/skills/`.
- `unison completion <bash|zsh|fish>` — shell completion scripts.
- Confirmation prompts on destructive commands (`--yes` to skip; refuses in
  non-interactive shells without `--yes`).
- Actionable error hints (e.g. 401 → run `unison auth login`).

### Agent ergonomics

- Result data on **stdout**, status/progress on **stderr** (clean piping).
- Errors are a JSON envelope on stderr under `--json` (or `OUTPUT_FORMAT=json`),
  with `code` / `message` / `status` / `suggestedFix`.
- Distinct **exit codes**: 0 ok, 1 error, 3 not found, 4 auth, 5 conflict.
- JSON auto-compacts when piped (pretty on a TTY) to save agent tokens.
- `--help` documents `--json`, env vars, exit codes, and usage examples.

[Unreleased]: https://github.com/unison-labs-ai/unison-brain/compare/v1.5.1...HEAD
[1.5.1]: https://github.com/unison-labs-ai/unison-brain/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/unison-labs-ai/unison-brain/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/unison-labs-ai/unison-brain/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/unison-labs-ai/unison-brain/compare/v1.2.0...v1.4.0
[1.2.0]: https://github.com/unison-labs-ai/unison-brain/compare/v1.0.0...v1.2.0
[1.0.0]: https://github.com/unison-labs-ai/unison-brain/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/unison-labs-ai/unison-brain/releases/tag/v0.1.0
