import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { CATALOG, pairFolderName, photoFileName } from "../supabase/functions/_shared/catalog.ts";
import { appProperties } from "../supabase/functions/_shared/drive.ts";
import { toCell } from "../supabase/functions/_shared/sheets.ts";

Deno.test("el catálogo del bot es idéntico al de semillas/", async () => {
  const seed = await Deno.readTextFile(new URL("../semillas/fotos_antes.json", import.meta.url));
  const bot = await Deno.readTextFile(new URL("../supabase/functions/_shared/fotos_antes.json", import.meta.url));
  assertEquals(bot, seed, "Corre deno task catalogo");
});

Deno.test("catálogo F01–F24 con códigos únicos y botones que caben", () => {
  assertEquals(CATALOG.length, 24);
  assertEquals(
    CATALOG.map((f) => f.codigo),
    Array.from({ length: 24 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
  );
  for (const f of CATALOG) assert(new TextEncoder().encode(`ant:c:${f.codigo}`).length <= 64);
});

Deno.test("nombres de archivos y carpetas en Drive", () => {
  assertEquals(photoFileName("ANTES", "2026-10-24", 1), "ANTES 2026-10-24 (1).jpg");
  assertEquals(photoFileName("DESPUÉS", "2026-10-31", 2, "png"), "DESPUÉS 2026-10-31 (2).png");
  assertEquals(pairFolderName("F01", "Muro cocina–sala completo"), "F01 Muro cocina–sala completo");
});

Deno.test("appProperties caben en 124 bytes y omiten los vacíos", () => {
  const p = appProperties({ nombre: "á".repeat(200), codigo: "F01", hitos: "" });
  assert(new TextEncoder().encode("nombre" + p.nombre).length <= 124);
  assertEquals(p.codigo, "F01");
  assertEquals("hitos" in p, false);
});

Deno.test("celdas de texto no se vuelven números al escribir", () => {
  assertEquals(toCell("id", "02"), "'02");
  assertEquals(toCell("depende_de", "10,16"), "'10,16");
  assertEquals(toCell("numero_factura", "5209100261757"), "'5209100261757");
  assertEquals(toCell("valor", "07:00"), "'07:00");
  assertEquals(toCell("valor", 45000), 45000);
  assertEquals(toCell("gastado", "=SUM(A:A)"), "=SUM(A:A)");
  assertEquals(toCell("fecha", "2026-10-26"), "2026-10-26");
});
