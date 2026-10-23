// /estado de punta a punta con la hoja simulada (las semillas) y Google simulado.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/csv@1.0.6";
import type { Ctx, Lugar, Rol } from "../supabase/functions/telegram/contexto.ts";

async function valores(pestana: string): Promise<string[][]> {
  return parse(await Deno.readTextFile(new URL(`../semillas/${pestana}.csv`, import.meta.url)));
}

// Llave de prueba para que la firma del JWT funcione.
const par = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign"],
);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
Deno.env.set(
  "GOOGLE_SA_PRIVATE_KEY",
  `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`,
);
Deno.env.set("GOOGLE_SA_EMAIL", "bot@prueba.iam.gserviceaccount.com");
Deno.env.set("SHEET_ID", "hoja-prueba");

let hoja: Record<string, string[][]> = {};
const lecturas: string[] = [];
globalThis.fetch = (entrada: string | URL | Request) => {
  const url = new URL(String(entrada));
  if (url.hostname === "oauth2.googleapis.com") {
    return Promise.resolve(Response.json({ access_token: "token", expires_in: 3600 }));
  }
  const rangos = url.searchParams.getAll("ranges").map((r) => r.replaceAll("'", ""));
  lecturas.push(...rangos);
  return Promise.resolve(Response.json({ valueRanges: rangos.map((r) => ({ values: hoja[r] ?? [] })) }));
};

const { estado } = await import("../supabase/functions/telegram/agentes/estado.ts");

async function correr(rol: Rol, lugar: Lugar, hoy: string): Promise<string> {
  let salida = "";
  const ctx = {
    rol,
    lugar,
    mensajes: [],
    responder: (t: string) => {
      salida = t;
      return Promise.resolve({} as never);
    },
  } as unknown as Ctx;
  await estado(ctx, hoy);
  return salida;
}

async function cargarSemillas() {
  hoja = {};
  for (const p of ["Config", "Tareas", "Gastos", "Pagos"]) hoja[p] = await valores(p);
}

Deno.test("antes de empezar la obra", async () => {
  await cargarSemillas();
  const t = await correr("carlos", "privado", "2026-10-23");
  assertStringIncludes(t, "ESTADO – vie 23 oct");
  assertStringIncludes(t, "La obra empieza el lun 26 oct (faltan 3 días).");
  assertStringIncludes(t, "Disponible de los 12 M: <b>$12.000.000</b>");
  assertStringIncludes(t, "Dato de la hoja,");
});

Deno.test("día de obra: semana, tareas de hoy y dinero solo en el privado de Carlos", async () => {
  await cargarSemillas();
  const privado = await correr("carlos", "privado", "2026-10-27");
  assertStringIncludes(privado, "Semana 1 de obra (lun 26 oct – sáb 31 oct).");
  assertStringIncludes(privado, "• 02 Demoler parte alta del muro cocina-sala (Albañil)");
  assertStringIncludes(
    privado,
    "• 00 Triple A: contador nuevo dentro de la reja; agua lista antes del 10 nov (Hermano + Triple A)",
  );
  assertStringIncludes(privado, "$12.000.000");

  const grupo = await correr("carlos", "reportes", "2026-10-27");
  assertStringIncludes(grupo, "• 02 Demoler parte alta del muro");
  assert(!grupo.includes("12 M"), "en el grupo no se muestra dinero");

  const hermanoPrivado = await correr("hermano", "privado", "2026-10-27");
  assert(!hermanoPrivado.includes("12 M"), "el hermano no ve dinero");
});

Deno.test("festivo y lectura en vivo: un cambio en la hoja se ve en la siguiente respuesta", async () => {
  await cargarSemillas();
  assertStringIncludes(await correr("carlos", "privado", "2026-11-02"), "Hoy es festivo: no se trabaja.");

  // Carlos marca la 02 como terminada y registra una compra.
  const tareas = hoja.Tareas;
  const col = tareas[0].indexOf("estado");
  tareas.find((f) => f[0] === "02")![col] = "terminada";
  hoja.Gastos = [...hoja.Gastos, [
    "2026-10-27",
    "Ferretería",
    "",
    "",
    "Lonas",
    "Materiales de obra y pintura",
    "45000",
    "caja menor",
    "sí",
  ]];
  const t = await correr("carlos", "privado", "2026-10-27");
  assert(!t.includes("• 02 "), "la 02 terminada ya no sale");
  assertStringIncludes(t, "$11.955.000");

  // Si Carlos activa hermano_ve_dinero, el grupo ya lo muestra.
  hoja.Config = hoja.Config.map((f) => (f[0] === "hermano_ve_dinero" ? [f[0], "sí", f[2]] : f));
  assertStringIncludes(await correr("hermano", "reportes", "2026-10-27"), "$11.955.000");
  assertEquals(lecturas.filter((r) => r === "Config").length >= 5, true);
});
