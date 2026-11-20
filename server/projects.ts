// Neue Projektordner unter ~/src anlegen. Nur einfache Namen, nie Pfade, nie Überschreiben.
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

export class ProjectError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function createProject(root: string, raw: string): string {
  const name = String(raw ?? "").trim();
  if (!NAME.test(name)) throw new ProjectError(400, "Projektname: nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich, ohne Leerzeichen");
  const dir = join(root, name);
  if (existsSync(dir)) throw new ProjectError(409, "Projekt „" + name + "“ gibt es schon");
  mkdirSync(dir, { mode: 0o755 });
  return name;
}
