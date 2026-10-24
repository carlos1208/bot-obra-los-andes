// Compara lo que leyó Gemini con semillas/facturas_esperadas.csv (fase 2).
// Criterio del prompt: número, fecha y total exactos.
import { parse } from "jsr:@std/csv@1.0.6";
import type { Invoice } from "../supabase/functions/_shared/extractors.ts";

export interface ExpectedInvoice {
  archivo: string;
  proveedor: string;
  numero: string;
  fecha: string;
  total: number;
}

export interface FieldCheck {
  field: "número" | "fecha" | "total";
  ok: boolean;
  got: string;
  expected: string;
}

export function parseExpected(csv: string): ExpectedInvoice[] {
  return parse(csv, { skipFirstRow: true }).map((r) => ({
    archivo: r.archivo,
    proveedor: r.proveedor,
    numero: r.numero,
    fecha: r.fecha,
    total: Number(r.total),
  }));
}

/** El número se compara sin espacios ni guiones y sin importar mayúsculas: «EL02 1045207» = «EL021045207». */
export const sameNumber = (a: string | null, b: string): boolean =>
  a !== null && a.toUpperCase().replace(/[\s-]/g, "") === b.toUpperCase().replace(/[\s-]/g, "");

export function checkInvoice(expected: ExpectedInvoice, got: Invoice): FieldCheck[] {
  return [
    { field: "número", ok: sameNumber(got.number, expected.numero), got: got.number ?? "—", expected: expected.numero },
    { field: "fecha", ok: got.date === expected.fecha, got: got.date ?? "—", expected: expected.fecha },
    {
      field: "total",
      ok: got.total === expected.total,
      got: got.total === null ? "—" : String(got.total),
      expected: String(expected.total),
    },
  ];
}

/** Para la foto: busca su factura esperada por número y, si no, por total. */
export function matchExpected(list: ExpectedInvoice[], got: Invoice): ExpectedInvoice | undefined {
  return list.find((e) => sameNumber(got.number, e.numero)) ?? list.find((e) => got.total === e.total);
}
