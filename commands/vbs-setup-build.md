---
description: Install a repo's Oracle build tools (npm install) so build/audit work
argument-hint: [repo]
allowed-tools: mcp__vbcs__setup_build_tools
---
Arguments from the user: $ARGUMENTS

The argument is the repo identifier. Call the setup_build_tools MCP tool (mcp__vbcs__setup_build_tools); it can take several minutes. Report success or the relevant error lines, and on success remind the user that /vbs-run-build also needs the Component Exchange URL configured for apps that use web components.
