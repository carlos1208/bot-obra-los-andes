// Página del tablero: HTML completo, sin librerías, con las gráficas en SVG. La muestra el Apps Script del tablero
// con HtmlService, que exige HTML bien formado: todo se escapa y las etiquetas vacías se cierran («<img … />»).

import { daysBetween, formatPesos, normalize, shortDate, weekday } from "../_shared/format.ts";
import { STATE } from "../_shared/pairs.ts";
import { mondayOf } from "../_shared/site.ts";
import type {
  Dashboard,
  DayPoint,
  MoneyView,
  PairView,
  Purchases,
  ReportView,
  TaskState,
  WorkWeekView,
} from "./data.ts";

/** Escapa texto para contenido y atributos. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const pct = (n: number) => `${Math.round(n)} %`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const range = (from: string, to: string) => `${shortDate(from)} – ${shortDate(to)}`;
const width = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (100 * part) / whole)) : 0);

/** Distintivo de estado: el color va en el punto; el texto lo dice. */
const badge = (kind: string, label: string) => `<span class="badge ${kind}"><i></i>${esc(label)}</span>`;

const TASK_BADGE: Record<TaskState, [string, string]> = {
  terminada: ["good", "✓ terminada"],
  atrasada: ["critical", "⚠ atrasada"],
  "en curso": ["active", "en curso"],
  pendiente: ["pending", "pendiente"],
};

const PAIR_BADGE: Record<string, [string, string]> = {
  [STATE.pendingApproval]: ["warning", "por aprobar"],
  [STATE.noAfter]: ["pending", "sin después"],
  [STATE.toValidate]: ["active", "por validar"],
  [STATE.checkOnSite]: ["warning", "revisar en sitio"],
  [STATE.validated]: ["good", "✓ validado"],
};

