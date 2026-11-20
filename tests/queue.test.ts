import { test, expect } from "bun:test";
import { PromptQueue } from "../server/queue.ts";
import { tmpdir } from "os";
import { join } from "path";

const file = () => join(tmpdir(), `queue-${Math.random().toString(36).slice(2)}.json`);

test("Queue liefert bei done die erste, beim nächsten done die zweite", () => {
  const q = new PromptQueue(file());
  q.push("p1", "eins"); q.push("p1", "zwei");
  expect(q.onStatus("p1", "working")).toBeNull();
  expect(q.onStatus("p1", "done")!.text).toBe("eins");
  expect(q.onStatus("p1", "idle")!.text).toBe("zwei");
  expect(q.onStatus("p1", "done")).toBeNull();
});

test("Einträge haben stabile IDs, Löschen per ID trifft den richtigen", () => {
  const f = file();
  const q = new PromptQueue(f);
  const a = q.push("p1", "A"); const b = q.push("p1", "B");
  q.onStatus("p1", "done");           // A geht automatisch raus
  expect(q.drop("p1", a.id)).toBe(false); // veraltete Ansicht will A verwerfen: B bleibt
  expect(q.list("p1").map(x => x.text)).toEqual(["B"]);
  expect(q.take("p1", b.id)!.text).toBe("B");
  expect(new PromptQueue(f).list("p1")).toEqual([]);
});

test("restore legt eine nicht zugestellte Nachricht vorne wieder hin", () => {
  const q = new PromptQueue(file());
  q.push("p1", "A"); q.push("p1", "B");
  const e = q.onStatus("p1", "done")!;
  q.restore("p1", e);
  expect(q.list("p1").map(x => x.text)).toEqual(["A", "B"]);
});
