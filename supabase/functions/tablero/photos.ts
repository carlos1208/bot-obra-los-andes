// Enlaces a las fotos de los pares. Las fotos están en el Drive de Carlos (permiso drive.file): la función las baja
// y las entrega. Cada enlace lleva el id de la foto, un vencimiento y una firma HMAC-SHA256 hecha con el código del
// enlace de quien mira: sirve solo para esa foto, por un par de días, y deja de servir si se cambia el código.

import { clock } from "../_shared/format.ts";
import { safeEqual } from "../_shared/runtime.ts";

const DAY = 86_400;
const enc = new TextEncoder();

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Vence a la medianoche (UTC) de pasado mañana: el mismo enlace sirve todo el día y el navegador lo guarda. */
export function photoExpiry(now: Date = clock.now()): number {
  return (Math.floor(now.getTime() / 1000 / DAY) + 2) * DAY;
}

/** Parámetros de la foto: «foto», «vence», «v» (quién mira: c o h) y «firma». */
export async function signPhoto(fileId: string, who: string, token: string): Promise<URLSearchParams> {
  const expires = String(photoExpiry());
  return new URLSearchParams({
    foto: fileId,
    vence: expires,
    v: who,
    firma: await hmac(token, `${fileId}.${expires}`),
  });
}

/** El id de la foto si la firma es de ese código y no ha vencido; si no, null. */
export async function verifyPhoto(params: URLSearchParams, tokenOf: (who: string) => string | null): Promise<
  string | null
> {
  const id = params.get("foto") ?? "";
  const expires = Number(params.get("vence"));
  const token = tokenOf(params.get("v") ?? "");
  const now = clock.now().getTime() / 1000;
  if (!/^[\w-]{1,200}$/.test(id) || !token || !Number.isInteger(expires)) return null;
  if (expires <= now || expires > now + 3 * DAY) return null;
  return safeEqual(params.get("firma") ?? "", await hmac(token, `${id}.${expires}`)) ? id : null;
}
