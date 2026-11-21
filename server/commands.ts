// Slash-Befehle für die Autovervollständigung: eingebaute, eigene (~/.claude), Projekt (.claude im Ordner) und aktive Plugins.
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export type Cmd = { name: string; desc: string };

const BUILTIN: Cmd[] = [
  ["add-dir", "Weiteren Ordner freigeben"], ["agents", "Subagents verwalten"], ["clear", "Unterhaltung leeren, neu anfangen"],
  ["compact", "Unterhaltung zusammenfassen, Kontext frei machen"], ["config", "Einstellungen"], ["context", "Kontext-Belegung anzeigen"],
  ["cost", "Kosten dieser Sitzung"], ["doctor", "Installation prüfen"], ["effort", "Denkaufwand einstellen"], ["exit", "Claude beenden"],
  ["export", "Unterhaltung exportieren"], ["fast", "Schnellmodus umschalten"], ["help", "Hilfe"], ["hooks", "Hooks verwalten"],
  ["init", "CLAUDE.md für das Projekt anlegen"], ["login", "Anmelden"], ["logout", "Abmelden"], ["mcp", "MCP-Dienste verwalten und anmelden"],
  ["memory", "Gedächtnis-Dateien bearbeiten"], ["model", "Modell wählen"], ["permissions", "Berechtigungen"], ["plugin", "Plugins verwalten"],
  ["release-notes", "Neuerungen"], ["resume", "Frühere Unterhaltung fortsetzen"], ["review", "Code-Review"], ["rewind", "Zurückspulen"],
  ["status", "Status anzeigen"], ["statusline", "Statuszeile einrichten"], ["todos", "Aufgabenliste anzeigen"], ["usage", "Abo-Verbrauch anzeigen"],
].map(([name, desc]) => ({ name, desc }));

const read = (p: string): string => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const dirs = (p: string): string[] => { try { return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } };
const files = (p: string): string[] => { try { return readdirSync(p).filter(f => f.endsWith(".md")); } catch { return []; } };

// description aus dem Frontmatter, Anführungszeichen weg, auf eine Zeile gekürzt
function describe(text: string): string {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const m = fm && fm[1].match(/^description:\s*(.*)$/m);
  const d = m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  return d.length > 140 ? d.slice(0, 137) + "…" : d;
}

// Befehle (commands/*.md) und Skills (skills/*/SKILL.md) eines Ordners, optional mit Präfix "plugin:"
function scan(base: string, prefix: string): Cmd[] {
  const out: Cmd[] = [];
  for (const f of files(join(base, "commands"))) out.push({ name: prefix + f.replace(/\.md$/, ""), desc: describe(read(join(base, "commands", f))) });
  for (const d of dirs(join(base, "skills"))) {
    const t = read(join(base, "skills", d, "SKILL.md"));
    if (t) out.push({ name: prefix + d, desc: describe(t) });
  }
  return out;
}

export function listCommands(home: string, cwd: string): Cmd[] {
  const claude = join(home, ".claude");
  const all: Cmd[] = [...BUILTIN, ...scan(claude, ""), ...(cwd && existsSync(cwd) ? scan(join(cwd, ".claude"), "") : [])];
  let enabled: Record<string, boolean> = {};
  try { enabled = JSON.parse(read(join(claude, "settings.json")) || "{}").enabledPlugins || {}; } catch {}
  let installed: Record<string, { installPath?: string }[]> = {};
  try { installed = JSON.parse(read(join(claude, "plugins/installed_plugins.json")) || "{}").plugins || {}; } catch {}
  for (const [key, list] of Object.entries(installed)) {
    if (!enabled[key]) continue;
    const path = Array.isArray(list) && list[0] && list[0].installPath;
    if (path) all.push(...scan(path, key.split("@")[0] + ":"));
  }
  const seen = new Set<string>();
  return all.filter(c => !seen.has(c.name) && seen.add(c.name));
}
