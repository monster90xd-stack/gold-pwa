// UPDATED app.js
// Changes requested:
// 1) Graph time labels now update only when the 10-min refresh runs (not on tab/page clicks).
//    - We freeze the x-axis labels per refresh in `state.chart`.
// 2) Add label: "Latest update: <time> | Next update: <time>" (English/Arabic).
//
// Requires index.html change: add <span id="nextUpdateLabel"></span> inside lblUpdatedWrap.
// (Provided in index.html block below.)

const METALPRICE_PROXY_URL = "https://gcc-gold-cache.monster-90xd.workers.dev/latest";

const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10 minutes
const TROY_OUNCE_GRAMS = 31.1034768;

const GCC = [
  { code: "AED", name_en: "UAE Dirham", name_ar: "درهم إماراتي", flag: "🇦🇪" },
  { code: "SAR", name_en: "Saudi Riyal", name_ar: "ريال سعودي", flag: "🇸🇦" },
  { code: "KWD", name_en: "Kuwaiti Dinar", name_ar: "دينار كويتي", flag: "🇰🇼" },
  { code: "QAR", name_en: "Qatari Riyal", name_ar: "ريال قطري", flag: "🇶🇦" },
  { code: "BHD", name_en: "Bahraini Dinar", name_ar: "دينار بحريني", flag: "🇧🇭" },
  { code: "OMR", name_en: "Omani Rial", name_ar: "ريال عماني", flag: "🇴🇲" }
];

const CURRENCIES = [
  { code: "USD", name_en: "US Dollar", name_ar: "دولار أمريكي", flag: "🇺🇸" },
  ...GCC
];

const DEFAULTS = { currency: "USD", karat: 24, lang: "en" };

const state = {
  currency: localStorage.getItem("currency") || DEFAULTS.currency,
  karat: Number(localStorage.getItem("karat") || DEFAULTS.karat),
  lang: localStorage.getItem("lang") || DEFAULTS.lang,

  usdToCurrency: Number(localStorage.getItem("usdToCurrency") || 1),

  price24PerGram: 0,

  // timestamps
  lastUpdatedAt: Number(localStorage.getItem("lastUpdatedAt") || 0),

  // label strings (for display; recomputed)
  lastUpdated: localStorage.getItem("lastUpdated") || "",

  // [{ t, usdPerGram24 }]
  history: JSON.parse(localStorage.getItem("history") || "[]"),

  // Freeze chart labels/data based on last refresh, so tab clicks don't regenerate time labels.
  chart: {
    labels: JSON.parse(localStorage.getItem("chart.labels") || "[]"), // string[]
    pointsT: JSON.parse(localStorage.getItem("chart.pointsT") || "[]") // number[] epoch ms
  }
};

const $ = (id) => document.getElementById(id);
let chart;
let refreshTimer;

function persist() {
  localStorage.setItem("currency", state.currency);
  localStorage.setItem("karat", String(state.karat));
  localStorage.setItem("lang", state.lang);

  localStorage.setItem("usdToCurrency", String(state.usdToCurrency || 1));

  localStorage.setItem("lastUpdatedAt", String(state.lastUpdatedAt || 0));
  localStorage.setItem("lastUpdated", state.lastUpdated || "");

  localStorage.setItem("history", JSON.stringify(state.history || []));

  localStorage.setItem("chart.labels", JSON.stringify(state.chart.labels || []));
  localStorage.setItem("chart.pointsT", JSON.stringify(state.chart.pointsT || []));
}

function fmtMoney(value, currency) {
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function nextUpdateAt() {
  if (!state.lastUpdatedAt) return 0;
  return state.lastUpdatedAt + AUTO_REFRESH_MS;
}

function karatFactor(k) { return k / 24; }

function setActiveKaratButtons() {
  document.querySelectorAll(".karat-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.karat) === state.karat);
  });
  $("karatLabel") && ($("karatLabel").textContent = String(state.karat));
  $("calcKaratLabel") && ($("calcKaratLabel").textContent = String(state.karat));
}

