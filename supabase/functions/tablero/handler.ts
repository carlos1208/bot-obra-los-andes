// Edge Function «tablero»: la página de la obra.
// Supabase no sirve HTML en su dominio (lo cambia a texto), así que la página la muestra un Apps Script
// (apps-script/tablero.gs) que le pasa a esta función el código del enlace y muestra lo que devuelve.
// - POST {"t": "<código>"}: el HTML del tablero, como texto. Con el código de Carlos, todo; con el del hermano,
//   sin dinero, salvo hermano_ve_dinero = sí.
// - GET ?foto=…&vence=…&v=…&firma=…: una foto de un par, si la firma es válida (ver photos.ts).

import { driveMedia } from "../_shared/drive.ts";
import { env } from "../_shared/env.ts";
import { reportError } from "../_shared/errors.ts";
import { safeEqual } from "../_shared/runtime.ts";
import { buildDashboard, type Viewer } from "./data.ts";
import { signPhoto, verifyPhoto } from "./photos.ts";
import { renderPage } from "./render.ts";

const VIEWERS: { viewer: Viewer; who: string; secret: string }[] = [
  { viewer: "carlos", who: "c", secret: "TABLERO_TOKEN_CARLOS" },
  { viewer: "hermano", who: "h", secret: "TABLERO_TOKEN_HERMANO" },
];

/** Código guardado de quien mira (c o h); null si no está configurado. */
function tokenOf(who: string): string | null {
  const v = VIEWERS.find((x) => x.who === who);
  return (v && Deno.env.get(v.secret)) || null;
}

function viewerOf(code: string): (typeof VIEWERS)[number] | null {
  if (!code) return null;
  return VIEWERS.find((v) => {
    const token = tokenOf(v.who);
    return token !== null && safeEqual(code, token);
  }) ?? null;
}

const plain = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("foto")) return await photo(url.searchParams);
  if (req.method !== "POST") return plain("ok");
  const body = await req.json().catch(() => ({})) as { t?: unknown };
  const v = viewerOf(typeof body.t === "string" ? body.t : "");
  if (!v) return plain("Este enlace no sirve. Pídele uno nuevo al bot con /tablero.", 401);
  const base = `${env("SUPABASE_URL")}/functions/v1/tablero`;
  try {
    const dashboard = await buildDashboard(
      v.viewer,
      async (id) => `${base}?${await signPhoto(id, v.who, tokenOf(v.who)!)}`,
    );
    return plain(renderPage(dashboard));
  } catch (e) {
    await reportError("tablero", e);
    return plain("No pude armar el tablero. Intenta otra vez en un rato.", 500);
  }
}

async function photo(params: URLSearchParams): Promise<Response> {
  const id = await verifyPhoto(params, tokenOf);
  if (!id) return plain("Enlace de foto vencido o no válido. Vuelve a abrir el tablero.", 403);
  try {
    const { bytes, mime } = await driveMedia(id);
    if (!mime.startsWith("image/")) return plain("No es una foto.", 404);
    return new Response(bytes, { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    console.error("tablero: foto", e);
    return plain("No pude traer la foto de Drive.", 502);
  }
}
