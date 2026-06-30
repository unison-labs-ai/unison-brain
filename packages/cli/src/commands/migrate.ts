import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Visibility, WriteDocInput } from "@unisonlabs/sdk";
import type { Command } from "commander";
import { requireClient } from "../client-factory";
import { firstHeading, parseFrontmatter, toBrainPath } from "../migrate-util";
import { fail, info, printJson, success } from "../output";

const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".serena", ".idea", ".vscode"]);
const BATCH = 100;

interface MigrateOpts {
  prefix: string;
  visibility: string;
  tag?: string[];
  dryRun?: boolean;
  actor?: string;
  json?: boolean;
}

export function registerMigrate(program: Command): void {
  const migrate = program
    .command("migrate")
    .description(
      "Migrate any memory system into the brain — run bare for the guided wizard (idempotent: re-run to sync)",
    )
    .action(async () => wizard());

  migrate
    .command("markdown <dir>")
    .description(
      "Import a directory of markdown files (knowledge base, Obsidian vault, any tool's markdown export)",
    )
    .option("--prefix <path>", "Brain path the tree is mounted under", "/private/notes")
    .option("--visibility <v>", "workspace | private", "private")
    .option("--tag <tag...>", "Extra tag(s) applied to every imported doc")
    .option("--exclude <path...>", "Relative path prefix(es) to skip, e.g. --exclude raw archive")
    .option("--dry-run", "Plan only — print what would change, write nothing")
    .option("--actor <id>", "Act as an external user id (requires brain:act-as scope)")
    .option("--json", "Output JSON")
    .action(async (dir: string, opts: MigrateOpts & { exclude?: string[] }) => {
      const docs = await markdownDocs(dir, opts, opts.exclude);
      await runImport(docs, opts);
    });

  migrate
    .command("json <file>")
    .description(
      "Import a JSON export from any memory system — an array of objects with id/title/content/tags fields (common field aliases auto-detected)",
    )
    .option("--prefix <path>", "Brain path the memories are mounted under", "/private/imported")
    .option("--visibility <v>", "workspace | private", "private")
    .option("--tag <tag...>", "Extra tag(s) applied to every imported doc")
    .option("--dry-run", "Plan only — print what would change, write nothing")
    .option("--actor <id>", "Act as an external user id (requires brain:act-as scope)")
    .option("--json", "Output JSON")
    .action(async (file: string, opts: MigrateOpts) => {
      const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
      const items = extractItems(raw);
      if (items.length === 0) {
        fail(
          "No memories found — expected a JSON array (or {memories|documents|items|results: [...]}).",
        );
        process.exit(1);
      }
      const docs: WriteDocInput[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const mapped = mapJsonItem(items[i] as Record<string, unknown>, i);
        if (!mapped) continue;
        let path = toBrainPath(opts.prefix, `${mapped.slug}.md`);
        for (let n = 2; seen.has(path); n++)
          path = toBrainPath(opts.prefix, `${mapped.slug}-${n}.md`);
        seen.add(path);
        docs.push({
          path,
          bodyMd: mapped.content,
          kind: "wiki_page",
          title: mapped.title,
          tags: [...new Set([...mapped.tags, ...(opts.tag ?? [])])],
          visibility: opts.visibility as Visibility,
        });
      }
      if (docs.length === 0) {
        fail("All items were empty — nothing to import.");
        process.exit(1);
      }
      await runImport(docs, opts);
    });
}

// ── Guided wizard ────────────────────────────────────────────────────────────

interface Candidate {
  label: string;
  dir: string;
  prefix: string;
}

