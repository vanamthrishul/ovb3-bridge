---
description: Guided setup — link a VB Studio project or a standalone VBCS instance
allowed-tools: mcp__vbcs__list_repos, mcp__vbcs__git_clone, mcp__vbcs__vbcs_list_applications, Edit, Read
---
Guide the user through linking either a VB Studio (VBS) project or a standalone VBCS instance, so the rest of the toolkit knows what to work against. Ask, don't assume:

1. Ask whether they're linking a **VB Studio project** (git-backed — pages/flows/chains live as files in a git repo) or a **standalone VBCS instance** (REST-only, no git remote for the app).

2. If **VB Studio**:
   - Ask whether they already have a local checkout, or need one cloned.
   - Already checked out: ask for its absolute path. Read `.env`'s current `VBS_WORKSPACE_DIR`. If the checkout's parent directory matches it, nothing to do — just confirm with `list_repos`. Otherwise, use `Edit` to set `VBS_WORKSPACE_DIR` in `.env` to the checkout's parent directory (or `VBCS_REPO_PATH` directly to the checkout itself, for a single-repo setup), then confirm with `list_repos`.
   - Needs cloning: ask for the git remote URL and a short destination folder name, then call `git_clone` (mcp__vbcs__git_clone) with those. Report the resulting path.
   - If the repo hosts more than one app (check via `list_apps` after cloning/pointing), ask which one is the default and set `VBCS_APP_NAME` in `.env` via `Edit`.
   - Tell the user their VB Studio git credentials (`VBSTUDIO_GIT_USERNAME`/`VBSTUDIO_GIT_TOKEN` in `.env`) must already be filled in for `git_clone`/`git_pull`/`git_push` to work, and that filling those in is on them, never in this conversation.

3. If **standalone VBCS**:
   - Ask for the instance's base URL only (not a secret). Use `Edit` to set `VBCS_BASE_URL` in `.env` to that value.
   - Explicitly tell the user: their IDCS username and password must be filled into `VBCS_IDCS_USERNAME` / `VBCS_IDCS_PASSWORD` in `.env` **by them, directly** — never paste credentials into this conversation.
   - Explain that a session restart is required afterward (env vars load once at server startup), and that once restarted, `/vbcs-list-apps` (or `vbcs_list_applications`) can be used to verify the connection.
   - Do not attempt to call `vbcs_list_applications` yet if the credentials were just requested — it will fail until the user has filled them in and restarted.

4. Only ever use `Edit` to write non-secret fields (`VBS_WORKSPACE_DIR`, `VBCS_REPO_PATH`, `VBCS_APP_NAME`, `VBCS_BASE_URL`). Never write, ask for, or echo back any credential/secret field — those are always the user's to fill in directly in `.env`.

5. Finish with a short summary of what's now configured and what (if anything) the user still needs to fill in themselves before it's fully working.
