// Client-side FS-contract routing — a slim snapshot of the writable-root list
// and the `defaultPrivateScope` rule the in-app agent's `CortexFs.writeFile`
// applies. Mirrors `@unison/agent-shared`'s `fs-contract.ts` so external
// writers (SDK / CLI / MCP) route to the same paths the server enforces.
//
// The server's `checkWritable` is the real gate; this is ergonomics — it turns
// a server 4xx into a clear error before the round-trip, and applies the same
// default routing so a bare or unqualified `*.md` write lands in the owner's
// private notes instead of failing.

import { BrainError } from "./errors";

/** Top-level namespaces the agent may write to. `/system/*` and `/AGENTS.md`
 * are read-only; `/private/sources/*` is rejected server-side.
 * Teams are a folder convention inside `/workspace/teams/<slug>/`. */
export const WRITABLE_BRAIN_ROOTS = ["private", "workspace"] as const;

/** Thrown when a write targets a path no longer in the FS contract. */
export class BrainContractError extends BrainError {
  constructor(message: string) {
    super("fs_contract", message, 422);
    this.name = "BrainContractError";
  }
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "note";
}

function defaultPrivateNotePath(rawPath: string): string {
  const base = rawPath.split("/").filter(Boolean).pop() ?? rawPath;
  return `/private/notes/${slugify(base)}.md`;
}

/**
 * Route a brain write path through the FS contract, mirroring the in-app
 * `defaultPrivateScope` behavior:
 *
 * - A path under a writable root (`/private`, `/workspace`) passes through
 *   unchanged — the server validates the rest of the path. Teams are nested
 *   under `/workspace/teams/<slug>/`.
 * - A bare-root (`/foo.md`) or unqualified (`foo.md`, `notes/foo.md`) write is
 *   rewritten to `/private/notes/<slug>.md`.
 * - Any other namespace (legacy `/wiki/`, `/actions/`, `/sources/`, `/skills/`,
 *   `/raw/`, `/shared/`, ad-hoc `/scratch/`, …) fails fast.
 */
export function routeBrainWritePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new BrainContractError("A write path is required.");
  }

  // Unqualified (no leading slash) → default to the owner's private notes.
  if (!trimmed.startsWith("/")) {
    return defaultPrivateNotePath(trimmed);
  }

  const segments = trimmed.split("/").filter(Boolean);
  const root = segments[0];

  if (root && (WRITABLE_BRAIN_ROOTS as readonly string[]).includes(root)) {
    // Canonical writable namespace — strip a trailing slash, let the server
    // validate the kind/slug.
    return `/${segments.join("/")}`;
  }

  // Bare-root `*.md` at the top level → default to private notes.
  if (segments.length === 1 && segments[0]?.endsWith(".md")) {
    return defaultPrivateNotePath(segments[0]);
  }

  throw new BrainContractError(
    `Path "${trimmed}" is not in the brain FS contract. Writable roots are /private/… (e.g. /private/notes/<slug>.md) and /workspace/… (e.g. /workspace/people/<slug>.md); teams live at /workspace/teams/<slug>/. Bare names route to /private/notes/.`,
  );
}
