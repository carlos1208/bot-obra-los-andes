// Cliente de Gemini y extractores con la API simulada.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { GeminiError, geminiTiming, generateJson, isQuotaError } from "../supabase/functions/_shared/gemini.ts";
import { extractInvoice, summarizeNote } from "../supabase/functions/_shared/extractors.ts";
import { checkInvoice, matchExpected, parseExpected } from "../scripts/_invoice_check.ts";

Deno.env.set("GEMINI_API_KEY", "clave-prueba");
Deno.env.set("GEMINI_MODEL", "modelo-principal");

interface Call {
  url: string;
  headers: Headers;
  body: any;
}
let calls: Call[] = [];
let reply: () => Response = () => Response.json({});
/** Si es true, la API no responde nunca (hasta que se cancele la solicitud). */
let hang = false;

globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
  calls.push({ url: String(input), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
  if (hang) {
    return await new Promise<Response>((_, reject) =>
      init.signal?.addEventListener("abort", () => reject(init.signal!.reason))
    );
  }
  return await Promise.resolve(reply());
};

const answer = (json: unknown, extra: Record<string, unknown> = {}) => () =>
  Response.json({
    candidates: [{
      content: { parts: [{ text: "pensando…", thought: true }, { text: JSON.stringify(json) }] },
      finishReason: "STOP",
      ...extra,
    }],
  });

Deno.test("arma la solicitud con JSON estructurado y el archivo en base64", async () => {
  calls = [];
  reply = answer({ ok: true });
  const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
  const data = await generateJson<{ ok: boolean }>({
    instructions: "instrucciones",
    parts: ["texto", { mimeType: "application/pdf", bytes }],
    schema: { type: "object" },
  });
  assertEquals(data, { ok: true }); // ignora las partes de pensamiento
  const [call] = calls;
  assert(call.url.endsWith("/v1beta/models/modelo-principal:generateContent"));
  assertEquals(call.headers.get("x-goog-api-key"), "clave-prueba");
  assertEquals(call.body.systemInstruction.parts[0].text, "instrucciones");
  assertEquals(call.body.generationConfig.responseFormat.text, {
    mimeType: "APPLICATION_JSON",
    schema: { type: "object" },
  });
  const [text, file] = call.body.contents[0].parts;
  assertEquals(text, { text: "texto" });
  assertEquals(file.inline_data.mime_type, "application/pdf");
  assertEquals(Uint8Array.from(atob(file.inline_data.data), (c) => c.charCodeAt(0)), bytes);
});

Deno.test("429 es error de cuota; los otros errores no", async () => {
  reply = () => Response.json({ error: { message: "Resource exhausted" } }, { status: 429 });
  const e = await assertRejects(() => generateJson({ instructions: "", parts: ["x"], schema: {} }), GeminiError);
  assert(isQuotaError(e));
  reply = () => Response.json({ error: { message: "bad" } }, { status: 400 });
  assert(!isQuotaError(await assertRejects(() => generateJson({ instructions: "", parts: ["x"], schema: {} }))));
});

Deno.test("respuesta bloqueada, cortada o sin JSON es error", async () => {
  const call = () => generateJson({ instructions: "", parts: ["x"], schema: {} });
  reply = () => Response.json({ promptFeedback: { blockReason: "SAFETY" } });
  await assertRejects(call, GeminiError, "SAFETY");
  reply = answer({}, { finishReason: "MAX_TOKENS" });
  await assertRejects(call, GeminiError, "MAX_TOKENS");
  reply = () => Response.json({ candidates: [{ content: { parts: [{ text: "no es json" }] }, finishReason: "STOP" }] });
  await assertRejects(call, GeminiError, "JSON");
});

Deno.test("no manda archivos de más de 20 MB", async () => {
  calls = [];
  const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
  const e = await assertRejects(
    () => generateJson({ instructions: "", parts: [{ mimeType: "image/jpeg", bytes }], schema: {} }),
    GeminiError,
  );
  assertEquals((e as GeminiError).status, 413);
  assertEquals(calls.length, 0);
});

Deno.test("la factura usa los capítulos de Presupuesto y el modelo pedido", async () => {
  calls = [];
  const invoice = {
    supplier: "Homecenter",
    tax_id: "800.242.106-2",
    date: "2026-10-19",
    number: "5209100261757",
    products: [
      { name: "Corte de vigas de hierro", quantity: 1, unit: "und", total: 12900 },
      { name: "Tubo rectangular 90 x 50", quantity: 1, unit: "und", total: 167900 },
      { name: "Pino de 2 x 3 pulgadas de 3,2 m", quantity: 1, unit: "und", total: 34900 },
    ],
    total: 215700,
    chapter: "Materiales de obra y pintura",
  };
  reply = answer(invoice);
  const file = { mimeType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) };
  assertEquals(await extractInvoice(file, ["Drywall", "Materiales de obra y pintura"], "modelo-respaldo"), invoice);
  const schema = calls[0].body.generationConfig.responseFormat.text.schema;
  assertEquals(schema.properties.chapter.enum, ["Drywall", "Materiales de obra y pintura"]);
  assertEquals(schema.properties.total.type, ["integer", "null"]);
  assertEquals(schema.properties.products.items.required, ["name", "printed", "quantity", "unit", "total"]);
  assert(calls[0].url.includes("/models/modelo-respaldo:"));
});

Deno.test("la nota de voz va como audio/ogg", async () => {
  calls = [];
  reply = answer({ transcript: "Hoy no vino el albañil", summary: "El albañil no vino." });
  const note = await summarizeNote({ mimeType: "audio/ogg", bytes: new Uint8Array([79, 103, 103, 83]) });
  assertEquals(note.summary, "El albañil no vino.");
  assertEquals(calls[0].body.contents[0].parts[1].inline_data.mime_type, "audio/ogg");
});

Deno.test("compara número, fecha y total con facturas_esperadas.csv", async () => {
  const expected = parseExpected(
    await Deno.readTextFile(new URL("../semillas/facturas_esperadas.csv", import.meta.url)),
  );
  assertEquals(expected.length, 4);
  const easy = expected.find((e) => e.numero === "EL021045207")!;
  assertEquals(easy.total, 1834030);
  const got = {
    supplier: "Easy",
    tax_id: null,
    date: "2026-09-22",
    number: "el02 1045207",
    products: [],
    total: 1834030,
    chapter: "",
  };
  assert(checkInvoice(easy, got).every((c) => c.ok));
  const wrong = checkInvoice(easy, { ...got, date: "2026-09-21", total: 1834000, number: null });
  assertEquals(wrong.map((c) => c.ok), [false, false, false]);
  // La foto se empareja por número y, si no lo leyó, por total.
  assertEquals(matchExpected(expected, { ...got, number: "5212100268554" })?.total, 19900);
  assertEquals(matchExpected(expected, { ...got, number: null, total: 215700 })?.numero, "5209100261757");
  assertEquals(matchExpected(expected, { ...got, number: "X1", total: 1 }), undefined);
});

Deno.test("si Gemini no responde a tiempo, falla con un error claro (no se queda colgado)", async () => {
  hang = true;
  geminiTiming.timeoutMs = 50;
  try {
    const e = await assertRejects(
      () => generateJson({ instructions: "i", parts: ["hola"], schema: { type: "object" } }),
      GeminiError,
    );
    assertEquals((e as GeminiError).status, 504);
    assertEquals((e as GeminiError).message, "Gemini modelo-principal no respondió en 0.05 s");
    assert(!isQuotaError(e));
  } finally {
    hang = false;
    geminiTiming.timeoutMs = 60_000;
  }
});
