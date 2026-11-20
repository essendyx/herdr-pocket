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
