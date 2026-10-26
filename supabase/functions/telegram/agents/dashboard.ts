// /tablero, por privado: el enlace personal a la página de la obra (Apps Script del tablero + código de cada uno).
// Carlos ve todo; su hermano, sin dinero, salvo hermano_ve_dinero = sí. El código va en el enlace: no se reenvía.

import { esc } from "../../tablero/render.ts";
import type { Context } from "../context.ts";

export async function link(ctx: Context): Promise<void> {
  if (ctx.place !== "private") {
    await ctx.reply("El enlace del tablero es personal: pídemelo por privado con /tablero.");
    return;
  }
  const url = Deno.env.get("TABLERO_URL");
  const token = Deno.env.get(ctx.role === "carlos" ? "TABLERO_TOKEN_CARLOS" : "TABLERO_TOKEN_HERMANO");
  if (!url || !token) {
    await ctx.reply("El tablero todavía no está configurado.");
    return;
  }
  const href = `${url}?t=${encodeURIComponent(token)}`;
  await ctx.reply(
    [
      `📊 <a href="${esc(href)}">Abrir el tablero de la obra</a>`,
      "",
      "Avance y cronograma, compras y fotos, con la hoja leída en el momento en que lo abres.",
      "Es tu enlace personal: no lo reenvíes.",
    ].join("\n"),
  );
}
