// Fotos ANTES de Carlos con el catálogo F01–F24. Solo Drive: no escribe en la hoja.
// Cada par vive en «Antes y después/<código> <nombre>/» y su estado en appProperties.

import { CATALOGO, type FotoCatalogo, fotoDelCatalogo, nombreCarpetaPar, nombreFoto } from "../../_shared/catalogo.ts";
import { borrarSesion, guardarSesion, leerSesion, type Sesion } from "../../_shared/db.ts";
import {
  buscarOCrearCarpeta,
  carpeta,
  CARPETAS,
  citar,
  listar,
  propiedades,
  subirArchivo,
} from "../../_shared/drive.ts";
import { escaparHtml, hoyISO } from "../../_shared/formato.ts";
import {
  descargar,
  editarTeclado,
  editarTexto,
  imagenDe,
  type ImagenRecibida,
  LIMITE_ARCHIVO,
  responderCallback,
  type Teclado,
} from "../../_shared/telegram.ts";
import type { Ctx } from "../contexto.ts";

export const FLUJO = "antes";
const MAX_FOTOS = 3;
const POR_PAGINA = 8;
const CON_ANTES = "appProperties has { key='tipo' and value='antes' }";

interface DatosAntes {
  pendientes?: ImagenRecibida[];
  codigo?: string;
}

async function codigosConAntes(): Promise<Set<string>> {
  const archivos = await listar(CON_ANTES);
  return new Set(archivos.map((a) => a.appProperties?.codigo ?? "").filter(Boolean));
}

async function faltantes(): Promise<FotoCatalogo[]> {
  const hechos = await codigosConAntes();
  return CATALOGO.filter((f) => !hechos.has(f.codigo));
}

function tecladoCatalogo(faltan: FotoCatalogo[], pagina: number): Teclado {
  const desde = pagina * POR_PAGINA;
  const filas: Teclado = faltan
    .slice(desde, desde + POR_PAGINA)
    .map((f) => [{ text: `${f.codigo} · ${f.nombre}`, callback_data: `ant:c:${f.codigo}` }]);
  const nav = [];
  if (pagina > 0) nav.push({ text: "◀ Anteriores", callback_data: `ant:p:${pagina - 1}` });
  if (desde + POR_PAGINA < faltan.length) nav.push({ text: "Siguientes ▶", callback_data: `ant:p:${pagina + 1}` });
  if (nav.length) filas.push(nav);
  filas.push([{ text: "Cancelar", callback_data: "ant:x" }]);
  return filas;
}

const TECLADO_LISTO: Teclado = [[{ text: "Listo", callback_data: "ant:fin" }]];

function imagenesDe(ctx: Ctx): ImagenRecibida[] {
  return ctx.mensajes.map(imagenDe).filter((i): i is ImagenRecibida => i !== null);
}

/** /antes, o fotos que llegan sin haber elegido el código. */
export async function iniciar(ctx: Ctx, pendientes: ImagenRecibida[] = []): Promise<void> {
  if (ctx.rol !== "carlos") {
    await ctx.responder("Las fotos ANTES las sube Carlos. Si falta una o hay un imprevisto, avísale.");
    return;
  }
  const faltan = await faltantes();
  if (!faltan.length) {
    await borrarSesion(ctx.chatId, ctx.userId);
    await ctx.responder(`Ya están todas las fotos ANTES del catálogo (${CATALOGO.length}).`);
    return;
  }
  await guardarSesion(ctx.chatId, ctx.userId, FLUJO, "elegir", { pendientes });
  const n = pendientes.length;
  const pregunta = n
    ? `Recibí ${n} foto${n > 1 ? "s" : ""}. ¿De cuál foto ANTES ${n > 1 ? "son" : "es"}?`
    : "¿Qué foto ANTES vas a subir?";
  await ctx.responder(`${pregunta}\nFaltan ${faltan.length} de ${CATALOGO.length}.`, tecladoCatalogo(faltan, 0));
}

/** Botones «ant:…». */
export async function alTocar(ctx: Ctx): Promise<void> {
  const cb = ctx.callback!;
  const mensaje = cb.message!;
  const sesion = await leerSesion<DatosAntes>(ctx.chatId, ctx.userId);
  if (!sesion || sesion.flujo !== FLUJO) {
    await responderCallback(cb.id, "Esto ya venció. Escribe /antes.");
    return;
  }
  const [, accion, valor] = (cb.data ?? "").split(":");

  if (accion === "p") {
    await editarTeclado(ctx.chatId, mensaje.message_id, tecladoCatalogo(await faltantes(), Number(valor) || 0));
    await responderCallback(cb.id);
    return;
  }
  if (accion === "x") {
    await borrarSesion(ctx.chatId, ctx.userId);
    await editarTexto(ctx.chatId, mensaje.message_id, "Cancelado. No guardé nada nuevo.");
    await responderCallback(cb.id);
    return;
  }
  if (accion === "fin") {
    await responderCallback(cb.id);
    await editarTeclado(ctx.chatId, mensaje.message_id);
    await terminar(ctx, sesion.datos.codigo);
    return;
  }
  if (accion === "c") {
    const foto = fotoDelCatalogo(valor);
    if (!foto || (await codigosConAntes()).has(foto.codigo)) {
      await responderCallback(cb.id, "Esa ya tiene foto ANTES.");
      return;
    }
    await responderCallback(cb.id);
    await editarTexto(
      ctx.chatId,
      mensaje.message_id,
      `<b>${foto.codigo} · ${escaparHtml(foto.nombre)}</b>\nEncuadre: ${escaparHtml(foto.encuadre)}`,
    );
    const pendientes = sesion.datos.pendientes ?? [];
    await guardarSesion(ctx.chatId, ctx.userId, FLUJO, "fotos", { codigo: foto.codigo });
    if (pendientes.length) {
      await recibirFotos(ctx, foto, pendientes);
    } else {
      await ctx.responder(`Mándame de 1 a ${MAX_FOTOS} fotos.`);
    }
    return;
  }
  await responderCallback(cb.id);
}