export function renderPage(d: Dashboard): string {
  const sections = [
    progressSection(d),
    d.moneyView ? moneySection(d.moneyView) : "",
    purchasesSection(d.purchases),
    photosSection(d),
  ].join("\n");
  const nav = [
    ["avance", "Avance"],
    ...(d.moneyView ? [["dinero", "Dinero"]] : []),
    ["compras", "Compras"],
    ["fotos", "Fotos y reportes"],
  ].map(([id, label]) => `<a href="#${id}" target="_self">${label}</a>`).join("");
  const view = d.money ? "Vista completa" : "Vista sin dinero";
  const when = d.week
    ? `Semana ${d.week} de obra`
    : d.today < d.start
    ? `La obra empieza el ${shortDate(d.start)}`
    : "La obra terminó";
  return `<!DOCTYPE html>
<html lang="es">
<head>
<base target="_blank" />
<style>${CSS}</style>
</head>
<body>
<main>
<header class="top">
<h1>Obra apto 202 · Los Andes</h1>
<p class="sub">${esc(shortDate(d.today))} · ${esc(when)}${d.todayNote ? ` · ${esc(d.todayNote)}` : ""}</p>
<p class="meta">Dato de la hoja, ${esc(d.time)} · ${view}</p>
<nav>${nav}</nav>
</header>
${sections}
<footer>Se arma con la hoja en el momento en que lo abres. Para ver lo último, vuelve a abrir el enlace.</footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

// --- Avance y cronograma -----------------------------------------------------------

function progressSection(d: Dashboard): string {
  const { actual, expected } = d.progress;
  const gap = Math.round(actual) - Math.round(expected);
  const late = d.lateTasks.length + d.lateExpected.length;
  const delivery = d.deliveryWithBaseboards && d.deliveryWithBaseboards !== d.deliveryWithoutBaseboards
    ? `con zócalos: ${shortDate(d.deliveryWithBaseboards)}`
    : "";
  return `<section id="avance">
<h2>Avance y cronograma</h2>
<div class="hero">
<span class="label">Avance de la obra</span>
<span class="value">${pct(actual)}</span>
<span class="note">Debería ir en ${pct(expected)} · desvío ${signed(gap)} puntos</span>
</div>
<div class="tiles">
${tile("Entrega", shortDate(d.deliveryWithoutBaseboards), delivery)}
${tile("Días de obra que faltan", String(d.workDaysLeft), "lunes a sábado, sin festivos")}
${tile("Pendientes atrasados", String(late), late ? "ver abajo" : "nada atrasado")}
</div>
${curveFigure(d.progress.curve, d.today)}
${lateBlock(d)}
<h3>Tareas por semana</h3>
<div class="legend">${
    (Object.keys(TASK_BADGE) as TaskState[]).map((s) => badge(...TASK_BADGE[s])).join("")
  }<span class="badge off"><i></i>no se trabaja</span></div>
${d.weeks.map(weekBlock).join("\n")}
${milestonesBlock(d)}
</section>`;
}

function tile(label: string, value: string, note = ""): string {
  return `<div class="tile"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span>${
    note ? `<span class="note">${esc(note)}</span>` : ""
  }</div>`;
}

// Medidas de la curva (en unidades del viewBox).
const C = { w: 400, h: 210, left: 40, right: 62, top: 14, bottom: 26 };

function curveFigure(points: DayPoint[], today: string): string {
  if (points.length < 2) return "";
  const plotW = C.w - C.left - C.right;
  const plotH = C.h - C.top - C.bottom;
  const step = plotW / (points.length - 1);
  const x = (i: number) => +(C.left + i * step).toFixed(1);
  const y = (v: number) => +(C.top + plotH * (1 - Math.max(0, Math.min(100, v)) / 100)).toFixed(1);
  const grid = [0, 25, 50, 75, 100].map((v) =>
    `<line class="grid" x1="${C.left}" x2="${C.w - C.right}" y1="${y(v)}" y2="${y(v)}" />` +
    (v % 50 === 0 ? `<text class="tick" x="${C.left - 6}" y="${y(v) + 4}" text-anchor="end">${v} %</text>` : "")
  ).join("");
  // Cada lunes, la semana de obra en el eje.
  const firstMonday = mondayOf(points[0].date);
  const ticks = points.map((p, i) => ({ p, i })).filter(({ p }) => weekday(p.date) === 1).map(({ p, i }) =>
    `<text class="tick" x="${x(i)}" y="${C.h - 8}" text-anchor="middle">S${
      Math.floor(daysBetween(firstMonday, p.date) / 7) + 1
    }</text>`
  ).join("");
  const expectedPath = points.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.expected)}`).join(" ");
  const real = points.map((p, i) => ({ p, i })).filter(({ p }) => p.actual !== undefined);
  const realPath = real.map(({ p, i }, n) => `${n ? "L" : "M"}${x(i)} ${y(p.actual!)}`).join(" ");
  const dots = real.map(({ p, i }) => `<circle class="dot" cx="${x(i)}" cy="${y(p.actual!)}" r="4" />`).join("");
  const last = points.length - 1;
  const lastReal = real.at(-1);
  const todayIndex = points.findIndex((p) => p.date === today);
  const todayLine = todayIndex >= 0
    ? `<line class="today" x1="${x(todayIndex)}" x2="${x(todayIndex)}" y1="${C.top}" y2="${C.top + plotH}" />` +
      `<text class="tick" x="${x(todayIndex)}" y="${C.top - 2}" text-anchor="middle">hoy</text>`
    : "";
  const labels = [
    `<text class="end" x="${x(last) + 6}" y="${y(points[last].expected) + 4}">Esperado</text>`,
    lastReal
      ? `<text class="end strong" x="${x(lastReal.i) + 8}" y="${y(lastReal.p.actual!) + 4}">Real ${
        pct(lastReal.p.actual!)
      }</text>`
      : "",
  ].join("");
  const data = esc(JSON.stringify(points.map((p) => ({
    l: shortDate(p.date),
    e: Math.round(p.expected),
    a: p.actual === undefined ? null : Math.round(p.actual),
  }))));
  const axes = esc(JSON.stringify({ left: C.left, step, w: C.w, start: todayIndex >= 0 ? todayIndex : 0 }));
  const rows = points.filter((p) => p.actual !== undefined || p.date <= today).map((p) =>
    `<tr><td>${esc(shortDate(p.date))}</td><td class="num">${pct(p.expected)}</td><td class="num">${
      p.actual === undefined ? "—" : pct(p.actual)
    }</td></tr>`
  ).join("");
  return `<figure class="chart">
<figcaption><b>Avance real y esperado, día a día</b><span class="keys"><span class="key real"><i></i>Real (reportes y hoy)</span><span class="key expected"><i></i>Esperado (cronograma)</span></span></figcaption>
<div class="plot">
<svg id="curva" viewBox="0 0 ${C.w} ${C.h}" role="img" aria-label="Avance real y esperado por día" tabindex="0" data-puntos="${data}" data-ejes="${axes}">
${grid}
<line class="axis" x1="${C.left}" x2="${C.w - C.right}" y1="${y(0)}" y2="${y(0)}" />
${ticks}
${todayLine}
<path class="expected" d="${expectedPath}" />
${realPath ? `<path class="real" d="${realPath}" />` : ""}
${dots}
${labels}
<line id="curva-cursor" class="cursor" x1="0" x2="0" y1="${C.top}" y2="${C.top + plotH}" visibility="hidden" />
</svg>
<div id="curva-tip" class="tip" hidden="hidden"></div>
</div>
<details><summary>Ver tabla</summary>
<table><thead><tr><th>Día</th><th class="num">Esperado</th><th class="num">Real</th></tr></thead><tbody>${
    rows || `<tr><td colspan="3">La obra no ha empezado.</td></tr>`
  }</tbody></table>
</details>
</figure>`;
}

