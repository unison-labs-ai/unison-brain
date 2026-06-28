import { describe, expect, test } from "bun:test";
import { BrainClient } from "./client";
import { BrainError } from "./errors";
import { parseResponse } from "./http";

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("BrainClient documents", () => {
  test("search builds the query (k, kinds, tags) and sends the bearer token", async () => {
    let url = "";
    let auth = "";
    const client = new BrainClient({
      baseUrl: "https://api.test/",
      token: "tok",
      fetch: stubFetch((u, init) => {
        url = u;
        auth = (init?.headers as Record<string, string>).authorization ?? "";
        return json({ results: [] });
      }),
    });

    await client.search("hello world", { limit: 5, kinds: ["wiki_page", "raw"], tags: ["x"] });

    expect(url).toContain("/v1/brain/search?");
    expect(url).toContain("q=hello+world");
    expect(url).toContain("k=5");
    expect(url).toContain("kind=wiki_page");
    expect(url).toContain("kind=raw");
    expect(url).toContain("tag=x");
    expect(auth).toBe("Bearer tok");
  });

  test("search returns body-less doc summaries (no bodyMd)", async () => {
    // The /v1/brain/search endpoint returns metadata-only docs (SPEC §5.1).
    // SearchResult.doc is typed as BrainDocumentSummary so callers can't read
    // a `bodyMd` that is never present — they must fetch it via get().
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch(() =>
        json({
          results: [
            {
              doc: {
                id: "d1",
                path: "/private/notes/auth.md",
                kind: "note",
                title: "Auth decision",
                tldr: "We chose device-flow.",
                tags: ["auth"],
                visibility: "workspace",
                updatedAt: "2026-05-31T00:00:00Z",
                contentHash: "abc",
              },
              score: 0.9,
              sources: ["vector"],
            },
          ],
        }),
      ),
    });

    const results = await client.search("auth decision");
    expect(results).toHaveLength(1);
    expect(results[0]?.doc.path).toBe("/private/notes/auth.md");
    expect(results[0]?.doc.tldr).toBe("We chose device-flow.");
    // The hit is a summary: no body is sent over the wire.
    expect("bodyMd" in (results[0]?.doc ?? {})).toBe(false);
  });

  test("write PUTs the document body to a contract path", async () => {
    let method = "";
    let captured = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        method = init?.method ?? "";
        captured = String(init?.body ?? "");
        return json({ id: "1", path: "/private/notes/x.md", kind: "note", bodyMd: "hi" });
      }),
    });

    const doc = await client.write({ path: "/private/notes/x.md", bodyMd: "hi" });
    expect(method).toBe("PUT");
    expect(JSON.parse(captured).path).toBe("/private/notes/x.md");
    expect(JSON.parse(captured).bodyMd).toBe("hi");
    expect(doc.path).toBe("/private/notes/x.md");
  });

  test("write default-routes a bare name to /private/notes", async () => {
    let captured = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        captured = String(init?.body ?? "");
        return json({
          id: "1",
          path: "/private/notes/auth-decision.md",
          kind: "note",
          bodyMd: "x",
        });
      }),
    });

    await client.write({ path: "Auth Decision.md", bodyMd: "x" });
    expect(JSON.parse(captured).path).toBe("/private/notes/auth-decision.md");
  });

  test("write rejects a non-contract namespace before the round-trip", async () => {
    let called = false;
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch(() => {
        called = true;
        return json({});
      }),
    });

    await expect(client.write({ path: "/wiki/x.md", bodyMd: "x" })).rejects.toThrow(/FS contract/);
    expect(called).toBe(false);
  });

  test("editDoc sends one atomic PATCH with oldStr/newStr (server does match + uniqueness)", async () => {
    const calls: { method: string; url: string; body: string }[] = [];
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((u, init) => {
        calls.push({ method: init?.method ?? "", url: u, body: String(init?.body ?? "") });
        return json({ id: "1", path: "/private/notes/x.md", bodyMd: "alpha BETA gamma" });
      }),
    });

    await client.editDoc({ path: "/private/notes/x.md", oldStr: "beta", newStr: "BETA" });
    // No client read-modify-write: a single PATCH, server matches + replaces.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toContain("/v1/brain/doc");
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.oldStr).toBe("beta");
    expect(body.newStr).toBe("BETA");
  });

  test("editDoc refuses a no-op (oldStr === newStr) without a round-trip", async () => {
    let called = false;
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch(() => {
        called = true;
        return json({ id: "1", path: "/private/notes/x.md" });
      }),
    });

    await expect(
      client.editDoc({ path: "/private/notes/x.md", oldStr: "a", newStr: "a" }),
    ).rejects.toThrow(/identical/);
    expect(called).toBe(false);
  });
});

