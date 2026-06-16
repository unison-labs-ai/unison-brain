# @unisonlabs/mcp

Model Context Protocol server for the Unison brain — gives agents without a shell
(chat UIs, IDE integrations) read/write access to your cloud knowledge base.

> **🤖 AI agent?** Self-onboard via [AGENTS.md](https://github.com/unison-labs-ai/unison-brain/blob/main/AGENTS.md) — install → auth → skill → verify.

## Register it

```json
{
  "mcpServers": {
    "unison-brain": {
      "command": "npx",
      "args": ["-y", "@unisonlabs/mcp"],
      "env": {
        "UNISON_TOKEN": "usk_live_...",
        "UNISON_API_URL": "https://brain.unisonlabs.ai"
      }
    }
  }
}
```

Get a `UNISON_TOKEN` key via `unison auth login` (CLI) or the MCP's own `auth_provision` tool.

## Tools

A curated brain tool set (kept small to avoid context bloat): `brain_context`,
`brain_search`, `brain_grep`, `brain_get`, `brain_list`, `brain_neighbors`,
`brain_write`, `brain_edit`, `brain_resolve_entity`, `brain_facts_about`,
`brain_record_fact`, `brain_status`, `brain_ingest`, `brain_remember`.

Agents with a shell are usually better served by [`@unisonlabs/cli`](https://www.npmjs.com/package/@unisonlabs/cli)
plus the bundled skill (`unison skill install`) — the CLI exposes the full surface.

MIT © Unison Labs · [source + full docs](https://github.com/unison-labs-ai/unison-brain)