function lateBlock(d: Dashboard): string {
  if (!d.lateTasks.length && !d.lateExpected.length) {
    return `<h3>Atrasado</h3><p>${badge("good", "✓ Nada atrasado")}</p>`;
  }
  const expected = d.lateExpected.map((e) => {
    const when = e.days ? `${shortDate(e.date)} (hace ${plural(e.days, "día", "días")} de obra)` : "Hoy";
    return `<li>${badge(e.notArrived ? "critical" : "warning", e.notArrived ? "⚠ no llegó" : "sin confirmar")} ${
      esc(when)
    }: ${esc(e.what)}${e.task ? ` <span class="muted">(tarea ${esc(e.task)})</span>` : ""}</li>`;
  }).join("");
  const tasks = d.lateTasks.map((t) =>
    `<li>${badge("critical", `⚠ ${plural(t.days, "día", "días")}`)} <b>${esc(t.id)}</b> ${
      esc(t.name)
    } <span class="muted">(fin ${esc(shortDate(t.end))})</span></li>`
  ).join("");
  return `<h3>Atrasado</h3>
<p class="muted">Se recuerda cada día hasta que se marque en el reporte, en la hoja o con los botones del aviso.</p>
${d.lateExpected.length ? `<h4>Lo esperado sin confirmar</h4><ul class="list">${expected}</ul>` : ""}
${d.lateTasks.length ? `<h4>Tareas atrasadas</h4><ul class="list">${tasks}</ul>` : ""}`;
}

const DAY_LETTERS = ["L", "M", "M", "J", "V", "S"];

