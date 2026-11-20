import { test, expect } from "bun:test";
import { mkdtempSync, statSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProject, ProjectError } from "../server/projects.ts";

const root = () => mkdtempSync(join(tmpdir(), "herdr-proj-"));

test("legt den Projektordner unter dem Wurzelordner an und gibt den Namen zurück", () => {
  const r = root();
  expect(createProject(r, "  mein-projekt_2.0 ")).toBe("mein-projekt_2.0");
  expect(statSync(join(r, "mein-projekt_2.0")).isDirectory()).toBe(true);
});

test("lehnt ungültige Namen ab: leer, Pfade, versteckt, Sonderzeichen", () => {
  const r = root();
  for (const n of ["", "   ", "../x", "a/b", ".geheim", "a b", "x;rm", "ä".repeat(70)]) {
    const e: any = (() => { try { createProject(r, n); } catch (e) { return e; } })();
    expect(e).toBeInstanceOf(ProjectError);
    expect(e.status).toBe(400);
  }
});

test("vorhandenes Projekt: 409, nichts überschrieben", () => {
  const r = root(); mkdirSync(join(r, "da"));
  const e: any = (() => { try { createProject(r, "da"); } catch (e) { return e; } })();
  expect(e.status).toBe(409);
});
