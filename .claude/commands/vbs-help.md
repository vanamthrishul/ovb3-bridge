---
description: List all /vbs-* commands and what they do
---
Show this table (the commands are namespaced /ovb3:vbs-* when installed as a plugin) and nothing else except the footnote:

| Command | Arguments | What it does |
|---|---|---|
| /vbs-doctor | [repo] [live] | Check your setup and get the exact fix for anything missing |
| /link | | Guided setup |
| /vbs-list-repos | | List local repo checkouts |
| /vbs-list-apps | repo | List VBCS web apps in a repo |
| /vbs-read | repo path | Read an artifact file |
| /vbs-write | repo path | Write an artifact file |
| /vbs-list-artifacts | repo glob | Find artifact files by name |
| /vbs-search | repo text [glob] | Search file content |
| /vbs-audit-calls | repo [endpoint] | Compare REST call parameters across apps |
| /vbs-git-status | repo | Git status |
| /vbs-git-commit | repo message | Stage and commit |
| /vbs-git-pull | repo | Pull |
| /vbs-git-push | repo | Push |
| /vbs-setup-build | repo | Install Oracle's build tools (npm install) |
| /vbs-run-build | repo [app] | Run grunt-vb-build |
| /vbs-run-audit | repo [app] | Run grunt-vb-audit |
| /vbs-ci-build | repo jobName | Start a VB Studio CI job |
| /vbs-ci-status | repo jobName n | Status of a CI build |

`<repo>` means an exact folder name under VBS_WORKSPACE_DIR, an absolute path, or "-" for the VBCS_REPO_PATH default. For standalone VBCS instances (no VB Studio project) see /vbcs-help.
