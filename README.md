<div align="center">

<img src="assets/brain.svg" alt="Unison Brain" width="180" />

# Unison Brain

### Your agents have the memory of a goldfish.

**One brain, every agent.** A cloud brain that Claude Code, Cursor, Codex — and your
research, ops, and personal agents — read from _and write back to_, on any machine,
for every teammate. Not another per-tool memory silo; the one source of truth they
all share — with **temporal facts that know what changed when** and **entity
resolution that knows who's who**, the parts a vector dump gets wrong.

[![CI](https://github.com/unison-labs-ai/unison-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/unison-labs-ai/unison-brain/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@unisonlabs/cli?logo=npm&color=cb3837&label=cli)](https://www.npmjs.com/package/@unisonlabs/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/unison-labs-ai/unison-brain?style=social)](https://github.com/unison-labs-ai/unison-brain)

[**Why**](#the-hard-part--what-every-memory-system-gets-wrong) • [**Benchmarks**](#benchmarks--run-them-yourself) • [**Quickstart**](#quickstart) • [**Install**](#install) • [**For agents**](#for-agents) • [**SPEC**](./SPEC.md)

</div>

---

> **🤖 Reading this as an AI agent?** Install the CLI, then run `unison skill install`
> and adopt [`skill/SKILL.md`](./skill/SKILL.md) — the canonical agent guide: setup,
> login, the recall-before-reasoning loop, and when/how to save what you learn.
> [`AGENTS.md`](./AGENTS.md) has the MCP fallback and repo-contributor guide.

Every agent starts each session blank — the context window resets the moment you
close the terminal. The usual patches only half-fix it: a `CLAUDE.md` here, Cursor's
memory there, a local `notes.md` in one repo, a wiki nobody syncs. The knowledge
survives, but it's *trapped* — scoped to one tool, one repo, one machine, one person.
It never travels. The decisions and the hard-won *why* end up everywhere except where
your **next** agent can reach them.

The **Unison brain** is a hosted knowledge base — decisions, conventions,
architecture, prior fixes, people — that any agent *reads from and writes back to*,
from any machine, with one command:

```bash
unison search "why did we pick email-otp auth"
```

It's not only for coding agents: the same brain backs your research, ops, and personal
agents too. It's a knowledge graph of documents, entities, and bitemporal facts — not
a codebase index — so anything worth remembering lives in one place every agent shares.
Coding agents are just the sharpest first example.

This repo is the **open-source client**: a CLI, an SDK, an MCP server, and an agent
skill. No local database, no vector index to run, no framework to adopt — the brain
lives in the cloud and every surface speaks one API. It's open source so you can read
exactly what it sends before you pipe it into an agent with shell access; the backend
that stores and searches your data is a separate, closed service ([`SPEC.md`](./SPEC.md)
is the contract this client speaks).

## What's in the box

| Package | Install as | What it is |
| --- | --- | --- |
| [`@unisonlabs/cli`](./packages/cli) | `unison` | The CLI: `search`, `get`, `write`, `list`, `status`, `auth`. |
| [`@unisonlabs/sdk`](./packages/sdk) | `@unisonlabs/sdk` | Typed HTTP client the CLI and MCP server are built on. |
| [`@unisonlabs/mcp`](./packages/mcp) | `unison-brain-mcp` | A Model Context Protocol server for agents without shell access. |
| [`skill/SKILL.md`](./skill/SKILL.md) | — | The primary agent entry: a drop-in [Agent Skill](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) covering setup, auth, recall, and capture (+ [`reference.md`](./skill/reference.md)). |

The SDK is the core; the CLI and MCP server are thin wrappers over it, and the
skill wraps the CLI — one API contract, four surfaces.

## With the brain vs. without

| 🐟 Without a brain | 🧠 With Unison |
| --- | --- |
| _"Why did we switch to email-OTP auth?"_ → the agent greps, guesses, or asks you for the third time | `unison search "why email-otp auth"` → the actual decision **and its reasoning**, in one second |
| New laptop, new repo, new teammate → re-explain the whole architecture from scratch | One brain. Every agent, every machine, every teammate reads the **same source of truth** |
| `CLAUDE.md` / `.cursorrules` go stale the day after you write them | Agents **write back** what they learn, so the brain stays current on its own |
| mem0 / Letta / Zep are frameworks you _build an agent with_ | Plugs into the agents you **already use** — nothing to host, no migration |
| A flat log of past chat messages | A **knowledge graph**: entities (people, projects) + bitemporal facts — _who_, _what_, and _what changed when_ |

## The hard part — what every memory system gets wrong

Bolting "memory" onto an agent is easy: dump messages into a vector DB, embed,
retrieve. That gets you ~80% — and for a single user remembering a preference, the
model providers now give that away for free. The remaining 20% is where memory
actually breaks, and it's the whole point of Unison:

- **Temporal correctness.** Facts change. Someone switches jobs, a decision gets
  reversed, a price updates. Most memory systems keep returning the stale fact
  *with confidence*. Unison stores **bitemporal facts with supersession chains** —
  it knows not just what's true, but *what changed when*, and stops surfacing the
  version that's no longer true.
- **Identity resolution.** "Dan", "Daniel", `daniel@…`, and "the new backend hire"
  are one person. Naive memory stores them as four, and the facts scatter. Unison
  runs **tiered entity resolution** (deterministic → fuzzy → a calibrated LLM judge,
  auto-merging above a confidence threshold) so facts attach to the right entity.
- **One brain, every agent — shared and consistent.** Per-tool memory (Cursor's, a
  `CLAUDE.md`, mem0 inside one app) is a silo. Unison is **one source of truth every
  agent and teammate reads from and writes back to** — Claude Code, Cursor, Codex,
  voice, your backend — so your fleet doesn't hold contradictory beliefs.

**"Can't I just build this with Postgres + pgvector?"** You can build the 80%. The
20% above — temporal supersession, calibrated identity resolution, multi-agent
consistency, and the retrieval tuning that makes memory *drive decisions* instead of
just echo them — is what this project is. And we measure it in the open, so you don't
have to take our word for it ([see below](#benchmarks--run-them-yourself)).

## Benchmarks — run them yourself

Memory benchmarks in this space are mostly self-reported and don't reproduce: vendors
quote headline numbers against weak baselines, and independent attempts to reproduce
those scores have failed. We do the opposite. [**Unison-evals**](https://github.com/unison-labs-ai/Unison-evals)
is an open harness that scores every memory system — **including ours** — on the same
code, with a **decision-driving** test (memory that must change what the agent *does*,
not just what it can recall) that most vendor benchmarks avoid.

No cherry-picked baselines. Clone it, run it, check our claims against everyone else's.

## Quickstart

```bash
npm i -g @unisonlabs/cli
unison auth login                          # enter email → OTP → signed in
unison status                              # confirm you're connected
unison search "auth decision"              # search the brain
unison write /private/notes/x.md          # pipe content in or pass --file
unison context "what did we decide about auth?"   # one-call memory recall
```

Documents: `search`, `grep`, `cat`/`get`, `ls`, `tree`, `find`, `write`, `edit`,
`rm`, `tag`, `share`, `neighbors`, `links`, `link`. Graph: `entity …`, `fact …`,
`timeline`. Admin: `review …`, `jobs …`. Add `--json` to any
command. Full surface and the backend contract are in [`SPEC.md`](./SPEC.md).

## Browse the brain like a filesystem

The brain is path-addressable (`/private/`, `/workspace/`, `/system/`), so it
navigates with the commands you already know:

```bash
unison ls                            # entries at the root (dirs + files)
unison ls /private                   # entries under /private
unison ls /workspace/people --docs   # documents with titles instead of the dir view
unison tree /private                 # recursive tree under /private
unison find '/private/**auth*'       # paths matching a glob
unison cat /workspace/projects/architecture.md  # read a document (alias of `get`)
unison cat --raw '/system/...'       # read any tier, including synthetic ones
unison grep "TODO" --json            # regex scan over document bodies
```

## Query the knowledge graph

Beyond documents, the brain has entities (canonical people/projects/companies)
and bitemporal facts about them:

```bash
id=$(unison entity resolve "Daniel" --json | jq -r .entity.id)
unison fact ls --entity "$id"          # what the brain knows about Daniel
unison timeline "$id"                   # facts over time
unison fact add "$id" works_at "Joined Unison in 2026" --confidence 0.9
unison neighbors /workspace/projects/architecture.md  # linked documents
```

## For agents

**Self-onboarding:** point your agent at [`AGENTS.md`](./AGENTS.md) — it walks any
agent (Claude Code, Cursor, Codex, or any MCP/CLI-capable agent) from zero to a
working brain in four steps, then teaches the search-first / write-back loop.

Pass `--json` for machine output: results are JSON on **stdout** (compact when
piped); errors are a JSON envelope on **stderr** with a nonzero exit code
(`4` auth, `3` not found, `5` conflict, `1` other). Destructive commands (`rm`,
`fact rm`, `review merge`) require `--yes` in non-interactive shells. Drop the
skill in with `unison skill install`, or run `unison --help` / `unison <cmd>
--help` — the help is written to be read by an agent.

```bash
unison search "rate limiting" -k 5 --json | jq '.[].doc.path'
unison get /workspace/projects/architecture.md --json
```

## Authentication

`unison auth login` signs you in via email-OTP — enter your email, get a code,
done. No browser, no OAuth dance. Account creation and key recovery both happen
in the terminal. The key is stored at `~/.config/unison/config.json` (mode `0600`).

```bash
unison auth login                        # prompts for email; sends OTP
unison auth verify <code>                # (optional) verify to lift usage caps
unison auth keys                         # list your API keys
unison auth keys create --name ci        # mint a key for CI; token shown once
unison auth keys revoke <id>             # revoke a key
unison invite colleague@company.com      # invite someone to your workspace
unison invites                           # list pending invitations
```

**Multi-workspace** — if you belong to more than one workspace:

```bash
unison workspaces ls                     # list all workspace memberships
unison switch <workspaceId>              # switch active workspace (mints or recalls key)
unison switch "Team Brain"               # also accepts a unique name
```

**Actor delegation** (service keys acting on behalf of end users):

```bash
# Mint a service key with brain:act-as scope (owner/admin only)
unison auth keys create --name service --scopes brain:read brain:write brain:act-as

# Per-command delegation
unison write /private/notes/x.md --actor user-001 -m "hello"
unison search "query" --actor user-001

# Global delegation via env var (all brain commands)
export UNISON_ACTOR=user-001
unison search "query"
```

For **CI and headless agents**, skip interaction — set an API key:

```bash
export UNISON_TOKEN="usk_live_..."   # overrides the stored credential
export UNISON_API_URL="https://brain.unisonlabs.ai"   # optional; this is the default
```

`UNISON_TOKEN` always takes precedence over the stored file.

## Install

```bash
npm i -g @unisonlabs/cli      # or: pnpm add -g / bun add -g / npx @unisonlabs/cli
unison auth login             # enter your email; OTP sent; key stored
```

Distributed via npm as three packages: **`@unisonlabs/cli`** (the `unison` binary),
**`@unisonlabs/sdk`** (the typed client library), and **`@unisonlabs/mcp`** (the MCP
server). The published binaries are plain compiled JS with a
`#!/usr/bin/env node` shebang — they run on Node or Bun, no runtime to install.

## Use it from an agent

**Claude Code / Cursor / Codex (with a shell):** install the CLI, then install the
skill so the agent knows when and how to use the brain (or just point the agent at
[`AGENTS.md`](./AGENTS.md) and let it self-onboard):

```bash
unison skill install      # writes the skill to ~/.claude/skills/unison-brain/
```

**Agents without a shell:** register the MCP server.

```json
{
  "mcpServers": {
    "unison-brain": {
      "command": "npx",
      "args": ["-y", "@unisonlabs/mcp"],
      "env": { "UNISON_TOKEN": "usk_live_...", "UNISON_API_URL": "https://brain.unisonlabs.ai" }
    }
  }
}
```

## Shell completion

```bash
source <(unison completion bash)   # bash — add to ~/.bashrc
source <(unison completion zsh)    # zsh  — add to ~/.zshrc
unison completion fish > ~/.config/fish/completions/unison.fish
```

## SDK

```ts
import { BrainClient } from "@unisonlabs/sdk";
const u = new BrainClient({ baseUrl: "https://brain.unisonlabs.ai", token: process.env.UNISON_TOKEN });

// Brain: search, write, and surgically edit knowledge.
const hits = await u.search("auth decision", { limit: 5 });
await u.write({ path: "/private/notes/auth.md", bodyMd: "We chose email-OTP because …" });
await u.editDoc({ path: "/private/notes/auth.md", oldStr: "email-OTP", newStr: "email-OTP (verified)" });

// Graph: resolve an entity and read the facts the brain holds about it.
const daniel = await u.entities.resolve("Daniel");
const facts = daniel ? await u.facts.about(daniel.id) : [];

// Multi-workspace: list memberships and list keys for another workspace.
const workspaces = await u.workspaces.list();           // [{ id, name, role, active }]
const otherKeys = await u.keys.list({ workspaceId: workspaces[1]?.id });

// Actor delegation: service key acting on behalf of end users (requires brain:act-as scope).
const svc = new BrainClient({ apiUrl: "https://brain.unisonlabs.ai", token: serviceKey });
const user1 = svc.withActor("user-001");
const user2 = svc.withActor("user-002");
await user1.write({ path: "/private/notes/x.md", bodyMd: "user 1 note" });
const r = await user2.search("query");           // isolated from user-001
const me = await user1.whoami();                 // .actedAs = { externalId: "user-001", userId }
```

See [`examples/`](./examples) for more.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun test                                    # unit tests (SDK + CLI)
bun lint                                     # Biome
bun run packages/cli/src/index.ts --help     # run the CLI from source
bun run build                                # bundle each package to dist/
node packages/cli/dist/index.js --help       # run the built (node) binary
```

This is a Bun workspace monorepo: `packages/*` resolve each other by name during
development. `bun run build` bundles the CLI and MCP server into self-contained
`dist/index.js` files (the SDK is bundled in; only npm deps stay external).

The hosted brain is live at `https://brain.unisonlabs.ai` (the default). To develop
against a different backend, point the client with `UNISON_API_URL`
or `unison auth login --api-url <url>`.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=unison-labs-ai/unison-brain&type=Date)](https://star-history.com/#unison-labs-ai/unison-brain&Date)

If the brain saves your agent one "wait, why did we do it this way?" — drop a ⭐ to help others find it.

## Contributing & security

Contributions welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the
[`CHANGELOG.md`](./CHANGELOG.md). Found a vulnerability? See
[`SECURITY.md`](./SECURITY.md) — please report privately, not via a public issue.

## Part of the Unison Labs constellation

**One brain, every agent.** Every repo below reads from _and writes to_ the same [Unison brain](https://unisonlabs.ai) — no per-tool memory silos.

| Repo | What it does |
|---|---|
| **[unison-brain](https://github.com/unison-labs-ai/unison-brain)** | **CLI · SDK · MCP server — the core ← you are here** |
| [claude-unison](https://github.com/unison-labs-ai/claude-unison) | Memory for Claude Code |
| [cursor-unison](https://github.com/unison-labs-ai/cursor-unison) | Memory for Cursor |
| [codex-unison](https://github.com/unison-labs-ai/codex-unison) | Memory for OpenAI Codex CLI |
| [opencode-unison](https://github.com/unison-labs-ai/opencode-unison) | Memory for OpenCode |
| [openclaw-unison](https://github.com/unison-labs-ai/openclaw-unison) | Memory for OpenClaw |
| [pipecat-unison](https://github.com/unison-labs-ai/pipecat-unison) | Memory for Pipecat voice agents |
| [python-sdk](https://github.com/unison-labs-ai/python-sdk) | Python SDK for the brain |
| [install-mcp](https://github.com/unison-labs-ai/install-mcp) | One-command MCP installer |
| [code-chunk](https://github.com/unison-labs-ai/code-chunk) | AST-aware code chunking |
| [unison-fs](https://github.com/unison-labs-ai/unison-fs) | Mount the brain as a filesystem |
| [backchannel](https://github.com/unison-labs-ai/backchannel) | Async messaging between agents |
| [Unison-evals](https://github.com/unison-labs-ai/Unison-evals) | Open memory benchmark suite |

## License

MIT © Unison Labs
