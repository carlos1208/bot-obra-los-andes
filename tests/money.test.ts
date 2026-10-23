import { assertEquals } from "jsr:@std/assert@1.0.19";
import { available12M, masonBalance, pettyCashBalance, readConfig } from "../supabase/functions/_shared/site.ts";
import { row, seedRows } from "./_rows.ts";

const cfg = readConfig(await seedRows("Config"));
const seedExpenses = await seedRows("Gastos");
const seedPayments = await seedRows("Pagos");

Deno.test("al inicio: 12 M completos, caja menor llena y albañil con 4,3 M por cobrar", () => {
  // Las 4 facturas y los adelantos ya pagados van con cuenta_12M = no.
  assertEquals(available12M(cfg, seedExpenses, seedPayments), 12_000_000);
  assertEquals(pettyCashBalance(cfg, seedExpenses, seedPayments), 100_000);
  assertEquals(masonBalance(cfg, seedPayments), 4_300_000); // 4.500.000 − 2 × 100.000
});

Deno.test("saldo de la caja menor y disponible de los 12 M", () => {
  const expenses = [
    ...seedExpenses,
    row({ valor: 45_000, medio_pago: "caja menor", cuenta_12M: "sí" }),
    row({ valor: 38_500, medio_pago: "Caja menor", cuenta_12M: "si" }),
    row({ valor: 1_200_000, medio_pago: "Carlos", cuenta_12M: "sí" }),
  ];
  const payments = [
    ...seedPayments,
    row({ a_quien: "Albañil", valor: 700_000, cuenta_12M: "sí", hito: "H1" }),
    row({ a_quien: "Caja menor", valor: 83_500, cuenta_12M: "no" }), // reposición del sábado
  ];
  // 100.000 + 83.500 − 45.000 − 38.500
  assertEquals(pettyCashBalance(cfg, expenses, payments), 100_000);
  // 12.000.000 − (45.000 + 38.500 + 1.200.000) − 700.000
  assertEquals(available12M(cfg, expenses, payments), 10_016_500);
  // 4.500.000 − 200.000 − 700.000
  assertEquals(masonBalance(cfg, payments), 3_600_000);
});

Deno.test("montos escritos como texto en la hoja también cuentan", () => {
  const expenses = [row({ valor: "$1.200.000", medio_pago: "Carlos", cuenta_12M: "Sí" })];
  assertEquals(available12M(cfg, expenses, []), 10_800_000);
});
