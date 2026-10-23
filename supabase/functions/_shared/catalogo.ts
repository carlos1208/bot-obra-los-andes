// Catálogo de fotos ANTES (F01–F24). Copia de semillas/fotos_antes.json: una prueba
// verifica que sean idénticos.

import datos from "./fotos_antes.json" with { type: "json" };

export interface FotoCatalogo {
  codigo: string;
  nombre: string;
  encuadre: string;
  tareas: string[];
  hitos: string[];
}

export const CATALOGO: FotoCatalogo[] = datos;

export function fotoDelCatalogo(codigo: string): FotoCatalogo | undefined {
  return CATALOGO.find((f) => f.codigo === codigo);
}

/** «ANTES 2026-10-24 (1).jpg». El DESPUÉS usa el mismo número que su ANTES. */
export function nombreFoto(tipo: "ANTES" | "DESPUÉS", fechaISO: string, n: number, extension = "jpg"): string {
  return `${tipo} ${fechaISO} (${n}).${extension}`;
}

/** Carpeta de cada par: «F01 Muro cocina–sala completo». */
export function nombreCarpetaPar(codigo: string, nombre: string): string {
  return `${codigo} ${nombre}`;
}
