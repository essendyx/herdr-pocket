// Versionsnummern für CSS und Skripte: Jede Änderung ergibt eine neue URL, so lädt auch die iOS-App die neue Fassung.
import { statSync } from "fs";
import { join } from "path";

export const ASSETS = ["/app.css", "/api.js", "/app.js"];

export function versionAssets(html: string, versions: Record<string, string>): string {
  let out = html;
  for (const [p, v] of Object.entries(versions)) out = out.split(`"${p}"`).join(`"${p}?v=${v}"`);
  return out;
}

// Version aus Änderungszeit und Größe, ohne die Datei zu lesen
export function assetVersions(webDir: string): Record<string, string> {
  const v: Record<string, string> = {};
  for (const p of ASSETS) {
    try { const s = statSync(join(webDir, p)); v[p] = Math.floor(s.mtimeMs).toString(36) + s.size.toString(36); } catch {}
  }
  return v;
}
