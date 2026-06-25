import { readFileSync } from "node:fs";
import type { IngestDocumentItem, Visibility } from "@unisonlabs/sdk";
import type { Command } from "commander";
import { requireClient } from "../client-factory";
import { fail, printJson, success } from "../output";

export function registerIngest(program: Command): void {
  program
    .command("ingest")
    .description("Ingest a markdown document into brain memory")
    .option("--file <path>", "Path to a markdown file to ingest as a document")
    .option("--title <title>", "Document title (only with --file)")
    .option("--doc-path <path>", "Brain path for the document (only with --file)")
    .option("--source-ref <ref>", "Stable source reference / idempotency identifier")
    .option("--visibility <v>", "workspace | private (default private)", "private")
    .option("--actor <id>", "Act as an external user id (requires brain:act-as scope)")
    .option("--json", "Output JSON")
    .action(
      async (opts: {
        file?: string;
        title?: string;
        docPath?: string;
        sourceRef?: string;
        visibility: string;
        actor?: string;
        json?: boolean;
      }) => {
        if (!opts.file) {
          fail(
            "No input provided. Use --file <path>.\n" +
              "To ingest a conversation or session log, use: unison remember",
          );
          process.exit(1);
        }

        const content = readFileSync(opts.file, "utf8");
        const item: IngestDocumentItem = {
          type: "document",
          content,
          title: opts.title,
          path: opts.docPath,
          visibility: opts.visibility as Visibility,
          sourceRef: opts.sourceRef,
        };

        const client = await requireClient(opts.actor);
        const result = await client.ingest({ items: [item] });

        if (opts.json) {
          printJson(result);
          return;
        }

        const r = result.items[0];
        if (!r) {
          fail("No result returned from ingest.");
          process.exit(1);
        }
        success(`Document written to ${r.path} (jobIds: ${r.jobIds.join(", ")})`);
      },
    );
}
