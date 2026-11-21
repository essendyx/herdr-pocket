// Erkennt einen Freigabe-Dialog von Claude Code im sichtbaren Bildschirmtext.
import { createHash } from "crypto";

// kind: "permission" = Freigabe (Bash, Write ...), "question" = Auswahlfrage von Claude (AskUserQuestion)
// descs: Beschreibung je Option (nur bei Fragen), freeText: Nummer der Option "Type something." oder null
// "trust" = Ordner-Vertrauen beim ersten Start in einem Ordner: Optionen ohne Nummern, Auswahl per Pfeiltasten ab cursor
export type Dialog = { hash: string; kind: "permission" | "question" | "trust"; title: string; question: string; detail: string; options: string[]; descs: string[]; freeText: number | null; cursor?: number };

const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const RULE = /^\s*[─━]{10,}\s*$/;
const DASHED = /^\s*╌{10,}\s*$/;
const FOOTER = /Esc to cancel/;
const QFOOTER = /Enter to select/;
const REVIEW = /^\s*Review your answers\s*$/;
const TABS = /^\s*←.*Submit.*→\s*$/;
const FREE = /^Type something\.?$/i;

// Ordner-Vertrauen: "Accessing workspace:", Pfad, zwei Optionen ohne Nummern, "Enter to confirm"
function parseTrust(lines: string[]): Dialog | null {
  const head = lines.map(l => l.trim()).lastIndexOf("Accessing workspace:");
  if (head < 0) return null;
  const foot = lines.findIndex((l, k) => k > head && /Enter to confirm/.test(l));
  if (foot < 0) return null;
  const body = lines.slice(head + 1, foot).map(l => l.trim());
  const yes = body.findIndex(l => /^(❯\s*)?Yes, I trust this folder$/.test(l));
  if (yes < 1 || !/^(❯\s*)?No, exit$/.test(body[yes - 1])) return null;
  const opts = [body[yes - 1], body[yes]];
  const options = opts.map(o => o.replace(/^❯\s*/, ""));
  const cursor = opts[1].startsWith("❯") ? 2 : 1;
  const detail = body.find(l => l.startsWith("/")) || "";
  const hash = createHash("sha256").update(["trust", detail, options.join("|")].join("\n")).digest("hex").slice(0, 16);
  return { hash, kind: "trust", title: "", question: "Diesem Ordner vertrauen?", detail, options, descs: ["", ""], freeText: null, cursor };
}

export function parseDialog(screen: string): Dialog | null {
  const lines = screen.split("\n");
  const trust = parseTrust(lines);
  if (trust) return trust;
  // Letzte Option "1." suchen, von dort die Optionen einsammeln
  let first = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(OPTION);
    if (m && m[1] === "1") { first = i; break; }
  }
  if (first < 0) return null;
  let footerAt = lines.findIndex((l, k) => k > first && FOOTER.test(l));
  // Bestätigungsseite nach mehreren Teilfragen: keine Fußzeile, aber "Review your answers" und die Reiterzeile mit Submit
  let review = false;
  if (footerAt < 0) {
    let top0 = first - 1;
    while (top0 >= 0 && !RULE.test(lines[top0])) top0--;
    const above = lines.slice(top0 + 1, first);
    if (!above.some(l => REVIEW.test(l)) || !above.some(l => TABS.test(l))) return null;
    review = true;
    footerAt = lines.length;
  }
  const kind: Dialog["kind"] = review || QFOOTER.test(lines[footerAt] || "") ? "question" : "permission";
  const options: string[] = [];
  const descs: string[] = [];
  for (let i = first; i < footerAt; i++) {
    const l = lines[i];
    // Bei Fragen trennt eine Linie "Type something." von "Chat about this": weiterlesen, wenn danach die nächste Nummer kommt
    if (RULE.test(l)) {
      const next = lines.slice(i + 1, footerAt).find(x => x.trim());
      const nm = next?.match(OPTION);
      if (kind === "question" && nm && Number(nm[1]) === options.length + 1) continue;
      break;
    }
    const m = l.match(OPTION);
    if (m && Number(m[1]) === options.length + 1) { options.push(m[2]); descs.push(""); }
    else if (l.trim() && options.length) {
      const k = options.length - 1;
      if (kind === "question") descs[k] = (descs[k] ? descs[k] + " " : "") + l.trim();
      else options[k] += " " + l.trim();
    }
  }
  if (options.length < 2) return null;

  // Block über den Optionen bis zur letzten durchgezogenen Linie
  let top = first - 1;
  while (top >= 0 && !RULE.test(lines[top])) top--;
  const block = lines.slice(top + 1, first).map(l => l.trim()).filter(Boolean);
  const question = block.length ? block[block.length - 1] : "";
  // Fragen haben oben einen Reiter wie "☐ Test"
  const title = block[0] && block[0] !== question ? block[0].replace(/^[☐☒✔✓■□]\s*/, "") : "";
  if (review) {
    // Zusammenfassung der Antworten als Detail anzeigen
    const hash = createHash("sha256").update(["review", block.join("\n"), options.join("|")].join("\n")).digest("hex").slice(0, 16);
    const detail = block.filter(l => !REVIEW.test(l) && !TABS.test(l)).join("\n");
    return { hash, kind, title: "", question: "Antworten prüfen und absenden", detail, options, descs, freeText: null };
  }
  // Detail: alles zwischen gestrichelten Linien, sonst die Zeilen zwischen Titel und Frage ohne Tipps
  const raw = lines.slice(top + 1, first);
  const dashed = raw.map((l, k) => (DASHED.test(l) ? k : -1)).filter(k => k >= 0);
  let detailLines: string[];
  if (dashed.length >= 2) {
    detailLines = raw.slice(dashed[0] + 1, dashed[dashed.length - 1]).map(l => l.trim()).filter(Boolean);
    const before = raw.slice(0, dashed[0]).map(l => l.trim()).filter(Boolean).slice(1).filter(l => !/^Tip:/.test(l));
    detailLines = before.concat(detailLines);
  } else {
    detailLines = block.slice(1, -1).filter(l => !/^Tip:/.test(l) && !DASHED.test(l));
  }
  const detail = detailLines.join("\n");
  const hash = createHash("sha256").update([kind, title, detail, question, options.join("|"), descs.join("|")].join("\n")).digest("hex").slice(0, 16);
  const fi = kind === "question" ? options.findIndex(o => FREE.test(o)) : -1;
  return { hash, kind, title, question, detail, options, descs, freeText: fi >= 0 ? fi + 1 : null };
}

