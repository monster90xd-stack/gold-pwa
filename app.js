/* GCC Gold PWA
 * Gold (USD/oz): metalpriceapi.com latest (USDXAU)
 * FX (USD->target + timeseries): exchangerate.host (no key)
 * Chart: last 30 days gold stored locally (1 point/day) and converted using FX timeseries.
 *
 * "Live": auto-refresh every 60s (adjust or disable below).
 */

const METALPRICE_API_KEY = "c04d99f9ac2f233a87135f316bbc2d90";
const TROY_OUNCE_GRAMS = 31.1034768;

const GCC = [
  { code: "AED", name: "UAE Dirham", flag: "🇦🇪" },
  { code: "SAR", name: "Saudi Riyal", flag: "🇸🇦" },
  { code: "KWD", name: "Kuwaiti Dinar", flag: "🇰🇼" },
  { code: "QAR", name: "Qatari Riyal", flag: "🇶🇦" },
  { code: "BHD", name: "Bahraini Dinar", flag: "🇧🇭" },
  { code: "OMR", name: "Omani Rial", flag: "🇴🇲" }
];

const CURRENCIES = [{ code: "USD", name: "US Dollar", flag: "🇺🇸" }, ...GCC];

const state = {
  currency: localStorage.getItem("currency") || "USD",
  karat: Number(localStorage.getItem("karat") || 24),

  // current 24K per gram in selected currency
  price24PerGram: Number(localStorage.getItem("price24PerGram") || 0),

  // gold daily points stored in USD/gram (24K): [{date, usdPerGram24}]
  goldUsdHistory: JSON.parse(localStorage.getItem("goldUsdHistory") || "[]"),

  lastUpdated: localStorage.getItem("lastUpdated") || ""
};

const $ = (id) => document.getElementById(id);
let chart;

function persist() {
  localStorage.setItem("currency", state.currency);
  localStorage.setItem("karat", String(state.karat));
  localStorage.setItem("price24PerGram", String(state.price24PerGram || 0));
  localStorage.setItem("goldUsdHistory", JSON.stringify(state.goldUsdHistory || []));
  localStorage.setItem("lastUpdated", state.lastUpdated || "");
}

function fmtMoney(value, currency) {
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function yyyyMmDd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lastNDaysRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { start: yyyyMmDd(start), end: yyyyMmDd(end) };
}

function karatFactor(k) { return k / 24; }

function pricePerGramSelectedKarat() {
  return (state.price24PerGram || 0) * karatFactor(state.karat);
}

function upsertGoldUsdPoint(dateStr, usdPerGram24) {
  const arr = Array.isArray(state.goldUsdHistory) ? state.goldUsdHistory : [];
  const idx = arr.findIndex(p => p.date === dateStr);
  const point = { date: dateStr, usdPerGram24 };
  if (idx >= 0) arr[idx] = point;
  else arr.push(point);
  arr.sort((a, b) => a.date.localeCompare(b.date));
  state.goldUsdHistory = arr.slice(-90);
}

function setActiveKaratButtons() {
  document.querySelectorAll(".karat-btn").forEach((btn) => {
    const k = Number(btn.dataset.karat);
    btn.classList.toggle("active", k === state.karat);
  });
  $("karatLabel") && ($("karatLabel").textContent = String(state.karat));
  $("calcKaratLabel") && ($("calcKaratLabel").textContent = String(state.karat));
}

function showView(which) {
  const views = { home: $("viewHome"), calc: $("viewCalc"), currency: $("viewCurrency") };
  Object.values(views).forEach(v => v?.classList.remove("view-active"));
  views[which]?.classList.add("view-active");
}

function updateTotal() {
  const gramsEl = $("gramsInput");
  const totalEl = $("totalLabel");
  if (!gramsEl || !totalEl) return;

  const grams = Number(String(gramsEl.value || "").replace(",", "."));
  if (!Number.isFinite(grams) || grams <= 0) {
    totalEl.textContent = "—";
    return;
  }
  totalEl.textContent = fmtMoney(grams * pricePerGramSelectedKarat(), state.currency);
}

function applyUI() {
  $("currencyLabel") && ($("currencyLabel").textContent = state.currency);
  $("calcCurrencyLabel") && ($("calcCurrencyLabel").textContent = state.currency);

  $("pricePerGramLabel") && ($("pricePerGramLabel").textContent = fmtMoney(pricePerGramSelectedKarat(), state.currency));
  $("calcPricePerGramLabel") && ($("calcPricePerGramLabel").textContent = fmtMoney(pricePerGramSelectedKarat(), state.currency));

  $("updatedLabel") && ($("updatedLabel").textContent = state.lastUpdated || "—");

  setActiveKaratButtons();
  updateTotal();
  renderCurrencyList();
}

function renderCurrencyList() {
  const list = $("currencyList");
  if (!list) return;
  list.innerHTML = "";

  CURRENCIES.forEach((c) => {
    const row = document.createElement("button");
    row.className = "currency-item";
    row.type = "button";
    row.innerHTML = `
      <span class="currency-flag">${c.flag}</span>
      <span class="currency-code">${c.code}</span>
      <span class="currency-name">${c.name}</span>
      <span class="currency-check">${c.code === state.currency ? "✓" : ""}</span>
    `;
    row.addEventListener("click", async () => {
      state.currency = c.code;
      persist();
      applyUI();
      await refreshAll();
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelector('.tab[data-tab="home"]')?.classList.add("active");
      showView("home");
    });
    list.appendChild(row);
  });
}