function showView(tab) {
  const map = { home: "viewHome", calc: "viewCalc", currency: "viewCurrency" };
  Object.values(map).forEach((id) => $(id)?.classList.remove("view-active"));
  $(map[tab])?.classList.add("view-active");

  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
}

function updateTotal() {
  const grams = Number($("gramsInput")?.value || 0);
  const out = $("totalLabel");
  if (!out) return;

  if (!Number.isFinite(grams) || grams <= 0) {
    out.textContent = "—";
    return;
  }

  const perGram = state.price24PerGram * karatFactor(state.karat);
  out.textContent = fmtMoney(grams * perGram, state.currency);
}

function renderCurrencyList() {
  const list = $("currencyList");
  if (!list) return;
  list.innerHTML = "";

  const isAr = state.lang === "ar";

  for (const c of CURRENCIES) {
    const div = document.createElement("div");
    div.className = "currency-item";
    div.innerHTML = `
      <div class="currency-left">
        <div class="flag">${c.flag}</div>
        <div>
          <div class="currency-code">${c.code}</div>
          <div class="currency-name">${isAr ? c.name_ar : c.name_en}</div>
        </div>
      </div>
      <div class="check">${c.code === state.currency ? "✓" : ""}</div>
    `;
    div.addEventListener("click", async () => {
      state.currency = c.code;
      persist();

      // Update chart values instantly (x-axis labels remain frozen)
      applyUI();

      // Then refresh to get accurate FX for that currency (worker cached anyway)
      await refreshNow();
      showView("home");
    });
    list.appendChild(div);
  }
}

