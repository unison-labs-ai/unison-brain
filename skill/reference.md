# Unison CLI reference

Companion to `SKILL.md`. Every command accepts `--json` (machine output on stdout)
and `--actor <externalUserId>` (act as an end user; needs the `brain:act-as`
scope). Run `unison <cmd> --help` for the authoritative flag list.

Writing code instead of running shell commands? Use the SDK (`@unisonlabs/sdk`;
methods listed in its `AGENT-REFERENCE.md`). No shell at all? The MCP server
(`@unisonlabs/mcp`) exposes the same operations as `brain_*` / `auth_*` tools.

## Recall

| Command | What it does |
|---|---|
| `unison context "<q>" [--deep] [--path-prefix <p>] [--include-bodies] [-k <n>] [--max-entities <n>]` | One-call recall: prompt-ready `contextMd` from hybrid search + rerank + entity facts. |
| `unison search "<q>" [-k <n>] [--kind <k>...] [--tag <t>...] [--memory-type <t>] [--as-of <ts>] [--path-prefix <p>]` | Ranked hybrid (keyword + semantic) hits. `--as-of` time-travels. |
| `unison grep "<regex>"` | Exact regex scan over document bodies. |
| `unison get <path>` | Print one document raw. |
| `unison ls [path] [--docs]` / `unison tree [path]` / `unison find <glob>` | Browse the brain filesystem. |
| `unison neighbors <idOrPath>` / `unison links` / `unison link <fromId> <toId>` | Document graph. |

## Write

| Command | What it does |
|---|---|
| `unison write <path> [-m "<content>"]` | Create/replace a doc; reads stdin when `-m` omitted. Bare names route to `/private/notes/`. |
| `unison edit <path> --old "…" --new "…"` | Surgical in-place edit; `--old` must match exactly once. |
| `unison rm <path> --yes` | Delete a document. |
| `unison tag <path> [--add <t>...] [--remove <t>...]` | Manage tags. |
| `unison ingest --file <md> [--title <t>] [--doc-path <p>] [--source-ref <ref>] [--visibility workspace\|private]` | Ingest a document through the extraction pipeline (entities + facts get built). |
| `unison remember [--session <jsonl>\|--file <p>\|--text <t>\|stdin] [--hints <h>] [--source <s>] [--source-ref <ref>]` | Hand a whole dump (session log, transcript, freeform notes) to the server-side `/remember` engine: it filters the ephemeral, dedupes against existing memory, and files only the durable bits as curated `/private/kb` notes + entity facts. `--source-ref` makes re-running idempotent. |

Writable path roots: `/private/…` (personal; free-form subtrees allowed except
`/private/sources/*`), `/workspace/…` (workspace-shared), `/workspace/teams/<slug>/…` (team folder).
Paths are lowercase kebab-case ending in `.md`. **Bare names are accepted by
`write` only** (the server routes them to `/private/notes/` and the command
prints the resolved path); `get`, `edit`, `rm`, and `tag` need the full path.

## Migration (in and out)

| Command | What it does |
|---|---|
| `unison migrate` | Guided wizard: detects memory systems on the machine (coding-agent memory dirs, Obsidian vaults, custom paths), imports what you pick, prints the cutover checklist. |
| `unison migrate markdown <dir> [--prefix /private/kb] [--visibility private\|workspace] [--tag <t>...] [--exclude <rel>...] [--dry-run]` | Import a markdown tree (knowledge base, Obsidian vault, any tool's markdown export). Idempotent: diffs against the brain and writes only new/changed docs — re-run any time to sync. |
| `unison migrate json <file> [--prefix /private/imported] [--dry-run]` | Import any memory system's JSON export — array of objects; id/title/content/tags field aliases auto-detected. |
| `unison export <dir> [--path-prefix </...>]` | Export brain docs to a markdown directory with frontmatter (incl. `unison-path`) — the lossless backward path. |

## Knowledge graph

| Command | What it does |
|---|---|
| `unison entity resolve "<name>"` | Find a person/company/project by name. |
| `unison entity ls` / `unison entity get <id>` / `unison entity set <kind> <name>` | List / inspect / upsert entities. |
| `unison fact ls --entity <id>` | Facts the brain holds about an entity. |
| `unison fact add <entityId> <predicate> "<text>"` | Record a fact. |
| `unison fact correct <factId>` | Supersede a fact with a corrected one. |
| `unison fact rm <factId> --yes` | Retract a fact. |

| `unison timeline <entityId> [--from <ts>] [--to <ts>]` | Chronological facts for an entity (bitemporal). |
| `unison review ls\|merge\|distinct\|merges\|undo` | Entity-dedup review queue (admin; `merge`/`undo` need `--yes`). |

## Auth, workspaces, account

| Command | What it does |
|---|---|
| `unison auth login --email <email>` | Provision/login; emails a one-time code. |
| `unison auth token <usk_>` | Authenticate by pasting an API key (e.g. from the web app settings); validates then stores it. |
| `unison auth verify <code>` | Complete login; stores the API key locally. |
| `unison auth status` / `unison auth logout` | Inspect / clear stored credentials. |
| `unison auth keys [ls]` / `unison auth keys create --name <n> [--scopes <s>...]` / `unison auth keys revoke <id>` | Manage API keys (`usk_…`). Default scopes: `brain:read brain:write`. |
| `unison invite <email> [--role admin\|member\|viewer]` | Invite someone to the workspace (top-level, not under `auth`). |
| `unison invites [ls]` / `unison invites revoke <id>` | List / revoke pending invitations. |
| `unison workspaces` / `unison switch <workspaceIdOrName>` | List memberships / switch active workspace. |
| `unison status` | Brain health + document/entity/fact counts. |
| `unison jobs ls\|stats\|retry <id>` | Background pipeline queue (admin). |
| `unison skill install [--dir <path>]` / `unison skill print` | (Re)install or print this skill. |

## Environment

| Variable | Effect |
|---|---|
| `UNISON_TOKEN` | API key; overrides the stored login. The headless/CI path. |
| `UNISON_API_URL` | Override the API base URL (default `https://brain.unisonlabs.ai`). Leave unset in normal use. |

## Output contract

Result data → **stdout** (JSON with `--json`, auto-compacted when piped).
Status and errors → **stderr** as a JSON envelope. Exit codes: `0` ok, `4` auth,
`3` not found, `5` conflict, `6` free-tier quota (verify email to lift), `1` other. Destructive commands require `--yes`
when non-interactive.
