// Catálogo de fotos ANTES (13 de las F01–F24 originales). Copia de semillas/fotos_antes.json: una prueba
// verifica que sean idénticos.

import data from "./fotos_antes.json" with { type: "json" };

/** Entrada del catálogo (los campos se llaman como en la semilla). */
export interface CatalogPhoto {
  codigo: string;
  nombre: string;
  encuadre: string;
  tareas: string[];
  hitos: string[];
}

export const CATALOG: CatalogPhoto[] = data;

export function catalogPhoto(code: string): CatalogPhoto | undefined {
  return CATALOG.find((f) => f.codigo === code);
}

/** «ANTES 2026-10-24 (1).jpg». El DESPUÉS usa el mismo número que su ANTES. */
export function photoFileName(kind: "ANTES" | "DESPUÉS", dateISO: string, n: number, extension = "jpg"): string {
  return `${kind} ${dateISO} (${n}).${extension}`;
}

/** Carpeta de cada par: «F01 Muro cocina–sala completo». */
export function pairFolderName(code: string, name: string): string {
  return `${code} ${name}`;
}
