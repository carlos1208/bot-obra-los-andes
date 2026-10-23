import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parsearMonto, pesos } from "../supabase/functions/_shared/formato.ts";

Deno.test("lee montos escritos de varias formas", () => {
  const casos: [string, number][] = [
    ["700 mil", 700_000],
    ["700mil", 700_000],
    ["700k", 700_000],
    ["1,2 M", 1_200_000],
    ["1.5 millones", 1_500_000],
    ["2 millones y medio", 2_500_000],
    ["$1.200.000", 1_200_000],
    ["1'200.000", 1_200_000],
    ["350.000", 350_000],
    ["350000", 350_000],
    ["un millón doscientos", 1_200_000],
    ["un millón doscientos mil", 1_200_000],
    ["un millón doscientos cincuenta", 1_250_000],
    ["dos millones y medio", 2_500_000],
    ["ciento cincuenta mil", 150_000],
    ["mil quinientos", 1_500],
    ["quince mil", 15_000],
  ];
  for (const [texto, esperado] of casos) assertEquals(parsearMonto(texto), esperado, texto);
});

Deno.test("encuentra el monto dentro de una frase", () => {
  assertEquals(parsearMonto("le pagué 700 mil al albañil por el H1 por Nequi"), 700_000);
  assertEquals(parsearMonto("por el H1 le pagué 700 mil"), 700_000);
  assertEquals(parsearMonto("repuse 230 mil de caja menor"), 230_000);
  assertEquals(parsearMonto("compré una caja de tornillos por quince mil"), 15_000);
  assertEquals(parsearMonto("le pagué un millón doscientos al carpintero"), 1_200_000);
  assertEquals(parsearMonto("sin plata"), null);
});

Deno.test("pesos con punto de miles y sin decimales", () => {
  assertEquals(pesos(1234567), "$1.234.567");
  assertEquals(pesos(700000), "$700.000");
  assertEquals(pesos(999), "$999");
  assertEquals(pesos(-200000), "-$200.000");
  assertEquals(pesos(1234.6), "$1.235");
});
