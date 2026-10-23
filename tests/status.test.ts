// /estado de punta a punta con la hoja simulada (las semillas) y Google simulado.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/csv@1.0.6";
import type { Context, Place, Role } from "../supabase/functions/telegram/context.ts";

async function seedValues(tab: string): Promise<string[][]> {
  return parse(await Deno.readTextFile(new URL(`../semillas/${tab}.csv`, import.meta.url)));
}

// Llave de prueba para que la firma del JWT funcione.
const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign"],
);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
Deno.env.set(
  "GOOGLE_SA_PRIVATE_KEY",
  `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`,
);
Deno.env.set("GOOGLE_SA_EMAIL", "bot@prueba.iam.gserviceaccount.com");
Deno.env.set("SHEET_ID", "hoja-prueba");

let sheet: Record<string, string[][]> = {};
const reads: string[] = [];
globalThis.fetch = (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "oauth2.googleapis.com") {
    return Promise.resolve(Response.json({ access_token: "token", expires_in: 3600 }));
  }
  const ranges = url.searchParams.getAll("ranges").map((r) => r.replaceAll("'", ""));
  reads.push(...ranges);
  return Promise.resolve(Response.json({ valueRanges: ranges.map((r) => ({ values: sheet[r] ?? [] })) }));
};

const { status } = await import("../supabase/functions/telegram/agents/status.ts");

async function run(role: Role, place: Place, today: string): Promise<string> {
  let output = "";
  const ctx = {
    role,
    place,
    messages: [],
    reply: (t: string) => {
      output = t;
      return Promise.resolve({} as never);
    },
  } as unknown as Context;
  await status(ctx, today);
  return output;
}

async function loadSeeds() {
  sheet = {};
  for (const t of ["Config", "Tareas", "Gastos", "Pagos"]) sheet[t] = await seedValues(t);
}

Deno.test("antes de empezar la obra", async () => {
  await loadSeeds();
  const t = await run("carlos", "private", "2026-10-23");
  assertStringIncludes(t, "ESTADO – vie 23 oct");
  assertStringIncludes(t, "La obra empieza el lun 26 oct (faltan 3 días).");
  assertStringIncludes(t, "Disponible de los 12 M: <b>$12.000.000</b>");
  assertStringIncludes(t, "Dato de la hoja,");
});

Deno.test("día de obra: semana, tareas de hoy y dinero solo en el privado de Carlos", async () => {
  await loadSeeds();
  const inPrivate = await run("carlos", "private", "2026-10-27");
  assertStringIncludes(inPrivate, "Semana 1 de obra (lun 26 oct – sáb 31 oct).");
  assertStringIncludes(inPrivate, "• 02 Demoler parte alta del muro cocina-sala (Albañil)");
  assertStringIncludes(
    inPrivate,
    "• 00 Triple A: contador nuevo dentro de la reja; agua lista antes del 10 nov (Hermano + Triple A)",
  );
  assertStringIncludes(inPrivate, "$12.000.000");

  const inGroup = await run("carlos", "reports", "2026-10-27");
  assertStringIncludes(inGroup, "• 02 Demoler parte alta del muro");
  assert(!inGroup.includes("12 M"), "en el grupo no se muestra dinero");

  const brotherPrivate = await run("hermano", "private", "2026-10-27");
  assert(!brotherPrivate.includes("12 M"), "el hermano no ve dinero");
});

Deno.test("festivo y lectura en vivo: un cambio en la hoja se ve en la siguiente respuesta", async () => {
  await loadSeeds();
  assertStringIncludes(await run("carlos", "private", "2026-11-02"), "Hoy es festivo: no se trabaja.");

  // Carlos marca la 02 como terminada y se registra una compra de caja menor.
  const tasks = sheet.Tareas;
  const col = tasks[0].indexOf("estado");
  tasks.find((r) => r[0] === "02")![col] = "terminada";
  sheet.Gastos = [
    ...sheet.Gastos,
    ["2026-10-27", "Ferretería", "", "", "Lonas", "Materiales de obra y pintura", "45000", "caja menor", "sí"],
  ];
  const t = await run("carlos", "private", "2026-10-27");
  assert(!t.includes("• 02 "), "la 02 terminada ya no sale");
  assertStringIncludes(t, "$11.955.000");

  // Si Carlos activa hermano_ve_dinero, el grupo ya lo muestra.
  sheet.Config = sheet.Config.map((r) => (r[0] === "hermano_ve_dinero" ? [r[0], "sí", r[2]] : r));
  assertStringIncludes(await run("hermano", "reports", "2026-10-27"), "$11.955.000");
  assertEquals(reads.filter((r) => r === "Config").length >= 5, true);
});