describe("BrainClient namespaces", () => {
  test("facts.about hits the entity-scoped path and unwraps facts", async () => {
    let url = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({ facts: [{ id: "f1", subjectId: "e1", predicate: "p", factText: "t" }] });
      }),
    });

    const facts = await client.facts.about("e1", { includeInvalidated: true });
    expect(url).toContain("/v1/brain/entities/e1/facts?");
    expect(url).toContain("includeInvalidated=true");
    expect(facts[0]?.id).toBe("f1");
  });

  test("review.resolve POSTs the verdict", async () => {
    let method = "";
    let body = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        method = init?.method ?? "";
        body = String(init?.body ?? "");
        return json({ ok: true });
      }),
    });

    const res = await client.review.resolve("c1", "merge");
    expect(method).toBe("POST");
    expect(JSON.parse(body).verdict).toBe("merge");
    expect(res.ok).toBe(true);
  });
});

describe("parseResponse", () => {
  test("throws a BrainError carrying the API error code", async () => {
    expect(
      parseResponse(json({ error: { code: "not_found", message: "nope" } }, 404)),
    ).rejects.toThrow(BrainError);
  });
});

describe("BrainClient context", () => {
  test("context builds the correct GET params", async () => {
    let url = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({
          query: "auth decision",
          mode: "deep",
          generatedAt: "2026-06-10T00:00:00Z",
          topScore: 0.92,
          weakEvidence: false,
          hits: [],
          entities: [],
          contextMd: "## Memory\n\nWe chose device-flow.",
        });
      }),
    });

    const result = await client.context({ query: "auth decision", mode: "deep", k: 5 });
    expect(url).toContain("/v1/brain/context?");
    expect(url).toContain("q=auth+decision");
    expect(url).toContain("mode=deep");
    expect(url).toContain("k=5");
    expect(result.contextMd).toBe("## Memory\n\nWe chose device-flow.");
    expect(result.weakEvidence).toBe(false);
  });

  test("context uses GET and returns contextMd", async () => {
    let method = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        method = init?.method ?? "";
        return json({
          query: "q",
          mode: "auto",
          generatedAt: "2026-06-10T00:00:00Z",
          topScore: null,
          weakEvidence: true,
          hits: [],
          entities: [],
          contextMd: "",
        });
      }),
    });

    await client.context({ query: "q" });
    expect(method).toBe("GET");
  });
});

describe("BrainClient ingest", () => {
  test("ingest document item is sent correctly", async () => {
    let captured = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        captured = String(init?.body ?? "");
        return json({
          items: [
            { type: "document", docId: "doc-1", path: "/private/notes/foo.md", jobIds: ["j1"] },
          ],
        });
      }),
    });

    const result = await client.ingest({
      items: [{ type: "document", content: "# Foo\n\nBar.", title: "Foo", visibility: "private" }],
    });

    const body = JSON.parse(captured);
    expect(body.items[0].type).toBe("document");
    expect(body.items[0].content).toBe("# Foo\n\nBar.");
    expect(result.items[0]).toMatchObject({ type: "document", path: "/private/notes/foo.md" });
  });
});

