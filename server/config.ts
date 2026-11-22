// Einstellungen aus Umgebungsvariablen. Ohne gültige Anmeldung startet der Server nicht (außer ausdrücklich gewollt).
import { readFileSync } from "fs";
import { join } from "path";
import { parseUpstream } from "./browser.ts";

export type Auth = { kind: "none" } | { kind: "cloudflare"; issuer: string; aud: string; email: string };
export type Config = { origin: string; auth: Auth; imageDir: string; browser: string | null };

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env, home: string, dev = false): Config {
  const stateDir = env.HERDR_APP_STATE || join(home, ".config", "herdr-app");
  const imageDir = env.HERDR_APP_IMAGE_DIR || join(stateDir, "images");
  // Optional: Selkies-Oberfläche des Agent-Browsers, erscheint dann als Tab "Browser" unter /browser/
  let browser: string | null;
  try { browser = parseUpstream(env.HERDR_APP_BROWSER_UPSTREAM); } catch (e: any) { throw new ConfigError(e.message); }
  if (dev) return { origin: "", auth: { kind: "none" }, imageDir, browser };
  const origin = (env.HERDR_APP_ORIGIN || "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/.test(origin)) throw new ConfigError("HERDR_APP_ORIGIN fehlt oder ist ungültig, z. B. https://herdr.example.com");
  if (env.HERDR_APP_AUTH === "none") return { origin, auth: { kind: "none" }, imageDir, browser };
  const team = (env.CF_ACCESS_TEAM_DOMAIN || "").replace(/\/+$/, "");
  if (!team) throw new ConfigError("Anmeldung fehlt: CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD (oder CF_ACCESS_AUD_FILE) und HERDR_APP_EMAIL setzen, oder HERDR_APP_AUTH=none");
  const issuer = /^https:\/\//.test(team) ? team : "https://" + team;
  let aud = (env.CF_ACCESS_AUD || "").trim();
  if (!aud && env.CF_ACCESS_AUD_FILE) aud = readFileSync(env.CF_ACCESS_AUD_FILE, "utf8").trim();
  const email = (env.HERDR_APP_EMAIL || "").trim().toLowerCase();
  if (!aud) throw new ConfigError("CF_ACCESS_AUD oder CF_ACCESS_AUD_FILE fehlt");
  if (!email) throw new ConfigError("HERDR_APP_EMAIL fehlt");
  return { origin, auth: { kind: "cloudflare", issuer, aud, email }, imageDir, browser };
}
