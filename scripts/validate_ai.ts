// Fase 2: valida que Gemini lea bien las facturas y las notas de voz.
// Pasa las 4 facturas reales en PDF y, si la das, la foto de una factura impresa, y compara con
// semillas/facturas_esperadas.csv. Si el modelo principal falla en alguna de las 4, repite con el
// de respaldo y dice cuál quedó. Al final transcribe y resume una nota de voz OGG de Telegram.
//
// Uso:
//   deno task validar-ia --facturas "C:\...\05 Facturas y pagos\Facturas" --foto "C:\...\factura.jpg" --voz "C:\...\nota.ogg"
// --foto y --voz son opcionales.
import { loadEnv, required } from "./_env.ts";
import { readTabs } from "../supabase/functions/_shared/sheets.ts";
import { formatPesos } from "../supabase/functions/_shared/format.ts";
import { fallbackModel, GeminiError, type InlineFile, primaryModel } from "../supabase/functions/_shared/gemini.ts";
import { extractInvoice, type Invoice, summarizeNote } from "../supabase/functions/_shared/extractors.ts";
import { checkInvoice, type ExpectedInvoice, matchExpected, parseExpected } from "./_invoice_check.ts";

await loadEnv();
const NEEDED = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_MODEL_FALLBACK",
  "SHEET_ID",
  "GOOGLE_SA_EMAIL",
  "GOOGLE_SA_PRIVATE_KEY",
];
for (const n of NEEDED) required(n);

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(`--${name}`);
  const value = i >= 0 ? Deno.args[i + 1] : undefined;
  // PowerShell deja una comilla al final si la ruta termina en «\"».
  return value && !value.startsWith("--") ? value.replace(/["\\/]+$/, "") : undefined;
}

const invoicesDir = arg("facturas");
if (!invoicesDir) {
  console.error('Uso: deno task validar-ia --facturas "<carpeta con las 4 facturas PDF>"');
  console.error('                         [--foto "<foto de una factura impresa>"] [--voz "<nota de voz .ogg>"]');
  Deno.exit(1);
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
};

async function readInline(path: string, allowed: string, hint: string): Promise<InlineFile> {
  const ext = (path.match(/\.[^.\\/]+$/)?.[0] ?? "").toLowerCase();
  const mimeType = MIME[ext];
  if (!mimeType || !mimeType.startsWith(allowed)) {
    console.error(`${path}: ${hint}`);
    Deno.exit(1);
  }
  try {
    return { mimeType, bytes: await Deno.readFile(path) };
  } catch {
    console.error(`No encontré ${path}`);
    Deno.exit(1);
  }
}

// Las 4 facturas: cada fila de facturas_esperadas.csv con su PDF en la carpeta.
const expectedList = parseExpected(await Deno.readTextFile("semillas/facturas_esperadas.csv"));
const inFolder = new Map<string, string>();
try {
  for await (const e of Deno.readDir(invoicesDir)) {
    if (e.isFile) inFolder.set(e.name.normalize("NFC"), `${invoicesDir}/${e.name}`);
  }
} catch {
  console.error(`No pude abrir la carpeta ${invoicesDir}`);
  Deno.exit(1);
}
const pdfs: { expected: ExpectedInvoice; file: InlineFile }[] = [];
for (const expected of expectedList) {
  const path = inFolder.get(expected.archivo.normalize("NFC"));
  if (!path) {
    console.error(`En ${invoicesDir} no está «${expected.archivo}».`);
    console.error(`Encontré: ${[...inFolder.keys()].join(" · ") || "nada"}`);
    Deno.exit(1);
  }
  pdfs.push({ expected, file: await readInline(path, "application/pdf", "debe ser PDF.") });
}
const photoPath = arg("foto");
const photo = photoPath ? await readInline(photoPath, "image/", "la foto debe ser JPG, PNG, WEBP o HEIC.") : null;
const voicePath = arg("voz");
const voice = voicePath
  ? await readInline(voicePath, "audio/", "la nota de voz debe ser .ogg, como la guarda Telegram.")
  : null;

// Capítulos leídos de la hoja en este momento, como hará el bot.
const { Presupuesto } = await readTabs(["Presupuesto"]);
const chapters = Presupuesto.map((r) => String(r.capitulo ?? "").trim()).filter(Boolean);

// 429 (cuota) y 500/503 (ocupado): espera creciente, como la cola del bot.
const WAITS = [20, 40, 80];
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0;; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof GeminiError) || ![429, 500, 503].includes(e.status) || i >= WAITS.length) throw e;
      console.log(`  Gemini respondió ${e.status} (${e.status === 429 ? "cuota" : "ocupado"}). Espero ${WAITS[i]} s…`);
      await new Promise((r) => setTimeout(r, WAITS[i] * 1000));
    }
  }
}

