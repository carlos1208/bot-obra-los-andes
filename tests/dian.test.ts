// Lectura del XML de la DIAN (UBL 2.1) de las facturas del correo, sin IA.
import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { parseDianInvoice } from "../supabase/functions/_shared/dian.ts";

const xml = await Deno.readTextFile(new URL("./fixtures/factura_dian.xml", import.meta.url));

Deno.test("lee la factura de dentro del AttachedDocument: datos, vendedor y líneas", () => {
  const inv = parseDianInvoice(xml);
  assertEquals([inv.number, inv.date, inv.taxId, inv.total], ["MC1234", "2026-10-27", "901234567", 360420]);
  assertEquals([inv.legalName, inv.tradeName, inv.storeName], [
    "MATERIALES DEL CARIBE S.A.S.",
    "Materiales del Caribe S.A.S.",
    "MATERIALES DEL CARIBE CENTRO",
  ]);
  // Valor de la línea + su IVA (una vez, aunque el TaxSubtotal lo repite); el descuento ya viene restado.
  // Los centavos se redondean para que las líneas sumen el total a pagar: 160.929,65 sube y 32.490,57 baja.
  assertEquals(inv.lines, [
    { printed: "LAVAMANOS OVAL BLA", quantity: 1, unit: "und", total: 160930 },
    { printed: "PISO CERAM 60X60 BLC", quantity: 2.5, unit: "m2", total: 100000 },
    { printed: "SV FLETE ADICIONAL", quantity: 1, unit: "und", total: 67000 },
    { printed: "KIT SIFON FLEXIBLE", quantity: 1, unit: "und", total: 32490 },
  ]);
  assertEquals(inv.lines.reduce((s, l) => s + l.total, 0), inv.total);
});

Deno.test("también sirve la factura (Invoice) sola, sin AttachedDocument", () => {
  const inner = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)![1];
  assertEquals(parseDianInvoice(inner).number, "MC1234");
});

Deno.test("un XML que no es una factura de la DIAN da error", () => {
  assertThrows(() => parseDianInvoice("<Pedido><ID>1</ID></Pedido>"), Error, "no trae una factura");
});
