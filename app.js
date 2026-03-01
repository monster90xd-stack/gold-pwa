/* GCC Gold PWA
 * Gold (USD/oz): metalpriceapi latest (USDXAU)
 * FX: frankfurter.app (ECB). NOTE: ECB does NOT provide all GCC currencies.
 * If a currency is missing from Frankfurter, we fall back:
 *   AED, SAR, QAR -> pegged to USD (fixed rates)
 *   BHD, OMR, KWD -> use last-known stored rate if available, otherwise show an alert
 *
 * Chart: requires Chart.js loaded in index.html
 */

const METALPRICE_API_KEY = "c04d99f9ac2f233a87135f316bbc2d90";
const TROY_OUNCE_GRAMS = 31.1034768;

// Hard USD pegs (approx fixed pegs)
const USD_PEGS = {
  AED: 3.6725,
  SAR: 3.75,
  QAR: 3.64
};

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

  // store last known USD->currency rates (for missing FX currencies)
  lastKnownUsdRates: JSON.parse(localStorage.getItem("lastKnownUsdRates") || "{}"),

  lastUpdated: localStorage.getItem("lastUpdated") || ""
};

const $ = (id) => document.getElementById(id);
let chart;

function persist() {
  localStorage.setItem("currency", state.currency);
  localStorage.setItem("karat", String(state.karat));
  localStorage.setItem("price24PerGram", String(state.price24PerGram || 0));
  localStorage.setItem("goldUsdHistory", JSON.stringify(state.goldUsdHistory || []));
  localStorage.setItem("lastKnownUsdRates", JSON.stringify(state.lastKnownUsdRates || {}));
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
  const views = {
    home: $("viewHome"),
    calc: $("viewCalc"),
    currency: $("viewCurrency")
  };
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
      // make sure tab and view go back to home
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelector('.tab[data-tab="home"]')?.classList.add("active");
      showView("home");
    });
    list.appendChild(row);
  });
}

/* ---- FX: Frankfurter ----
   We fetch EUR->USD and EUR->TARGET and compute USD->TARGET.
   If TARGET missing, we use pegs or last known.
*/
async function fetchFrankfurterSeries({ start, end }, symbolsCsv) {
  const url = `https://api.frankfurter.app/${start}..${end}?from=EUR&to=${encodeURIComponent(symbolsCsv)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX error ${res.status}`);
  return res.json();
}

function fxUsdToTargetFromEurRates(dayRates, target) {
  if (target === "USD") return 1;
  if (USD_PEGS[target]) return USD_PEGS[target];

  const eurToUsd = dayRates?.USD;
  const eurToT = dayRates?.[target];
  if (Number.isFinite(eurToUsd) && Number.isFinite(eurToT)) return eurToT / eurToUsd;

  // fallback: last known if we have it
  const lk = state.lastKnownUsdRates?.[target];
  if (Number.isFinite(lk) && lk > 0) return lk;

  return null;
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

  // If Chart.js missing, don't silently do nothing — show a warning once
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

    // 1) gold current USD/oz -> USD/g
    const usdPerOunce = await fetchGoldUsdPerOunce();
    const usdPerGram24 = usdPerOunce / TROY_OUNCE_GRAMS;

    // store today's USD point for chart
    const today = yyyyMmDd(new Date());
    upsertGoldUsdPoint(today, usdPerGram24);

    // 2) FX series for chart conversion + current conversion
    const { start, end } = lastNDaysRange(30);

    // Try to get USD + all GCC. If some are missing, Frankfurter will simply not include them.
    const symbols = ["USD", ...GCC.map(x => x.code)].join(",");
    const fx = await fetchFrankfurterSeries({ start, end }, symbols);

    const fxDates = Object.keys(fx.rates || {}).sort();
    const latestFxDate = fxDates[fxDates.length - 1];
    const latestDayRates = fx.rates?.[latestFxDate];

    const usdToTargetNow = fxUsdToTargetFromEurRates(latestDayRates, state.currency);

    if (!Number.isFinite(usdToTargetNow)) {
      // Could not compute currency conversion
      state.price24PerGram = usdPerGram24; // fallback USD
      state.lastUpdated = `FX missing for ${state.currency} (showing USD). ${new Date().toLocaleString()}`;
      alert(`FX rate not available for ${state.currency} from Frankfurter/ECB.\n` +
            `Try AED/SAR/QAR (USD-pegged), or keep USD.\n` +
            `BHD/OMR/KWD may require a different FX provider.`);
    } else {
      // cache last known
      if (state.currency !== "USD" && !USD_PEGS[state.currency]) {
        state.lastKnownUsdRates[state.currency] = usdToTargetNow;
      }
      state.price24PerGram = usdPerGram24 * usdToTargetNow;
      state.lastUpdated = new Date().toLocaleString();
    }

    // 3) chart conversion (use same-day FX; if missing, skip that point)
    const factor = karatFactor(state.karat);
    const history = (state.goldUsdHistory || []).slice(-30);

    const converted = history
      .map(p => {
        const dayRates = fx.rates?.[p.date];
        const rate = fxUsdToTargetFromEurRates(dayRates, state.currency);
        if (!Number.isFinite(rate)) return null;
        return { label: p.date.slice(5), value: p.usdPerGram24 * rate * factor };
      })
      .filter(Boolean);

    renderChart(converted);

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

  // Currency view shortcut button
  $("btnCurrency")?.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelector('.tab[data-tab="currency"]')?.classList.add("active");
    showView("currency");
  });

  // Refresh
  $("btnRefresh")?.addEventListener("click", refreshAll);

  // Karat buttons
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

  // Optional: "live-ish" refresh every 60s (comment out if you want manual only)
  setInterval(() => refreshAll().catch(() => {}), 60_000);
})();
