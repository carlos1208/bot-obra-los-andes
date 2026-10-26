import { assertEquals } from "jsr:@std/assert@1.0.19";
import { cellDate, parseDateInput, shortDate, todayISO } from "../supabase/functions/_shared/format.ts";
import {
  isWorkDay,
  parseWorkDays,
  readConfig,
  weekRange,
  workDaysBetween,
  workWeek,
} from "../supabase/functions/_shared/site.ts";
import { seedRows } from "./_rows.ts";

const cfg = readConfig(await seedRows("Config"));

Deno.test("fechas cortas en español", () => {
  assertEquals(shortDate("2026-10-26"), "lun 26 oct");
  assertEquals(shortDate("2026-12-23"), "mié 23 dic");
  assertEquals(shortDate("2026-11-21"), "sáb 21 nov");
});

Deno.test("hoy se calcula en hora de Bogotá", () => {
  // 03:00 UTC del 27 oct = 22:00 del 26 oct en Bogotá
  assertEquals(todayISO(new Date("2026-10-27T03:00:00Z")), "2026-10-26");
  assertEquals(todayISO(new Date("2026-10-27T05:00:00Z")), "2026-10-27");
});

Deno.test("celdas de fecha: serial de Sheets, ISO y dd/mm/aaaa", () => {
  assertEquals(cellDate(46321), "2026-10-26");
  assertEquals(cellDate("2026-10-26"), "2026-10-26");
  assertEquals(cellDate("26/10/2026"), "2026-10-26");
  assertEquals(cellDate(""), null);
});

Deno.test("Config de las semillas", () => {
  assertEquals(cfg.fecha_inicio, "2026-10-26");
  assertEquals(cfg.entrega_sin_zocalos, "2026-12-18");
  assertEquals(cfg.entrega_con_zocalos, "2026-12-23");
  assertEquals(cfg.festivos, ["2026-11-02", "2026-11-16", "2026-12-08"]);
  assertEquals(cfg.dias_laborales, [1, 2, 3, 4, 5, 6]);
  assertEquals(cfg.hermano_ve_dinero, false);
  assertEquals(cfg.hora_objetivos_lunes, "07:00");
  assertEquals(cfg.hora_aviso_diario, "17:00");
  assertEquals(cfg.compra_sin_factura_max, 10_000);
  assertEquals(cfg.compras_sin_factura_por_dia, 1);
});

Deno.test("días laborales como rango o lista", () => {
  assertEquals(parseWorkDays("lun-sáb"), [1, 2, 3, 4, 5, 6]);
  assertEquals(parseWorkDays("lun,mar,mié,jue,vie"), [1, 2, 3, 4, 5]);
  assertEquals(parseWorkDays("lun-vie, sáb"), [1, 2, 3, 4, 5, 6]);
});

Deno.test("semana de obra, de lunes a sábado", () => {
  assertEquals(workWeek("2026-10-23", cfg), 0); // antes de empezar
  assertEquals(workWeek("2026-10-26", cfg), 1);
  assertEquals(workWeek("2026-10-31", cfg), 1);
  assertEquals(workWeek("2026-11-01", cfg), 1); // domingo: cuenta con la semana que termina
  assertEquals(workWeek("2026-11-02", cfg), 2);
  assertEquals(workWeek("2026-11-21", cfg), 4); // H3
  assertEquals(workWeek("2026-12-18", cfg), 8);
  assertEquals(workWeek("2026-12-23", cfg), 9);
  assertEquals(weekRange("2026-11-04"), { monday: "2026-11-02", saturday: "2026-11-07" });
  assertEquals(weekRange("2026-11-08"), { monday: "2026-11-02", saturday: "2026-11-07" });
});

Deno.test("días de obra: lunes a sábado sin festivos", () => {
  assertEquals(isWorkDay("2026-10-26", cfg), true);
  assertEquals(isWorkDay("2026-10-31", cfg), true); // sábado
  assertEquals(isWorkDay("2026-11-01", cfg), false); // domingo
  assertEquals(isWorkDay("2026-11-02", cfg), false); // festivo
  assertEquals(isWorkDay("2026-11-16", cfg), false); // festivo
  assertEquals(isWorkDay("2026-12-08", cfg), false); // festivo
  assertEquals(isWorkDay("2026-12-09", cfg), true);
});

Deno.test("fechas escritas al corregir un campo", () => {
  const today = "2026-10-28";
  assertEquals(parseDateInput("hoy", today), "2026-10-28");
  assertEquals(parseDateInput("Ayer", today), "2026-10-27");
  assertEquals(parseDateInput("antier", today), "2026-10-26");
  assertEquals(parseDateInput("24/10", today), "2026-10-24");
  assertEquals(parseDateInput("3-11", today), "2026-11-03");
  assertEquals(parseDateInput("24/10/2026", today), "2026-10-24");
  assertEquals(parseDateInput("24-10-2026", today), "2026-10-24");
  assertEquals(parseDateInput("2026-10-24", today), "2026-10-24");
  assertEquals(parseDateInput("31/02", today), null);
  assertEquals(parseDateInput("el martes", today), null);
});

Deno.test("días laborales entre dos fechas: lunes a sábado, sin festivos", () => {
  assertEquals(workDaysBetween("2026-10-26", "2026-10-31", cfg), 6);
  assertEquals(workDaysBetween("2026-10-26", "2026-11-07", cfg), 11); // dom 1 y lun 2 nov (festivo)
  assertEquals(workDaysBetween("2026-11-01", "2026-11-01", cfg), 0);
});
