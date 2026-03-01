/* GCC Gold PWA (No GoldAPI)
 * - Gold spot USD/oz: metalpriceapi.com (USDXAU)
 * - FX daily series: frankfurter.app (EUR base, convert to USD->target)
 * - Gold daily history: stored locally (1 point/day when you refresh)
 *
 * Requirements in index.html:
 * - elements: btnRefresh, btnCurrency, currencyLabel, pricePerGramLabel, updatedLabel
 * - calculator: gramsInput, totalLabel, calcPricePerGramLabel
 * - views: viewHome, viewCalc, viewCurrency
 * - chart: canvas#priceChart (Chart.js optional)
 * - karat buttons: .karat-btn[data-karat]
 * - currency list container: currencyList
 */

const METALPRICE_API_KEY = "c04d99f9ac2f233a87135f316bbc2d90";

const DEFAULTS = { currency: "USD", karat: 24 };
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
  currency: localStorage.getItem("currency") || DEFAULTS.currency,
  karat: Number(localStorage.getItem("karat") || DEFAULTS.karat),
  // current 24K price per gram in selected currency
  price24PerGram: Number(localStorage.getItem("price24PerGram") || 0),
  // stored gold history in USD per gram 24K: [{date:"YYYY-MM-DD", usdPerGram24:number}]
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
  const kl = $("karatLabel");
  const ckl = $("calcKaratLabel");
  if (kl) kl.textContent = String(state.karat);
  if (ckl) ckl.textContent = String(state.karat);
}

function showView(which) {
  const map = {
    home: $("viewHome"),
    calc: $("viewCalc"),
    currency: $("viewCurrency")
  };
  Object.values(map).forEach(v => v?.classList.remove("view-active"));
  map[which]?.classList.add("view-active");
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
  $("pricePerGramLabel") && ($("pricePerGramLabel").textContent = fmtMoney(pricePerGramSelectedKarat(), state.currency));
  $("updatedLabel") && ($("updatedLabel").textContent = state.lastUpdated || "—");

  $("calcPricePerGramLabel") && ($("calcPricePerGramLabel").textContent = fmtMoney(pricePerGramSelectedKarat(), state.currency));

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
      await refreshAll(); // update current price + chart conversion
      showView("home");
    });
    list.appendChild(row);
  });
}

/* ---- FX: Frankfurter ----
 * API is EUR-based: we fetch EUR->USD and EUR->TARGET.
 * Then USD->TARGET = (EUR->TARGET) / (EUR->USD)
 */
async function fetchFrankfurterSeries({ start, end }, symbolsCsv) {
  const url = `https://api.frankfurter.app/${start}..${end}?from=EUR&to=${encodeURIComponent(symbolsCsv)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX error ${res.status}`);
  return res.json(); // { rates: { YYYY-MM-DD: { USD:..., AED:... } } }
}

function fxUsdToTargetOnDate(ratesByDate, date, target) {
  if (target === "USD") return 1;
  const day = ratesByDate?.[date];
  if (!day) return null;

  const eurToUsd = day["USD"];
  const eurToT = day[target];
  if (!Number.isFinite(eurToUsd) || !Number.isFinite(eurToT)) return null;

  return eurToT / eurToUsd;
}

/* ---- Gold: MetalpriceAPI ----
 * You already confirmed response like:
 * rates: { USDXAU: 5177.30, XAU: 0.000193... }
 * USDXAU == USD per 1 XAU (troy ounce)
 */
async function fetchGoldUsdPerOunce() {
  const url =
    "https://api.metalpriceapi.com/v1/latest" +
    `?api_key=${encodeURIComponent(METALPRICE_API_KEY)}` +
    "&base=USD" +
    "&currencies=EUR,XAU,XAG";

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MetalpriceAPI error ${res.status}: ${text}`);
  }
  const json = await res.json();
  const usdXau = json?.rates?.USDXAU;

  if (!Number.isFinite(usdXau) || usdXau <= 0) {
    throw new Error("Missing/invalid USDXAU from MetalpriceAPI");
  }
  return usdXau;
}

function renderChart(historyConverted) {
  const canvas = $("priceChart");
  if (!canvas || typeof Chart === "undefined") return;

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
          tooltip: {
            callbacks: { label: (c) => fmtMoney(c.parsed.y, state.currency) }
          }
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

    // 1) gold current USD/oz -> USD/g
    const usdPerOunce = await fetchGoldUsdPerOunce();
    const usdPerGram24 = usdPerOunce / TROY_OUNCE_GRAMS;

    // store today's USD point
    const today = yyyyMmDd(new Date());
    upsertGoldUsdPoint(today, usdPerGram24);

    // 2) FX series for chart conversion + current conversion
    const { start, end } = lastNDaysRange(30);
    const symbols = ["USD", ...GCC.map(x => x.code)].join(",");
    const fx = await fetchFrankfurterSeries({ start, end }, symbols);

    const fxDates = Object.keys(fx.rates || {}).sort();
    const latestFxDate = fxDates[fxDates.length - 1];
    const usdToTargetNow = fxUsdToTargetOnDate(fx.rates, latestFxDate, state.currency) ?? 1;

    // 3) current selected currency price for 24K per gram
    state.price24PerGram = usdPerGram24 * usdToTargetNow;

    // 4) chart: convert stored gold points to selected currency using same-day FX
    const factor = karatFactor(state.karat);
    const history = (state.goldUsdHistory || []).slice(-30);

    const converted = history
      .map(p => {
        const rate = fxUsdToTargetOnDate(fx.rates, p.date, state.currency);
        if (!Number.isFinite(rate)) return null;
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
  // karat selection
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

  // navigation buttons if present
  $("btnCurrency")?.addEventListener("click", () => showView("currency"));

  // optional nav tabs: .tab[data-tab]
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      showView(t.dataset.tab);
    });
  });

  $("btnRefresh")?.addEventListener("click", refreshAll);
  $("gramsInput")?.addEventListener("input", updateTotal);
}

(function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
  bindEvents();
  applyUI();
  refreshAll();
})();
