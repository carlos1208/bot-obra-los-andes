import { assertEquals } from "jsr:@std/assert@1.0.19";
import { disponible12M, leerConfig, saldoAlbanil, saldoCajaMenor } from "../supabase/functions/_shared/obra.ts";
import { fila, filasDeSemilla } from "./_filas.ts";

const cfg = leerConfig(await filasDeSemilla("Config"));
const pagosSemilla = await filasDeSemilla("Pagos");

Deno.test("al inicio: 12 M completos y caja menor llena", () => {
  assertEquals(disponible12M(cfg, [], pagosSemilla), 12_000_000); // el anticipo va fuera de los 12 M
  assertEquals(saldoCajaMenor(cfg, [], pagosSemilla), 100_000);
  assertEquals(saldoAlbanil(cfg, pagosSemilla), 4_300_000); // 4.500.000 − 200.000 ya entregados
});

Deno.test("saldo de la caja menor y disponible de los 12 M", () => {
  const gastos = [
    fila({ total: 45_000, medio_pago: "caja menor", cuenta_12M: "sí" }),
    fila({ total: 38_500, medio_pago: "Caja menor", cuenta_12M: "si" }),
    fila({ total: 1_200_000, medio_pago: "Carlos", cuenta_12M: "sí" }),
    fila({ total: 300_000, medio_pago: "Carlos", cuenta_12M: "no" }), // pagado antes
  ];
  const pagos = [
    ...pagosSemilla,
    fila({ a_quien: "Albañil", valor: 700_000, cuenta_12M: "sí", hito: "H1" }),
    fila({ a_quien: "Caja menor", valor: 83_500, cuenta_12M: "no" }), // reposición del sábado
  ];
  // 100.000 + 83.500 − 45.000 − 38.500
  assertEquals(saldoCajaMenor(cfg, gastos, pagos), 100_000);
  // 12.000.000 − (45.000 + 38.500 + 1.200.000) − 700.000
  assertEquals(disponible12M(cfg, gastos, pagos), 10_016_500);
  // 4.500.000 − 200.000 − 700.000
  assertEquals(saldoAlbanil(cfg, pagos), 3_600_000);
});

Deno.test("montos escritos como texto en la hoja también cuentan", () => {
  const gastos = [fila({ total: "$1.200.000", medio_pago: "Carlos", cuenta_12M: "Sí" })];
  assertEquals(disponible12M(cfg, gastos, []), 10_800_000);
});
