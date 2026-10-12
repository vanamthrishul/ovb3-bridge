---
description: Start a VB Studio CI job (e.g. a build or deploy job)
argument-hint: [repo] [jobName]
allowed-tools: mcp__vbcs__vbstudio_trigger_build, mcp__vbcs__vbstudio_job_params, mcp__vbcs__vbstudio_build_status
---
Arguments: $ARGUMENTS

The first word is the repo identifier (used to find the VB Studio project), the rest is the job name. Starting a CI job has real effects (it may deploy), so confirm the job name with the user before calling vbstudio_trigger_build (mcp__vbcs__vbstudio_trigger_build). If the job needs parameters, call vbstudio_job_params first and ask the user for the values. Report the returned build number and offer to check its status with /vbs-ci-status.
