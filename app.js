/* 123watersport omzetdashboard — leest dash_*-tabellen uit Supabase (achter login). */
const { SUPABASE_URL, SUPABASE_KEY } = window.DASH_CONFIG;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let BASIS = "incl"; // incl | excl
let lastRows = [];
let sortKey = "date", sortDir = -1;
let currentView = "overview";
let prodRows = [];               // geaggregeerd per product
let prodSortKey = "omzet", prodSortDir = -1;
let prodSearch = "";             // zoekterm productpagina
const lineCache = {};            // product_id -> order_lines (drill-down)

// ── formatting (NL) ────────────────────────────────────────────────
const eur = (v) => "€ " + (Number(v) || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => (Number(v) || 0).toLocaleString("nl-NL");
const pctTxt = (v) => (Number(v) || 0).toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const iso = (d) => d.toISOString().slice(0, 10);

// ── auth ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp(); else showLogin();
  sb.auth.onAuthStateChange((_e, s) => (s ? showApp() : showLogin()));
}

function showLogin() { $("login").classList.remove("hidden"); $("app").classList.add("hidden"); }
function showApp() { $("login").classList.add("hidden"); $("app").classList.remove("hidden"); loadCurrent(); }

// ── tabs / views ───────────────────────────────────────────────────
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    currentView = b.dataset.view;
    $("view-overview").classList.toggle("hidden", currentView !== "overview");
    $("view-products").classList.toggle("hidden", currentView !== "products");
    loadCurrent();
  })
);

function loadCurrent() { return currentView === "products" ? loadProducts() : loadOverview(); }
function rerender() { return currentView === "products" ? renderProducts() : render(); }

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-err").textContent = "";
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value,
    password: $("password").value,
  });
  if (error) $("login-err").textContent = "Inloggen mislukt: " + error.message;
});
$("logout").addEventListener("click", () => sb.auth.signOut());
$("prod-search").addEventListener("input", (e) => { prodSearch = e.target.value; renderProducts(); });

// ── periode ────────────────────────────────────────────────────────
function range() {
  const preset = $("preset").value;
  const end = new Date();
  let start = new Date();
  if (preset === "custom") {
    return { start: $("start").value, end: $("end").value };
  } else if (preset === "today") {
    /* start = end = vandaag (default) */
  } else if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "month") {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  } else {
    start.setDate(end.getDate() - (parseInt(preset, 10) - 1));
  }
  return { start: iso(start), end: iso(end) };
}

$("preset").addEventListener("change", () => {
  const custom = $("preset").value === "custom";
  $("start").classList.toggle("hidden", !custom);
  $("end").classList.toggle("hidden", !custom);
  if (custom) {
    const r = range();
    if (!$("start").value) $("start").value = r.start;
    if (!$("end").value) $("end").value = r.end;
  } else loadCurrent();
});
$("start").addEventListener("change", loadCurrent);
$("end").addEventListener("change", loadCurrent);

document.querySelectorAll("#btw button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#btw button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    BASIS = b.dataset.basis;
    Object.keys(lineCache).forEach((k) => delete lineCache[k]); // varianten herrekenen
    rerender();
  })
);

// ── data laden ─────────────────────────────────────────────────────
async function fetchDaily(start, end) {
  const { data, error } = await sb
    .from("dash_daily_metrics").select("*")
    .gte("date", start).lte("date", end).order("date");
  if (error) { console.error(error); return []; }
  return data;
}

async function loadOverview() {
  const { start, end } = range();
  if (!start || !end) return;
  $("kpis").innerHTML = '<div class="loading">Laden…</div>';

  // huidige + vorige periode (zelfde lengte) voor delta's
  const days = Math.round((new Date(end) - new Date(start)) / 86400000);
  const pEnd = new Date(new Date(start) - 86400000);
  const pStart = new Date(pEnd - days * 86400000);
  const [cur, prev, meta] = await Promise.all([
    fetchDaily(start, end),
    fetchDaily(iso(pStart), iso(pEnd)),
    sb.from("dash_meta").select("*").eq("key", "last_refresh").maybeSingle(),
  ]);
  lastRows = cur;
  window._prev = prev;
  if (meta.data?.value) {
    const t = new Date(meta.data.value);
    $("refreshed").textContent = "Laatst bijgewerkt: " + t.toLocaleString("nl-NL");
  }
  render();
}

