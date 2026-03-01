// GCC Gold - uses Cloudflare Worker proxy (cached MetalpriceAPI).
// Auto-refresh every 10 minutes; no refresh button; Arabic toggle button.
// Uses Metalprice rates:
// - rates.USDXAU = USD per 1 XAU (troy ounce)
// - rates.<CUR>  = CUR per 1 USD (because base=USD)

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

  price24PerGram: 0,
  lastUpdated: localStorage.getItem("lastUpdated") || "",

  // store recent points for chart
  history: JSON.parse(localStorage.getItem("history") || "[]")
};

const $ = (id) => document.getElementById(id);
let chart;
let refreshTimer;

function persist() {
  localStorage.setItem("currency", state.currency);
  localStorage.setItem("karat", String(state.karat));
  localStorage.setItem("lang", state.lang);
  localStorage.setItem("lastUpdated", state.lastUpdated || "");
  localStorage.setItem("history", JSON.stringify(state.history || []));
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

function setActiveKaratButtons() {
  document.querySelectorAll(".karat-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.karat) === state.karat);
  });
  const k1 = $("karatLabel"); if (k1) k1.textContent = String(state.karat);
  const k2 = $("calcKaratLabel"); if (k2) k2.textContent = String(state.karat);
}

function showView(tab) {
  const map = { home: "viewHome", calc: "viewCalc", currency: "viewCurrency" };
  Object.values(map).forEach((id) => $(id)?.classList.remove("view-active"));
  $(map[tab])?.classList.add("view-active");

  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
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
      applyUI();
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

function pushHistoryPoint(price24PerGram) {
  const now = Date.now();
  state.history = Array.isArray(state.history) ? state.history : [];
  state.history.push({ t: now, price24PerGram });

  // keep last 720 points (~5 days at 10-min)
  state.history = state.history.slice(-720);
}

function renderChart() {
  const canvas = $("priceChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const factor = karatFactor(state.karat);

  const points = (state.history || []).slice(-144); // ~24h view
  const labels = points.map(p => new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const data = points.map(p => p.price24PerGram * factor);

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

  // safer than manipulating childNodes directly
  $("lblUpdatedWrap").innerHTML = isAr
    ? `آخر تحديث: <span id="updatedLabel">${state.lastUpdated || "—"}</span>`
    : `Last updated: <span id="updatedLabel">${state.lastUpdated || "—"}</span>`;

  $("lblChartTitle").textContent = isAr ? "آخر البيانات (تحديث كل 10 دقائق)" : "Latest points (auto every 10 min)";
  $("lblKarat").textContent = isAr ? "العيار" : "Karat";

  $("lblPricePerGramCalc").textContent = isAr ? "السعر / جرام" : "Price / gram";
  $("lblGrams").textContent = isAr ? "الوزن (جرام)" : "Grams";
  $("lblTotal").textContent = isAr ? "الإجمالي" : "Total";
  $("btnBackHome1").textContent = isAr ? "رجوع" : "Back";
  $("lblChooseCurrency").textContent = isAr ? "اختر العملة" : "Choose currency";
  $("btnBackHome2").textContent = isAr ? "رجوع" : "Back";
}

function applyUI() {
  $("currencyLabel").textContent = state.currency;

  const perGramSelectedK = state.price24PerGram * karatFactor(state.karat);
  $("pricePerGramLabel").textContent = fmtMoney(perGramSelectedK, state.currency);
  $("calcPricePerGramLabel").textContent = fmtMoney(perGramSelectedK, state.currency);

  // updatedLabel is recreated in applyTranslations, so set translations last
  setActiveKaratButtons();
  updateTotal();
  renderCurrencyList();
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

    const usdPerGram24 = usdXau / TROY_OUNCE_GRAMS;
    state.price24PerGram = usdPerGram24 * usdToCur;

    state.lastUpdated = new Date().toLocaleString();
    pushHistoryPoint(state.price24PerGram);

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
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.tab));
  });

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
      applyUI();
    });
  });

  $("gramsInput")?.addEventListener("input", updateTotal);
}

(function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
  initEvents();
  applyUI();
  refreshNow();
  startAutoRefresh();
})();
