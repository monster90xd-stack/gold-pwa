/**
 * Free-data mode (no GoldAPI):
 * - Gold spot (XAU/USD) current: metals.live (no key)
 * - FX rates/history: frankfurter.app (no key, daily)
 *
 * Note about 30-day chart:
 * - We store daily gold-usd points locally (1 point/day when refreshed).
 * - FX series is fetched for last 30 days and used to convert those points into selected currency.
 */

const DEFAULT_CURRENCY = "USD";
const DEFAULT_KARAT = 24;

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
  currency: localStorage.getItem("currency") || DEFAULT_CURRENCY,
  karat: Number(localStorage.getItem("karat") || DEFAULT_KARAT),

  // current 24k price per gram in selected currency
  price24PerGram: Number(localStorage.getItem("price24PerGram") || 0),

  // history points are stored as daily gold price in USD per gram:
  // [{ date: "YYYY-MM-DD", usdPerGram24: number }]
  goldUsdHistory: JSON.parse(localStorage.getItem("goldUsdHistory") || "[]"),

  lastUpdated: localStorage.getItem("lastUpdated") || ""
};

const $ = (id) => document.getElementById(id);
let chart;

function persistState() {
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

function karatFactor(k) { return k / 24; }
function currentPricePerGramSelectedKarat() {
  return state.price24PerGram * karatFactor(state.karat);
}

function setActiveKaratButtons() {
  document.querySelectorAll(".karat-btn").forEach((btn) => {
    const k = Number(btn.dataset.karat);
    btn.classList.toggle("active", k === state.karat);
  });
}

function showView(which) {
  const views = ["viewHome","viewCalc","viewCurrency"].map($).filter(Boolean);
  views.forEach(v => v.classList.remove("view-active"));
  if (which === "home") $("viewHome")?.classList.add("view-active");
  if (which === "calc") $("viewCalc")?.classList.add("view-active");
  if (which === "currency") $("viewCurrency")?.classList.add("view-active");
}

function updateTotal() {
  const gramsInput = $("gramsInput");
  const totalLabel = $("totalLabel");
  if (!gramsInput || !totalLabel) return;

  const grams = Number(String(gramsInput.value || "").replace(",", "."));
  if (!Number.isFinite(grams) || grams <= 0) {
    totalLabel.textContent = "—";
    return;
  }
  totalLabel.textContent = fmtMoney(grams * currentPricePerGramSelectedKarat(), state.currency);
}

function renderCurrencyList() {
  const currencyList = $("currencyList");
  if (!currencyList) return;
  currencyList.innerHTML = "";

  CURRENCIES.forEach((c) => {
    const div = document.createElement("div");
    div.className = "currency-item";
    div.innerHTML = `
      <div class="currency-left">
        <div class="flag">${c.flag}</div>
        <div>
          <div class="currency-code">${c.code}</div>
          <div class="currency-name">${c.name}</div>
        </div>
      </div>
      <div class="check">${c.code === state.currency ? "✓" : ""}</div>
    `;
    div.addEventListener("click", async () => {
      state.currency = c.code;
      persistState();
      applyUI();
      // recalc current from stored USD price (if any) using latest FX
      await refreshAll();
      showView("home");
    });
    currencyList.appendChild(div);
  });
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

// ----- FX (Frankfurter) -----
// Frankfurter base is EUR. We'll compute USD->X using EURUSD and EURX.
async function fetchFrankfurterSeries({ start, end }, symbolsCsv) {
  const url = `https://api.frankfurter.app/${start}..${end}?from=EUR&to=${encodeURIComponent(symbolsCsv)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX error ${res.status}`);
  return res.json();
}

function fxUsdToTargetOnDate(ratesByDate, date, target) {
  if (target === "USD") return 1;

  const day = ratesByDate[date];
  if (!day) return null;

  const eurToUsd = day["USD"];
  const eurToT = day[target];

  if (!Number.isFinite(eurToUsd) || !Number.isFinite(eurToT)) return null;

  // 1 USD = (1/eurToUsd) EUR, then * eurToT = target
  return eurToT / eurToUsd;
}

// ----- Gold (metals.live) -----
// metals.live returns XAU spot in USD per ounce (usually).
async function fetchGoldUsdPerOunce() {
  const res = await fetch("https://api.metals.live/v1/spot");
  if (!res.ok) throw new Error(`Gold spot error ${res.status}`);

  const json = await res.json();
  // Example format commonly: [["gold", 2034.12], ["silver", 24.33], ...]
  const goldRow = Array.isArray(json) ? json.find(r => r?.[0] === "gold") : null;
  const usdPerOunce = goldRow?.[1];

  if (!Number.isFinite(usdPerOunce)) {
    throw new Error("Gold spot response missing gold price");
  }

  return usdPerOunce;
}

function ounceToGram(usdPerOunce) {
  // troy ounce
  return usdPerOunce / 31.1034768;
}

function upsertDailyGoldUsdPoint(dateStr, usdPerGram24) {
  const arr = Array.isArray(state.goldUsdHistory) ? state.goldUsdHistory : [];
  const idx = arr.findIndex(p => p.date === dateStr);
  const point = { date: dateStr, usdPerGram24 };
  if (idx >= 0) arr[idx] = point;
  else arr.push(point);

  // keep last 60 points max
  arr.sort((a,b) => a.date.localeCompare(b.date));
  state.goldUsdHistory = arr.slice(-60);
}

// ----- Chart -----
function renderChartFromHistoryConverted(historyConverted) {
  const canvas = $("priceChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");

  const labels = historyConverted.map(p => p.label);
  const data = historyConverted.map(p => p.value);

  const config = {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `${state.karat}K (${state.currency})`,
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
  };

  if (!chart) chart = new Chart(ctx, config);
  else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].label = `${state.karat}K (${state.currency})`;
    chart.update();
  }
}