async function fetchLatestRates() {
  const res = await fetch(METALPRICE_PROXY_URL, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Proxy error ${res.status}: ${text}`);
  }
  return res.json();
}

function pushHistoryPointUsd(usdPerGram24) {
  const now = Date.now();
  state.history = Array.isArray(state.history) ? state.history : [];
  state.history.push({ t: now, usdPerGram24 });
  state.history = state.history.slice(-720);
}

// Freeze chart labels to refresh cadence, not UI events.
function rebuildFrozenChartWindow() {
  const points = (state.history || []).slice(-144);
  const labels = points.map(p => fmtTime(p.t)); // HH:MM
  const pointsT = points.map(p => p.t);

  state.chart.labels = labels;
  state.chart.pointsT = pointsT;
}

function renderChart() {
  const canvas = $("priceChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const factor = karatFactor(state.karat);

  // Use frozen chart timestamps from last refresh
  const pointsT = (state.chart.pointsT || []).slice(-144);
  const labels = (state.chart.labels || []).slice(-144);

  // Map timestamps to history points
  const map = new Map((state.history || []).map(p => [p.t, p.usdPerGram24]));
  const data = pointsT.map(t => {
    const usdPerGram24 = map.get(t);
    return Number.isFinite(usdPerGram24) ? (usdPerGram24 * state.usdToCurrency * factor) : null;
  });

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
        pointRadius: 0,
        spanGaps: true
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

function applyTranslations() {
  const isAr = state.lang === "ar";

  document.documentElement.lang = isAr ? "ar" : "en";
  document.documentElement.dir = isAr ? "rtl" : "ltr";

  $("btnLang").textContent = isAr ? "English" : "العربية";

  $("tabHome").textContent = isAr ? "الرئيسية" : "Home";
  $("tabCalc").textContent = isAr ? "الحاسبة" : "Calculator";
  $("tabCurrency").textContent = isAr ? "العملة" : "Currency";

  $("lblCurrentPrice").textContent = isAr ? "السعر الحالي / جرام" : "Current price / gram";
  $("lblCurrency").textContent = isAr ? "العملة" : "Currency";
  $("btnCurrency").textContent = isAr ? "تغيير" : "Change";

  // Latest + Next update line
  const latest = fmtDateTime(state.lastUpdatedAt);
  const next = fmtDateTime(nextUpdateAt());

  $("lblUpdatedWrap").innerHTML = isAr
    ? `آخر تحديث: <span id="updatedLabel">${latest}</span> | التحديث القادم: <span id="nextUpdateLabel">${next}</span>`
    : `Latest update: <span id="updatedLabel">${latest}</span> | Next update: <span id="nextUpdateLabel">${next}</span>`;

  $("lblChartTitle").textContent = isAr ? "البيانات حسب آخر تحديث (كل 10 دقائق)" : "Data updated every 10 minutes";
  $("lblKarat").textContent = isAr ? "العيار" : "Karat";

  $("lblPricePerGramCalc").textContent = isAr ? "السعر / جرام" : "Price / gram";
  $("lblGrams").textContent = isAr ? "الوزن (جرام)" : "Grams";
  $("lblTotal").textContent = isAr ? "الإجمالي" : "Total";
  $("btnBackHome1").textContent = isAr ? "رجوع" : "Back";
  $("lblChooseCurrency").textContent = isAr ? "اختر العملة" : "Choose currency";
  $("btnBackHome2").textContent = isAr ? "رجوع" : "Back";

  const adTitle = $("adTitle");
  if (adTitle) adTitle.textContent = isAr ? "إعلان" : "Ad";
}

function applyUI() {
  $("currencyLabel").textContent = state.currency;

  const perGramSelectedK = state.price24PerGram * karatFactor(state.karat);
  $("pricePerGramLabel").textContent = fmtMoney(perGramSelectedK, state.currency);
  $("calcPricePerGramLabel").textContent = fmtMoney(perGramSelectedK, state.currency);

  setActiveKaratButtons();
  updateTotal();
  renderCurrencyList();

  // IMPORTANT: renderChart uses frozen labels; it won't change labels on tab clicks.
  renderChart();

  applyTranslations();
}

async function refreshNow() {
  try {
    const json = await fetchLatestRates();

    const usdXau = json?.rates?.USDXAU;
    if (!Number.isFinite(usdXau) || usdXau <= 0) throw new Error("Missing USDXAU rate");

    const usdToCur = state.currency === "USD" ? 1 : json?.rates?.[state.currency];
    if (!Number.isFinite(usdToCur) || usdToCur <= 0) throw new Error(`Missing ${state.currency} rate`);

    state.usdToCurrency = usdToCur;

    const usdPerGram24 = usdXau / TROY_OUNCE_GRAMS;
    state.price24PerGram = usdPerGram24 * usdToCur;

    state.lastUpdatedAt = Date.now();
    state.lastUpdated = fmtDateTime(state.lastUpdatedAt);

    pushHistoryPointUsd(usdPerGram24);

    // Freeze chart labels to this refresh
    rebuildFrozenChartWindow();

    persist();
    applyUI();
  } catch (e) {
    console.error(e);
    if (document.visibilityState === "visible") alert(String(e?.message || e));
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshNow();
  });

  refreshTimer = setInterval(refreshNow, AUTO_REFRESH_MS);
}

function initEvents() {
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.tab)));

  $("btnCurrency")?.addEventListener("click", () => showView("currency"));
  $("btnBackHome1")?.addEventListener("click", () => showView("home"));
  $("btnBackHome2")?.addEventListener("click", () => showView("home"));

  $("btnLang")?.addEventListener("click", () => {
    state.lang = state.lang === "ar" ? "en" : "ar";
    persist();
    applyUI();
  });

  document.querySelectorAll(".karat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.karat = Number(btn.dataset.karat);
      persist();
      applyUI(); // chart values update; labels remain frozen
    });
  });

  $("gramsInput")?.addEventListener("input", updateTotal);
}

(function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);

  // Ensure chart freeze arrays are consistent on first load
  if (!Array.isArray(state.chart.labels) || !Array.isArray(state.chart.pointsT) || state.chart.pointsT.length === 0) {
    rebuildFrozenChartWindow();
  }

  initEvents();
  applyUI();
  refreshNow();
  startAutoRefresh();
})();
