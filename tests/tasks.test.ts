import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  nextTasks,
  parseTaskIds,
  readConfig,
  readTasks,
  scheduleProgress,
  tasksForDay,
  tasksForWeek,
} from "../supabase/functions/_shared/site.ts";
import { row, seedRows } from "./_rows.ts";

const tasks = readTasks(await seedRows("Tareas"));
const ids = (list: { id: string }[]) => list.map((t) => t.id);

Deno.test("cronograma v5: 46 tareas con ids de texto y zócalos tentativos", () => {
  assertEquals(tasks.length, 46);
  assertEquals(tasks[0].id, "00");
  assertEquals(tasks.filter((t) => t.tentativo).map((t) => t.id), ["Z1", "Z2", "Z3"]);
  assertEquals(tasks.find((t) => t.id === "17")!.depende_de, ["10", "16"]);
  assertEquals(tasks.filter((t) => t.hito).map((t) => `${t.id}:${t.hito}`), [
    "06:H1",
    "10:H2",
    "27:H3",
    "35:H4",
    "41:H5",
  ]);
});

Deno.test("tareas de hoy: el rango incluye la fecha", () => {
  assertEquals(ids(tasksForDay(tasks, "2026-10-26")), ["00", "01", "02"]);
  assertEquals(ids(tasksForDay(tasks, "2026-10-28")), ["00", "03"]);
});

Deno.test("tareas de la semana: fechas que tocan la semana y no terminadas", () => {
  assertEquals(ids(tasksForWeek(tasks, "2026-10-29")), [
    "00",
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "15",
    "16",
  ]);
  // Semana 2 empieza con festivo; las tareas largas (00, 07, 16) siguen apareciendo.
  assertEquals(ids(tasksForWeek(tasks, "2026-11-02")), ["00", "07", "08", "09", "10", "11", "16"]);
});

Deno.test("las terminadas no aparecen y se respeta lo que diga la hoja", () => {
  const own = readTasks([
    row({ id: "02", tarea: "Muro", inicio: "2026-10-26", fin: "2026-10-28", estado: "Terminada" }),
    row({ id: "03", tarea: "Viga", inicio: 46323, fin: 46325, estado: "en curso" }), // seriales
    row({ id: "", tarea: "fila vacía" }),
  ]);
  assertEquals(ids(tasksForDay(own, "2026-10-28")), ["03"]);
  assertEquals(ids(tasksForWeek(own, "2026-10-26")), ["03"]);
});

const cfg = readConfig(await seedRows("Config"));
const round = (p: { actual: number; expected: number }) => [Math.round(p.actual), Math.round(p.expected)];

Deno.test("avance por días del cronograma: lo terminado contra lo que debería ir a la fecha", () => {
  // 101 días sin las tentativas. Al mié 28 oct debían ir 01 (1 día), 02 (2) y 03 (1), y 3 de los 12 días
  // laborales de la 00 (13 días) → 7 %.
  assertEquals(round(scheduleProgress(tasks, "2026-10-28", cfg)), [0, 7]);
  assertEquals(round(scheduleProgress(tasks, "2026-10-28", cfg, ["02", "03"])), [3, 7]);
  const kitchen = tasks.filter((t) => t.fase === "Cocina");
  assertEquals(round(scheduleProgress(kitchen, "2026-10-28", cfg, ["02", "03"])), [10, 10]);
  // Lo que está terminado en la hoja también cuenta; antes del inicio no se esperaba nada.
  const sheetDone = tasks.map((t) => t.id === "02" ? { ...t, estado: "terminada" } : t);
  assertEquals(round(scheduleProgress(sheetDone, "2026-10-25", cfg)), [2, 0]);
  // Las tentativas (zócalos) no cuentan.
  assertEquals(scheduleProgress(tasks.filter((t) => t.tentativo), "2026-12-30", cfg), { actual: 0, expected: 0 });
});

Deno.test("lo que sigue: tareas sin terminar con sus dependencias terminadas", () => {
  assertEquals(ids(nextTasks(tasks)), ["00", "01", "02"]);
  assertEquals(ids(nextTasks(tasks, ["02", "03"])), ["00", "01", "04"]);
});

Deno.test("números de tareas escritos por el usuario", () => {
  const pending = ["00", "02", "05", "10", "Z1"];
  assertEquals(parseTaskIds("2-5", pending), { ids: ["02", "05"], unknown: [] });
  assertEquals(parseTaskIds("2- 5", pending), { ids: ["02", "05"], unknown: [] });
  assertEquals(parseTaskIds(" 02 - 05 -10 ", pending), { ids: ["02", "05", "10"], unknown: [] });
  assertEquals(parseTaskIds("2, 5 y z1", pending), { ids: ["02", "05", "Z1"], unknown: [] });
  assertEquals(parseTaskIds("0", pending), { ids: ["00"], unknown: [] });
  assertEquals(parseTaskIds("5-5-99", pending), { ids: ["05"], unknown: ["99"] });
});
