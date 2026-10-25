import { assertEquals } from "jsr:@std/assert@1.0.19";
import { readTasks, tasksForDay, tasksForWeek, weeklyObjective } from "../supabase/functions/_shared/site.ts";
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

Deno.test("avance del objetivo semanal: tareas que terminan en la semana (sin las tentativas)", () => {
  // Semana del lun 26 oct: terminan 01, 02, 03, 04, 05, 06 y 15.
  assertEquals(weeklyObjective(tasks, "2026-10-28"), { done: 0, total: 7 });
  assertEquals(weeklyObjective(tasks, "2026-10-28", ["03", "07"]), { done: 1, total: 7 }); // 07 termina después
  const sheetDone = tasks.map((t) => t.id === "02" ? { ...t, estado: "terminada" } : t);
  assertEquals(weeklyObjective(sheetDone, "2026-10-28", ["03"]), { done: 2, total: 7 });
  // Semana de los zócalos: las tentativas no cuentan.
  const zocalos = tasks.filter((t) => t.tentativo);
  assertEquals(weeklyObjective(zocalos, zocalos[0].fin).total, 0);
});
