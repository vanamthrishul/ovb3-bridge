import { describe, it, expect, afterEach } from "vitest";

import { authConfigFor, nonInteractiveEnv } from "../src/tools/git.js";

describe("git auth + environment hygiene", () => {
  const saved = { u: process.env.VBSTUDIO_GIT_USERNAME, t: process.env.VBSTUDIO_GIT_TOKEN };
  afterEach(() => {
    if (saved.u === undefined) delete process.env.VBSTUDIO_GIT_USERNAME;
    else process.env.VBSTUDIO_GIT_USERNAME = saved.u;
    if (saved.t === undefined) delete process.env.VBSTUDIO_GIT_TOKEN;
    else process.env.VBSTUDIO_GIT_TOKEN = saved.t;
  });

  it("sends no auth config when no token is configured", () => {
    delete process.env.VBSTUDIO_GIT_USERNAME;
    delete process.env.VBSTUDIO_GIT_TOKEN;
    expect(authConfigFor("https://h.example/o/s/p/scm/r.git")).toEqual([]);
  });

  it("scopes a Basic header to the remote's own origin", () => {
    process.env.VBSTUDIO_GIT_USERNAME = "user@corp";
    process.env.VBSTUDIO_GIT_TOKEN = "tok";
    const [cfg] = authConfigFor("https://h.example:8443/o/s/p/scm/r.git");
    expect(cfg).toBe(`http.https://h.example:8443/.extraHeader=Authorization: Basic ${Buffer.from("user@corp:tok").toString("base64")}`);
  });

  it("never sends the header for ssh or local-path remotes", () => {
    process.env.VBSTUDIO_GIT_USERNAME = "u";
    process.env.VBSTUDIO_GIT_TOKEN = "t";
    expect(authConfigFor("git@host:org/repo.git")).toEqual([]);
    expect(authConfigFor("ssh://git@host/org/repo.git")).toEqual([]);
    expect(authConfigFor("C:\\repos\\thing")).toEqual([]);
    expect(authConfigFor("/srv/git/thing")).toEqual([]);
  });

  it("strips credential-prompt and programmable-hook variables, keeps proxy/TLS ones, disables prompts", () => {
    const env = nonInteractiveEnv({
      PATH: "/bin",
      GIT_ASKPASS: "code-askpass",
      SSH_ASKPASS: "x",
      GIT_EDITOR: "vim",
      GIT_SSH_COMMAND: "ssh -o x",
      EDITOR: "vim",
      GIT_SSL_CAINFO: "/etc/ca.pem",
      GIT_HTTP_PROXY_AUTHMETHOD: "basic",
      HTTPS_PROXY: "http://proxy",
    });
    expect(env).toMatchObject({ PATH: "/bin", GIT_SSL_CAINFO: "/etc/ca.pem", GIT_HTTP_PROXY_AUTHMETHOD: "basic", HTTPS_PROXY: "http://proxy" });
    for (const gone of ["GIT_ASKPASS", "SSH_ASKPASS", "GIT_EDITOR", "GIT_SSH_COMMAND", "EDITOR"]) expect(env).not.toHaveProperty(gone);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GCM_INTERACTIVE).toBe("never");
  });
});
