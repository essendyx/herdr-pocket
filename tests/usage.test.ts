import { test, expect } from "bun:test";
import { usageView } from "../server/usage.ts";

const raw = { at: 1000, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 5000 }, seven_day: { used_percentage: 41.2, resets_at: 90000 } } };

test("rechnet beide Fenster in gerundete Prozent und Reset-Zeit in Millisekunden um", () => {
  expect(usageView(raw, 2000)).toEqual({ at: 1000000, five: { pct: 24, resetsAt: 5000000 }, week: { pct: 41, resetsAt: 90000000 } });
});

test("abgelaufenes Fenster fällt weg, fehlende Daten ergeben null", () => {
  expect(usageView(raw, 6000)).toEqual({ at: 1000000, five: null, week: { pct: 41, resetsAt: 90000000 } });
  expect(usageView(null, 2000)).toBeNull();
  expect(usageView({ at: 1, rate_limits: {} }, 2000)).toBeNull();
  expect(usageView({ at: 1, rate_limits: { five_hour: { used_percentage: "x" } } } as any, 2000)).toBeNull();
});
