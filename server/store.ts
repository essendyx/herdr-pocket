// Kleine JSON-Dateien im Zustandsordner, nur für den Benutzer lesbar.
import { mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const STATE_DIR = process.env.HERDR_APP_STATE || join(homedir(), ".config/herdr-app");

export function ensureDir(dir = STATE_DIR) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

export function readJson<T>(name: string, fallback: T, dir = STATE_DIR): T {
  try { return JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { return fallback; }
}

export function writeJson(name: string, value: unknown, dir = STATE_DIR) {
  ensureDir(dir);
  const f = join(dir, name);
  writeFileSync(f + ".tmp", JSON.stringify(value), { mode: 0o600 });
  renameSync(f + ".tmp", f);
  try { chmodSync(f, 0o600); } catch {}
}

export type Settings = { notify: { blocked: boolean; done: boolean; working: boolean }; quiet: boolean };
export const DEFAULT_SETTINGS: Settings = { notify: { blocked: true, done: true, working: false }, quiet: true };
