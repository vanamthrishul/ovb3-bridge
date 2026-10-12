---
description: Compare REST service call parameters across apps in a repo
argument-hint: [repo] [endpoint]
allowed-tools: mcp__vbcs__audit_service_calls
---
Arguments: $ARGUMENTS

The first word is the repo identifier; an optional second word is a single endpoint to check (e.g. ServiceName/OperationId). Call the audit_service_calls MCP tool (mcp__vbcs__audit_service_calls). Report, per endpoint, which apps call it, then list every inconsistency (a parameter key some apps send that others omit) with the apps on each side. If there are no inconsistencies, say so plainly. Remind the user this compares which parameter keys are passed, not their values.