function weekBlock(w: WorkWeekView): string {
  const head = w.days.map((day, i) =>
    `<span class="g-day${w.off[i] ? " off" : ""}">${DAY_LETTERS[i]}<br />${Number(day.slice(8))}</span>`
  ).join("");
  const rows = w.tasks.map((t) => {
    const [kind, label] = TASK_BADGE[t.state];
    const cells = t.days.map((on, i) =>
      `<span class="g-cell${w.off[i] ? " off" : ""}${on && !w.off[i] ? ` on ${kind}` : ""}${
        on && t.tentative ? " tentative" : ""
      }"></span>`
    ).join("");
    return `<div class="g-row"><span class="g-name"><b>${esc(t.id)}</b> ${esc(t.name)}<small>${esc(t.who)} · ${
      esc(label)
    }${t.tentative ? " · tentativa" : ""}</small></span>${cells}</div>`;
  }).join("");
  const done = w.tasks.filter((t) => t.state === "terminada").length;
  const title = `${w.number ? `Semana ${w.number}` : "Antes de la obra"}`;
  return `<details class="week"${w.current ? ` open="open"` : ""}>
<summary><b>${title}</b> · ${esc(range(w.days[0], w.days[5]))} <span class="muted">· ${
    plural(w.tasks.length, "tarea", "tareas")
  }${done ? `, ${done} terminada${done === 1 ? "" : "s"}` : ""}${w.current ? " · esta semana" : ""}</span></summary>
<div class="gantt"><div class="g-row g-head"><span class="g-name"></span>${head}</div>${
    rows || `<p class="muted">Sin tareas.</p>`
  }</div>
</details>`;
}

function milestonesBlock(d: Dashboard): string {
  if (!d.milestones.length) return "";
  const money = d.money;
  const rows = d.milestones.map((m) => {
    const state = m.done
      ? badge("good", `✓ cumplido ${shortDate(m.done)}`)
      : m.late
      ? badge("critical", "⚠ atrasado")
      : badge("pending", "pendiente");
    const paid = money
      ? `<b class="num">${formatPesos(m.toPay ?? 0)}<small>a pagar · ${m.paid ? "pagado" : "sin pagar"}</small></b>`
      : "";
    return `<li><div><b>${esc(m.hito)}</b> ${esc(m.name)}${
      m.estimated ? ` <span class="muted">· ${esc(shortDate(m.estimated))}</span>` : ""
    }<small>${esc(m.criteria)}</small>${state}</div>${paid}</li>`;
  }).join("");
  return `<h3>Hitos</h3>
<ul class="rows">${rows}</ul>`;
}

// --- Dinero (solo con permiso de dinero) --------------------------------------------

function meter(part: number, whole: number, over = false): string {
  return `<div class="meter"><div class="fill${over ? " over" : ""}" style="width:${
    width(part, whole).toFixed(1)
  }%"></div></div>`;
}

function moneySection(m: MoneyView): string {
  const used = m.budget - m.available;
  const chapters = m.chapters.map((c) => {
    const over = c.budget > 0 && c.spent > c.budget;
    const status = over
      ? badge("critical", `⚠ pasado por ${formatPesos(c.spent - c.budget)}`)
      : c.budget === 0 && c.spent > 0
      ? badge("warning", "sin valor presupuestado")
      : "";
    return `<div class="bar-row"><div class="bar-label"><span>${esc(c.name)} <small>${esc(c.state)}</small></span><b>${
      formatPesos(c.spent)
    }${c.budget ? ` <small>de ${formatPesos(c.budget)}</small>` : ""}</b></div>${
      c.budget ? meter(c.spent, c.budget, over) : ""
    }${status}</div>`;
  }).join("");
  const payments = m.payments.map((p) => {
    const details = [p.date ? shortDate(p.date) : "sin fecha", p.method, p.in12M ? "" : "fuera de los 12 M"]
      .filter(Boolean).join(" · ");
    return `<li><div><b>${esc(p.payee)}</b><small>${esc(p.concept)}</small><small>${
      esc(details)
    }</small></div><b class="num">${formatPesos(p.amount)}</b></li>`;
  }).join("");
  const mason = m.mason;
  return `<section id="dinero">
<h2>Dinero</h2>
<div class="tiles">
<div class="tile wide"><span class="label">Disponible de los 12 M</span><span class="value">${
    formatPesos(m.available)
  }</span><span class="note">Usado ${formatPesos(used)} de ${formatPesos(m.budget)}</span>${
    meter(used, m.budget, m.available < 0)
  }</div>
<div class="tile wide"><span class="label">Albañil</span><span class="value">${
    formatPesos(mason.paid)
  }</span><span class="note">pagado de ${formatPesos(mason.total)} · saldo ${
    formatPesos(mason.balance)
  } · reserva para extras ${formatPesos(mason.reserve)}</span>${
    meter(mason.paid, mason.total, mason.paid > mason.total)
  }</div>
</div>
<h3>Presupuesto y gastado por capítulo</h3>
<p class="muted">Gastos y pagos que cuentan en los 12 M.</p>
<div class="bars">${chapters}</div>
${
    m.otherSpent
      ? `<p>${badge("warning", "otros")} Con un capítulo que no está en Presupuesto: <b>${
        formatPesos(m.otherSpent)
      }</b></p>`
      : ""
  }
${m.outside12M ? `<p class="muted">Pagado antes de los 12 M (no cuenta): ${formatPesos(m.outside12M)}</p>` : ""}
<h3>Pagos</h3>
${payments ? `<ul class="rows">${payments}</ul>` : `<p class="muted">Todavía no hay pagos.</p>`}
</section>`;
}

