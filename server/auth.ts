// Prüft das Cloudflare-Access-JWT und schützt schreibende Anfragen gegen CSRF.
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

export function makeVerifier(o: { jwks: JWTVerifyGetKey; aud: string; iss: string; email: string }) {
  return async (req: Request): Promise<{ email: string } | null> => {
    const t = req.headers.get("cf-access-jwt-assertion");
    if (!t) return null;
    try {
      const { payload } = await jwtVerify(t, o.jwks, { audience: o.aud, issuer: o.iss });
      const email = String(payload.email || "").toLowerCase();
      return email === o.email ? { email } : null;
    } catch {
      return null;
    }
  };
}

export function accessVerifier(issuer: string, aud: string, email: string) {
  return makeVerifier({ jwks: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)), aud, iss: issuer, email });
}

// origin leer (nur Entwicklung auf localhost): nur der eigene Header zählt
export function checkCsrf(req: Request, origin: string): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  return (!origin || req.headers.get("origin") === origin) && req.headers.get("x-herdr-app") === "1";
}
