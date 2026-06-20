import {
  BrainClient,
  createInvitation,
  createKey,
  listInvitations,
  listKeys,
  provisionAccount,
  requestKey,
  revokeInvitation,
  revokeKey,
  verifyEmail,
} from "@unisonlabs/sdk";
import type { Command } from "commander";
import { clearCredentials, defaultApiUrl, loadCredentials, saveCredentials } from "../config";
import { fail, info, printJson, success } from "../output";
import { readStdin } from "../stdin";

// ── helpers ────────────────────────────────────────────────────────────────────

function isTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Prompt for a value on stderr (so stdout stays clean). */
async function prompt(message: string): Promise<string> {
  process.stderr.write(message);
  const line = await new Promise<string>((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, nl).trim());
      }
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
  });
  return line.trim();
}

// ── auth login ─────────────────────────────────────────────────────────────────

/**
 * Email-OTP login: provision → store key → nudge to verify.
 * For existing accounts: request-key → collect code → verify → store key.
 */
async function emailOtpLogin(apiUrl: string, email: string): Promise<void> {
  // Try to provision a new account.
  let result: Awaited<ReturnType<typeof provisionAccount>> | null = null;
  let isExisting = false;

  try {
    result = await provisionAccount(apiUrl, { email });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "email_registered") {
      isExisting = true;
    } else {
      throw err;
    }
  }

  if (isExisting) {
    // Existing account: send a recovery OTP and collect the code.
    await requestKey(apiUrl, { email });
    info(`  A recovery code was sent to ${email}.`);
    let code: string;
    if (isTty()) {
      code = await prompt("  Enter the code from your email: ");
    } else {
      fail("Non-interactive shell: pass the code via `unison auth verify <code> --email <email>`.");
      process.exit(1);
    }
    const ver = await verifyEmail(apiUrl, { email, code });
    if (!ver.verified) {
      fail("Verification failed — check the code and try again.");
      process.exit(1);
    }
    if (ver.apiKey) {
      await saveCredentials({ apiUrl, token: ver.apiKey });
      success("Recovered and signed in.");
    } else {
      success("Verified. Use UNISON_TOKEN or `unison auth login` to sign in with your key.");
    }
    return;
  }

  if (!result) throw new Error("Unexpected: provision returned nothing");

  // Fresh account: key is ready immediately.
  await saveCredentials({ apiUrl, token: result.apiKey });
  success("Account created and signed in.");
  info(`  workspace: ${result.workspaceId}`);
  info(`  status: ${result.status}`);

  if (isTty()) {
    info("");
    info(`  A verification code was ${result.emailSent ? "sent" : "queued"} to ${email}.`);
    const code = await prompt("  Enter the code to verify your account (or press Enter to skip): ");
    if (code) {
      const ver = await verifyEmail(apiUrl, { email, code });
      if (ver.verified) {
        success("Email verified — your account is now durable.");
      } else {
        info("  Could not verify with that code. Run `unison auth verify <code>` to try again.");
      }
    } else {
      info("  Skipped. Run `unison auth verify <code> --email <email>` when you get the email.");
    }
  } else {
    info("");
    info(`  Verify later with: unison auth verify <code> --email ${email}`);
  }
}