// --- Compras --------------------------------------------------------------------------

function bars(rows: { label: string; total: number }[]): string {
  const max = Math.max(0, ...rows.map((r) => r.total));
  return `<div class="bars">${
    rows.map((r) =>
      `<div class="bar-row"><div class="bar-label"><span>${esc(r.label)}</span><b>${formatPesos(r.total)}</b></div>${
        meter(r.total, max)
      }</div>`
    ).join("")
  }</div>`;
}

function purchasesSection(p: Purchases): string {
  const cash = p.pettyCash;
  const weeks = p.byWeek.map((w) => ({ label: `Semana ${w.week} · ${shortDate(w.monday)}`, total: w.total }));
  const latest = p.latest.map((e) => {
    const details = [e.date ? shortDate(e.date) : "sin fecha", e.chapter, e.payment ? `pagó ${e.payment}` : ""]
      .filter(Boolean).join(" · ");
    return `<li><div><b>${esc(e.supplier) || "—"}</b><small>${esc(e.items)}</small><small>${esc(details)}${
      e.link ? ` · <a href="${esc(e.link)}">factura</a>` : ""
    }</small></div><b class="num">${formatPesos(e.amount)}</b></li>`;
  }).join("");
  const products = p.products.map((r) => {
    const search = normalize([r.name, r.printed, r.supplier, r.chapter, r.invoice].join(" "));
    const printed = r.printed && normalize(r.printed) !== normalize(r.name) ? `<small>${esc(r.printed)}</small>` : "";
    const where = [r.supplier, r.date ? shortDate(r.date) : ""].filter(Boolean).join(" · ");
    return `<li data-q="${esc(search)}" data-v="${Math.round(r.total)}"><div>${esc(r.name)}${printed}<small>${
      esc(where)
    }</small></div><b class="num">${formatPesos(r.total)}<small>${esc(String(r.quantity).replace(".", ","))} ${
      esc(r.unit)
    }</small></b></li>`;
  }).join("");
  const productsTotal = p.products.reduce((s, r) => s + r.total, 0);
  return `<section id="compras">
<h2>Compras</h2>
<div class="tiles">
${tile("Total en compras", formatPesos(p.total), plural(p.count, "gasto registrado", "gastos registrados"))}
<div class="tile"><span class="label">Caja menor</span><span class="value">${
    formatPesos(cash.balance)
  }</span><span class="note">en efectivo de un fondo de ${formatPesos(cash.fund)} · facturas por reponer ${
    formatPesos(cash.toRefill)
  }</span></div>
</div>
<h3>Gastos por semana de obra</h3>
${weeks.length ? bars(weeks) : `<p class="muted">La obra no ha empezado.</p>`}
${p.beforeStart ? `<p class="muted">Antes de la obra: ${formatPesos(p.beforeStart)}</p>` : ""}
<h3>Gastos por capítulo</h3>
${
    p.byChapter.length
      ? bars(p.byChapter.map((c) => ({ label: c.name, total: c.total })))
      : `<p class="muted">Sin gastos.</p>`
  }
<h3>Últimos gastos</h3>
${latest ? `<ul class="rows">${latest}</ul>` : `<p class="muted">Todavía no hay gastos.</p>`}
${p.count > p.latest.length ? `<p class="muted">Los ${p.count} están en la hoja (pestaña Gastos).</p>` : ""}
<h3>Productos</h3>
<input id="buscar" type="search" placeholder="Buscar producto, tienda o capítulo" autocomplete="off" />
<p id="productos-total" class="muted">${plural(p.products.length, "producto", "productos")} · ${
    formatPesos(productsTotal)
  }</p>
<ul id="productos" class="rows">${products}</ul>
</section>`;
}

