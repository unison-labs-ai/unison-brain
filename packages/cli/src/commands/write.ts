import type { DocKind, Visibility } from "@unisonlabs/sdk";
import type { Command } from "commander";
import { requireClient } from "../client-factory";
import { fail, printJson, success } from "../output";
import { readStdin } from "../stdin";

export function registerWrite(program: Command): void {
  program
    .command("write <path>")
    .description("Write a document to the brain (content from -m or stdin)")
    .option("-m, --message <content>", "Document content (markdown)")
    .option("--kind <kind>", "Document kind", "wiki_page")
    .option("--title <title>", "Title")
    .option("--tldr <tldr>", "One-line summary")
    .option("--tag <tag...>", "Tags (repeatable)")
    .option("--visibility <v>", "workspace | private", "workspace")
    .option("--if-match <hash>", "Optimistic concurrency: expected content hash")
    .option("--actor <id>", "Act as an external user id (requires brain:act-as scope)")
    .option("--json", "Output JSON")
    .action(
      async (
        path: string,
        opts: {
          message?: string;
          kind: string;
          title?: string;
          tldr?: string;
          tag?: string[];
          visibility: string;
          ifMatch?: string;
          actor?: string;
          json?: boolean;
        },
      ) => {
        const client = await requireClient(opts.actor);
        const bodyMd = opts.message ?? (await readStdin());
        if (!bodyMd.trim()) {
          fail('No content provided. Use -m "..." or pipe content via stdin.');
          process.exit(1);
        }

        const doc = await client.write({
          path,
          bodyMd,
          kind: opts.kind as DocKind,
          title: opts.title,
          tldr: opts.tldr,
          tags: opts.tag,
          visibility: opts.visibility as Visibility,
          expectedContentHash: opts.ifMatch,
        });
        if (opts.json) printJson(doc);
        else success(`Wrote ${doc.path}`);
      },
    );
}