async function wizard(): Promise<void> {
  if (!process.stdin.isTTY) {
    fail(
      "The wizard is interactive. Non-interactive: `unison migrate markdown <dir>` or `unison migrate json <file>`.",
    );
    process.exit(1);
  }
  info("Scanning for memory systems on this machine…");
  const candidates = await detectCandidates();
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (const [i, c] of candidates.entries()) info(`  ${i + 1}. ${c.label} (${c.dir})`);
    info(`  ${candidates.length + 1}. Other — enter a path (markdown directory or JSON export)`);

    const picked: Candidate[] = [];
    const answer = await rl.question("Migrate which? (numbers, comma-separated): ");
    for (const part of answer
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const n = Number(part);
      const candidate = candidates[n - 1];
      if (candidate) picked.push(candidate);
      else if (n === candidates.length + 1) {
        const custom = (await rl.question("Path: ")).trim().replace(/^~/, homedir());
        const isJson = custom.endsWith(".json");
        const name = slugName(basename(custom).replace(/\.json$/, ""));
        picked.push({
          label: basename(custom),
          dir: custom,
          prefix: `/private/${isJson ? "imported" : name}`,
        });
      }
    }
    if (picked.length === 0) {
      fail("Nothing selected.");
      process.exit(1);
    }

    let total = 0;
    for (const c of picked) {
      const opts: MigrateOpts = { prefix: c.prefix, visibility: "private" };
      const docs = c.dir.endsWith(".json")
        ? await jsonDocsForWizard(c.dir, opts)
        : await markdownDocs(c.dir, opts);
      info(`\n${c.label}: ${docs.length} docs → ${c.prefix}`);
      const go = (await rl.question("Import? [y/N] ")).trim().toLowerCase();
      if (go !== "y" && go !== "yes") {
        info("Skipped.");
        continue;
      }
      await runImport(docs, opts);
      total += docs.length;
    }

    if (total > 0) {
      info("\nDone. To finish the cutover:");
      info("  1. unison skill install   — agents now recall from and capture to the brain");
      info("  2. Repoint anything that still writes to the old system (scripts, agent rules)");
      info("  3. Archive the old system read-only — the brain is canonical now");
      info(
        "  4. Escape hatch, any time: unison export <dir> round-trips everything back to markdown",
      );
    }
  } finally {
    rl.close();
  }
}

async function detectCandidates(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const home = homedir();

  // Coding-agent memory directories (one per project).
  const agentMemoryRoots = [join(home, ".claude", "projects")];
  for (const root of agentMemoryRoots) {
    try {
      for (const entry of await readdir(root)) {
        const dir = join(root, entry, "memory");
        try {
          if ((await stat(dir)).isDirectory() && (await collectMarkdownFiles(dir)).length > 0) {
            out.push({
              label: `Coding-agent memory: ${entry}`,
              dir,
              prefix: `/private/agent-memory/${slugName(entry)}`,
            });
          }
        } catch {}
      }
    } catch {}
  }

  // Obsidian vaults (macOS + Linux config locations).
  for (const cfg of [
    join(home, "Library", "Application Support", "obsidian", "obsidian.json"),
    join(home, ".config", "obsidian", "obsidian.json"),
  ]) {
    try {
      const conf = JSON.parse(await readFile(cfg, "utf8")) as {
        vaults?: Record<string, { path: string }>;
      };
      for (const vault of Object.values(conf.vaults ?? {})) {
        out.push({
          label: `Obsidian vault: ${basename(vault.path)}`,
          dir: vault.path,
          prefix: `/private/${slugName(basename(vault.path))}`,
        });
      }
    } catch {}
  }

  return out;
}

function slugName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "imported"
  );
}

// ── Shared source readers ────────────────────────────────────────────────────

async function markdownDocs(
  dir: string,
  opts: MigrateOpts,
  exclude?: string[],
): Promise<WriteDocInput[]> {
  const excluded = (exclude ?? []).map((e) => e.replace(/\/+$/, ""));
  const files = (await collectMarkdownFiles(dir)).filter((f) => {
    const rel = relative(dir, f);
    return !excluded.some((e) => rel === e || rel.startsWith(`${e}/`));
  });
  if (files.length === 0) {
    fail(`No markdown files found under ${dir}`);
    process.exit(1);
  }
  const docs: WriteDocInput[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const fm = parseFrontmatter(raw);
    const rel = relative(dir, file);
    docs.push({
      path: toBrainPath(opts.prefix, rel),
      bodyMd: fm.body.trim() ? fm.body : raw,
      kind: "wiki_page",
      title: fm.title ?? firstHeading(fm.body) ?? rel.replace(/\.(md|markdown)$/i, ""),
      tags: [...new Set([...fm.tags, ...(opts.tag ?? [])])],
      visibility: opts.visibility as Visibility,
    });
  }
  return docs;
}

