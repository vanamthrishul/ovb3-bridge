---
description: Guided setup — link a VB Studio project repo checkout
allowed-tools: mcp__vbcs__list_repos, mcp__vbcs__list_apps, mcp__vbcs__git_clone, mcp__vbcs__doctor
---
Guide the user through linking a VB Studio (VBS) project — a git-backed VBCS app where pages/flows/chains live as files in a git repo — so the rest of the toolkit knows what to work against.

1. First check whether config is already in place: call `list_repos` (mcp__vbcs__list_repos). If it succeeds (even with an empty list), workspace discovery is already configured — skip to step 4. If it fails with a "VBS_WORKSPACE_DIR is not set" / "does not exist" error, config is missing — continue to step 2.

2. Explain how config works for this plugin: `VBS_WORKSPACE_DIR` (and the optional `VBCS_REPO_PATH` / `VBCS_APP_NAME` / Component Exchange URL defaults) are set as **plugin configuration**, not a `.env` file — this tool doesn't have write access to that config from inside a conversation. Tell the user to set it themselves via one of:
   - The `/plugin` menu → find **OVB3** → Configure, and fill in "VBS workspace directory" (a local folder to hold git checkouts of VB Studio project repos — it can be empty to start, you'll clone into it next).
   - Or, at install/reinstall time: `claude plugin install ovb3@ovb3 --config vbs_workspace_dir=/absolute/path/to/a/folder`.

   Ask the user to do this now, then tell them to run `/reload-plugins` (or restart the session) and re-run `/link` to continue.

3. Stop here for this turn — do not proceed further until `list_repos` succeeds.

4. Once workspace discovery works: ask whether the user already has a local checkout of the VB Studio project they want to work on, or needs one cloned.
   - Already checked out, but not under the configured workspace folder: tell them to move/re-clone it under the workspace directory (or set `VBCS_REPO_PATH` via plugin config to point at it directly for a single-repo setup), then confirm with `list_repos`.
   - Needs cloning: ask for the git remote URL and a short destination folder name, then call `git_clone` (mcp__vbcs__git_clone) with those. Report the resulting path. Tell the user that for HTTPS remotes the easiest non-interactive setup is the plugin's "VB Studio git username" and "VB Studio git token" settings (the token is stored in their system keychain; never ask them to paste it here). Without those, git falls back to credentials already cached by their OS credential manager, and fails fast with a clear message rather than hanging if there are none.

5. If the repo hosts more than one app (check via `list_apps` after cloning/pointing), ask which one they want as the default and tell them to set it via plugin config (`vbcs_app_name`) if they'd like to skip specifying it on every call — otherwise every `/vbs-*` command just takes the app name as an argument.

6. Call `doctor` (mcp__vbcs__doctor) and summarize it: what's configured (workspace dir, repo(s) found, default app if set), what is still missing with its one-line fix, and a suggested next step, e.g. `/vbs-list-apps <repo>` or `/vbs-read <repo> <path>`.
