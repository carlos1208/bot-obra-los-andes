// Productos de una factura: suma, cómo se muestran y cómo se leen cuando alguien corrige la lista.

import type { InvoiceLine } from "./extractors.ts";
import { formatPesos, normalize, parseAmount } from "./format.ts";

/** Suma de las líneas con valor. */
export const linesTotal = (lines: InvoiceLine[]): number => lines.reduce((s, l) => s + (l.total ?? 0), 0);

/** 2.5 → "2,5". */
const quantityText = (q: number) => String(Math.round(q * 1000) / 1000).replace(".", ",");

/** «2 × Cemento gris», «2,5 m2 Enchape», «Brocha» (una unidad). */
function quantityAndName(l: InvoiceLine): string {
  if (l.unit === "und") return l.quantity === 1 ? l.name : `${quantityText(l.quantity)} × ${l.name}`;
  return `${quantityText(l.quantity)} ${l.unit} ${l.name}`;
}

/** Línea para la vista previa: «2 × Cemento gris: $64.000». */
export function lineText(l: InvoiceLine): string {
  return `${quantityAndName(l)}: ${l.total === null ? "sin valor" : formatPesos(l.total)}`;
}

/** Línea en el formato que se escribe para corregir: «2 Cemento gris 64.000». */
export function lineEditText(l: InvoiceLine): string {
  const unit = l.unit === "und" ? "" : `${l.unit} `;
  const value = l.total === null ? "" : ` ${formatPesos(l.total).replace("$", "")}`;
  return `${quantityText(l.quantity)} ${unit}${l.name}${value}`;
}

const UNITS: [RegExp, string][] = [
  [/^(und|unds|un|unid|unidad|unidades)$/, "und"],
  [/^(m2|m²|mt2|mts2)$/, "m2"],
  [/^(m|mt|mts|metro|metros)$/, "m"],
  [/^(kg|kilo|kilos)$/, "kg"],
  [/^(gal|galon|galones)$/, "galón"],
  [/^(caja|cajas)$/, "caja"],
  [/^(bulto|bultos)$/, "bulto"],
  [/^(rollo|rollos)$/, "rollo"],
  [/^(l|lt|litro|litros)$/, "litro"],
];

/** Unidad escrita por la persona → la de la hoja, o null si no es una unidad. */
function unitOf(word: string): string | null {
  const w = normalize(word).replace(/\.$/, "");
  return UNITS.find(([re]) => re.test(w))?.[1] ?? null;
}

/**
 * Lee la lista corregida: una línea por producto, «cantidad [unidad] producto valor».
 * La cantidad es opcional (1); el valor va al final y es obligatorio.
 * Devuelve las líneas o, si alguna no se entiende, el texto de esas líneas.
 */
export function parseLines(text: string): { lines: InvoiceLine[] } | { bad: string[] } {
  const lines: InvoiceLine[] = [];
  const bad: string[] = [];
  for (const raw of text.split("\n")) {
    let rest = raw.replace(/^\s*[•*·-]\s*/, "").trim();
    if (!rest) continue;
    const value = rest.match(/(?:^|[\s:=])(\$?\s?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(?:mil|k))?)\s*$/i);
    const total = value ? parseAmount(value[1]) : null;
    if (!value || total === null) {
      bad.push(rest);
      continue;
    }
    rest = rest.slice(0, value.index).replace(/[\s:=$-]+$/, "").trim();
    let quantity = 1;
    const q = rest.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+(.*)$/i);
    if (q) {
      quantity = Number(q[1].replace(",", "."));
      rest = q[2];
    }
    let unit = "und";
    const [first, ...others] = rest.split(/\s+/);
    const u = others.length ? unitOf(first) : null;
    if (u) {
      unit = u;
      rest = others.join(" ").replace(/^de\s+/i, "");
    }
    if (!rest || quantity <= 0) {
      bad.push(raw.trim());
      continue;
    }
    lines.push({ name: rest, quantity, unit, total });
  }
  return bad.length || !lines.length ? { bad } : { lines };
}
