---
description: Export business-object data from a standalone VBCS instance (CSV, or ZIP of all)
argument-hint: [appName] [appVersion] [boName]
allowed-tools: mcp__vbcs__vbcs_export_bo_data
---
Arguments: $ARGUMENTS

Words, in order: appName, appVersion, and an optional boName. With a boName you get that object's CSV; without one you get every object as a ZIP, which is saved to disk (tell the user the path). Call the vbcs_export_bo_data MCP tool (mcp__vbcs__vbcs_export_bo_data) and report what was exported.
