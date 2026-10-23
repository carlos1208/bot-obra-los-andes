// Tokens de Google:
// - Sheets: cuenta de servicio (JWT RS256 firmado con WebCrypto).
// - Drive: OAuth de Carlos con refresh token (permiso drive.file).
// Los tokens se guardan en memoria del proceso mientras duran (no son datos de la obra).

import { env } from "./env.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";
export const SCOPE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";

interface TokenEnCache {
  token: string;
  vence: number; // ms epoch
}

const cache = new Map<string, TokenEnCache>();

function base64url(datos: Uint8Array | string): string {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : datos;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemADer(pem: string): Uint8Array<ArrayBuffer> {
  const limpio = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(limpio), (c) => c.charCodeAt(0));
}

async function pedirToken(cuerpo: Record<string, string>): Promise<{ access_token: string; expires_in: number }> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(cuerpo),
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(`Google token ${r.status}: ${datos.error ?? ""} ${datos.error_description ?? ""}`);
  return datos;
}

/** Token de la cuenta de servicio para los scopes dados. */
export async function tokenCuentaServicio(scope = SCOPE_SHEETS): Promise<string> {
  const clave = `sa:${scope}`;
  const enCache = cache.get(clave);
  if (enCache && enCache.vence > Date.now() + 60_000) return enCache.token;

  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const reclamos = base64url(JSON.stringify({
    iss: env("GOOGLE_SA_EMAIL"),
    scope,
    aud: TOKEN_URL,
    iat: ahora,
    exp: ahora + 3600,
  }));
  const llave = await crypto.subtle.importKey(
    "pkcs8",
    pemADer(env("GOOGLE_SA_PRIVATE_KEY")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, new TextEncoder().encode(`${cabecera}.${reclamos}`)),
  );
  const jwt = `${cabecera}.${reclamos}.${base64url(firma)}`;
  const t = await pedirToken({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt });
  cache.set(clave, { token: t.access_token, vence: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

/** Token de Drive con la cuenta de Carlos (refresh token de larga duración). */
export async function tokenDrive(): Promise<string> {
  const enCache = cache.get("drive");
  if (enCache && enCache.vence > Date.now() + 60_000) return enCache.token;
  const t = await pedirToken({
    grant_type: "refresh_token",
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token: env("GOOGLE_OAUTH_REFRESH_TOKEN"),
  });
  cache.set("drive", { token: t.access_token, vence: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}