async function jsonDocsForWizard(file: string, opts: MigrateOpts): Promise<WriteDocInput[]> {
  const items = extractItems(JSON.parse(await readFile(file, "utf8")) as unknown);
  const docs: WriteDocInput[] = [];
  for (let i = 0; i < items.length; i++) {
    const mapped = mapJsonItem(items[i] as Record<string, unknown>, i);
    if (!mapped) continue;
    docs.push({
      path: toBrainPath(opts.prefix, `${mapped.slug}.md`),
      bodyMd: mapped.content,
      kind: "wiki_page",
      title: mapped.title,
      tags: mapped.tags,
      visibility: opts.visibility as Visibility,
    });
  }
  return docs;
}

function extractItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["memories", "documents", "items", "results", "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function mapJsonItem(
  m: Record<string, unknown>,
  index: number,
): { slug: string; title?: string; content: string; tags: string[] } | null {
  const content = [m.content, m.text, m.memory, m.body, m.summary].find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  if (!content) return null;
  const title = typeof m.title === "string" && m.title ? m.title : undefined;
  const id = [m.customId, m.id, m.uuid, m.key].find(
    (v): v is string | number => typeof v === "string" || typeof v === "number",
  );
  const tags = (["tags", "containerTags", "labels"] as const).flatMap((k) =>
    Array.isArray(m[k])
      ? (m[k] as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
  );
  return { slug: String(id ?? `memory-${index + 1}`), title, content, tags };
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectMarkdownFiles(full)));
    else if (/\.(md|markdown)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

async function runImport(docs: WriteDocInput[], opts: MigrateOpts): Promise<void> {
  const client = await requireClient(opts.actor);

  // Diff against what's already in the brain so re-runs only sync deltas.
  const existing = await client.list({ prefix: opts.prefix, limit: 10_000 });
  const byPath = new Map(existing.map((d) => [d.path, d]));
  const toWrite = docs.filter((d) => {
    const cur = byPath.get(d.path);
    return !cur || cur.bodyMd !== d.bodyMd || cur.title !== (d.title ?? null);
  });
  const skipped = docs.length - toWrite.length;
  const created = toWrite.filter((d) => !byPath.has(d.path)).length;

  if (opts.dryRun) {
    const plan = {
      total: docs.length,
      create: created,
      update: toWrite.length - created,
      unchanged: skipped,
      writes: toWrite.map((d) => d.path),
    };
    if (opts.json) printJson(plan);
    else {
      info(
        `${docs.length} docs → ${created} new, ${toWrite.length - created} changed, ${skipped} unchanged`,
      );
      for (const d of toWrite) info(`  would write ${d.path}`);
    }
    return;
  }

  const failures: { path: string; error: string; code?: string }[] = [];
  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const batch = toWrite.slice(i, i + BATCH);
    try {
      await client.writeDocs(batch);
      written += batch.length;
    } catch {
      // Batch failed (e.g. one bad doc) — retry individually so one bad file
      // doesn't sink the other 99.
      for (const doc of batch) {
        try {
          await client.write(doc);
          written++;
        } catch (err) {
          failures.push({
            path: doc.path,
            error: err instanceof Error ? err.message : String(err),
            code:
              typeof (err as { code?: unknown })?.code === "string"
                ? (err as { code: string }).code
                : undefined,
          });
        }
      }
    }
    info(`${Math.min(i + BATCH, toWrite.length)}/${toWrite.length} synced`);
  }

  const result = { written, created, unchanged: skipped, failed: failures };
  if (opts.json) printJson(result);
  else {
    success(
      `Synced ${written} docs (${created} new, ${written - created} updated, ${skipped} unchanged).`,
    );
    for (const f of failures) fail(`  ${f.path}: ${f.error}`);
  }
  if (failures.length > 0) {
    // Surface the free-tier cap distinctly (exit 6) when it's the sole blocker,
    // matching the single-write exit code; mixed/other failures stay exit 1.
    const allQuota = failures.every((f) => f.code === "quota_exceeded");
    process.exit(allQuota ? 6 : 1);
  }
}
