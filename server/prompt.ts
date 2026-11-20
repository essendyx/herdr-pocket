// Erkennt einen Freigabe-Dialog von Claude Code im sichtbaren Bildschirmtext.
import { createHash } from "crypto";

// kind: "permission" = Freigabe (Bash, Write ...), "question" = Auswahlfrage von Claude (AskUserQuestion)
// descs: Beschreibung je Option (nur bei Fragen), freeText: Nummer der Option "Type something." oder null
export type Dialog = { hash: string; kind: "permission" | "question"; title: string; question: string; detail: string; options: string[]; descs: string[]; freeText: number | null };

const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const RULE = /^\s*[─━]{10,}\s*$/;
const DASHED = /^\s*╌{10,}\s*$/;
const FOOTER = /Esc to cancel/;
const QFOOTER = /Enter to select/;
const REVIEW = /^\s*Review your answers\s*$/;
const TABS = /^\s*←.*Submit.*→\s*$/;
const FREE = /^Type something\.?$/i;

export function parseDialog(screen: string): Dialog | null {
  const lines = screen.split("\n");
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