/* ---- FX: exchangerate.host ----
 * latest: /latest?base=USD&symbols=AED,...
 * timeseries: /timeseries?base=USD&symbols=AED,...&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
async function fetchFxLatestUsdTo(symbolsCsv) {
  const url = `https://api.exchangerate.host/latest?base=USD&symbols=${encodeURIComponent(symbolsCsv)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX latest error ${res.status}`);
  return res.json(); // { rates: { AED: ... } }
}

async function fetchFxTimeseriesUsdTo({ start, end }, symbolsCsv) {
  const url =
    `https://api.exchangerate.host/timeseries` +
    `?base=USD` +
    `&symbols=${encodeURIComponent(symbolsCsv)}` +
    `&start_date=${encodeURIComponent(start)}` +
    `&end_date=${encodeURIComponent(end)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX timeseries error ${res.status}`);
  return res.json(); // { rates: { YYYY-MM-DD: { AED: ... } } }
}

/* ---- Gold: MetalpriceAPI ----
   USDXAU = USD per 1 XAU (troy ounce)
*/
async function fetchGoldUsdPerOunce() {
  const url =
    "https://api.metalpriceapi.com/v1/latest" +
    `?api_key=${encodeURIComponent(METALPRICE_API_KEY)}` +
    "&base=USD&currencies=EUR,XAU,XAG";

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MetalpriceAPI error ${res.status}: ${text}`);
  }
  const json = await res.json();
  const usdXau = json?.rates?.USDXAU;

  if (!Number.isFinite(usdXau) || usdXau <= 0) throw new Error("Missing/invalid USDXAU from MetalpriceAPI");
  return usdXau;
}

/* ---- Chart ---- */
function renderChart(historyConverted) {
  const canvas = $("priceChart");
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    console.warn("Chart.js is not loaded; chart will not render.");
    return;
  }

  const labels = historyConverted.map(p => p.label);
  const data = historyConverted.map(p => p.value);

  const ctx = canvas.getContext("2d");
  const datasetLabel = `${state.karat}K (${state.currency})`;

  if (!chart) {
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: datasetLabel,
          data,
          borderColor: "rgba(110,231,255,0.95)",
          backgroundColor: "rgba(110,231,255,0.12)",
          tension: 0.25,
          fill: true,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#e8eefc" } },
          tooltip: { callbacks: { label: (c) => fmtMoney(c.parsed.y, state.currency) } }
        },
        scales: {
          x: { ticks: { color: "#9bb0d4" }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "#9bb0d4" }, grid: { color: "rgba(255,255,255,0.06)" } }
        }
      }
    });
  } else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].label = datasetLabel;
    chart.update();
  }
}

async function refreshAll() {
  const btn = $("btnRefresh");
  try {
    if (btn) btn.textContent = "Refreshing...";

    // 1) Gold current USD/oz -> USD/g
    const usdPerOunce = await fetchGoldUsdPerOunce();
    const usdPerGram24 = usdPerOunce / TROY_OUNCE_GRAMS;

    // store today's USD point for chart
    const today = yyyyMmDd(new Date());
    upsertGoldUsdPoint(today, usdPerGram24);

    // 2) FX latest for current conversion
    const symbols = GCC.map(x => x.code).join(",");
    const fxLatest = await fetchFxLatestUsdTo(symbols);

    const usdToTargetNow = state.currency === "USD" ? 1 : fxLatest?.rates?.[state.currency];
    if (!Number.isFinite(usdToTargetNow) || usdToTargetNow <= 0) {
      throw new Error(`FX rate missing for ${state.currency}`);
    }

    state.price24PerGram = usdPerGram24 * usdToTargetNow;

    // 3) FX timeseries for chart conversion
    const { start, end } = lastNDaysRange(30);
    const fxTs = await fetchFxTimeseriesUsdTo({ start, end }, symbols);

    const factor = karatFactor(state.karat);
    const history = (state.goldUsdHistory || []).slice(-30);

    const converted = history
      .map(p => {
        const day = fxTs?.rates?.[p.date];
        const rate = state.currency === "USD" ? 1 : day?.[state.currency];
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return { label: p.date.slice(5), value: p.usdPerGram24 * rate * factor };
      })
      .filter(Boolean);

    renderChart(converted);

    state.lastUpdated = new Date().toLocaleString();
    persist();
    applyUI();
  } catch (e) {
    console.error(e);
    alert(String(e?.message || e));
  } finally {
    if (btn) btn.textContent = "Refresh";
  }
}

function bindEvents() {
  // Tabs
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      showView(t.dataset.tab);
    });
  });

  // Currency shortcut
  $("btnCurrency")?.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelector('.tab[data-tab="currency"]')?.classList.add("active");
    showView("currency");
  });

  $("btnRefresh")?.addEventListener("click", refreshAll);

  // Karat
  document.querySelectorAll(".karat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = Number(btn.dataset.karat);
      if (![18, 21, 22, 24].includes(k)) return;
      state.karat = k;
      persist();
      applyUI();
      refreshAll();
    });
  });

  // Calculator
  $("gramsInput")?.addEventListener("input", updateTotal);
}

(function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
  bindEvents();
  applyUI();
  refreshAll();

  // "Live-ish" update every 60s. Increase interval if you want fewer API calls.
  setInterval(() => refreshAll().catch(() => {}), 60_000);
})();