// ── totalen + render ───────────────────────────────────────────────
function totals(rows) {
  const rev = (r) => Number(BASIS === "incl" ? r.revenue_incl : r.revenue_excl);
  const ret = (r) => Number(BASIS === "incl" ? r.returns_value_incl : r.returns_value_excl);
  const t = { omzet: 0, adspend: 0, ad_omzet: 0, retour: 0, orders: 0, retouren: 0 };
  rows.forEach((r) => {
    t.omzet += rev(r); t.adspend += Number(r.ad_cost); t.ad_omzet += Number(r.ad_revenue);
    t.retour += ret(r); t.orders += Number(r.orders); t.retouren += Number(r.returns_count);
  });
  t.roas = t.adspend ? t.ad_omzet / t.adspend : 0;
  t.netto = t.omzet - t.retour;
  t.aov = t.orders ? t.omzet / t.orders : 0;
  return t;
}

function deltaHtml(cur, prev, inverse) {
  if (!prev) return '<div class="delta flat">—</div>';
  const pct = ((cur - prev) / prev) * 100;
  const up = pct >= 0;
  const good = inverse ? !up : up;
  const cls = Math.abs(pct) < 0.05 ? "flat" : good ? "up" : "down";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
  return `<div class="delta ${cls}">${arrow} ${Math.abs(pct).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}% vs vorige</div>`;
}

function render() {
  if (!lastRows) return;
  const c = totals(lastRows), p = totals(window._prev || []);
  const cards = [
    ["Omzet (totaal)", eur(c.omzet), c.omzet, p.omzet, false],
    ["Adspend", eur(c.adspend), c.adspend, p.adspend, true],
    ["Ad-omzet", eur(c.ad_omzet), c.ad_omzet, p.ad_omzet, false],
    ["Orders", num(c.orders), c.orders, p.orders, false],
    ["Gem. orderwaarde", eur(c.aov), c.aov, p.aov, false],
    ["Retouren", num(c.retouren), c.retouren, p.retouren, true],
    ["Netto omzet", eur(c.netto), c.netto, p.netto, false],
  ];
  $("kpis").innerHTML = cards.map(([label, val, cv, pv, inv]) =>
    `<div class="kpi"><div class="label">${label}</div><div class="value">${val}</div>${deltaHtml(cv, pv, inv)}</div>`
  ).join("");
  renderChart();
  renderTable();
}

let chart;
function renderChart() {
  const rev = (r) => Number(BASIS === "incl" ? r.revenue_incl : r.revenue_excl);
  const labels = lastRows.map((r) => r.date);
  const ctx = $("chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Omzet", data: lastRows.map(rev), backgroundColor: "#2563eb" },
        { type: "bar", label: "Ad-omzet", data: lastRows.map((r) => Number(r.ad_revenue)), backgroundColor: "#16a34a" },
        { type: "bar", label: "Adspend", data: lastRows.map((r) => Number(r.ad_cost)), backgroundColor: "#f59e0b" },
      ],
    },
    options: {
      responsive: true, interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "top" } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "€" } },
      },
    },
  });
}

const COLS = [
  ["date", "Datum", (r) => r.date, false],
  ["orders", "Orders", (r) => num(r.orders), true],
  ["omzet", "Omzet", (r) => eur(BASIS === "incl" ? r.revenue_incl : r.revenue_excl), true],
  ["ad_cost", "Adspend", (r) => eur(r.ad_cost), true],
  ["ad_revenue", "Ad-omzet", (r) => eur(r.ad_revenue), true],
  ["returns_count", "Retouren", (r) => num(r.returns_count), true],
  ["netto", "Netto omzet", (r) => eur((BASIS === "incl" ? r.revenue_incl : r.revenue_excl) - (BASIS === "incl" ? r.returns_value_incl : r.returns_value_excl)), true],
];

