import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";

import { resolveProjectRoot } from "./lib/env.js";
import { ensureEnvFile, upsertEnvVars } from "./lib/env-writer.js";
import * as artifacts from "./tools/artifacts.js";
import * as git from "./tools/git.js";

/**
 * `ovb3 init` — interactive guided setup, the CLI-native equivalent of the
 * Claude Code /link slash command. Same rule as /link: only ever writes the
 * non-secret fields (VBS_WORKSPACE_DIR, VBCS_REPO_PATH, VBCS_APP_NAME,
 * VBCS_BASE_URL) — credentials are always the user's to fill in by hand.
 */

async function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? "(Y/n)" : "(y/N)";
  const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

async function vbsFlow(rl: readline.Interface): Promise<void> {
  const hasCheckout = await askYesNo(rl, "Do you already have a local checkout of the VB Studio repo?");
  let repoRoot: string;

  if (hasCheckout) {
    const checkoutInput = (await rl.question("Absolute path to the checkout: ")).trim();
    const resolved = path.resolve(checkoutInput);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      console.log(`  ! ${resolved} does not exist or isn't a directory — skipping VB Studio setup.`);
      return;
    }
    const workspaceDir = path.dirname(resolved);
    upsertEnvVars({ VBS_WORKSPACE_DIR: workspaceDir });
    console.log(`  Set VBS_WORKSPACE_DIR=${workspaceDir}`);
    repoRoot = resolved;
  } else {
    const defaultWorkspace = path.join(resolveProjectRoot(), "workspace");
    const workspaceInput = (await rl.question(`Workspace directory to clone into [${defaultWorkspace}]: `)).trim();
    const workspaceDir = path.resolve(workspaceInput || defaultWorkspace);
    fs.mkdirSync(workspaceDir, { recursive: true });
    upsertEnvVars({ VBS_WORKSPACE_DIR: workspaceDir });
    console.log(`  Set VBS_WORKSPACE_DIR=${workspaceDir}`);

    const remoteUrl = (await rl.question("Git remote URL: ")).trim();
    const destName = (await rl.question("Destination folder name: ")).trim();
    console.log(
      "  Note: cloning needs VBSTUDIO_GIT_USERNAME/VBSTUDIO_GIT_TOKEN already set in .env if the remote requires auth."
    );
    try {
      const cloned = await git.gitClone(remoteUrl, destName);
      repoRoot = cloned.path;
      console.log(`  Cloned into ${cloned.path}`);
    } catch (err) {
      console.log(`  ! Clone failed: ${err instanceof Error ? err.message : String(err)}`);
      console.log("  Fill in git credentials in .env and re-run `ovb3 init`, or clone manually.");
      return;
    }
  }

  const apps = await artifacts.listApps(repoRoot);
  if (apps.length > 1) {
    console.log(`  Apps found in this repo: ${apps.join(", ")}`);
    const chosen = (await rl.question("  Which is the default app? (blank to skip): ")).trim();
    if (chosen) {
      upsertEnvVars({ VBCS_APP_NAME: chosen });
      console.log(`  Set VBCS_APP_NAME=${chosen}`);
    }
  } else if (apps.length === 1) {
    upsertEnvVars({ VBCS_APP_NAME: apps[0] });
    console.log(`  Set VBCS_APP_NAME=${apps[0]} (only app found)`);
  } else {
    console.log("  No webApps/ found yet — that's fine if the repo is still empty.");
  }

  console.log("  Still needed in .env, fill in yourself: VBSTUDIO_GIT_USERNAME, VBSTUDIO_GIT_TOKEN");
}

async function vbcsFlow(rl: readline.Interface): Promise<void> {
  let baseUrl = (await rl.question("Base URL of the standalone VBCS instance: ")).trim();
  if (!baseUrl) {
    console.log("  Skipped (no URL given).");
    return;
  }

  if (/oauth2/i.test(baseUrl) && baseUrl.includes("?")) {
    try {
      const parsed = new URL(baseUrl);
      const resource = parsed.searchParams.get("idcs_app_resource_url");
      if (resource) {
        console.log("  This looks like an IDCS login-redirect URL, not the instance URL itself.");
        console.log(`  Extracted resource host: ${resource}`);
        if (await askYesNo(rl, `  Use "${resource}" instead?`)) {
          baseUrl = resource;
        }
      } else {
        console.log(
          "  Warning: this looks like a login-redirect URL (contains oauth2 + query params) but no " +
            "idcs_app_resource_url param was found — double-check this is really the instance base URL, " +
            "not a one-time SSO link."
        );
      }
    } catch {
      // Not a parseable URL — fall through and use it as typed.
    }
  }

  const stripped = baseUrl.replace(/\/ic\/builder.*$/i, "").replace(/\/$/, "");
  if (stripped !== baseUrl.replace(/\/$/, "")) {
    console.log('  Stripped trailing "/ic/builder..." path — the tools append that themselves.');
  }
  baseUrl = stripped;

  upsertEnvVars({ VBCS_BASE_URL: baseUrl });
  console.log(`  Set VBCS_BASE_URL=${baseUrl}`);
  console.log("  Still needed in .env, fill in yourself: VBCS_IDCS_USERNAME, VBCS_IDCS_PASSWORD");
}

export async function runInit(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("OVB3 setup");
    console.log("==========");
    console.log("This creates/updates your local .env — it never asks for secrets.\n");

    const { created } = ensureEnvFile();
    console.log(
      created
        ? "No .env found — created one from .env.example."
        : "Found existing .env — only the fields you choose below will change."
    );

    console.log("\nWhat do you want to link?");
    console.log("  1) VB Studio project (git-backed)");
    console.log("  2) Standalone VBCS instance (REST-only)");
    console.log("  3) Both");
    console.log("  4) Skip for now");
    const choice = (await rl.question("> ")).trim();

    if (choice === "1" || choice === "3") {
      console.log("\n--- VB Studio project ---");
      await vbsFlow(rl);
    }
    if (choice === "2" || choice === "3") {
      console.log("\n--- Standalone VBCS instance ---");
      await vbcsFlow(rl);
    }
    if (!["1", "2", "3"].includes(choice)) {
      console.log("\nSkipped linking. Run `ovb3 init` again anytime, or edit .env by hand (see .env.example).");
    }

    console.log("\nDone. The CLI reloads .env fresh on every run, so these changes are already live for `ovb3` commands.");
    console.log("If you also use this through Claude Code's MCP server, restart that session to pick up the change.");
    console.log("\nVerify with: ovb3 list-repos          (VB Studio)");
    console.log("             ovb3 vbcs-list-apps        (standalone VBCS)");
  } finally {
    rl.close();
  }
}
