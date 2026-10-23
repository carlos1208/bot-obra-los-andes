// /estado: semana de obra, tareas de hoy y disponible de los 12 M (si se puede ver dinero).
// Lee Config, Tareas, Gastos y Pagos en este momento.

import { diasEntre, escaparHtml, fechaCorta, horaBogota, hoyISO, pesos } from "../../_shared/formato.ts";
import {
  disponible12M,
  esDiaDeObra,
  esFestivo,
  leerConfig,
  leerTareas,
  rangoSemana,
  semanaDeObra,
  tareasDelDia,
} from "../../_shared/obra.ts";
import { leerPestanas } from "../../_shared/sheets.ts";
import { type Ctx, puedeVerDinero } from "../contexto.ts";

export async function estado(ctx: Ctx, hoy = hoyISO()): Promise<void> {
  const hoja = await leerPestanas(["Config", "Tareas", "Gastos", "Pagos"]);
  const cfg = leerConfig(hoja.Config);
  const tareas = leerTareas(hoja.Tareas);

  const lineas = [`<b>ESTADO – ${fechaCorta(hoy)}</b>`];
  const semana = semanaDeObra(hoy, cfg);

  if (semana === 0) {
    const faltan = diasEntre(hoy, cfg.fecha_inicio);
    lineas.push(
      `La obra empieza el ${fechaCorta(cfg.fecha_inicio)} (falta${faltan === 1 ? "" : "n"} ${faltan} día${
        faltan === 1 ? "" : "s"
      }).`,
    );
  } else {
    const { lunes, sabado } = rangoSemana(hoy);
    lineas.push(`Semana ${semana} de obra (${fechaCorta(lunes)} – ${fechaCorta(sabado)}).`);
    if (!esDiaDeObra(hoy, cfg)) {
      lineas.push(esFestivo(hoy, cfg) ? "Hoy es festivo: no se trabaja." : "Hoy no se trabaja.");
    } else {
      const deHoy = tareasDelDia(tareas, hoy);
      lineas.push("", "<b>Tareas de hoy</b>");
      if (!deHoy.length) lineas.push("No hay tareas programadas.");
      for (const t of deHoy) {
        const extra = [t.oficio, t.estado === "en curso" ? "en curso" : "", t.tentativo ? "tentativa" : ""]
          .filter(Boolean).join(", ");
        lineas.push(`• ${escaparHtml(t.id)} ${escaparHtml(t.descripcion)} (${escaparHtml(extra)})`);
      }
    }
  }

  if (puedeVerDinero(ctx, cfg)) {
    lineas.push("", `Disponible de los 12 M: <b>${pesos(disponible12M(cfg, hoja.Gastos, hoja.Pagos))}</b>`);
  }
  lineas.push("", `<i>Dato de la hoja, ${horaBogota()}</i>`);
  await ctx.responder(lineas.join("\n"));
}
