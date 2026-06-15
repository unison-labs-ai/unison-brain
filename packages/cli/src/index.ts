#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { BrainError } from "@unisonlabs/sdk";
import { Command } from "commander";
import { registerAuth, registerInvite } from "./commands/auth";
import { registerCompletion } from "./commands/completion";
import { registerContext } from "./commands/context";
import { registerDocs } from "./commands/docs";
import { registerEdit } from "./commands/edit";
import { registerEntity } from "./commands/entity";
import { registerExport } from "./commands/export";
import { registerFact } from "./commands/fact";
import { registerGet } from "./commands/get";
import { registerIngest } from "./commands/ingest";
import { registerJobs } from "./commands/jobs";
import { registerList } from "./commands/list";
import { registerMigrate } from "./commands/migrate";
import { registerRemember } from "./commands/remember";
import { registerReview } from "./commands/review";
import { registerSearch } from "./commands/search";
import { registerSkill } from "./commands/skill";
import { registerStatus } from "./commands/status";
import { registerSwitch, registerWorkspaces } from "./commands/workspaces";
import { registerWrite } from "./commands/write";
import { fail, info } from "./output";

// Read from package.json at runtime so `--version` always matches the published
// package (npm includes package.json next to dist/ in the tarball). Resolved
// relative to this module, so it works both from dist/ and `bun run src`.
const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();
program
  .name("unison")
  .description("Unison brain — your cloud knowledge base, in any coding agent")
  .version(VERSION)
  .showSuggestionAfterError()
  .addHelpText(
    "after",
    `
Output:
  Add --json to any command for machine-readable output on stdout (compact when
  piped). Human text and progress go to stderr; result data goes to stdout.

Auth & env:
  UNISON_TOKEN     API key (usk_...) — overrides the stored login (use in CI/agents)
  UNISON_API_URL   API base URL (default https://brain.unisonlabs.ai)
  UNISON_ACTOR     Actor external id for delegation (requires brain:act-as scope on the key)
  NO_COLOR         Disable color. Color is auto-off when output is piped.

Exit codes:
  0 success   1 error   3 not found   4 auth (sign in / scope)   5 conflict

Examples:
  unison auth login
  unison search "auth decision" -k 5 --json
  unison get /workspace/projects/architecture.md
  echo "We chose X because Y." | unison write /private/notes/x.md
  unison edit /private/notes/x.md --old "We chose X" --new "We chose Z"
  unison context "what did we decide about auth?" --deep
  unison ingest --file notes.md --title "Auth decision"
  unison entity resolve "Daniel" --json
  unison rm /private/notes/old.md --yes   # destructive cmds need --yes when non-interactive
  unison workspaces ls --json
  unison switch <workspaceId>
  unison search "query" --actor user-123   # delegate to actor (service-key users)
`,
  );

// Auth
registerAuth(program);
registerInvite(program);
// Multi-workspace
registerWorkspaces(program);
registerSwitch(program);
// Documents
registerSearch(program);
registerMigrate(program);
registerExport(program);
registerGet(program);
registerWrite(program);
registerEdit(program);
registerList(program);
registerDocs(program);
// Recall + ingest
registerContext(program);
registerIngest(program);
registerRemember(program);
// Graph
registerEntity(program);
registerFact(program);
// Admin
registerReview(program);
registerJobs(program);
// Status
registerStatus(program);
// Setup
registerSkill(program);
registerCompletion(program);

// Distinct exit codes so an agent can branch without parsing text.
function exitCodeFor(status: number, code?: string): number {
  if (code === "quota_exceeded") return 6; // free-tier cap: verify email to lift
  if (status === 401 || status === 403) return 4; // auth: sign in / missing scope
  if (status === 404) return 3; // not found
  if (status === 409) return 5; // conflict (e.g. stale content hash)
  return 1; // general / retryable
}

function suggestedFix(status: number, code?: string): string | undefined {
  if (code === "quota_exceeded")
    return "Free-tier cap reached. Verify your email (`unison auth verify <code>`) to lift it, or delete docs you no longer need.";
  if (status === 401) return "Run `unison auth login` to sign in.";
  if (status === 403) return "Your key lacks the required scope (read / write / admin).";
  if (status === 404) return "Nothing found at that path or id.";
  if (status === 429) return "Rate limited — wait a moment and retry.";
  if (status >= 500) return "The brain API had an error. Try again shortly.";
  return undefined;
}

// Agents pass --json; emit a parseable error envelope (to stderr) instead of prose.
function wantsJson(): boolean {
  return (
    process.argv.includes("--json") ||
    process.env.OUTPUT_FORMAT === "json" ||
    process.env.UNISON_JSON === "1"
  );
}

// Errors go to stderr (stdout stays clean — success data only). When --json,
// the envelope is parseable JSON; otherwise human text + a next-step hint.
function jsonError(envelope: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ error: envelope })}\n`);
}

function reportError(err: unknown): number {
  if (err instanceof BrainError) {
    const fix = suggestedFix(err.status, err.code);
    if (wantsJson()) {
      jsonError({
        code: err.code,
        message: err.message,
        status: err.status,
        ...(fix ? { suggestedFix: fix } : {}),
      });
    } else {
      fail(err.message);
      if (fix) info(`→ ${fix}`);
    }
    return exitCodeFor(err.status, err.code);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (wantsJson()) jsonError({ code: "error", message });
  else fail(message);
  return 1;
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.exit(reportError(err));
});
