import { assertEquals } from "jsr:@std/assert@1.0.19";
import { leerTareas, tareasDeLaSemana, tareasDelDia } from "../supabase/functions/_shared/obra.ts";
import { fila, filasDeSemilla } from "./_filas.ts";

const tareas = leerTareas(await filasDeSemilla("Tareas"));
const ids = (lista: { id: string }[]) => lista.map((t) => t.id);

Deno.test("las semillas traen las tareas con ids de texto", () => {
  assertEquals(tareas[0].id, "01");
  assertEquals(tareas.filter((t) => t.tentativo).map((t) => t.id), ["Z1", "Z2", "Z3"]);
});

Deno.test("tareas de hoy: el rango incluye la fecha", () => {
  assertEquals(ids(tareasDelDia(tareas, "2026-10-26")), ["01", "02", "08"]);
  assertEquals(ids(tareasDelDia(tareas, "2026-10-28")), ["02", "03", "04", "08"]);
});

Deno.test("tareas de la semana: fechas que tocan la semana y no terminadas", () => {
  const semana1 = ids(tareasDeLaSemana(tareas, "2026-10-29"));
  assertEquals(semana1, ["01", "02", "03", "04", "05", "06", "07", "08"]);
  // Semana 2 empieza con festivo; la tarea larga 08 sigue apareciendo.
  assertEquals(ids(tareasDeLaSemana(tareas, "2026-11-02")), ["08", "09", "10", "11", "12", "13", "14", "15"]);
});

Deno.test("las terminadas no aparecen y se respeta lo que diga la hoja", () => {
  const propias = leerTareas([
    fila({ id: "02", descripcion: "Muro", inicio: "2026-10-26", fin: "2026-10-28", estado: "Terminada" }),
    fila({ id: "03", descripcion: "Viga", inicio: 46323, fin: 46325, estado: "en curso" }), // seriales
    fila({ id: "", descripcion: "fila vacía" }),
  ]);
  assertEquals(ids(tareasDelDia(propias, "2026-10-28")), ["03"]);
  assertEquals(ids(tareasDeLaSemana(propias, "2026-10-26")), ["03"]);
});