function sortVal(r, key) {
  if (key === "omzet") return Number(BASIS === "incl" ? r.revenue_incl : r.revenue_excl);
  if (key === "roas") return Number(r.ad_cost) ? r.ad_revenue / r.ad_cost : 0;
  if (key === "netto") return (BASIS === "incl" ? r.revenue_incl : r.revenue_excl) - (BASIS === "incl" ? r.returns_value_incl : r.returns_value_excl);
  if (key === "date") return r.date;
  return Number(r[key]);
}

function renderTable() {
  const thead = document.querySelector("#daily thead");
  const tbody = document.querySelector("#daily tbody");
  thead.innerHTML = "<tr>" + COLS.map(([k, label]) =>
    `<th data-k="${k}">${label}${sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr>";
  thead.querySelectorAll("th").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
      renderTable();
    }));
  const rows = [...lastRows].sort((a, b) => {
    const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
    return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
  });
  tbody.innerHTML = rows.map((r) =>
    "<tr>" + COLS.map(([, , fn]) => `<td>${fn(r)}</td>`).join("") + "</tr>").join("");
}

// ── Omzet per product ──────────────────────────────────────────────
async function loadProducts() {
  const { start, end } = range();
  if (!start || !end) return;
  $("prod-kpis").innerHTML = '<div class="loading">Laden…</div>';
  const { data, error } = await sb.from("dash_product_daily").select("*").gte("date", start).lte("date", end);
  if (error) console.error(error);
  const map = {};
  (data || []).forEach((r) => {
    const m = map[r.product_id] || (map[r.product_id] = {
      product_id: r.product_id, title: r.product_title, path: r.product_path, ean: r.ean || "",
      qty: 0, orders: 0, sessions: 0, revenue_incl: 0, revenue_excl: 0,
    });
    m.qty += +r.qty; m.orders += +r.orders; m.sessions += +(r.sessions || 0);
    m.revenue_incl += +r.revenue_incl; m.revenue_excl += +r.revenue_excl;
    if (!m.title && r.product_title) m.title = r.product_title;
    if (!m.path && r.product_path) m.path = r.product_path;
    if (!m.ean && r.ean) m.ean = r.ean;
  });
  prodRows = Object.values(map);
  prodRows.forEach((r) => (r.conv = r.sessions ? (r.orders / r.sessions) * 100 : null));
  renderProducts();
}

function prodRev(r) { return Number(BASIS === "incl" ? r.revenue_incl : r.revenue_excl); }

function convCell(r) {
  if (r.conv == null) return '<span class="conv na">—</span>';
  const cls = r.conv >= 4 ? "hi" : r.conv >= 1.5 ? "mid" : "lo";
  return `<span class="conv ${cls}">${r.conv.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>`;
}
function shareCell(r, totaal) {
  const pct = totaal ? prodRev(r) / totaal * 100 : 0;
  return `<div class="share"><span class="pct">${pct.toFixed(1)}%</span><span class="bar"><span style="width:${Math.min(pct, 100)}%"></span></span></div>`;
}

function renderProducts() {
  const totaal = prodRows.reduce((s, r) => s + prodRev(r), 0);
  const totQty = prodRows.reduce((s, r) => s + Number(r.qty), 0);
  const totSess = prodRows.reduce((s, r) => s + Number(r.sessions), 0);
  const totOrd = prodRows.reduce((s, r) => s + Number(r.orders), 0);
  const avgConv = totSess ? (totOrd / totSess * 100) : null;
  $("prod-kpis").innerHTML = [
    ["Productomzet", eur(totaal)], ["Producten", num(prodRows.length)],
    ["Stuks verkocht", num(totQty)],
    ["Gem. conversie", avgConv == null ? "—" : avgConv.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"],
  ].map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");

  const L = "left";
  const cols = [
    ["title", "Product", (r) => `<span class="pname">${r.title || ("Product " + r.product_id)}</span>`, L],
    ["ean", "EAN", (r) => `<span class="ean">${r.ean || "—"}</span>`, L],
    ["qty", "Aantal", (r) => num(r.qty)],
    ["orders", "Orders", (r) => num(r.orders)],
    ["sessions", "Sessies", (r) => num(r.sessions)],
    ["conv", "Conversie", (r) => convCell(r)],
    ["omzet", "Omzet", (r) => eur(prodRev(r))],
    ["aandeel", "Aandeel", (r) => shareCell(r, totaal)],
  ];
  const thead = document.querySelector("#products thead");
  const tbody = document.querySelector("#products tbody");
  thead.innerHTML = "<tr><th></th>" + cols.map(([k, l, , al]) =>
    `<th data-k="${k}" style="text-align:${al === L ? "left" : "right"}">${l}${prodSortKey === k ? (prodSortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr>";
  thead.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (prodSortKey === k) prodSortDir *= -1; else { prodSortKey = k; prodSortDir = -1; }
    renderProducts();
  }));
  const sv = (r, k) => {
    if (k === "omzet" || k === "aandeel") return prodRev(r);
    if (k === "title") return (r.title || "").toLowerCase();
    if (k === "ean") return r.ean || "";
    if (k === "conv") return r.conv == null ? -1 : r.conv;
    return Number(r[k]);
  };
  const q = prodSearch.trim().toLowerCase();
  let rows = q ? prodRows.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.ean || "").includes(q)) : prodRows;
  rows = [...rows].sort((a, b) => {
    const va = sv(a, prodSortKey), vb = sv(b, prodSortKey);
    return (va > vb ? 1 : va < vb ? -1 : 0) * prodSortDir;
  });
  tbody.innerHTML = rows.map((r) =>
    `<tr class="prow" data-pid="${r.product_id}"><td><span class="caret">▸</span></td>` +
    cols.map(([, , fn, al]) => `<td style="text-align:${al === L ? "left" : "right"}">${fn(r)}</td>`).join("") + "</tr>").join("");
  tbody.querySelectorAll("tr.prow").forEach((tr) => tr.addEventListener("click", () => toggleProduct(tr)));
}

