#!/usr/bin/env bun
/**
 * Smoke test for the `remember` client surface across SDK + CLI + MCP.
 *
 * No deployed endpoint needed: a local stub records POST /v1/brain/remember and
 * returns { jobId }. Each client is exercised for real (SDK in-process, CLI +
 * MCP as spawned processes) and we assert the request shape + the parsed result.
 *
 *   bun scripts/smoke-remember.ts
 */

import { BrainClient } from "../packages/sdk/src/index";

interface Recorded {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}

const recorded: Recorded[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/v1/brain/remember") {
      recorded.push({
        method: req.method,
        path: url.pathname,
        auth: req.headers.get("authorization"),
        body: await req.json().catch(() => null),
      });
      return Response.json({ jobId: "smoke-job-1" });
    }
    return new Response("not found", { status: 404 });
  },
});
const base = `http://localhost:${server.port}`;
const TOKEN = "usk_test_smoke";
let failures = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

// ── 1. SDK ───────────────────────────────────────────────────────────────────
{
  const client = new BrainClient({ baseUrl: base, token: TOKEN });
  const res = await client.remember({ dump: "we chose Postgres LISTEN/NOTIFY", source: "smoke" });
  const r = recorded.at(-1);
  ok("SDK: remember() returns jobId", res.jobId === "smoke-job-1", JSON.stringify(res));
  ok("SDK: POST /v1/brain/remember", r?.method === "POST" && r?.path === "/v1/brain/remember");
  ok("SDK: sends bearer token", r?.auth === `Bearer ${TOKEN}`);
  ok(
    "SDK: body carries dump + source",
    (r?.body as { dump?: string; source?: string })?.dump === "we chose Postgres LISTEN/NOTIFY" &&
      (r?.body as { source?: string })?.source === "smoke",
  );
}

// ── 2. CLI ───────────────────────────────────────────────────────────────────
{
  const proc = Bun.spawn(
    [
      "bun",
      "packages/cli/src/index.ts",
      "remember",
      "--text",
      "we shipped the remember endpoint",
      "--json",
    ],
    {
      env: { ...process.env, UNISON_API_URL: base, UNISON_TOKEN: TOKEN },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const r = recorded.at(-1);
  ok("CLI: `unison remember` prints jobId", out.includes("smoke-job-1"), out.trim().slice(0, 120));
  ok("CLI: hit POST /v1/brain/remember", r?.path === "/v1/brain/remember" && r?.method === "POST");
  ok(
    "CLI: body carries the text dump",
    (r?.body as { dump?: string })?.dump === "we shipped the remember endpoint",
  );
}

// ── 3. MCP ───────────────────────────────────────────────────────────────────
{
  const proc = Bun.spawn(["bun", "packages/mcp/src/index.ts"], {
    env: { ...process.env, UNISON_API_URL: base, UNISON_TOKEN: TOKEN },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const rpc = (id: number, method: string, params: unknown) =>
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
  proc.stdin.write(
    rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0" },
    }),
  );
  proc.stdin.write(rpc(2, "tools/list", {}));
  proc.stdin.write(
    rpc(3, "tools/call", {
      name: "brain_remember",
      arguments: { dump: "mcp smoke dump", source: "mcp-smoke" },
    }),
  );
  await proc.stdin.flush?.();
  // Read for a short window, then stop the server.
  const reader = proc.stdout.getReader();
  let buf = "";
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
    if (buf.includes("brain_remember") && buf.includes("smoke-job-1")) break;
  }
  proc.kill();
  ok("MCP: tools/list exposes brain_remember", buf.includes("brain_remember"));
  ok("MCP: brain_remember call returns jobId", buf.includes("smoke-job-1"));
  ok(
    "MCP: reached POST /v1/brain/remember",
    recorded.some((r) => (r.body as { source?: string })?.source === "mcp-smoke"),
  );
}

server.stop(true);
console.log(
  `\n${failures === 0 ? "✓ ALL GREEN" : `✗ ${failures} failure(s)`} — ${recorded.length} request(s) recorded`,
);
process.exit(failures === 0 ? 0 : 1);