function applyUI() {
  $("currencyLabel").textContent = state.currency;
  $("calcCurrencyLabel").textContent = state.currency;

  $("updatedLabel").textContent = state.lastUpdated || "—";

  const p = currentPricePerGramSelectedKarat();
  $("pricePerGramLabel").textContent = fmtMoney(p, state.currency);
  $("calcPricePerGramLabel").textContent = fmtMoney(p, state.currency);

  setActiveKaratButtons();
  updateTotal();
  renderCurrencyList();
}

// ----- Main refresh -----
async function refreshAll() {
  const btn = $("btnRefresh");
  try {
    if (btn) btn.textContent = "Refreshing...";

    // 1) Gold current in USD
    const usdPerOunce = await fetchGoldUsdPerOunce();
    const usdPerGram24 = ounceToGram(usdPerOunce);

    // 2) FX for today (and 30 day series for chart conversion)
    const { start, end } = lastNDaysRange(30);
    const symbols = ["USD", ...GCC.map(x => x.code)].join(",");
    const fx = await fetchFrankfurterSeries({ start, end }, symbols);

    const today = yyyyMmDd(new Date());

    // store today's gold point
    upsertDailyGoldUsdPoint(today, usdPerGram24);

    // current conversion
    const usdToTarget = fxUsdToTargetOnDate(fx.rates, Object.keys(fx.rates).slice(-1)[0], state.currency) ?? 1;
    state.price24PerGram = usdPerGram24 * usdToTarget;

    // 3) Build chart from locally stored gold points intersected with FX dates
    const factor = karatFactor(state.karat);
    const history = (state.goldUsdHistory || []).slice(-30);

    const converted = history
      .map(p => {
        const rate = fxUsdToTargetOnDate(fx.rates, p.date, state.currency);
        if (!Number.isFinite(rate)) return null;
        return {
          label: p.date.slice(5), // MM-DD
          value: p.usdPerGram24 * rate * factor
        };
      })
      .filter(Boolean);

    renderChartFromHistoryConverted(converted);

    state.lastUpdated = new Date().toLocaleString();
    persistState();
    applyUI();
  } catch (e) {
    console.error(e);
    alert(String(e.message || e));
  } finally {
    if (btn) btn.textContent = "Refresh";
  }
}

// ----- Events -----
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t?.id === "btnCalc") showView("calc");
  if (t?.id === "btnCurrency") showView("currency");
  if (t?.dataset?.nav === "home") showView("home");

  if (t?.classList?.contains("karat-btn")) {
    const k = Number(t.dataset.karat);
    if ([18,21,22,24].includes(k)) {
      state.karat = k;
      persistState();
      applyUI();
      // re-render chart with new karat factor on next refresh; or just refresh now
      refreshAll();
    }
  }
});

$("btnRefresh")?.addEventListener("click", refreshAll);
$("gramsInput")?.addEventListener("input", updateTotal);

(function init(){
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
  applyUI();
  refreshAll();
})();
