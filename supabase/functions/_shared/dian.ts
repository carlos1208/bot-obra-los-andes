// Factura electrónica de la DIAN (UBL 2.1): el XML que llega en el .zip del correo. Puede ser un
// AttachedDocument (con la factura dentro, en un CDATA) o la factura (Invoice) sola.
// De aquí salen los datos exactos, sin IA: número, fecha, NIT, nombres del vendedor, total y cada línea.

import { XMLParser } from "npm:fast-xml-parser@4.5.1";

export interface DianLine {
  /** Descripción tal como viene en la factura. */
  printed: string;
  quantity: number;
  unit: string;
  /** Pagado por la línea en pesos enteros: valor sin impuestos (ya con descuentos) + impuestos. */
  total: number;
}

export interface DianInvoice {
  number: string;
  date: string; // AAAA-MM-DD
  taxId: string; // NIT del vendedor
  legalName: string; // razón social
  tradeName: string; // nombre que trae la factura (puede ser la razón social)
  storeName: string | null; // tienda, si la trae (p. ej. «EASY ALTOS DEL PRADO»)
  total: number; // total a pagar, en pesos enteros
  lines: DianLine[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ["InvoiceLine", "TaxTotal", "Description", "Attachment"].includes(name),
});

// deno-lint-ignore no-explicit-any
type Node = any;

/** Texto de un nodo (con atributos queda en «#text»). */
const text = (v: Node): string => {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return String(v["#text"] ?? "").trim();
  return String(v).trim();
};
const amount = (v: Node): number => Number(text(v)) || 0;

/** Código de unidad UN/ECE → la unidad de la hoja. */
const UNITS: Record<string, string> = {
  "94": "und",
  NIU: "und",
  NAR: "und",
  EA: "und",
  C62: "und",
  H87: "und",
  MTK: "m2",
  MTR: "m",
  KGM: "kg",
  LTR: "litro",
  GLL: "galón",
};

function invoiceNode(xml: string): Node {
  const doc = parser.parse(xml);
  if (doc.Invoice) return doc.Invoice;
  // AttachedDocument: la factura va como texto (CDATA) en Attachment/ExternalReference/Description.
  for (const att of doc.AttachedDocument?.Attachment ?? []) {
    for (const d of att.ExternalReference?.Description ?? []) {
      const inner = text(d);
      if (inner.includes("<Invoice")) {
        const invoice = parser.parse(inner).Invoice;
        if (invoice) return invoice;
      }
    }
  }
  throw new Error("El XML no trae una factura (Invoice) de la DIAN");
}

/**
 * Redondea cada línea a pesos para que la suma dé el total a pagar: los centavos del IVA hacen que el
 * redondeo de cada línea no siempre cuadre (método del mayor residuo).
 */
function roundToTotal(exact: number[], total: number): number[] {
  const floors = exact.map(Math.floor);
  let missing = total - floors.reduce((s, v) => s + v, 0);
  // Si la diferencia no es de centavos (otro cargo o un descuento general), se redondea cada una y ya.
  if (missing < 0 || missing > exact.length) return exact.map(Math.round);
  const order = exact.map((v, i) => ({ i, r: v - floors[i] })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (missing-- <= 0) break;
    floors[i]++;
  }
  return floors;
}

export function parseDianInvoice(xml: string): DianInvoice {
  const inv = invoiceNode(xml);
  const party = inv.AccountingSupplierParty?.Party ?? {};
  const taxScheme = Array.isArray(party.PartyTaxScheme) ? party.PartyTaxScheme[0] : party.PartyTaxScheme ?? {};
  const total = Math.round(amount(inv.LegalMonetaryTotal?.PayableAmount));
  const raw = (inv.InvoiceLine ?? []).map((l: Node) => ({
    printed: text(l.Item?.Description).replace(/\s+/g, " "),
    quantity: amount(l.InvoicedQuantity),
    unit: UNITS[String(l.InvoicedQuantity?.["@_unitCode"] ?? "").toUpperCase()] ??
      (String(l.InvoicedQuantity?.["@_unitCode"] ?? "").toLowerCase() || "und"),
    // Solo el TaxAmount de cada TaxTotal (el de TaxSubtotal repite el mismo valor).
    exact: amount(l.LineExtensionAmount) +
      (l.TaxTotal ?? []).reduce((s: number, t: Node) => s + amount(t.TaxAmount), 0),
  }));
  const totals = roundToTotal(raw.map((l: { exact: number }) => l.exact), total);
  return {
    number: text(inv.ID),
    date: text(inv.IssueDate),
    taxId: text(taxScheme.CompanyID),
    legalName: (text(taxScheme.RegistrationName) || text(party.PartyLegalEntity?.RegistrationName)).replace(
      /\s+/g,
      " ",
    ),
    tradeName: text(party.PartyName?.Name).replace(/\s+/g, " "),
    storeName: text(party.PhysicalLocation?.Name) || null,
    total,
    lines: raw.map((l: { printed: string; quantity: number; unit: string }, i: number) => ({
      printed: l.printed,
      quantity: l.quantity,
      unit: l.unit,
      total: totals[i],
    })),
  };
}