// ── register ──────────────────────────────────────────────────────────────────

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Manage authentication and API keys");

  // ── auth login ─────────────────────────────────────────────────────────────

  auth
    .command("login")
    .description("Sign in via email (email-OTP)")
    .option("--email <email>", "Email address")
    .option("--api-url <url>", "API base URL", defaultApiUrl())
    .option("--with-token", "Read an API key from stdin (CI/agents)")
    .action(async (opts: { email?: string; apiUrl: string; withToken?: boolean }) => {
      const apiUrl = opts.apiUrl;

      if (opts.withToken) {
        const token = (await readStdin()).trim();
        if (!token) {
          fail("No token provided on stdin.");
          process.exit(1);
        }
        const path = await saveCredentials({ apiUrl, token });
        success(`Saved API key to ${path}`);
        return;
      }

      let email = opts.email?.trim();
      if (!email) {
        if (!isTty()) {
          fail("Pass --email <email> or --with-token in non-interactive shells.");
          process.exit(1);
        }
        email = await prompt("  Email: ");
      }
      if (!email) {
        fail("Email is required.");
        process.exit(1);
      }

      await emailOtpLogin(apiUrl, email);
    });

  // ── auth token ───────────────────────────────────────────────────────────────

  auth
    .command("token <usk>")
    .description("Authenticate by pasting an API key (e.g. from the web app settings)")
    .option("--api-url <url>", "API base URL", defaultApiUrl())
    .action(async (usk: string, opts: { apiUrl: string }) => {
      const token = usk.trim();
      if (!token.startsWith("usk_")) {
        fail("That doesn't look like a Unison API key (expected `usk_...`).");
        process.exit(1);
      }
      // Validate the key against the brain before storing it, so a bad paste
      // fails loudly here instead of on the next command.
      const client = new BrainClient({ baseUrl: opts.apiUrl, token });
      let me: Awaited<ReturnType<typeof client.whoami>>;
      try {
        me = await client.whoami();
      } catch {
        fail("That key was rejected by the brain. Copy a fresh one from the app and retry.");
        process.exit(1);
      }
      const path = await saveCredentials({ apiUrl: opts.apiUrl, token });
      success(`Signed in to ${opts.apiUrl}`);
      info(`  user:      ${me.user.email ?? me.user.id}`);
      info(`  workspace: ${me.workspace.name ?? me.workspace.id}`);
      info(`  key saved: ${path}`);
    });

  // ── auth verify ────────────────────────────────────────────────────────────

  auth
    .command("verify [code]")
    .description("Verify the OTP code sent to your email")
    .option("--email <email>", "The account email (required if not in config)")
    .option("--api-url <url>", "API base URL", defaultApiUrl())
    .option("--json", "Output JSON")
    .action(
      async (
        code: string | undefined,
        opts: { email?: string; apiUrl: string; json?: boolean },
      ) => {
        const apiUrl = opts.apiUrl;
        let email = opts.email?.trim();
        let resolvedCode = code?.trim();

        // Fall back to stored credentials for the email.
        if (!email) {
          const creds = await loadCredentials();
          if (creds) {
            // Fetch whoami to find the email.
            try {
              const client = new BrainClient({ baseUrl: creds.apiUrl, token: creds.token });
              const me = await client.whoami();
              email = me.user.email ?? undefined;
            } catch {
              // ignore
            }
          }
        }
        if (!email) {
          if (!isTty()) {
            fail("Pass --email <email> in non-interactive shells.");
            process.exit(1);
          }
          email = await prompt("  Email: ");
        }
        if (!resolvedCode) {
          if (!isTty()) {
            fail("Pass the code as: unison auth verify <code>");
            process.exit(1);
          }
          resolvedCode = await prompt("  Verification code: ");
        }
        if (!email || !resolvedCode) {
          fail("Email and code are required.");
          process.exit(1);
        }

        const res = await verifyEmail(apiUrl, { email, code: resolvedCode });
        if (res.apiKey) await saveCredentials({ apiUrl, token: res.apiKey });
        if (opts.json) {
          printJson(res);
          return;
        }
        success(res.verified ? "Verified." : "Verification failed — check the code.");
        if (res.apiKey) info("  A new key was issued and stored.");
      },
    );

  // ── auth logout ────────────────────────────────────────────────────────────

  auth
    .command("logout")
    .description("Remove stored credentials")
    .action(async () => {
      await clearCredentials();
      success("Logged out.");
    });

  // ── auth status ────────────────────────────────────────────────────────────

  auth
    .command("status")
    .description("Show current authentication status")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const creds = await loadCredentials();
      if (!creds) {
        if (opts.json) printJson({ authenticated: false });
        else fail("Not authenticated. Run `unison auth login`.");
        process.exit(1);
      }
      const client = new BrainClient({ baseUrl: creds.apiUrl, token: creds.token });
      const me = await client.whoami();
      if (opts.json) {
        printJson({ authenticated: true, apiUrl: creds.apiUrl, ...me });
        return;
      }
      success(`Authenticated to ${creds.apiUrl}`);
      info(`  user:     ${me.user.email ?? me.user.id}`);
      info(`  workspace: ${me.workspace.name ?? me.workspace.id}`);
      info(`  verified: ${(me.workspace as { verified?: boolean }).verified ?? true}`);
      info(`  scopes:   ${me.scopes.join(", ")}`);
    });

  // ── auth keys ──────────────────────────────────────────────────────────────

  const keys = auth.command("keys").description("Manage API keys for this account");

  keys
    .command("ls", { isDefault: true })
    .description("List API keys")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const creds = await loadCredentials();
      if (!creds) {
        fail("Not authenticated. Run `unison auth login`.");
        process.exit(1);
      }
      const rows = await listKeys(creds.apiUrl, creds.token);
      if (opts.json) {
        printJson(rows);
        return;
      }
      if (rows.length === 0) {
        info("No API keys.");
        return;
      }
      // Table: id prefix, name, scopes, created
      const header = ["ID", "NAME", "PREFIX", "SCOPES", "CREATED", "STATUS"];
      const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
      const colWidths = [36, 20, 12, 30, 24, 10];
      info(header.map((h, i) => pad(h, colWidths[i] ?? 10)).join("  "));
      info("-".repeat(140));
      for (const k of rows) {
        const status = k.revokedAt ? "revoked" : "active";
        info(
          [
            pad(k.id, 36),
            pad(k.name, 20),
            pad(k.keyPrefix, 12),
            pad(k.scopes.join(" "), 30),
            pad(k.createdAt, 24),
            pad(status, 10),
          ].join("  "),
        );
      }
    });

  keys
    .command("create")
    .description("Mint a new API key (token returned once — store it)")
    .option("--name <name>", "Key name")
    .option("--scopes <scopes...>", "Space-separated scopes (default: brain:read brain:write)")
    .option("--json", "Output JSON")
    .action(async (opts: { name?: string; scopes?: string[]; json?: boolean }) => {
      const creds = await loadCredentials();
      if (!creds) {
        fail("Not authenticated. Run `unison auth login`.");
        process.exit(1);
      }
      const res = await createKey(creds.apiUrl, creds.token, {
        name: opts.name,
        scopes: opts.scopes,
      });
      if (opts.json) {
        printJson(res);
        return;
      }
      success(`Key created: ${res.id}`);
      info(`  name:   ${res.name}`);
      info(`  scopes: ${res.scopes.join(", ")}`);
      info("");
      info(`  token (shown once):  ${res.token}`);
      info("");
      info("  Store it now — it cannot be retrieved again.");
    });

  keys
    .command("revoke <id>")
    .description("Revoke an API key by id")
    .option("--json", "Output JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const creds = await loadCredentials();
      if (!creds) {
        fail("Not authenticated. Run `unison auth login`.");
        process.exit(1);
      }
      const res = await revokeKey(creds.apiUrl, creds.token, id);
      if (opts.json) {
        printJson(res);
        return;
      }
      success(`Key ${id} revoked.`);
      if (res.note) info(`  note: ${res.note}`);
    });

  // ── invite / invites (top-level shortcuts) ────────────────────────────────
  // Registered here so they share auth helpers; mounted on program root below.
}

