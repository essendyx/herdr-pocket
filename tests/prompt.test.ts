import { test, expect } from "bun:test";
import { parseDialog, denyOption } from "../server/prompt.ts";

const read = (n: string) => Bun.file(import.meta.dir + "/fixtures/screens/" + n).text();

test("Bash-Dialog: Titel, Befehl, Frage, vier Optionen mit Umbruch", async () => {
  const d = parseDialog(await read("screen-bash.txt"))!;
  expect(d.title).toBe("Bash command");
  expect(d.detail).toContain("echo herdr-app-dialog-test > probe.txt");
  expect(d.question).toBe("Do you want to proceed?");
  expect(d.options.length).toBe(4);
  expect(d.options[0]).toBe("Yes");
  expect(d.options[1]).toContain("from this project");
  expect(d.options[3]).toBe("No");
  expect(d.hash).toMatch(/^[0-9a-f]{16}$/);
});

test("Write-Dialog: drei Optionen, Datei im detail", async () => {
  const d = parseDialog(await read("screen-write.txt"))!;
  expect(d.title).toBe("Create file");
  expect(d.detail).toContain("notiz.md");
  expect(d.options.length).toBe(3);
  expect(denyOption(d)).toBe(3);
});

test("Ablehnen ist im Bash-Dialog die 4", async () => {
  expect(denyOption(parseDialog(await read("screen-bash.txt"))!)).toBe(4);
});

test("gleicher Dialog gleicher Hash, anderer Befehl anderer Hash", async () => {
  const t = await read("screen-bash.txt");
  expect(parseDialog(t)!.hash).toBe(parseDialog(t)!.hash);
  expect(parseDialog(t.replace("probe.txt > probe.txt", "x").replaceAll("echo herdr-app-dialog-test", "rm -rf ziel"))!.hash).not.toBe(parseDialog(t)!.hash);
});

test("kein Dialog ergibt null", async () => {
  expect(parseDialog(await read("screen-idle.txt"))).toBeNull();
  expect(parseDialog("")).toBeNull();
});

test("Auswahlfrage (AskUserQuestion): Optionen über die Trennlinie hinweg, Beschreibungen getrennt, Freitext erkannt", async () => {
  const d = parseDialog(await read("screen-question.txt"))!;
  expect(d).not.toBeNull();
  expect(d.kind).toBe("question");
  expect(d.title).toBe("Test");
  expect(d.question).toBe("Testfrage 2: Welche Farbe soll der Senden-Knopf haben?");
  expect(d.options).toEqual(["Türkis lassen", "Blau", "Grau", "Type something.", "Chat about this"]);
  expect(d.descs).toEqual(["So wie jetzt.", "Wie die Links.", "Dezenter.", "", ""]);
  expect(d.freeText).toBe(4);
});

test("Freigabe-Dialoge bleiben Freigaben: Umbruch gehört zur Option, kein Freitext", async () => {
  const d = parseDialog(await read("screen-bash.txt"))!;
  expect(d.kind).toBe("permission");
  expect(d.freeText).toBeNull();
  expect(d.options[1]).toContain("from this project");
});

test("Bestätigungsseite nach mehreren Teilfragen (ohne Fußzeile): Absenden oder Abbrechen", async () => {
  const d = parseDialog(await read("screen-question-review.txt"))!;
  expect(d).not.toBeNull();
  expect(d.kind).toBe("question");
  expect(d.question).toBe("Antworten prüfen und absenden");
  expect(d.options).toEqual(["Submit answers", "Cancel"]);
  expect(d.detail).toContain("Testfrage C: Lieber Kaffee oder Tee?");
  expect(d.detail).toContain("→ Meer");
  expect(d.freeText).toBeNull();
});

test("nummerierte Liste ohne Fußzeile im normalen Verlauf ist kein Dialog", () => {
  expect(parseDialog("● Plan:\n  1. Erst das\n  2. Dann das\n\n───────────────\n❯ \n───────────────")).toBeNull();
});

test("Ordner-Vertrauen: Optionen ohne Nummern werden erkannt, Cursor steht auf der ersten", async () => {
  const s = await Bun.file(import.meta.dir + "/fixtures/screens/screen-trust.txt").text();
  const d = parseDialog(s)!;
  expect(d).not.toBeNull();
  expect(d.kind).toBe("trust");
  expect(d.options).toEqual(["No, exit", "Yes, I trust this folder"]);
  expect(d.detail).toBe("/home/alex/src/neu");
  expect(d.cursor).toBe(1);
  expect(denyOption(d)).toBe(1);
  // Cursor auf der zweiten Option
  expect(parseDialog(s.replace("❯ No, exit", "  No, exit").replace("   Yes, I trust", " ❯ Yes, I trust"))!.cursor).toBe(2);
});

