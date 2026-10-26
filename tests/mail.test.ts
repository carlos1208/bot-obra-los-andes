// /correo: facturas del Gmail de Carlos solo cuando él lo pide; valores del XML de la DIAN y una llamada corta de
// texto a Gemini para los nombres; vista previa, «Sí, guardar», Productos con los dos nombres y la etiqueta.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  BROTHER,
  buttons,
  CARLOS,
  clearSent,
  clock,
  drive,
  gemini,
  lastText,
  mailbox,
  message,
  processUpdate,
  resetSheet,
  rowsOf,
  tap,
} from "./_world.ts";
import { storeOf } from "../supabase/functions/telegram/agents/mail_invoices.ts";

clock.now = () => new Date("2026-10-28T15:00:00Z"); // mié 28 oct, 10:00 en Bogotá

const xml = await Deno.readTextFile(new URL("./fixtures/factura_dian.xml", import.meta.url));
const NEW = {
  id: "18f0nueva",
  fecha: "2026-10-27T19:30:00.000Z",
  nit: "901234567",
  empresa: "MATERIALES DEL CARIBE S.A.S.",
  numero: "MC1234",
  remitente: "Facturación <facturas@materialesdelcaribe.co>",
  total: 360420,
  fechaFactura: "2026-10-27",
  tienda: "MATERIALES DEL CARIBE CENTRO",
  xml,
  pdf: btoa("%PDF-1.4 prueba"),
};
// Una de las 4 facturas de la semilla: ya está en Gastos.
const OLD = {
  ...NEW,
  id: "18f0vieja",
  fecha: "2026-09-30T18:26:02.000Z",
  numero: "EL021045523",
  empresa: "Cencosud Colombia S.A.",
};
const naming = {
  supplier: "Materiales del Caribe",
  names: ["Lavamanos ovalado blanco", "Piso cerámico 60 x 60 blanco", "Flete adicional", "Kit de sifón flexible"],
  chapter: "Materiales de obra y pintura",
};

Deno.test("/correo: lista solo lo nuevo, lee el XML, vista previa y guarda con los dos nombres", async () => {
  await resetSheet();
  clearSent();
  mailbox.invoices.push(OLD, NEW);
  const calls = gemini.calls.length;
  await processUpdate(message(CARLOS, { text: "/correo" }));
  // La búsqueda no usa Gemini; la que ya estaba en Gastos queda etiquetada.
  assertEquals(gemini.calls.length, calls);
  assertEquals(mailbox.marked, ["18f0vieja"]);
  const list = lastText();
  // Fecha, establecimiento y total (del XML, sin IA) dicen más que el número de la factura.
  assertStringIncludes(
    list,
    "<b>Facturas nuevas en tu correo</b> (últimos 30 días)\n• mar 27 oct · Materiales del Caribe Centro · $360.420",
  );
  assertStringIncludes(list, "1 ya estaba en Gastos: la marqué para que no vuelva a salir.");
  assertEquals(buttons(), ["$360.420 · 27 oct · Materiales del Cari…|cor:f:18f0nueva"]);

  gemini.replies.push(naming);
  await processUpdate(tap(CARLOS, "cor:f:18f0nueva"));
  // Una sola llamada a Gemini, de texto (sin el PDF), con las descripciones tal como vienen.
  const call = gemini.calls.at(-1)!.body;
  assertEquals(gemini.calls.length, calls + 1);
  assert(call.contents[0].parts.every((p: Record<string, unknown>) => !p.inline_data));
  assertStringIncludes(call.contents[0].parts[0].text, "Tienda: MATERIALES DEL CARIBE CENTRO");
  assertStringIncludes(call.contents[0].parts[1].text, "2. PISO CERAM 60X60 BLC");

  const preview = lastText();
  assertStringIncludes(preview, "Proveedor: Materiales del Caribe\nNIT: 901234567\nFecha: mar 27 oct\nNúmero: MC1234");
  assertStringIncludes(preview, "• Lavamanos ovalado blanco: $160.930 · <i>LAVAMANOS OVAL BLA</i>");
  assertStringIncludes(preview, "• 2,5 m2 Piso cerámico 60 x 60 blanco: $100.000 · <i>PISO CERAM 60X60 BLC</i>");
  assertStringIncludes(preview, "Total: $360.420\nCapítulo: Materiales de obra y pintura");
  assert(!preview.includes("⚠️")); // los productos suman el total

  await processUpdate(tap(CARLOS, "gas:p:carlos"));
  await processUpdate(tap(CARLOS, "gas:ok"));
  const expense = rowsOf("Gastos").at(-1)!;
  assertEquals([expense.numero_factura, expense.nit, expense.valor, expense.medio_pago], [
    "MC1234",
    "901234567",
    360420,
    "Carlos",
  ]);
  const file = drive.find((f) => f.name === "2026-10-27 Materiales del Caribe MC1234 - 360.420.pdf")!;
  assertEquals(file.mimeType, "application/pdf");
  assertEquals(expense.enlace_factura, `https://drive/${drive.indexOf(file) + 1}`);
  const products = rowsOf("Productos").slice(-4);
  assertEquals(products.map((r) => [r.producto, r.descripcion_factura, r.valor_total]), [
    ["Lavamanos ovalado blanco", "LAVAMANOS OVAL BLA", 160930],
    ["Piso cerámico 60 x 60 blanco", "PISO CERAM 60X60 BLC", 100000],
    ["Flete adicional", "SV FLETE ADICIONAL", 67000],
    ["Kit de sifón flexible", "KIT SIFON FLEXIBLE", 32490],
  ]);
  // Queda etiquetada: /correo ya no la muestra.
  assertEquals(mailbox.marked, ["18f0vieja", "18f0nueva"]);
  await processUpdate(message(CARLOS, { text: "/correo" }));
  assertEquals(lastText(), "No hay facturas nuevas en tu correo de los últimos 30 días.");
});

Deno.test("/correo es solo de Carlos y por privado", async () => {
  clearSent();
  await processUpdate(message(BROTHER, { text: "/correo" }));
  assertEquals(lastText(), "Las facturas del correo las registra Carlos.");
});

Deno.test("establecimiento: la tienda del XML, el buzón de la misma empresa o la razón social", () => {
  const base = { ...NEW, tienda: null };
  assertEquals(storeOf({ ...base, tienda: "EASY ALTOS DEL PRADO" }), "Easy Altos del Prado");
  assertEquals(storeOf({ ...base, remitente: "efacturahomecenter@homecenter.co" }), "Homecenter");
  // Si lo manda un proveedor de facturación, su dominio no es la tienda: queda la razón social.
  assertEquals(storeOf({ ...base, remitente: "Factura <noreply@proveedorfe.com>" }), "Materiales del Caribe S.A.S.");
});
