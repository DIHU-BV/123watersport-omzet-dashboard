/* 123watersport omzetdashboard — leest dash_*-tabellen uit Supabase (achter login). */
const { SUPABASE_URL, SUPABASE_KEY } = window.DASH_CONFIG;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let BASIS = "incl"; // incl | excl
let lastRows = [];
let sortKey = "date", sortDir = -1;

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
function showApp() { $("login").classList.add("hidden"); $("app").classList.remove("hidden"); load(); }

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

// ── periode ────────────────────────────────────────────────────────
function range() {
  const preset = $("preset").value;
  const end = new Date();
  let start = new Date();
  if (preset === "custom") {
    return { start: $("start").value, end: $("end").value };
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
  } else load();
});
$("start").addEventListener("change", load);
$("end").addEventListener("change", load);

document.querySelectorAll("#btw button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#btw button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    BASIS = b.dataset.basis;
    render();
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

async function load() {
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
    ["ROAS (ads)", c.adspend ? c.roas.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×" : "—", c.roas, p.roas, false],
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
        { type: "line", label: "ROAS", yAxisID: "y1", data: lastRows.map((r) => Number(r.ad_cost) ? Number(r.ad_revenue) / Number(r.ad_cost) : 0), borderColor: "#7c3aed", borderWidth: 2, tension: .3, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true, interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "top" } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "€" } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "ROAS ×" } },
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
  ["roas", "ROAS", (r) => (Number(r.ad_cost) ? (r.ad_revenue / r.ad_cost).toFixed(2) + "×" : "—"), true],
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

init();