async function fetchLines(pid) {
  if (lineCache[pid]) return lineCache[pid];
  const { start, end } = range();
  const { data } = await sb.from("dash_order_lines").select("*")
    .eq("product_id", pid).gte("date", start).lte("date", end).order("date", { ascending: false });
  lineCache[pid] = data || [];
  return lineCache[pid];
}

async function toggleProduct(tr) {
  const pid = tr.dataset.pid;
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("detail")) { next.remove(); tr.querySelector(".caret").textContent = "▸"; return; }
  tr.querySelector(".caret").textContent = "▾";
  const detail = document.createElement("tr");
  detail.className = "detail";
  detail.innerHTML = `<td colspan="${tr.children.length}"><div class="detail-inner">Laden…</div></td>`;
  tr.after(detail);
  const lines = await fetchLines(pid);
  detail.querySelector(".detail-inner").innerHTML = detailHtml(pid, lines);
}

function detailHtml(pid, lines) {
  const prod = prodRows.find((p) => String(p.product_id) === String(pid)) || {};
  const vmap = {};
  lines.forEach((l) => {
    const k = l.variant_title || "—";
    const v = vmap[k] || (vmap[k] = { variant: k, qty: 0, rev: 0 });
    v.qty += Number(l.qty); v.rev += prodRev(l);
  });
  const variants = Object.values(vmap).sort((a, b) => b.rev - a.rev);
  const varTable = (variants.length > 1 || (variants[0] && variants[0].variant !== "—"))
    ? `<h4>Per variant</h4><table><thead><tr><th style="text-align:left">Variant</th><th>Aantal</th><th>Omzet</th></tr></thead><tbody>` +
      variants.map((v) => `<tr><td style="text-align:left">${v.variant}</td><td>${num(v.qty)}</td><td>${eur(v.rev)}</td></tr>`).join("") + `</tbody></table>`
    : "";
  const pathHtml = prod.path ? `<div class="path">🔗 Productpad: <code>${prod.path}</code></div>` : "";
  const orders = `<h4>Orders met dit product (${lines.length})</h4><table><thead><tr><th style="text-align:left">Order</th><th>Datum</th><th style="text-align:left">Klant</th><th>Aantal</th><th>Omzet</th></tr></thead><tbody>` +
    lines.map((l) => `<tr><td style="text-align:left">${l.order_number || l.order_id}</td><td>${l.date}</td><td style="text-align:left">${l.customer_name || ""}</td><td>${num(l.qty)}</td><td>${eur(prodRev(l))}</td></tr>`).join("") + `</tbody></table>`;
  return pathHtml + varTable + orders;
}

init();