/** Mensaje mientras hay una sesión de fotos ANTES abierta. */
export async function continuar(ctx: Ctx, sesion: Sesion<DatosAntes>): Promise<void> {
  const imagenes = imagenesDe(ctx);
  if (sesion.paso === "elegir") {
    if (imagenes.length) {
      const pendientes = [...(sesion.datos.pendientes ?? []), ...imagenes];
      await guardarSesion(ctx.chatId, ctx.userId, FLUJO, "elegir", { pendientes });
      await ctx.responder(
        `Tengo ${pendientes.length} foto${pendientes.length > 1 ? "s" : ""}. Elige arriba de cuál foto ANTES ${
          pendientes.length > 1 ? "son" : "es"
        }.`,
      );
    } else {
      await ctx.responder("Elige arriba qué foto ANTES vas a subir, o toca «Cancelar».");
    }
    return;
  }
  const foto = fotoDelCatalogo(sesion.datos.codigo ?? "");
  if (!foto) {
    await borrarSesion(ctx.chatId, ctx.userId);
    await ctx.responder("Perdí el código de la foto. Escribe /antes para empezar de nuevo.");
    return;
  }
  if (!imagenes.length) {
    await ctx.responder(`Estoy esperando las fotos de ${foto.codigo}. Mándalas o toca «Listo».`, TECLADO_LISTO);
    return;
  }
  await recibirFotos(ctx, foto, imagenes);
}

async function carpetaDelPar(foto: FotoCatalogo) {
  const raiz = await carpeta(CARPETAS.antesDespues);
  return await buscarOCrearCarpeta(
    nombreCarpetaPar(foto.codigo, foto.nombre),
    raiz.id,
    propiedades({ codigo: foto.codigo, nombre: foto.nombre }),
  );
}

async function recibirFotos(ctx: Ctx, foto: FotoCatalogo, imagenes: ImagenRecibida[]): Promise<void> {
  const destino = await carpetaDelPar(foto);
  const yaEstan = (await listar(`${citar(destino.id)} in parents and ${CON_ANTES}`)).length;
  const cupo = Math.max(0, MAX_FOTOS - yaEstan);
  const lote = imagenes.slice(0, cupo);
  const avisos: string[] = [];
  if (imagenes.length > cupo) {
    avisos.push(`Solo guardo ${MAX_FOTOS} por foto ANTES. No guardé ${imagenes.length - cupo}.`);
  }

  const fecha = hoyISO();
  let n = yaEstan;
  for (const img of lote) {
    if (img.tamano && img.tamano > LIMITE_ARCHIVO) {
      avisos.push("Una foto pesa más de 20 MB. Mándala como foto, no como archivo.");
      continue;
    }
    const { bytes } = await descargar(img.fileId);
    n++;
    await subirArchivo({
      nombre: nombreFoto("ANTES", fecha, n, img.extension),
      padre: destino.id,
      mimeType: img.mime,
      bytes,
      appProperties: propiedades({
        codigo: foto.codigo,
        nombre: foto.nombre,
        tipo: "antes",
        tareas: foto.tareas.join(","),
        hitos: foto.hitos.join(","),
        subido_por: ctx.rol,
        estado: "sin después",
      }),
    });
  }

  const nuevas = n - yaEstan;
  if (n >= MAX_FOTOS) {
    if (avisos.length) await ctx.responder(avisos.join("\n"));
    await terminar(ctx, foto.codigo);
    return;
  }
  await guardarSesion(ctx.chatId, ctx.userId, FLUJO, "fotos", { codigo: foto.codigo });
  const resumen = nuevas
    ? `Guardé ${nuevas} foto${
      nuevas > 1 ? "s" : ""
    } de ${foto.codigo}. Van ${n} de ${MAX_FOTOS}. Manda otra o toca «Listo».`
    : `No guardé fotos de ${foto.codigo}. Mándalas de nuevo o toca «Listo».`;
  await ctx.responder([...avisos, resumen].join("\n"), TECLADO_LISTO);
}

async function terminar(ctx: Ctx, codigo?: string): Promise<void> {
  await borrarSesion(ctx.chatId, ctx.userId);
  const foto = fotoDelCatalogo(codigo ?? "");
  if (!foto) {
    await ctx.responder("Listo.");
    return;
  }
  const destino = await carpetaDelPar(foto);
  const total = (await listar(`${citar(destino.id)} in parents and ${CON_ANTES}`)).length;
  if (!total) {
    await ctx.responder(`${foto.codigo} quedó sin fotos ANTES. Escribe /antes cuando las tengas.`);
    return;
  }
  const enlace = destino.webViewLink ? ` <a href="${destino.webViewLink}">Ver en Drive</a>` : "";
  await ctx.responder(
    `Listo: ${foto.codigo} · ${escaparHtml(foto.nombre)} quedó con ${total} foto${
      total > 1 ? "s" : ""
    } ANTES.${enlace}\nPara la siguiente, escribe /antes.`,
  );
}
