import { test, expect } from "bun:test";
import { DialogWatch } from "../server/dialogwatch.ts";

test("meldet eine Änderung, wenn sich bei einem wartenden Agent die Frage ändert (gleicher Status)", () => {
  const w = new DialogWatch();
  expect(w.update("w1:p1", "aaa")).toBe(false);   // erster Blick: nur merken
  expect(w.update("w1:p1", "aaa")).toBe(false);
  expect(w.update("w1:p1", "bbb")).toBe(true);    // zweite Teilfrage
  expect(w.update("w1:p1", null)).toBe(true);     // Frage weg
  expect(w.update("w1:p1", null)).toBe(false);
});

test("forget räumt Agents auf, die nicht mehr warten", () => {
  const w = new DialogWatch();
  w.update("w1:p1", "aaa"); w.update("w1:p2", "ccc");
  w.keepOnly(["w1:p2"]);
  expect(w.update("w1:p1", "aaa")).toBe(false);
  expect(w.update("w1:p2", "ccc")).toBe(false);
});
