# VB Studio / VBCS reference

Confirmed facts about how git-backed Visual Builder Studio (VBS) projects are
actually laid out and built, gathered by directly inspecting real project
checkouts and Oracle's own installed build tooling, not from guessing at
Oracle's docs. Nothing here is specific to any one project; it's the same for
any VBS-backed VBCS app.

## Repo layout

A VB Studio project is a git repo. One repo can back multiple VBCS web apps,
so some things are project-root scoped (shared by every app in the repo) and
some are per-app:

```
<repo root>/
  visual-application.json     # project-wide, one per repo
  services/<name>/
    openapi3.json
    catalog.json               # project-wide, shared by every app in the repo
  settings/                    # project-wide
    dependencies.json
    deployment-profiles.json
    user-roles.json
  webApps/<app>/
    flows/*                    # app-scoped
    chains/*
    pages/*
    fragments/*
    resources/*
    settings/                  # app-scoped (distinct from the project-wide settings/ above)
      build.json
      appShellCache.json
      dependencies.json
```

The easy mistake: assuming `services/`, `settings/`, and
`visual-application.json` live under `webApps/<app>/`. They don't; they're
one level up, at the repo root, because a repo can hold more than one app
sharing the same backend services.

## Service calls live in JS action-chain files, not JSON

In current VBCS versions, a page's action chain that calls a backend service
is a **JavaScript** file (`<page>-chains/*.js`), not a JSON document. The call
shape:

```js
Actions.callRest(context, {
  endpoint: "ServiceName/OperationId",
  uriParams: { ... },
  requestType: "json",
});
```

If you're writing a tool that needs to find/compare service usage across
pages or apps, you're grepping/parsing JS for `Actions.callRest(...)` calls,
not walking JSON.

## grunt-vb-build / grunt-vb-audit

Oracle's own build/audit tasks, installed into a VBS repo checkout from a
private Oracle CDN feed (not public npm), confirmed by reading the installed
package source directly, not assumed from docs:

- Task names: **`vb-build`** and **`vb-audit`** (`grunt.registerTask('vb-build', ...)` /
  `i.registerTask("vb-audit", ...)` in the installed packages).
- Target a specific app with `--app=<name>`.
- Both need `--url:ce=<Component Exchange URL>` for any app using shared or
  custom components, which is the normal case, not an edge case. Without it,
  `vb-build` fails outright (`Fatal error: Missing mandatory component
  exchange URL`) and `vb-audit` logs a `ComponentExchangeCCAFinder: Cannot
  load` error per component. This URL is org-specific; there's no default to
  fall back to; you have to know your own org's Component Exchange endpoint.
- `vb-audit` additionally needs live network/auth connectivity to a VB Studio
  backend/tenant service to fetch `vb.services.catalog.json`. If that's not
  reachable you'll see `Backend fetch failed... status: 'ETIMEDOUT'`. This is
  a separate requirement from the Component Exchange URL, and isn't something
  a CLI flag can work around.

## Component Exchange options

From Oracle's grunt-task docs: `url[:ce]` is the Component Exchange service
URL and is only needed when the app references web components. If the
exchange needs a login, pass `username[:ce]` + `password[:ce]`, or
`accessToken[:ce]` (a token wins if both are given). A private exchange hosted
in a VB Studio project has a URL of the form
`https://<vbs-host>/<org>/s/<org>_<project>/compcatalog/0.2.0`; the exchange
is configured under Tenant Settings → Component Exchange, and its credentials
should belong to an administrator who is a member of the hosting project.

## VB Studio CI (Builds REST API)

Documented base: `https://<server>/<org-id>/rest/<org-id_project-id>/cibuild/v1/`.
The `<org-id_project-id>` part is the segment of a git remote URL before
`/scm/` (`https://<server>/<org-id>/s/<org-id_project-id>/scm/<repo>.git`), so
the base can be derived from any repo's `origin`.

| Call | Request | Response |
|---|---|---|
| Start a job | `POST jobs/{job}/build`, `Content-Type: text/plain`, body `{}` or the parameter YAML | plain text `jobs/<id>/builds/<n>` |
| Parameter definitions | `GET jobs/{job}/params` | YAML |
| Build status | `GET jobs/{job}/builds/{n}/status` | plain text, e.g. `SUCCESSFUL` |

Auth is HTTP Basic (a VB Studio user and password) or
`Authorization: Bearer <personal access token>`. There is no deploy endpoint;
a deploy is a job or pipeline you start like any other.

## Standalone VBCS REST API

Oracle publishes exactly 14 endpoints: application list/lock/unlock, the
token endpoint, application- and tenant-level credential CRUD, and
business-object data export/import. There is no whole-application
export/import, version, build or deploy endpoint.

Data import is `POST /ic/builder/{design|deployment}/{app}/{version}/resources/datamgr/import[/{objectId}]`
with the file as the **raw request body** (`Content-Type: text/csv` or
`application/zip`; `.xls`/`.xlsx` also accepted for a single object), not
multipart. The file name must equal the object id. `?append=true` adds rows;
the default replaces the object's existing data. Export is the matching `GET`
returning CSV (one object) or a ZIP of CSVs (all). Lock a live application
before either.

## Common gotchas

- **Personal access tokens expire.** A git or API call that used to work and
  now returns 401 is almost always an expired or revoked token.

- **The `gitRemoteRepo` field from the standalone-VBCS REST API's app listing
  is not a reliable source of the canonical git host.** It just records
  whatever was true when the app was created/deployed and can point at a
  stale environment. If you need the real git remote for a project, use a
  value the user configured directly (or ask), not this field.
- **A pasted VBCS "base URL" that's suspiciously long and full of query
  params (`oauth2/v1/authorize?...&state=...&nonce=...`) is an IDCS login
  redirect, not the instance URL.** The real host is recoverable from that
  URL's `idcs_app_resource_url` query parameter.
- **The standalone-VBCS REST base URL must be the bare host**, e.g.
  `https://vbcs-<tenant>-<env>.builder.<region>.ocp.oraclecloud.com`,
  without a trailing `/ic/builder/`. Tooling that calls the REST API appends
  that path itself; including it in the base URL double-prefixes every call.
