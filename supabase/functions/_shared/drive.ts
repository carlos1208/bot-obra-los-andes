// Cliente mínimo de Google Drive API v3 con la cuenta de Carlos (permiso drive.file:
// el bot solo ve lo que él mismo creó).

import { env } from "./env.ts";
import { tokenDrive } from "./google_auth.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const MIME_CARPETA = "application/vnd.google-apps.folder";

export const CARPETAS = {
  antesDespues: "Antes y después",
  facturas: "Facturas",
  notasVoz: "Notas de voz",
} as const;

export interface ArchivoDrive {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  createdTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

const CAMPOS = "id,name,mimeType,parents,createdTime,webViewLink,appProperties";

async function driveFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await tokenDrive()}`, ...init.headers },
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(`Drive ${r.status}: ${datos.error?.message ?? r.statusText}`);
  return datos as T;
}

/** Escapa un texto para usarlo entre comillas simples en una consulta de Drive. */
export function citar(texto: string): string {
  return `'${texto.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function listar(q: string): Promise<ArchivoDrive[]> {
  const salida: ArchivoDrive[] = [];
  let pageToken = "";
  do {
    const p = new URLSearchParams({
      q: `${q} and trashed = false`,
      fields: `nextPageToken,files(${CAMPOS})`,
      pageSize: "1000",
      orderBy: "createdTime",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await driveFetch<{ files: ArchivoDrive[]; nextPageToken?: string }>(`${API}/files?${p}`);
    salida.push(...r.files);
    pageToken = r.nextPageToken ?? "";
  } while (pageToken);
  return salida;
}

export async function crearCarpeta(
  nombre: string,
  padre: string,
  appProperties?: Record<string, string>,
): Promise<ArchivoDrive> {
  return await driveFetch<ArchivoDrive>(`${API}/files?fields=${CAMPOS}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nombre, mimeType: MIME_CARPETA, parents: [padre], appProperties }),
  });
}

export async function buscarOCrearCarpeta(
  nombre: string,
  padre: string,
  appProperties?: Record<string, string>,
): Promise<ArchivoDrive> {
  const existentes = await listar(
    `name = ${citar(nombre)} and ${citar(padre)} in parents and mimeType = '${MIME_CARPETA}'`,
  );
  return existentes[0] ?? await crearCarpeta(nombre, padre, appProperties);
}

/** Carpeta de primer nivel dentro de «Obra Los Andes». */
export async function carpeta(nombre: string): Promise<ArchivoDrive> {
  return await buscarOCrearCarpeta(nombre, env("DRIVE_ROOT_FOLDER_ID"));
}

/** Sube un archivo con carga multiparte (metadatos + contenido). */
export async function subirArchivo(opciones: {
  nombre: string;
  padre: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
  appProperties?: Record<string, string>;
}): Promise<ArchivoDrive> {
  const limite = `obra-${crypto.randomUUID()}`;
  const meta = JSON.stringify({
    name: opciones.nombre,
    parents: [opciones.padre],
    appProperties: opciones.appProperties,
  });
  const enc = new TextEncoder();
  const cuerpo = new Blob([
    enc.encode(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    enc.encode(`--${limite}\r\nContent-Type: ${opciones.mimeType}\r\n\r\n`),
    opciones.bytes,
    enc.encode(`\r\n--${limite}--`),
  ]);
  return await driveFetch<ArchivoDrive>(`${UPLOAD}/files?uploadType=multipart&fields=${CAMPOS}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${limite}` },
    body: cuerpo,
  });
}

export async function actualizarPropiedades(
  id: string,
  appProperties: Record<string, string>,
): Promise<ArchivoDrive> {
  return await driveFetch<ArchivoDrive>(`${API}/files/${id}?fields=${CAMPOS}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appProperties }),
  });
}

/** Recorta un valor para que clave + valor quepan en los 124 bytes que permite Drive. */
export function valorPropiedad(clave: string, valor: string): string {
  const enc = new TextEncoder();
  const max = 124 - enc.encode(clave).length;
  let v = valor;
  while (enc.encode(v).length > max) v = v.slice(0, -1);
  return v;
}

export function propiedades(p: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "").map(([k, v]) => [k, valorPropiedad(k, v)]));
}
