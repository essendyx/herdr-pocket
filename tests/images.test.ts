import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { imagePath } from "../server/images.ts";

const dir = mkdtempSync(join(tmpdir(), "img-"));
writeFileSync(join(dir, "herdr-app-1.png"), "x");
writeFileSync(join(dir, "notiz.txt"), "x");
mkdirSync(join(dir, "sub"));
writeFileSync(join(dir, "sub", "b.jpg"), "x");

test("Bild im Bilderordner wird gefunden", () => {
  expect(imagePath(dir, join(dir, "herdr-app-1.png"))).toBe(join(dir, "herdr-app-1.png"));
});

test("Nur Bilddateien, nur im Bilderordner, nichts außerhalb", () => {
  expect(imagePath(dir, join(dir, "notiz.txt"))).toBeNull();
  expect(imagePath(dir, join(dir, "fehlt.png"))).toBeNull();
  expect(imagePath(dir, join(dir, "..", "x.png"))).toBeNull();
  expect(imagePath(dir, "/etc/passwd")).toBeNull();
  expect(imagePath(dir, "relativ.png")).toBeNull();
  expect(imagePath(dir, join(dir, "sub", "b.jpg"))).toBeNull();
});

test("Symlink aus dem Ordner heraus wird abgelehnt", () => {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  writeFileSync(join(out, "geheim.png"), "x");
  symlinkSync(join(out, "geheim.png"), join(dir, "link.png"));
  expect(imagePath(dir, join(dir, "link.png"))).toBeNull();
});