// Nummer der ablehnenden Option ("No ..."), sonst die letzte
export function denyOption(d: Dialog): number {
  const i = d.options.findIndex(o => /^No\b/i.test(o));
  return i >= 0 ? i + 1 : d.options.length;
}

// MCP-Anmeldung ("Authenticate with X"): die im Terminal umgebrochene URL wieder zusammensetzen.
// paste: Claude wartet auf die Adresse aus dem Browser (Weiterleitung auf localhost geht vom Handy aus ins Leere)
export type Auth = { server: string; url: string; paste: boolean };
export function parseAuth(screen: string): Auth | null {
  const lines = screen.split("\n");
  let h = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^\s*Authenticate with \S/.test(lines[i])) { h = i; break; }
  if (h < 0) return null;
  const server = lines[h].trim().replace(/^Authenticate with\s+/, "");
  const u = lines.findIndex((l, k) => k > h && /^\s*https?:\/\//.test(l));
  if (u < 0) return null;
  let url = "";
  for (let k = u; k < lines.length && lines[k].trim(); k++) url += lines[k].trim();
  const rest = lines.slice(u);
  const paste = rest.some(l => /paste the URL/i.test(l)) && rest.some(l => /Enter to submit/.test(l));
  return { server, url, paste };
}

// Offenes Menü im Terminal (z. B. /mcp, /model): erkennbar an der Fußzeile mit "Esc to …", "Enter to …" oder "to navigate".
// Liefert den Block darüber ohne Rahmen, damit der Chat ihn zeigen und mit Pfeiltasten bedienen kann.
export type Panel = { text: string; footer: string };
const PANEL_FOOT = /\b(Esc to \w|Enter to \w|to navigate)/;
const SEP = /^\s*[─━▔]{10,}\s*$/;
// claude: bei Claude Code gilt außerdem jede Anzeige als Menü, die das normale Eingabefeld (❯ zwischen zwei Linien) verdrängt hat,
// z. B. /usage oder /status ohne Fußzeile. Inhalt ist dann alles unter der obersten ▔-Linie.
const TOPBAR = /^\s*▔{10,}\s*$/;
function hasPromptBox(lines: string[]): boolean {
  const tail = lines.slice(-12);
  return tail.some((l, k) => /^\s*❯/.test(l) && k > 0 && RULE.test(tail[k - 1]));
}
export function parsePanel(screen: string, claude = false): Panel | null {
  const lines = screen.split("\n").map(l => l.replace(/\s+$/, ""));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return null;
  const footer = lines[lines.length - 1].trim();
  if (!PANEL_FOOT.test(footer)) {
    if (!claude || hasPromptBox(lines)) return null;
    let top = -1;
    for (let k = lines.length - 1; k >= 0; k--) if (TOPBAR.test(lines[k])) { top = k; break; }
    const block = lines.slice(top + 1);
    while (block.length && !block[0].trim()) block.shift();
    if (!block.length) return null;
    const ind = Math.min(...block.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length));
    return { text: block.map(l => l.slice(ind)).join("\n"), footer: "" };
  }
  let i = lines.length - 2;
  while (i >= 0 && !lines[i].trim()) i--;
  if (i < 0) return null;
  let block: string[] = [];
  if (/^\s*╰/.test(lines[i])) {
    let k = i - 1;
    while (k >= 0 && !/^\s*╭/.test(lines[k])) k--;
    if (k < 0) return null;
    block = lines.slice(k + 1, i).map(l => l.replace(/^\s*│\s?/, "").replace(/\s*│\s*$/, ""));
  } else {
    let k = i;
    while (k >= 0 && i - k < 30 && !SEP.test(lines[k])) k--;
    block = lines.slice(k + 1, i + 1);
  }
  while (block.length && !block[0].trim()) block.shift();
  while (block.length && !block[block.length - 1].trim()) block.pop();
  if (!block.length) return null;
  const ind = Math.min(...block.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length));
  return { text: block.map(l => l.slice(ind).replace(/\s+$/, "")).join("\n"), footer };
}
