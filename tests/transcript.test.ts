import { test, expect } from "bun:test";
import { parseTranscript, transcriptPath, readSession } from "../server/transcript.ts";

const text = await Bun.file(import.meta.dir + "/fixtures/transcript.jsonl").text();

test("Feed hat die erwartete Reihenfolge, Meta-Nachrichten fehlen", () => {
  const s = parseTranscript(text);
  expect(s.feed.map(x => x.t)).toEqual(["user", "text", "tool", "tool", "diff", "tool", "tool"]);
  expect((s.feed[0] as any).v).toBe("Setz bitte Prio 1 um.");
});

test("Werkzeugstatus: ok, err und run ohne Ergebnis", () => {
  const tools = parseTranscript(text).feed.filter(x => x.t === "tool") as any[];
  expect(tools.find(t => t.k === "Read").s).toBe("ok");
  expect(tools.find(t => t.k === "Read").a).toBe("/home/alex/src/idlegame/docs/bericht.md");
  expect(tools.find(t => t.k === "Bash").s).toBe("err");
  expect(tools.find(t => t.k === "Bash").a).toBe("npm test -- offline");
  expect(tools.find(t => t.k === "Agent").s).toBe("run");
});

test("Edit mit structuredPatch wird diff mit Zählern", () => {
  const d = parseTranscript(text).feed.find(x => x.t === "diff") as any;
  expect(d.f).toBe("/home/alex/src/idlegame/src/offline.ts");
  expect(d.add).toBe(2);
  expect(d.del).toBe(1);
  expect(d.lines).toContain("+  return 1;");
});

test("Plan, Subagents, Kontext, Modell, Effort, Modus", () => {
  const s = parseTranscript(text);
  expect(s.plan).toEqual([["Offline-Fortschritt", "done"], ["Tutorial", "run"], ["Sounds", "todo"]]);
  expect(s.subs).toBe(1);
  expect(s.ctx).toBe(60);
  expect(s.model).toBe("claude-opus-5-5");
  expect(s.effort).toBe("high");
  expect(s.mode).toBe("auto");
  expect(s.changes.length).toBe(1);
});

test("leerer Verlauf", () => {
  const s = parseTranscript("");
  expect(s.feed).toEqual([]);
  expect(s.ctx).toBe(0);
});

test("transcriptPath ersetzt Sonderzeichen durch Minus", () => {
  expect(transcriptPath("/home/alex/src/herdr_mobileview", "abc").endsWith("/.claude/projects/-home-alex-src-herdr-mobileview/abc.jsonl")).toBe(true);
});

test("readSession liefert null, wenn die Datei fehlt", async () => {
  expect(await readSession("/gibt/es/nicht", "x")).toBeNull();
});

test("gültiges JSON mit fremder Form wirft nicht", () => {
  const weird = [
    JSON.stringify({ type: "assistant", message: { content: 5, usage: null } }),
    JSON.stringify({ type: "assistant", message: { content: [null, { type: "tool_use", id: "x", name: "TodoWrite", input: { todos: [null, { content: "a", status: "pending" }] } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: null }] } }),
    JSON.stringify({ type: "user", message: { content: [null, { type: "tool_result", tool_use_id: "e1" }] }, toolUseResult: { structuredPatch: [null, { lines: null }] } }),
    JSON.stringify({ type: "user", message: null }),
    JSON.stringify(null),
    JSON.stringify(42),
  ].join("\n");
  expect(() => parseTranscript(weird)).not.toThrow();
});

test("readTail liest nur das Ende ab einer Zeilengrenze", async () => {
  const { readTail } = await import("../server/transcript.ts");
  const f = require("os").tmpdir() + "/tail-" + Math.random().toString(36).slice(2) + ".jsonl";
  await Bun.write(f, Array.from({ length: 1000 }, (_, i) => JSON.stringify({ n: i })).join("\n") + "\n");
  const t = await readTail(f, 200);
  expect(t.length).toBeLessThanOrEqual(200);
  const first = t.split("\n")[0];
  expect(() => JSON.parse(first)).not.toThrow();
  expect(t.trim().endsWith('{"n":999}')).toBe(true);
});

test("Komprimierung: Zusammenfassung wird eigener Eintrag 'compact', nicht deine Nachricht", () => {
  const lines = [
    { type: "user", message: { role: "user", content: "Erste Frage" } },
    { type: "system", subtype: "compact_boundary", content: "Conversation compacted", compactMetadata: { trigger: "auto" } },
    { type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n<system-reminder>\nintern\n</system-reminder>\nSummary:\n1. Ziel: App bauen\n\nIf you need specific details from before compaction (like exact code snippets), read the full transcript at: /x.jsonl\nContinue the conversation from where it left off." } },
    { type: "user", message: { role: "user", content: "Weiter" } },
  ].map(x => JSON.stringify(x)).join("\n");
  const f = parseTranscript(lines).feed;
  expect(f.map(x => x.t)).toEqual(["user", "compact", "user"]);
  expect(f[1]).toEqual({ t: "compact", trigger: "auto", v: "Summary:\n1. Ziel: App bauen" } as any);
});

test("Eingebettetes Bild: [Image #N] wird durch den Pfad aus der Meta-Zeile ersetzt", () => {
  const lines = [
    { type: "user", imagePasteIds: [1, 2], message: { role: "user", content: [{ type: "text", text: "[Image #1] und [Image #2] schau mal" }, { type: "image", source: { type: "base64", data: "x" } }, { type: "image", source: { type: "base64", data: "y" } }] } },
    { type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text: "[Image: source: /home/alex/bilder/a.jpg]" }, { type: "text", text: "[Image: source: /home/alex/bilder/b.png]" }] } },
    { type: "user", message: { role: "user", content: "[Image #1] ohne Meta" } },
  ].map(x => JSON.stringify(x)).join("\n");
  const f = parseTranscript(lines).feed;
  expect(f).toEqual([
    { t: "user", v: "/home/alex/bilder/a.jpg und /home/alex/bilder/b.png schau mal" },
    { t: "user", v: "[Image #1] ohne Meta" },
  ] as any);
});

test("Letzte Aktivität: Zeit der letzten echten Nachricht, nicht der Zeilen beim Fortsetzen nach Neustart", () => {
  const lines = [
    { type: "user", timestamp: "2026-11-20T18:00:00.000Z", message: { role: "user", content: "Hallo" } },
    { type: "assistant", timestamp: "2026-11-20T18:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
    { type: "system", subtype: "turn_duration", timestamp: "2026-11-20T18:01:01.000Z" },
    { type: "system", subtype: "informational", timestamp: "2026-11-21T03:00:52.000Z" },
    { type: "user", isMeta: true, timestamp: "2026-11-21T03:00:53.000Z", message: { role: "user", content: "intern" } },
    { type: "derived-from" },
    { type: "user", timestamp: "2026-11-21T03:01:11.000Z", message: { role: "user", content: "<task-notification>\n<status>stopped</status>\n</task-notification>" } },
  ].map(x => JSON.stringify(x)).join("\n");
  expect(parseTranscript(lines).last).toBe(Date.parse("2026-11-20T18:01:00.000Z"));
  expect(parseTranscript("").last).toBe(0);
});
