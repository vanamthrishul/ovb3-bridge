import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const list = (dir: string) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".md")).sort();

/**
 * The slash commands exist in two places: .claude/commands (used when working
 * inside this repo) and commands/ (shipped in the plugin). Everything but the
 * setup flow must stay byte-identical, or one copy silently rots.
 */
const INTENTIONALLY_DIFFERENT = new Set(["link.md"]);

describe("packaging consistency", () => {
  it("ships the same set of commands in both locations", () => {
    expect(list("commands")).toEqual(list(".claude/commands"));
  });

  it("keeps shared command files identical", () => {
    for (const file of list("commands")) {
      if (INTENTIONALLY_DIFFERENT.has(file)) continue;
      expect(read(`commands/${file}`), `${file} drifted between commands/ and .claude/commands/`).toBe(read(`.claude/commands/${file}`));
    }
  });

  it("keeps package.json, plugin.json and marketplace.json on one version", () => {
    const pkg = JSON.parse(read("package.json")).version;
    expect(JSON.parse(read(".claude-plugin/plugin.json")).version).toBe(pkg);
    const market = JSON.parse(read(".claude-plugin/marketplace.json"));
    for (const plugin of market.plugins ?? []) if (plugin.version) expect(plugin.version).toBe(pkg);
    expect(read("src/server.ts")).toContain(`version: "${pkg}"`);
  });

  it("publishes bin entries without a leading ./ (npm silently drops those)", () => {
    const bin = JSON.parse(read("package.json")).bin as Record<string, string>;
    for (const target of Object.values(bin)) expect(target.startsWith("./")).toBe(false);
  });

  it("documents every env var the code reads", () => {
    const example = read(".env.example");
    const used = new Set<string>();
    for (const dir of ["src", "src/lib", "src/tools"]) {
      for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith(".ts"))) {
        for (const m of read(`${dir}/${f}`).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|env\.([A-Z][A-Z0-9_]+)|"([A-Z][A-Z0-9_]{4,})"/g)) {
          const name = m[1] ?? m[2] ?? m[3];
          if (/^(VBS|VBCS|VBSTUDIO|VB_BUILD|OVB3)_/.test(name)) used.add(name);
        }
      }
    }
    const missing = [...used].filter((name) => !example.includes(name));
    expect(missing, `env vars used in code but absent from .env.example: ${missing.join(", ")}`).toEqual([]);
  });
});