/** Register `unison invite` and `unison invites` as top-level commands. */
export function registerInvite(program: Command): void {
  // unison invite <email>
  program
    .command("invite <email>")
    .description("Invite an email to your workspace")
    .option("--role <role>", "Role: admin|member|viewer (default: member)")
    .option("--api-url <url>", "API base URL", defaultApiUrl())
    .option("--json", "Output JSON")
    .action(async (email: string, opts: { role?: string; apiUrl: string; json?: boolean }) => {
      const creds = await loadCredentials();
      if (!creds) {
        fail("Not authenticated. Run `unison auth login`.");
        process.exit(1);
      }
      const res = await createInvitation(creds.apiUrl, creds.token, {
        email,
        role: opts.role,
      });
      if (opts.json) {
        printJson(res);
        return;
      }
      success(
        `Invited ${email} — they'll join your brain when they sign in: unison auth login --email ${email}`,
      );
      info(`  id:   ${res.invitation.id}`);
      info(`  role: ${res.invitation.role}`);
    });

  // unison invites
  const invites = program.command("invites").description("Manage pending workspace invitations");

  invites
    .command("ls", { isDefault: true })
    .description("List pending invitations")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const creds = await loadCredentials();
      if (!creds) {
        fail("Not authenticated. Run `unison auth login`.");
        process.exit(1);
      }
      const rows = await listInvitations(creds.apiUrl, creds.token);
      if (opts.json) {
        printJson(rows);
        return;
      }
      if (rows.length === 0) {
        info("No pending invitations.");
        return;
      }
      const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
      info([pad("ID", 36), pad("EMAIL", 30), pad("ROLE", 10), pad("EXPIRES", 24)].join("  "));
      info("-".repeat(104));
      for (const inv of rows) {
        info(
          [pad(inv.id, 36), pad(inv.email, 30), pad(inv.role, 10), pad(inv.expiresAt, 24)].join(
            "  ",
          ),
        );
      }
    });

  invites
    .command("revoke <id>")
    .description("Revoke a pending invitation by id")
    .option("--json", "Output JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const creds = await loadCredentials();
      if (!creds) {
        fail("Not authenticated. Run `unison auth login`.");
        process.exit(1);
      }
      const res = await revokeInvitation(creds.apiUrl, creds.token, id);
      if (opts.json) {
        printJson(res);
        return;
      }
      success(`Invitation ${id} revoked.`);
    });
}