// --- Fotos y reportes --------------------------------------------------------------------

function pairCard(p: PairView): string {
  const [kind, label] = PAIR_BADGE[p.state] ?? ["pending", p.state];
  const photo = (url: string | undefined, what: string) =>
    url
      ? `<figure><img src="${esc(url)}" alt="${what} ${
        esc(p.code)
      }" loading="lazy" decoding="async" /><figcaption>${what}</figcaption></figure>`
      : `<figure class="empty"><span>Sin ${what.toLowerCase()}</span><figcaption>${what}</figcaption></figure>`;
  return `<article class="pair"><div class="photos">${photo(p.before, "ANTES")}${photo(p.after, "DESPUÉS")}</div>
<p><b>${esc(p.code)}</b> ${esc(p.name)}</p><p>${badge(kind, label)}${
    p.uploadedBy ? ` <span class="muted">subió ${esc(p.uploadedBy)}</span>` : ""
  }</p></article>`;
}

function reportCard(r: ReportView): string {
  const facts = [
    r.actual !== null ? `Avance ${pct(r.actual)}${r.expected !== null ? ` (esperado ${pct(r.expected)})` : ""}` : "",
    r.finished ? `Terminadas: ${r.finished}` : "",
    r.arrived ? `Llegó: ${r.arrived}` : "",
    r.notArrived ? `No llegó: ${r.notArrived}` : "",
    r.next ? `Para continuar: ${r.next}` : "",
  ].filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join("");
  return `<article class="report"><p><b>${esc(shortDate(r.date))}</b>${r.time ? ` · ${esc(r.time)}` : ""}${
    r.by ? ` · ${esc(r.by)}` : ""
  }</p>${r.summary ? `<p>${esc(r.summary)}</p>` : ""}${facts ? `<ul class="list">${facts}</ul>` : ""}${
    r.text ? `<details><summary>Reporte completo</summary><p class="pre">${esc(r.text)}</p></details>` : ""
  }</article>`;
}

function photosSection(d: Dashboard): string {
  const counts = Object.entries(PAIR_BADGE).map(([state, [kind, label]]) => {
    const n = d.pairs.filter((p) => p.state === state).length;
    return n ? badge(kind, `${label}: ${n}`) : "";
  }).filter(Boolean).join(" ");
  const pairs = d.pairsError
    ? `<p>${badge("warning", "Drive")} ${esc(d.pairsError)}</p>`
    : d.pairs.length
    ? `<p class="legend">${counts}</p><div class="pairs">${d.pairs.map(pairCard).join("")}</div>`
    : `<p class="muted">Todavía no hay fotos ANTES.</p>`;
  const missing = d.missingBefore.length
    ? `<details><summary>${
      plural(d.missingBefore.length, "foto del catálogo sin ANTES", "fotos del catálogo sin ANTES")
    }</summary><ul class="list">${
      d.missingBefore.map((m) => `<li><b>${esc(m.code)}</b> ${esc(m.name)}</li>`).join("")
    }</ul></details>`
    : "";
  return `<section id="fotos">
<h2>Fotos y reportes</h2>
<h3>Antes y después</h3>
${pairs}
${missing}
<h3>Últimos reportes</h3>
${d.reports.length ? d.reports.map(reportCard).join("") : `<p class="muted">Todavía no hay reportes.</p>`}
</section>`;
}

// --- Estilos y script ---------------------------------------------------------------------
// Colores de la paleta de referencia (validada para daltonismo): azul para la serie, gris para lo esperado,
// los de estado con su ícono y su texto. Modo oscuro con sus propios pasos.

const CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--s1:#2a78d6;--track:#cde2fb;--pending:#9ec5f4;--good:#0ca30c;--warning:#fab219;--critical:#d03b3b;--off:#ecebe6}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--track:#0d366b;--pending:#1c5cab;--off:#262624}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:12px 16px 32px}
h1{font-size:20px;margin:4px 0}
h2{font-size:18px;margin:0 0 12px}
h3{font-size:15px;margin:20px 0 8px}
h4{font-size:14px;margin:12px 0 4px;color:var(--ink2)}
p{margin:6px 0}
a{color:var(--s1)}
small{display:block;color:var(--ink2);font-size:12px}
.sub{color:var(--ink2);margin:0}
.meta,.muted,footer{color:var(--muted);font-size:13px}
footer{margin-top:24px;text-align:center}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}
nav a{padding:6px 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);text-decoration:none;color:var(--ink);font-size:14px}
section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-top:14px}
.hero{display:flex;flex-direction:column;margin-bottom:12px}
.hero .value{font-size:48px;font-weight:600;line-height:1.1}
.label{font-size:13px;color:var(--ink2)}
.note{font-size:12px;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.tile{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--border);border-radius:10px}
.tile.wide{grid-column:1/-1}
.tile .value{font-size:22px;font-weight:600}
.chart{margin:16px 0 0}
.chart figcaption{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:14px;margin-bottom:6px}
.keys{display:flex;gap:12px;font-size:12px;color:var(--ink2)}
.key i{display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:5px;border-radius:1px}
.key.real i{background:var(--s1)}
.key.expected i{background:var(--muted)}
.plot{position:relative}
svg{display:block;width:100%;height:auto;max-width:560px;touch-action:pan-y}
svg text{font-size:11px;fill:var(--muted)}
svg text.end{fill:var(--ink2)}
svg text.strong{fill:var(--ink);font-weight:600}
.grid{stroke:var(--grid);stroke-width:1}
.axis{stroke:var(--axis);stroke-width:1}
.today,.cursor{stroke:var(--axis);stroke-width:1}
.expected{fill:none;stroke:var(--muted);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.real{fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.dot{fill:var(--s1);stroke:var(--surface);stroke-width:2}
.tip{position:absolute;top:0;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.12);pointer-events:none;white-space:nowrap}
.tip b{font-size:14px}
details{margin:8px 0}
summary{cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 6px;border-bottom:1px solid var(--grid);vertical-align:top}
th{color:var(--ink2);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
.list{margin:4px 0;padding-left:0;list-style:none}
.list li{margin:6px 0}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2);white-space:nowrap;margin-right:6px}
.badge i{width:9px;height:9px;border-radius:50%;background:var(--pending);flex:none}
.badge.good i{background:var(--good)}
.badge.critical i{background:var(--critical)}
.badge.warning i{background:var(--warning)}
.badge.active i{background:var(--s1)}
.badge.off i{border-radius:2px;background:var(--off)}
.legend{display:flex;flex-wrap:wrap;gap:4px 8px;margin:4px 0 8px}
.week{border-top:1px solid var(--grid);padding-top:6px}
.gantt{margin-top:6px}
.g-row{display:grid;grid-template-columns:minmax(0,1fr) repeat(6,22px);gap:2px;align-items:center;padding:3px 0}
.g-head{font-size:11px;color:var(--muted);text-align:center;line-height:1.2}
.g-name{font-size:13px;padding-right:6px;overflow-wrap:anywhere}
.g-cell{height:16px;border-radius:4px;background:transparent}
.g-cell.off{background:var(--off)}
.g-cell.on{background:var(--pending)}
.g-cell.on.good{background:var(--good)}
.g-cell.on.critical{background:var(--critical)}
.g-cell.on.active{background:var(--s1)}
.g-cell.tentative{opacity:.5}
.rows{list-style:none;margin:0;padding:0}
.rows li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--grid)}
.rows li>div{min-width:0;overflow-wrap:anywhere}
.rows li>b{text-align:right;white-space:nowrap}
.rows li>b small{font-weight:400}
.rows .badge{margin-top:4px}
.bars{display:flex;flex-direction:column;gap:10px}
.bar-label{display:flex;justify-content:space-between;gap:8px;font-size:13px}
.bar-label b{white-space:nowrap;text-align:right}
.meter{height:8px;border-radius:4px;background:var(--track);margin-top:3px;overflow:hidden}
.meter .fill{height:100%;border-radius:4px;background:var(--s1)}
.meter .fill.over{background:var(--critical)}
input[type=search]{width:100%;padding:9px 12px;font:inherit;border:1px solid var(--border);border-radius:8px;background:var(--page);color:var(--ink)}
.pairs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.pair{border:1px solid var(--border);border-radius:10px;padding:8px}
.photos{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.photos figure{margin:0;position:relative}
.photos img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;display:block;background:var(--off)}
.photos figcaption{position:absolute;left:4px;top:4px;font-size:10px;background:rgba(0,0,0,.55);color:#fff;padding:1px 5px;border-radius:4px}
.photos .empty span{display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;border-radius:6px;background:var(--off);color:var(--muted);font-size:12px}
.report{border-top:1px solid var(--grid);padding-top:8px;margin-top:8px}
.pre{white-space:pre-wrap;font-size:13px}
`;

// Cursor y cuadro de la curva (toque o mouse; con el teclado, flechas) y el buscador de productos.
const SCRIPT = `
(function () {
  var svg = document.getElementById('curva');
  if (svg) {
    var pts = JSON.parse(svg.getAttribute('data-puntos'));
    var ax = JSON.parse(svg.getAttribute('data-ejes'));
    var cursor = document.getElementById('curva-cursor');
    var tip = document.getElementById('curva-tip');
    var current = ax.start;
    var line = function (label, value, strong) {
      var row = document.createElement('div');
      var b = document.createElement(strong ? 'b' : 'span');
      b.textContent = value;
      row.appendChild(b);
      row.appendChild(document.createTextNode(' ' + label));
      tip.appendChild(row);
    };
    var show = function (i) {
      current = Math.max(0, Math.min(pts.length - 1, i));
      var p = pts[current];
      var x = ax.left + current * ax.step;
      cursor.setAttribute('x1', x);
      cursor.setAttribute('x2', x);
      cursor.setAttribute('visibility', 'visible');
      tip.textContent = '';
      var day = document.createElement('div');
      day.textContent = p.l;
      tip.appendChild(day);
      if (p.a !== null) line('real', p.a + ' %', true);
      line('esperado', p.e + ' %', p.a === null);
      tip.hidden = false;
      var r = svg.getBoundingClientRect();
      tip.style.left = Math.max(48, Math.min(r.width - 48, x * r.width / ax.w)) + 'px';
    };
    var fromPointer = function (ev) {
      var r = svg.getBoundingClientRect();
      show(Math.round(((ev.clientX - r.left) * ax.w / r.width - ax.left) / ax.step));
    };
    var hide = function () {
      cursor.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    svg.addEventListener('pointermove', fromPointer);
    svg.addEventListener('pointerdown', fromPointer);
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', function () { show(current); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') show(current - 1);
      if (ev.key === 'ArrowRight') show(current + 1);
    });
  }
  var box = document.getElementById('buscar');
  var total = document.getElementById('productos-total');
  if (box) {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#productos li'));
    var norm = function (s) {
      return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, ' ').trim();
    };
    var pesos = function (n) {
      return '$' + String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
    };
    box.addEventListener('input', function () {
      var q = norm(box.value);
      var n = 0;
      var sum = 0;
      rows.forEach(function (row) {
        var show = q === '' || row.getAttribute('data-q').indexOf(q) !== -1;
        row.hidden = !show;
        if (show) {
          n += 1;
          sum += Number(row.getAttribute('data-v'));
        }
      });
      total.textContent = n + (n === 1 ? ' producto' : ' productos') + ' · ' + pesos(sum);
    });
  }
})();
`;
