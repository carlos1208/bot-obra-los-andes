// Lectura de la lista de productos corregida a mano y su formato.
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { lineEditText, lineText, parseLines } from "../supabase/functions/_shared/products.ts";

Deno.test("lee cantidad, unidad, producto y valor de cada línea", () => {
  const got = parseLines(
    [
      "2 Cemento gris de 50 kg 64.000",
      "• Brocha de 3 pulgadas 12 mil",
      "Pino de 2 x 3 pulgadas de 3,2 m: $34.900",
      "2,5 m2 de Enchape blanco 80.000",
      "",
      "3 x Rejilla redonda 59700",
    ].join("\n"),
  );
  assertEquals(got, {
    lines: [
      { name: "Cemento gris de 50 kg", quantity: 2, unit: "und", total: 64000 },
      { name: "Brocha de 3 pulgadas", quantity: 1, unit: "und", total: 12000 },
      { name: "Pino de 2 x 3 pulgadas de 3,2 m", quantity: 1, unit: "und", total: 34900 },
      { name: "Enchape blanco", quantity: 2.5, unit: "m2", total: 80000 },
      { name: "Rejilla redonda", quantity: 3, unit: "und", total: 59700 },
    ],
  });
});

Deno.test("sin valor al final, o sin producto, la línea no se acepta", () => {
  assertEquals(parseLines("Pino 2x3\n64.000\n1 Brocha 5.000"), { bad: ["Pino 2x3", "64.000"] });
  assertEquals(parseLines("  \n"), { bad: [] });
});

Deno.test("la lista que se manda para corregir se vuelve a leer igual", () => {
  const lines = [
    { name: "Enchape de pared (caja de 1,62 m²)", quantity: 21, unit: "und", total: 814438 },
    { name: "Malla", quantity: 2.5, unit: "m2", total: 2000 },
  ];
  assertEquals(lines.map(lineEditText), ["21 Enchape de pared (caja de 1,62 m²) 814.438", "2,5 m2 Malla 2.000"]);
  assertEquals(parseLines(lines.map(lineEditText).join("\n")), { lines });
  assertEquals(lines.map(lineText), ["21 × Enchape de pared (caja de 1,62 m²): $814.438", "2,5 m2 Malla: $2.000"]);
});