describe("BrainClient writeDocs", () => {
  test("writeDocs PUTs to /brain/docs and returns documents array", async () => {
    let method = "";
    let url = "";
    let captured = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((u, init) => {
        method = init?.method ?? "";
        url = u;
        captured = String(init?.body ?? "");
        return json({
          documents: [
            { id: "1", path: "/private/notes/a.md", kind: "note", bodyMd: "A" },
            { id: "2", path: "/private/notes/b.md", kind: "note", bodyMd: "B" },
          ],
        });
      }),
    });

    const docs = await client.writeDocs([
      { path: "/private/notes/a.md", bodyMd: "A" },
      { path: "/private/notes/b.md", bodyMd: "B" },
    ]);

    expect(method).toBe("PUT");
    expect(url).toContain("/v1/brain/docs");
    const body = JSON.parse(captured);
    expect(body.docs).toHaveLength(2);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.path).toBe("/private/notes/a.md");
  });
});

describe("BrainClient search pathPrefix", () => {
  test("search forwards pathPrefix as a query param", async () => {
    let url = "";
    const client = new BrainClient({
      baseUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({ results: [] });
      }),
    });

    await client.search("auth", { pathPrefix: "/private/notes" });
    expect(url).toContain("pathPrefix=%2Fprivate%2Fnotes");
  });
});

describe("BrainClient constructor apiUrl alias", () => {
  test("apiUrl is accepted as the primary option", async () => {
    let url = "";
    const client = new BrainClient({
      apiUrl: "https://api.alias-test",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({ results: [] });
      }),
    });

    await client.search("hello");
    expect(url).toContain("https://api.alias-test/");
  });

  test("baseUrl still works as legacy alias", async () => {
    let url = "";
    const client = new BrainClient({
      baseUrl: "https://api.legacy-test",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({ results: [] });
      }),
    });

    await client.search("hello");
    expect(url).toContain("https://api.legacy-test/");
  });

  test("throws when apiUrl and baseUrl are both set and differ", () => {
    expect(
      () =>
        new BrainClient({
          apiUrl: "https://api.one",
          baseUrl: "https://api.two",
          token: "tok",
        }),
    ).toThrow(/differ/);
  });

  test("accepts apiUrl and baseUrl when they are identical", async () => {
    let url = "";
    const client = new BrainClient({
      apiUrl: "https://api.same",
      baseUrl: "https://api.same",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({ results: [] });
      }),
    });

    await client.search("hello");
    expect(url).toContain("https://api.same/");
  });
  test("defaults to the hosted brain when neither apiUrl nor baseUrl is provided", () => {
    const client = new BrainClient({ token: "usk_test" });
    // @ts-expect-error private access for assertion
    expect(client.baseUrl).toBe("https://brain.unisonlabs.ai");
  });
});

// ── Actor delegation ──────────────────────────────────────────────────────────

