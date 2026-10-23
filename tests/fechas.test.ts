import { assertEquals } from "jsr:@std/assert@1.0.19";
import { fechaCorta, fechaDeCelda, hoyISO } from "../supabase/functions/_shared/formato.ts";
import { esDiaDeObra, leerConfig, rangoSemana, semanaDeObra } from "../supabase/functions/_shared/obra.ts";
import { filasDeSemilla } from "./_filas.ts";

const cfg = leerConfig(await filasDeSemilla("Config"));

Deno.test("fechas cortas en español", () => {
  assertEquals(fechaCorta("2026-10-26"), "lun 26 oct");
  assertEquals(fechaCorta("2026-12-23"), "mié 23 dic");
  assertEquals(fechaCorta("2026-11-21"), "sáb 21 nov");
});

Deno.test("hoy se calcula en hora de Bogotá", () => {
  // 03:00 UTC del 27 oct = 22:00 del 26 oct en Bogotá
  assertEquals(hoyISO(new Date("2026-10-27T03:00:00Z")), "2026-10-26");
  assertEquals(hoyISO(new Date("2026-10-27T05:00:00Z")), "2026-10-27");
});

Deno.test("celdas de fecha: serial de Sheets, ISO y dd/mm/aaaa", () => {
  assertEquals(fechaDeCelda(46321), "2026-10-26");
  assertEquals(fechaDeCelda("2026-10-26"), "2026-10-26");
  assertEquals(fechaDeCelda("26/10/2026"), "2026-10-26");
  assertEquals(fechaDeCelda(""), null);
});

Deno.test("Config de las semillas", () => {
  assertEquals(cfg.fecha_inicio, "2026-10-26");
  assertEquals(cfg.festivos, ["2026-11-02", "2026-11-16", "2026-12-08"]);
  assertEquals(cfg.dias_laborales, [1, 2, 3, 4, 5, 6]);
  assertEquals(cfg.hermano_ve_dinero, false);
  assertEquals(cfg.hora_aviso_diario, "17:00");
});

Deno.test("semana de obra, de lunes a sábado", () => {
  assertEquals(semanaDeObra("2026-10-23", cfg), 0); // antes de empezar
  assertEquals(semanaDeObra("2026-10-26", cfg), 1);
  assertEquals(semanaDeObra("2026-10-31", cfg), 1);
  assertEquals(semanaDeObra("2026-11-01", cfg), 1); // domingo: cuenta con la semana que termina
  assertEquals(semanaDeObra("2026-11-02", cfg), 2);
  assertEquals(semanaDeObra("2026-11-21", cfg), 4); // H3
  assertEquals(semanaDeObra("2026-12-18", cfg), 8);
  assertEquals(semanaDeObra("2026-12-23", cfg), 9);
  assertEquals(rangoSemana("2026-11-04"), { lunes: "2026-11-02", sabado: "2026-11-07" });
  assertEquals(rangoSemana("2026-11-08"), { lunes: "2026-11-02", sabado: "2026-11-07" });
});

Deno.test("días de obra: lunes a sábado sin festivos", () => {
  assertEquals(esDiaDeObra("2026-10-26", cfg), true);
  assertEquals(esDiaDeObra("2026-10-31", cfg), true); // sábado
  assertEquals(esDiaDeObra("2026-11-01", cfg), false); // domingo
  assertEquals(esDiaDeObra("2026-11-02", cfg), false); // festivo
  assertEquals(esDiaDeObra("2026-11-16", cfg), false); // festivo
  assertEquals(esDiaDeObra("2026-12-08", cfg), false); // festivo
  assertEquals(esDiaDeObra("2026-12-09", cfg), true);
});
