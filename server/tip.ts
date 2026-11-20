// Tipps des eingebauten Plugins "You should know": Zeile über dem Eingabefeld erkennen, Erklärung aus der Plugin-Datei lesen.
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type TipOption = { key: string; label: string };
export type Tip = { tag: string; text: string; options: TipOption[] };
export type TipInfo = { tag: string; line: string; explanation: string };

const HEAD = /^✦\s+(.+?)\s+·\s+(.*\S)\s*$/;
const OPTS = /^\s*\d+:\s+\S/;
const RULE = /^\s*[─━]{10,}\s*$/;

export function parseTip(screen: string): Tip | null {
  const lines = screen.split("\n");
  let h = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (HEAD.test(lines[i])) { h = i; break; }
  if (h < 0) return null;
  const m = lines[h].match(HEAD)!;
  // Tipptext: Kopfzeile plus Folgezeilen bis zur ersten Leerzeile. Danach kann die Erklärung stehen (nach "Learn more").
  const text = [m[2]];
  let o = h + 1;
  for (; o < lines.length && lines[o].trim() && !OPTS.test(lines[o]) && !RULE.test(lines[o]); o++) text.push(lines[o].trim());
  // Optionszeile suchen, höchstens 40 Zeilen tief und nie über die Linie des Eingabefelds hinaus
  for (; o < lines.length && o < h + 40; o++) {
    if (OPTS.test(lines[o])) break;
    if (RULE.test(lines[o])) return null;
  }
  if (o >= lines.length || !OPTS.test(lines[o])) return null;
  const options = [...lines[o].matchAll(/(\d+):\s+(.+?)(?=\s{2,}\d+:|\s*$)/g)].map(x => ({ key: x[1], label: x[2].trim() }));
  // Muss direkt über dem Eingabefeld stehen: bis zur nächsten Linie höchstens zwei Zeilen (Hinweise rechts)
  let r = o + 1;
  while (r < lines.length && !RULE.test(lines[r])) r++;
  if (r >= lines.length || r - o > 3 || !options.length) return null;
  return { tag: m[1], text: text.join(" "), options };
}

// Plugin-Datei: ~/.claude/plugins/store/cc-plugin-you-should-know_*.json
export function tipStoreFile(dir = join(homedir(), ".claude", "plugins", "store")): string | null {
  try {
    const f = readdirSync(dir).find(n => n.startsWith("cc-plugin-you-should-know") && n.endsWith(".json"));
    return f ? join(dir, f) : null;
  } catch { return null; }
}

export function tipInfo(file: string | null, sessionId: string | null): TipInfo | null {
  if (!file || !sessionId) return null;
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    const s = (d?.sessions || []).find((x: any) => x?.id === sessionId);
    const v = s?.view;
    if (!v || typeof v.line !== "string") return null;
    // Vor "Learn more" heißt das Feld explanation, danach text
    const ex = typeof v.explanation === "string" ? v.explanation : typeof v.text === "string" ? v.text : "";
    return { tag: String(s.tag || ""), line: v.line, explanation: ex };
  } catch { return null; }
}
