import { readFileSync } from "node:fs";
import type { RememberDump } from "@unisonlabs/sdk";
import type { Command } from "commander";
import { requireClient } from "../client-factory";
import { fail, printJson, success } from "../output";
import { readStdin } from "../stdin";

export function registerRemember(program: Command): void {
  program
    .command("remember")
    .description(
      "Remember a dump (session, conversation, or text) — runs the /remember skill server-side: filter, dedupe, file curated /private/kb notes + entity facts",
    )
    .option("--file <path>", "Read freeform text to remember from a file")
    .option("--session <path>", "Read a Claude Code session log (.jsonl) to remember")
    .option("--text <text>", "Inline text to remember")
    .option("--hints <hints>", 'Optional steering, e.g. "focus on decisions"')
    .option("--source <source>", 'Provenance label, e.g. "claude-code-session"')
    .option("--source-ref <ref>", "Stable id → idempotent re-remember")
    .option("--actor <id>", "Act as an external user id (requires brain:act-as scope)")
    .option("--json", "Output JSON")
    .action(
      async (opts: {
        file?: string;
        session?: string;
        text?: string;
        hints?: string;
        source?: string;
        sourceRef?: string;
        actor?: string;
        json?: boolean;
      }) => {
        let dump: RememberDump;
        if (opts.session) {
          dump = { sessionJsonl: readFileSync(opts.session, "utf8") };
        } else if (opts.file) {
          dump = readFileSync(opts.file, "utf8");
        } else if (opts.text) {
          dump = opts.text;
        } else {
          const raw = await readStdin();
          if (!raw.trim()) {
            fail(
              "No input. Use --session <jsonl>, --file <path>, --text <text>, or pipe text via stdin.",
            );
            process.exit(1);
          }
          dump = raw;
        }

        const client = await requireClient(opts.actor);
        const result = await client.remember({
          dump,
          source: opts.source ?? "cli",
          sourceRef: opts.sourceRef,
          hints: opts.hints,
        });

        if (opts.json) {
          printJson(result);
          return;
        }
        success(
          `Queued to remember (jobId: ${result.jobId}). Poll with: unison jobs get ${result.jobId}`,
        );
      },
    );
}
