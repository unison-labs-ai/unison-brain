import type { Command } from "commander";
import { requireClient } from "../client-factory";
import { printJson } from "../output";

export function registerGet(program: Command): void {
  program
    .command("get <path>")
    .alias("cat")
    .description("Read a document from the brain by path (alias: cat)")
    .option("--raw", "Read raw FS content (read-only tiers /sources/ /system/)")
    .option("--actor <id>", "Act as an external user id (requires brain:act-as scope)")
    .option("--json", "Output JSON (default prints raw content)")
    .action(async (path: string, opts: { raw?: boolean; actor?: string; json?: boolean }) => {
      const client = await requireClient(opts.actor);
      if (opts.raw) {
        const res = await client.getRaw(path);
        if (opts.json) printJson(res);
        else process.stdout.write(`${res.content ?? ""}\n`);
        return;
      }
      const doc = await client.get(path);
      if (opts.json) printJson(doc);
      else process.stdout.write(`${doc.bodyMd}\n`);
    });
}
