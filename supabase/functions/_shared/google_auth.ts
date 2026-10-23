// Tokens de Google:
// - Sheets: cuenta de servicio (JWT RS256 firmado con WebCrypto).
// - Drive: OAuth de Carlos con refresh token (permiso drive.file).
// Los tokens se guardan en memoria del proceso mientras duran (no son datos de la obra).

import { env } from "./env.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";
export const SCOPE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";

interface CachedToken {
  token: string;
  expiresAt: number; // ms epoch
}

const cache = new Map<string, CachedToken>();

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

async function requestToken(body: Record<string, string>): Promise<{ access_token: string; expires_in: number }> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Google token ${r.status}: ${data.error ?? ""} ${data.error_description ?? ""}`);
  return data;
}

/** Token de la cuenta de servicio para el scope dado. */
export async function serviceAccountToken(scope = SCOPE_SHEETS): Promise<string> {
  const key = `sa:${scope}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: env("GOOGLE_SA_EMAIL"),
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env("GOOGLE_SA_PRIVATE_KEY")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${claims}`)),
  );
  const jwt = `${header}.${claims}.${base64url(signature)}`;
  const t = await requestToken({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt });
  cache.set(key, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

/** Token de Drive con la cuenta de Carlos (refresh token de larga duración). */
export async function driveToken(): Promise<string> {
  const cached = cache.get("drive");
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const t = await requestToken({
    grant_type: "refresh_token",
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token: env("GOOGLE_OAUTH_REFRESH_TOKEN"),
  });
  cache.set("drive", { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}