describe("BrainClient actor delegation", () => {
  test("sends X-Unison-Actor header when actor is set via options", async () => {
    let capturedActor = "";
    const client = new BrainClient({
      apiUrl: "https://api.test",
      token: "tok",
      actor: "user-123",
      fetch: stubFetch((_u, init) => {
        capturedActor = (init?.headers as Record<string, string>)["x-unison-actor"] ?? "";
        return json({ results: [] });
      }),
    });

    await client.search("hello");
    expect(capturedActor).toBe("user-123");
  });

  test("withActor returns a derived client that sends the actor header", async () => {
    const captured: string[] = [];
    const base = new BrainClient({
      apiUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        captured.push((init?.headers as Record<string, string>)["x-unison-actor"] ?? "");
        return json({ results: [] });
      }),
    });

    const actor = base.withActor("u1");
    await actor.search("hello");
    expect(captured[0]).toBe("u1");
  });

  test("withActor(null) clears the actor header", async () => {
    const captured: string[] = [];
    const base = new BrainClient({
      apiUrl: "https://api.test",
      token: "tok",
      actor: "u1",
      fetch: stubFetch((_u, init) => {
        const h = (init?.headers as Record<string, string>)["x-unison-actor"] ?? "";
        captured.push(h);
        return json({ results: [] });
      }),
    });

    const noActor = base.withActor(null);
    await noActor.search("hello");
    expect(captured[0]).toBe("");
  });

  test("withActor from derived client stacks correctly — last call wins", async () => {
    let capturedActor = "";
    const base = new BrainClient({
      apiUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        capturedActor = (init?.headers as Record<string, string>)["x-unison-actor"] ?? "";
        return json({ results: [] });
      }),
    });

    const c1 = base.withActor("u1");
    const c2 = c1.withActor("u2");
    await c2.search("hello");
    expect(capturedActor).toBe("u2");
  });

  test("BrainClient constructor throws on invalid actor id", () => {
    expect(
      () => new BrainClient({ apiUrl: "https://api.test", token: "tok", actor: "bad id!" }),
    ).toThrow(/invalid actor id/);
  });

  test("actor id of 200 chars is valid", () => {
    expect(
      () =>
        new BrainClient({
          apiUrl: "https://api.test",
          token: "tok",
          actor: "a".repeat(200),
        }),
    ).not.toThrow();
  });

  test("actor id of 201 chars is invalid", () => {
    expect(
      () =>
        new BrainClient({
          apiUrl: "https://api.test",
          token: "tok",
          actor: "a".repeat(201),
        }),
    ).toThrow(/invalid actor id/);
  });
});

// ── Multi-workspace ───────────────────────────────────────────────────────────

describe("BrainClient workspaces", () => {
  test("workspaces.list() GETs /v1/auth/workspaces and returns the array", async () => {
    let url = "";
    const client = new BrainClient({
      apiUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({
          workspaces: [
            { id: "t1", name: "Main", role: "owner", active: true },
            { id: "t2", name: "Shared", role: "member", active: false },
          ],
        });
      }),
    });

    const workspaces = await client.workspaces.list();
    expect(url).toContain("/v1/auth/workspaces");
    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]?.id).toBe("t1");
    expect(workspaces[0]?.active).toBe(true);
    expect(workspaces[1]?.role).toBe("member");
  });
});

describe("BrainClient keys multi-workspace", () => {
  test("keys.list passes workspaceId as query param", async () => {
    let url = "";
    const client = new BrainClient({
      apiUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((u) => {
        url = u;
        return json({ keys: [] });
      }),
    });

    await client.keys.list({ workspaceId: "t2" });
    expect(url).toContain("workspaceId=t2");
  });

  test("keys.create passes workspaceId in body", async () => {
    let body = "";
    const client = new BrainClient({
      apiUrl: "https://api.test",
      token: "tok",
      fetch: stubFetch((_u, init) => {
        body = String(init?.body ?? "");
        return json({
          id: "k1",
          token: "usk_x",
          scopes: ["brain:read"],
          name: "cli",
          workspaceId: "t2",
        });
      }),
    });

    await client.keys.create({ name: "cli", workspaceId: "t2" });
    expect(JSON.parse(body).workspaceId).toBe("t2");
  });
});

describe("BrainClient default apiUrl", () => {
  test("falls back to the hosted brain when no url is given", () => {
    const client = new BrainClient({ token: "usk_test" });
    // @ts-expect-error private access for assertion
    expect(client.baseUrl).toBe("https://brain.unisonlabs.ai");
  });
});

describe("context() forwards pathPrefix + includeBodies", () => {
  test("query string carries both params", async () => {
    let captured = "";
    globalThis.fetch = (async (url: unknown) => {
      captured = String(url);
      return new Response(JSON.stringify({ query: "q", hits: [], entities: [], contextMd: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = new BrainClient({ token: "usk_test", apiUrl: "https://x.test" });
    await client.context({ query: "q", pathPrefix: "/private/notes/", includeBodies: true });
    expect(captured).toContain("pathPrefix=%2Fprivate%2Fnotes%2F");
    expect(captured).toContain("includeBodies=true");
  });
});
