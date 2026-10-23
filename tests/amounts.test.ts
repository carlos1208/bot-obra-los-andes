import { assertEquals } from "jsr:@std/assert@1.0.19";
import { formatPesos, parseAmount } from "../supabase/functions/_shared/format.ts";

Deno.test("lee montos escritos de varias formas", () => {
  const cases: [string, number][] = [
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
  for (const [text, expected] of cases) assertEquals(parseAmount(text), expected, text);
});

Deno.test("encuentra el monto dentro de una frase", () => {
  assertEquals(parseAmount("le pagué 700 mil al albañil por el H1 por Nequi"), 700_000);
  assertEquals(parseAmount("por el H1 le pagué 700 mil"), 700_000);
  assertEquals(parseAmount("repuse 230 mil de caja menor"), 230_000);
  assertEquals(parseAmount("compré una caja de tornillos por quince mil"), 15_000);
  assertEquals(parseAmount("le pagué un millón doscientos al carpintero"), 1_200_000);
  assertEquals(parseAmount("sin plata"), null);
});

Deno.test("pesos con punto de miles y sin decimales", () => {
  assertEquals(formatPesos(1234567), "$1.234.567");
  assertEquals(formatPesos(700000), "$700.000");
  assertEquals(formatPesos(999), "$999");
  assertEquals(formatPesos(-200000), "-$200.000");
  assertEquals(formatPesos(1234.6), "$1.235");
});
