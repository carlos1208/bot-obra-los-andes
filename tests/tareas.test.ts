import { assertEquals } from "jsr:@std/assert@1.0.19";
import { leerTareas, tareasDeLaSemana, tareasDelDia } from "../supabase/functions/_shared/obra.ts";
import { fila, filasDeSemilla } from "./_filas.ts";

const tareas = leerTareas(await filasDeSemilla("Tareas"));
const ids = (lista: { id: string }[]) => lista.map((t) => t.id);

Deno.test("cronograma v5: 46 tareas con ids de texto y zócalos tentativos", () => {
  assertEquals(tareas.length, 46);
  assertEquals(tareas[0].id, "00");
  assertEquals(tareas.filter((t) => t.tentativo).map((t) => t.id), ["Z1", "Z2", "Z3"]);
  assertEquals(tareas.find((t) => t.id === "17")!.depende_de, ["10", "16"]);
  assertEquals(tareas.filter((t) => t.hito).map((t) => `${t.id}:${t.hito}`), [
    "06:H1",
    "10:H2",
    "27:H3",
    "35:H4",
    "41:H5",
  ]);
});

Deno.test("tareas de hoy: el rango incluye la fecha", () => {
  assertEquals(ids(tareasDelDia(tareas, "2026-10-26")), ["00", "01", "02"]);
  assertEquals(ids(tareasDelDia(tareas, "2026-10-28")), ["00", "03"]);
});

Deno.test("tareas de la semana: fechas que tocan la semana y no terminadas", () => {
  assertEquals(ids(tareasDeLaSemana(tareas, "2026-10-29")), [
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
  assertEquals(ids(tareasDeLaSemana(tareas, "2026-11-02")), ["00", "07", "08", "09", "10", "11", "16"]);
});

Deno.test("las terminadas no aparecen y se respeta lo que diga la hoja", () => {
  const propias = leerTareas([
    fila({ id: "02", tarea: "Muro", inicio: "2026-10-26", fin: "2026-10-28", estado: "Terminada" }),
    fila({ id: "03", tarea: "Viga", inicio: 46323, fin: 46325, estado: "en curso" }), // seriales
    fila({ id: "", tarea: "fila vacía" }),
  ]);
  assertEquals(ids(tareasDelDia(propias, "2026-10-28")), ["03"]);
  assertEquals(ids(tareasDeLaSemana(propias, "2026-10-26")), ["03"]);
});
