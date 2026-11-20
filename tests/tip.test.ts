import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseTip, tipInfo } from "../server/tip.ts";

const read = (n: string) => Bun.file(import.meta.dir + "/fixtures/screens/" + n).text();

test("Tipp über dem Eingabefeld: Kennzeichen, Text über zwei Zeilen, Optionen mit Taste", async () => {
  const t = parseTip(await read("screen-tip.txt"))!;
  expect(t.tag).toBe("Heads up");
  expect(t.text).toBe("Die neue Grenze von 2 Stunden verschiebt Stufe 2 von Tag 4 auf Tag 9, weil die Abwesenheit weniger Ertrag bringt.");
  expect(t.options).toEqual([{ key: "1", label: "Learn more" }, { key: "2", label: "Knew this already" }, { key: "0", label: "Dismiss" }]);
});

test("breites Terminal, Text in einer Zeile", async () => {
  const t = parseTip(await read("screen-tip-wide.txt"))!;
  expect(t.text).toBe("Die neue Grenze von 2 Stunden verschiebt Stufe 2 von Tag 4 auf Tag 9.");
  expect(t.options.map(o => o.key)).toEqual(["1", "2", "0"]);
});

test("kein Tipp: null; Tipp ohne Optionszeile oder weit oben im Verlauf: null", async () => {
  expect(parseTip(await read("screen-idle.txt"))).toBeNull();
  expect(parseTip("✦ Heads up · nur Text\n───────\n❯\n───────")).toBeNull();
  expect(parseTip("✦ Heads up · alt\n  1: Learn more   0: Dismiss\n● viel später\n● noch mehr\n● und mehr\n───────\n❯\n───────")).toBeNull();
});

test("nach Learn more: Erklärung zwischen Leerzeilen, neue Optionen werden erkannt", async () => {
  const t = parseTip(await read("screen-tip-explained.txt"))!;
  expect(t.text).toBe("Die neue Grenze von 2 Stunden verschiebt Stufe 2 von Tag 4 auf Tag 9, weil die Abwesenheit weniger Ertrag bringt.");
  expect(t.options).toEqual([{ key: "1", label: "Understood" }, { key: "2", label: "Chat in main session" }, { key: "0", label: "Dismiss" }]);
});

test("tipInfo nimmt nach Learn more den Text aus view.text", () => {
  const f = join(mkdtempSync(join(tmpdir(), "tip-")), "store.json");
  writeFileSync(f, JSON.stringify({ sessions: [{ id: "s1", tag: "Heads up", view: { kind: "explained", line: "Zeile", text: "Erklärung" } }] }));
  expect(tipInfo(f, "s1")).toEqual({ tag: "Heads up", line: "Zeile", explanation: "Erklärung" });
});

test("tipInfo liest die Erklärung zur Sitzung aus der Plugin-Datei", () => {
  const f = join(mkdtempSync(join(tmpdir(), "tip-")), "store.json");
  writeFileSync(f, JSON.stringify({ sessions: [
    { id: "s1", tag: "Heads up", view: { kind: "offer", line: "Zeile", explanation: "**Fett**\n* Punkt" } },
    { id: "s2", tag: "Heads up" },
  ] }));
  expect(tipInfo(f, "s1")).toEqual({ tag: "Heads up", line: "Zeile", explanation: "**Fett**\n* Punkt" });
  expect(tipInfo(f, "s2")).toBeNull();
  expect(tipInfo(f, "fehlt")).toBeNull();
  expect(tipInfo(join(tmpdir(), "gibt-es-nicht.json"), "s1")).toBeNull();
});
