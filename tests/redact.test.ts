import { describe, it, expect } from "vitest";
import { redactString, redactValue } from "../src/lib/redact.js";

describe("redact", () => {
  it("strips user:token from URLs but keeps host and path", () => {
    expect(redactString("clone https://alice:s3cr3t@host.example/org/s/p/scm/r.git now")).toBe(
      "clone https://***@host.example/org/s/p/scm/r.git now"
    );
  });

  it("strips a username-only URL credential", () => {
    expect(redactString("https://alice@host.example/x")).toBe("https://***@host.example/x");
  });

  it("strips secret CLI flags", () => {
    expect(redactString("grunt vb-build --password:ce=hunter2 --accessToken:ce=abc.def --app=x")).toBe(
      "grunt vb-build --password:ce=*** --accessToken:ce=*** --app=x"
    );
  });

  it("strips Authorization header values", () => {
    expect(redactString("Authorization: Bearer abc.DEF-123")).toBe("Authorization: Bearer ***");
    expect(redactString("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe("Authorization: Basic ***");
  });

  it("leaves ordinary text alone", () => {
    expect(redactString("webApps/myApp/flows/main.json")).toBe("webApps/myApp/flows/main.json");
  });

  it("redacts deeply inside log-field objects without mutating the input", () => {
    const input = { remoteUrl: "https://u:p@h/x", nested: { list: ["--password=zzz"] }, n: 3 };
    const out = redactValue(input) as typeof input;
    expect(out.remoteUrl).toBe("https://***@h/x");
    expect(out.nested.list[0]).toBe("--password=***");
    expect(out.n).toBe(3);
    expect(input.remoteUrl).toBe("https://u:p@h/x");
  });
});
