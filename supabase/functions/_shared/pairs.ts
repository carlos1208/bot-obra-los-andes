// Pares ANTES / DESPUÉS en Drive: «Antes y después/<código> <nombre>/» con «ANTES AAAA-MM-DD (n).jpg» y
// «DESPUÉS AAAA-MM-DD (n).jpg». Todo el estado vive en las appProperties de los archivos (no en la hoja).

import { CATALOG } from "./catalog.ts";
import { appProperties, downloadDriveFile, type DriveFile, listFiles, updateAppProperties } from "./drive.ts";

/** Estados de un par (appProperty «estado» del ANTES y del DESPUÉS). */
export const STATE = {
  pendingApproval: "por aprobar", // ANTES por imprevisto del hermano, esperando a Carlos
  noAfter: "sin después",
  toValidate: "por validar",
  validated: "validado",
  checkOnSite: "revisar en sitio",
  discarded: "descartada", // DESPUÉS que Carlos pidió repetir
} as const;

export const IS_BEFORE = "appProperties has { key='tipo' and value='antes' }";
export const IS_AFTER = "appProperties has { key='tipo' and value='después' }";

export interface Pair {
  folderId: string;
  code: string;
  name: string;
  tasks: string[];
  hitos: string[];
  state: string;
  uploadedBy: string;
  reason: string;
  /** ANTES en orden (n). */
  before: DriveFile[];
  /** DESPUÉS vigentes en orden (n), sin los descartados. */
  after: DriveFile[];
}

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const order = (f: DriveFile) => Number(f.name.match(/\((\d+)\)/)?.[1] ?? 0);

/** Todos los pares, leídos de Drive en este momento (dos consultas). */
export async function listPairs(): Promise<Pair[]> {
  const [before, after] = await Promise.all([listFiles(IS_BEFORE), listFiles(IS_AFTER)]);
  const byFolder = new Map<string, Pair>();
  for (const f of before.sort((a, b) => order(a) - order(b))) {
    const folderId = f.parents?.[0] ?? "";
    const p = f.appProperties ?? {};
    const pair = byFolder.get(folderId) ?? {
      folderId,
      code: p.codigo ?? "",
      name: p.nombre ?? "",
      tasks: list(p.tareas),
      hitos: list(p.hitos),
      state: p.estado ?? STATE.noAfter,
      uploadedBy: p.subido_por ?? "",
      reason: p.motivo ?? "",
      before: [],
      after: [],
    };
    pair.before.push(f);
    byFolder.set(folderId, pair);
  }
  for (const f of after.sort((a, b) => order(a) - order(b))) {
    const pair = byFolder.get(f.parents?.[0] ?? "");
    if (pair && f.appProperties?.estado !== STATE.discarded) pair.after.push(f);
  }
  return [...byFolder.values()].sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));
}

/** Cambia appProperties de los ANTES y DESPUÉS vigentes del par. */
export async function updatePair(pair: Pair, props: Record<string, string>): Promise<void> {
  const values = appProperties(props);
  await Promise.all([...pair.before, ...pair.after].map((f) => updateAppProperties(f.id, values)));
}

/** Código para una foto fuera del catálogo: el siguiente F después del mayor que exista (F25, F26…). */
export function nextCode(pairs: Pair[]): string {
  const numbers = [...CATALOG.map((c) => c.codigo), ...pairs.map((p) => p.code)]
    .map((c) => Number(c.match(/^F(\d+)$/)?.[1] ?? 0));
  return `F${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

/** Bytes de las fotos para mandarlas a Telegram. */
export async function photoBytes(files: DriveFile[]): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }[]> {
  return await Promise.all(files.map(async (f) => ({ bytes: await downloadDriveFile(f.id), mime: f.mimeType })));
}

/** «F01 Muro cocina–sala completo (tareas 02, 09; H1, H2)». */
export function pairLabel(pair: Pair): string {
  const tasks = pair.tasks.length ? `tarea${pair.tasks.length > 1 ? "s" : ""} ${pair.tasks.join(", ")}` : "";
  const details = [tasks, pair.hitos.join(", ")].filter(Boolean).join("; ");
  return `${pair.code} ${pair.name}${details ? ` (${details})` : ""}`;
}