test("MCP-Anmeldung: Server, zusammengesetzte URL, Einfügen möglich", async () => {
  const { parseAuth } = await import("../server/prompt.ts");
  const s = await read("screen-mcp-auth.txt");
  expect(parseAuth(s)).toEqual({
    server: "higgsfield",
    url: "https://example.ai/oauth/authorize?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fclaude-code-client-metadata&code_challenge=abc&redirect_uri=http%3A%2F%2Flocalhost%3A53561%2Fcallback&state=xyz&scope=openid+email+offline_access&prompt=consent",
    paste: true,
  });
  expect(parseAuth("❯ hi\n● Hallo")).toBeNull();
  expect(parseDialog(s)).toBeNull();
});

test("Offenes Terminal-Menü (z. B. /mcp): Block über der Fußzeile, ohne Rahmenzeichen", async () => {
  const { parsePanel } = await import("../server/prompt.ts");
  expect(parsePanel(await read("screen-mcp-menu.txt"))).toEqual({
    text: "Manage MCP servers\n2 servers\n\n❯ 1. higgsfield                 △ needs authentication\n  2. obsidian                   ✔ connected\n\n※ Tip: Run claude --debug to see logs",
    footer: "↑↓ to navigate · Enter to confirm · Esc to cancel",
  });
  // Normales Eingabefeld ist kein Menü
  expect(parsePanel(await read("screen-idle.txt"))).toBeNull();
  expect(parsePanel(await read("screen-tip.txt"))).toBeNull();
});

test("Vollbild-Anzeige ohne Fußzeile (z. B. /usage): erkannt, weil das Eingabefeld fehlt", async () => {
  const { parsePanel } = await import("../server/prompt.ts");
  const p = parsePanel(await read("screen-usage.txt"), true)!;
  expect(p).not.toBeNull();
  expect(p.text.split("\n")[0]).toBe("Settings  Status   Config   Usage   Stats");
  expect(p.text).toContain("Current week (all models)");
  expect(p.text).not.toContain("❯ /clear");
  // Ohne Claude-Kennzeichen (andere Agents) keine Vermutung
  expect(parsePanel(await read("screen-usage.txt"))).toBeNull();
  // Normales Eingabefeld, auch mit Tipp darüber: kein Menü
  expect(parsePanel(await read("screen-idle.txt"), true)).toBeNull();
  expect(parsePanel(await read("screen-tip.txt"), true)).toBeNull();
  expect(parsePanel(await read("screen-tip-explained.txt"), true)).toBeNull();
});

test("Statuszeile beim Arbeiten: Dauer, Tokens und Hinweis aus dem Terminal", async () => {
  const { parseSpinner } = await import("../server/prompt.ts");
  const box = "\n────────────────────\n❯\n────────────────────\n  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt";
  expect(parseSpinner("● Hallo\n* Vibing… (10m 47s · ↓ 11.2k tokens · thinking)" + box)).toEqual({ secs: 647, tokens: "11.2k", note: "thinking" });
  expect(parseSpinner("· Incubating… (18s · ↓ 1.4k tokens)" + box)).toEqual({ secs: 18, tokens: "1.4k", note: "" });
  expect(parseSpinner("✻ Pondering… (1h 2m 3s · ↑ 900 tokens · esc to interrupt)" + box)).toEqual({ secs: 3723, tokens: "900", note: "" });
  expect(parseSpinner("✳ Pondering…" + box)).toEqual({ secs: null, tokens: "", note: "" });
  // Abgeschlossene Runde und normale Antwort sind keine Statuszeile
  expect(parseSpinner("✻ Churned for 11s · done 11:40 PM" + box)).toBeNull();
  expect(parseSpinner("● Ich prüfe das…" + box)).toBeNull();
});

test("Mehrere Teilfragen: Reiter werden erkannt, umgebrochene Frage bleibt vollständig", async () => {
  const d = parseDialog(await read("screen-question-multi.txt"))!;
  expect(d.kind).toBe("question");
  expect(d.question).toBe("In Miniconda gibt es zwei Conda-Umgebungen: 'tts' und 'vision'. Wenn Miniconda wegfällt, sind die auch weg. Brauchst du die noch?");
  expect(d.title).toBe("Conda-Envs");
  expect(d.tabs).toEqual([{ label: "Codex", done: true }, { label: "Conda-Envs", done: false }, { label: "ComfyUI", done: false }]);
  expect(d.step).toBe(1);
  expect(d.options.slice(0, 2)).toEqual(["Können weg", "Als venv nachbauen"]);
  expect(d.descs[1]).toBe("Ich baue beide als uv-venv auf Python 3.14 neu auf (Torch/CUDA kann dabei hakelig werden), danach fliegt Miniconda raus.");
  expect(d.freeText).toBe(3);
});

test("Einzelne Frage: Reiter oben ist der Titel, keine Reiterliste", async () => {
  const d = parseDialog(await read("screen-question.txt"))!;
  expect(d.title).toBe("Test");
  expect(d.question).toBe("Testfrage 2: Welche Farbe soll der Senden-Knopf haben?");
  expect(d.tabs).toBeUndefined();
});