const seconds = (start: number) => ((performance.now() - start) / 1000).toFixed(1).replace(".", ",");
const money = (v: string) => /^\d+$/.test(v) ? formatPesos(Number(v)) : v;

/** Lee una factura y la compara. Devuelve true si número, fecha y total son exactos. */
async function showInvoice(label: string, file: InlineFile, model: string, expected?: ExpectedInvoice) {
  console.log(`\n${label}`);
  const start = performance.now();
  let got: Invoice;
  try {
    got = await withRetry(() => extractInvoice(file, chapters, model));
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
    return false;
  }
  const target = expected ?? matchExpected(expectedList, got);
  let ok = false;
  if (target) {
    if (!expected) console.log(`  Corresponde a ${target.numero} de facturas_esperadas.csv.`);
    const checks = checkInvoice(target, got);
    for (const c of checks) {
      const shown = c.field === "total" ? money(c.got) : c.got;
      const note = c.ok
        ? (c.field === "número" && c.got !== c.expected ? "  (igual sin espacios ni guiones)" : "")
        : `  (esperado ${c.field === "total" ? money(c.expected) : c.expected})`;
      console.log(`  ${c.ok ? "✓" : "✗"} ${c.field.padEnd(6)} ${shown}${note}`);
    }
    ok = checks.every((c) => c.ok);
  } else {
    console.log("  No está en facturas_esperadas.csv: revísala a ojo.");
    console.log(
      `  número ${got.number ?? "—"} · fecha ${got.date ?? "—"} · total ${
        got.total === null ? "—" : formatPesos(got.total)
      }`,
    );
  }
  console.log(`  proveedor: ${got.supplier} · NIT: ${got.tax_id ?? "—"} · capítulo sugerido: ${got.chapter}`);
  console.log(`  ítems: ${got.items.join(", ") || "—"}`);
  console.log(`  (${seconds(start)} s)`);
  return ok;
}

async function runModel(model: string): Promise<boolean> {
  console.log(`\n══ Facturas con ${model} ══`);
  let passed = 0;
  for (const { expected, file } of pdfs) {
    if (await showInvoice(`Factura ${expected.numero} (PDF)`, file, model, expected)) passed++;
  }
  if (photo) await showInvoice("Foto de factura impresa", photo, model);
  console.log(`\n${passed} de ${pdfs.length} facturas PDF exactas con ${model}.`);
  return passed === pdfs.length;
}

const main = primaryModel();
const backup = fallbackModel();
let chosen: string | null = null;
if (await runModel(main)) chosen = main;
else {
  console.log("\nRepito con el modelo de respaldo.");
  if (await runModel(backup)) chosen = backup;
}

if (voice) {
  const model = chosen ?? main;
  console.log(`\n══ Nota de voz (audio/ogg) con ${model} ══`);
  const start = performance.now();
  try {
    const note = await withRetry(() => summarizeNote(voice, model));
    console.log(`  Transcripción: ${note.transcript}`);
    console.log(`  Resumen: ${note.summary}`);
    console.log(`  (${seconds(start)} s)`);
  } catch (e) {
    console.log(`  ✗ Error: ${(e as Error).message}`);
  }
}

console.log("\n══ Resultado ══");
if (chosen === main) {
  console.log(`Quedó ${main}, el principal. No hay que cambiar nada.`);
} else if (chosen === backup) {
  console.log(`Quedó ${backup}, el de respaldo: ${main} falló en alguna factura.`);
  console.log(`Para dejarlo de principal: en .env.local pon GEMINI_MODEL=${backup} y GEMINI_MODEL_FALLBACK=${main},`);
  console.log("y corre deno task secretos.");
} else {
  console.log("Ningún modelo leyó exactas las 4 facturas. Mándame esta salida.");
}
if (!photo) console.log("Faltó la foto de la factura impresa (--foto).");
if (!voice) console.log("Faltó la nota de voz (--voz).");
