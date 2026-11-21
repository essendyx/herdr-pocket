import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { listCommands } from "../server/commands.ts";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "cmds-"));
  const cwd = join(home, "src/proj");
  const md = (p: string, fm: string) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, "---\n" + fm + "\n---\nInhalt\n"); };
  const pl = join(home, ".claude/plugins/cache/m/superpowers/7.0.0");
  md(join(pl, "skills/brainstorming/SKILL.md"), "name: brainstorming\ndescription: \"Vor kreativer Arbeit\"");
  const off = join(home, ".claude/plugins/cache/m/aus/1.0.0");
  md(join(off, "commands/geheim.md"), "description: sollte fehlen");
  const cc = join(home, ".claude/plugins/cache/o/commit-commands/1.0.1");
  md(join(cc, "commands/commit.md"), "allowed-tools: Bash(git add:*)\ndescription: Create a git commit");
  mkdirSync(join(home, ".claude/plugins"), { recursive: true });
  writeFileSync(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: {
    "superpowers@m": [{ installPath: pl }], "aus@m": [{ installPath: off }], "commit-commands@o": [{ installPath: cc }] } }));
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "superpowers@m": true, "aus@m": false, "commit-commands@o": true } }));
  md(join(home, ".claude/commands/standup.md"), "description: Tagesbericht");
  md(join(home, ".claude/skills/notiz/SKILL.md"), "name: notiz\ndescription: Notiz anlegen");
  md(join(cwd, ".claude/commands/deploy.md"), "description: Projekt ausrollen");
  return { home, cwd };
}

test("Befehle: eingebaute, eigene, Projekt- und Plugin-Befehle, deaktivierte Plugins fehlen", () => {
  const { home, cwd } = setup();
  const l = listCommands(home, cwd);
  const by = Object.fromEntries(l.map(c => [c.name, c.desc]));
  expect(by["compact"]).toBeTruthy();
  expect(by["mcp"]).toBeTruthy();
  expect(by["superpowers:brainstorming"]).toBe("Vor kreativer Arbeit");
  expect(by["commit-commands:commit"]).toBe("Create a git commit");
  expect(by["standup"]).toBe("Tagesbericht");
  expect(by["notiz"]).toBe("Notiz anlegen");
  expect(by["deploy"]).toBe("Projekt ausrollen");
  expect("aus:geheim" in by).toBe(false);
  // Keine Doppelten
  expect(new Set(l.map(c => c.name)).size).toBe(l.length);
});

test("Befehle: fehlende Ordner und kaputte Dateien stören nicht", () => {
  const home = mkdtempSync(join(tmpdir(), "cmds-"));
  const l = listCommands(home, join(home, "gibtsnicht"));
  expect(l.some(c => c.name === "clear")).toBe(true);
});
