import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { CATALOGO, nombreCarpetaPar, nombreFoto } from "../supabase/functions/_shared/catalogo.ts";
import { propiedades } from "../supabase/functions/_shared/drive.ts";
import { prepararCelda } from "../supabase/functions/_shared/sheets.ts";

Deno.test("el catálogo del bot es idéntico al de semillas/", async () => {
  const semilla = await Deno.readTextFile(new URL("../semillas/fotos_antes.json", import.meta.url));
  const delBot = await Deno.readTextFile(
    new URL("../supabase/functions/_shared/fotos_antes.json", import.meta.url),
  );
  assertEquals(delBot, semilla, "Copia semillas/fotos_antes.json a supabase/functions/_shared/");
});

Deno.test("catálogo F01–F24 con códigos únicos y botones que caben", () => {
  assertEquals(CATALOGO.length, 24);
  assertEquals(
    CATALOGO.map((f) => f.codigo),
    Array.from({ length: 24 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
  );
  for (const f of CATALOGO) {
    assert(new TextEncoder().encode(`ant:c:${f.codigo}`).length <= 64);
  }
});

Deno.test("nombres de archivos y carpetas en Drive", () => {
  assertEquals(nombreFoto("ANTES", "2026-10-24", 1), "ANTES 2026-10-24 (1).jpg");
  assertEquals(nombreFoto("DESPUÉS", "2026-10-31", 2, "png"), "DESPUÉS 2026-10-31 (2).png");
  assertEquals(nombreCarpetaPar("F01", "Muro cocina–sala desde la sala"), "F01 Muro cocina–sala desde la sala");
});

Deno.test("appProperties caben en 124 bytes", () => {
  const p = propiedades({ nombre: "á".repeat(200), codigo: "F01" });
  assert(new TextEncoder().encode("nombre" + p.nombre).length <= 124);
  assertEquals(p.codigo, "F01");
});

Deno.test("celdas de texto no se vuelven números al escribir", () => {
  assertEquals(prepararCelda("id", "02"), "'02");
  assertEquals(prepararCelda("tareas", "08,24"), "'08,24");
  assertEquals(prepararCelda("valor", "07:00"), "'07:00");
  assertEquals(prepararCelda("total", 45000), 45000);
  assertEquals(prepararCelda("gastado", "=SUM(A:A)"), "=SUM(A:A)");
  assertEquals(prepararCelda("fecha", "2026-10-26"), "2026-10-26");
});
