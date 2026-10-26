// Cliente mínimo de Google Drive API v3 con la cuenta de Carlos (permiso drive.file:
// el bot solo ve lo que él mismo creó).

import { env } from "./env.ts";
import { driveToken } from "./google_auth.ts";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export const FOLDERS = {
  beforeAfter: "Antes y después",
  invoices: "Facturas",
  voiceNotes: "Notas de voz",
} as const;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  createdTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

const FIELDS = "id,name,mimeType,parents,createdTime,webViewLink,appProperties";

async function driveFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await driveToken()}`, ...init.headers },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Drive ${r.status}: ${data.error?.message ?? r.statusText}`);
  return data as T;
}

/** Escapa un texto para usarlo entre comillas simples en una consulta de Drive. */
export function quote(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function listFiles(q: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const p = new URLSearchParams({
      q: `${q} and trashed = false`,
      fields: `nextPageToken,files(${FIELDS})`,
      pageSize: "1000",
      orderBy: "createdTime",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await driveFetch<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${p}`);
    files.push(...r.files);
    pageToken = r.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

export async function createFolder(
  name: string,
  parent: string,
  appProperties?: Record<string, string>,
): Promise<DriveFile> {
  return await driveFetch<DriveFile>(`${API}/files?fields=${FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], appProperties }),
  });
}

export async function findOrCreateFolder(
  name: string,
  parent: string,
  appProperties?: Record<string, string>,
): Promise<DriveFile> {
  const existing = await listFiles(
    `name = ${quote(name)} and ${quote(parent)} in parents and mimeType = '${FOLDER_MIME}'`,
  );
  return existing[0] ?? await createFolder(name, parent, appProperties);
}

/** Carpeta de primer nivel dentro de «Obra Los Andes». */
export async function topFolder(name: string): Promise<DriveFile> {
  return await findOrCreateFolder(name, env("DRIVE_ROOT_FOLDER_ID"));
}

/** Sube un archivo con carga multiparte (metadatos + contenido). */
export async function uploadFile(options: {
  name: string;
  parent: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
  appProperties?: Record<string, string>;
}): Promise<DriveFile> {
  const boundary = `obra-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: options.name,
    parents: [options.parent],
    appProperties: options.appProperties,
  });
  const enc = new TextEncoder();
  const body = new Blob([
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: ${options.mimeType}\r\n\r\n`),
    options.bytes,
    enc.encode(`\r\n--${boundary}--`),
  ]);
  return await driveFetch<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function updateAppProperties(
  id: string,
  appProperties: Record<string, string>,
): Promise<DriveFile> {
  return await driveFetch<DriveFile>(`${API}/files/${id}?fields=${FIELDS}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appProperties }),
  });
}

/** Recorta un valor para que clave + valor quepan en los 124 bytes que permite Drive. */
export function fitPropertyValue(key: string, value: string): string {
  const enc = new TextEncoder();
  const max = 124 - enc.encode(key).length;
  let v = value;
  while (enc.encode(v).length > max) v = v.slice(0, -1);
  return v;
}

/** appProperties listas para Drive: sin valores vacíos y recortadas a 124 bytes. */
export function appProperties(p: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== "").map(([k, v]) => [k, fitPropertyValue(k, v)]),
  );
}

/** Contenido de un archivo (solo los que creó el bot: permiso drive.file). */
export async function downloadDriveFile(id: string): Promise<Uint8Array<ArrayBuffer>> {
  const r = await fetch(`${API}/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${await driveToken()}` } });
  if (!r.ok) throw new Error(`Drive ${r.status} al descargar ${id}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Contenido y tipo (el que guardó Drive) de un archivo que creó el bot. */
export async function driveMedia(id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const r = await fetch(`${API}/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${await driveToken()}` } });
  if (!r.ok) throw new Error(`Drive ${r.status} al descargar ${id}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("Content-Type") ?? "" };
}

/** Manda un archivo o carpeta a la papelera de Drive (se puede recuperar 30 días). */
export async function trashFile(id: string): Promise<void> {
  await driveFetch(`${API}/files/${id}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}
