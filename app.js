// GCC Gold - TRUE month-to-date chart (server history via Cloudflare Worker KV)
//
// Requires your Worker endpoints:
//   - https://gcc-gold-cache.monster-90xd.workers.dev/latest
//   - https://gcc-gold-cache.monster-90xd.workers.dev/history/month
//
// UI assumptions (ids exist in your index.html):
// btnLang, tabHome, tabCalc, tabCurrency
// viewHome, viewCalc, viewCurrency
// lblCurrentPrice, pricePerGramLabel, lblCurrency, currencyLabel, btnCurrency
// karatLabel, calcKaratLabel, calcPricePerGramLabel
// gramsInput, totalLabel
// lblUpdatedWrap (we replace innerHTML), lblChartTitle, lblKarat
// lblPricePerGramCalc, lblGrams, lblTotal, btnBackHome1, btnBackHome2, lblChooseCurrency
// currencyList, priceChart
// adTitle (optional)
//
// Notes:
// - "True month" means: month points come from your Worker KV, not device local storage.
// - Graph updates on the 10-minute refresh schedule (and on currency/karat change for values).
// - Label shows: Latest update time + Next update time.

const WORKER_BASE_URL = "https://gcc-gold-cache.monster-90xd.workers.dev";
const LATEST_URL = `${WORKER_BASE_URL}/latest`;
const MONTH_HISTORY_URL = `${WORKER_BASE_URL}/history/month`;

const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10 minutes (matches your Basic plan delay + worker TTL)
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

  // latest FX (CUR per USD) from /latest, used for the big price tiles
  usdToCurrency: Number(localStorage.getItem("usdToCurrency") || 1),

  // derived: 24k price per gram in selected currency (current)
  price24PerGram: 0,

  // when we last refreshed (app time)
  lastUpdatedAt: Number(localStorage.getItem("lastUpdatedAt") || 0),

  // true month points from server
  // each point: { t: number, rates: { USDXAU, AED, SAR, ... } }
  monthPoints: []
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

function fmtDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function nextUpdateAt() {
  return state.lastUpdatedAt ? (state.lastUpdatedAt + AUTO_REFRESH_MS) : 0;
}

function karatFactor(k) { return k / 24; }

function showView(tab) {
  const map = { home: "viewHome", calc: "viewCalc", currency: "viewCurrency" };
  Object.values(map).forEach((id) => $(id)?.classList.remove("view-active"));
  $(map[tab])?.classList.add("view-active");

  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}

function setActiveKaratButtons() {
  document.querySelectorAll(".karat-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.karat) === state.karat);
  });

  $("karatLabel") && ($("karatLabel").textContent = String(state.karat));
  $("calcKaratLabel") && ($("calcKaratLabel").textContent = String(state.karat));
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

function applyTranslations() {
  const isAr = state.lang === "ar";

  document.documentElement.lang = isAr ? "ar" : "en";
  document.documentElement.dir = isAr ? "rtl" : "ltr";

  $("btnLang") && ($("btnLang").textContent = isAr ? "English" : "العربية");

  $("tabHome") && ($("tabHome").textContent = isAr ? "الرئيسية" : "Home");
  $("tabCalc") && ($("tabCalc").textContent = isAr ? "الحاسبة" : "Calculator");
  $("tabCurrency") && ($("tabCurrency").textContent = isAr ? "العملة" : "Currency");

  $("lblCurrentPrice") && ($("lblCurrentPrice").textContent = isAr ? "السعر الحالي / جرام" : "Current price / gram");
  $("lblCurrency") && ($("lblCurrency").textContent = isAr ? "العملة" : "Currency");
  $("btnCurrency") && ($("btnCurrency").textContent = isAr ? "تغيير" : "Change");

  const latest = fmtDateTime(state.lastUpdatedAt);
  const next = fmtDateTime(nextUpdateAt());
  if ($("lblUpdatedWrap")) {
    $("lblUpdatedWrap").innerHTML = isAr
      ? `آخر تحديث: <span id="updatedLabel">${latest}</span> | التحديث القادم: <span id="nextUpdateLabel">${next}</span>`
      : `Latest update: <span id="updatedLabel">${latest}</span> | Next update: <span id="nextUpdateLabel">${next}</span>`;
  }

  $("lblChartTitle") && ($("lblChartTitle").textContent = isAr ? "من بداية الشهر حتى الآن" : "Current month to latest update");
  $("lblKarat") && ($("lblKarat").textContent = isAr ? "العيار" : "Karat");

  $("lblPricePerGramCalc") && ($("lblPricePerGramCalc").textContent = isAr ? "السعر / جرام" : "Price / gram");
  $("lblGrams") && ($("lblGrams").textContent = isAr ? "الوزن (جرام)" : "Grams");
  $("lblTotal") && ($("lblTotal").textContent = isAr ? "الإجمالي" : "Total");
  $("btnBackHome1") && ($("btnBackHome1").textContent = isAr ? "رجوع" : "Back");
  $("btnBackHome2") && ($("btnBackHome2").textContent = isAr ? "رجوع" : "Back");
  $("lblChooseCurrency") && ($("lblChooseCurrency").textContent = isAr ? "اختر العملة" : "Choose currency");

  $("adTitle") && ($("adTitle").textContent = isAr ? "إعلان" : "Ad");
}

function renderCurrencyList() {
  const list = $("currencyList");
  if (!list) return;

  const isAr = state.lang === "ar";
  list.innerHTML = "";

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

      // Update chart values immediately (it will re-convert each stored point to new currency)
      applyUI();

      // Fetch latest + month points again (worker cached; cheap)
      await refreshNow();
      showView("home");
    });

    list.appendChild(div);
  }
}

async function fetchLatestRates() {
  const res = await fetch(LATEST_URL, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Latest error ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchMonthHistory() {
  const res = await fetch(MONTH_HISTORY_URL, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`History error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return Array.isArray(json?.points) ? json.points : [];
}

function renderChart() {
  const canvas = $("priceChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const factor = karatFactor(state.karat);

  // Build a fixed 10-minute timeline from 1st of month to now
  const now = Date.now();
  const d = new Date();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();

  const BUCKET_MS = 10 * 60 * 1000;
  const startBucket = Math.floor(monthStart / BUCKET_MS) * BUCKET_MS;
  const endBucket = Math.floor(now / BUCKET_MS) * BUCKET_MS;

  const timeline = [];
  for (let t = startBucket; t <= endBucket; t += BUCKET_MS) timeline.push(t);

  // Map stored points to their 10-min bucket (Worker should already bucket, but we normalize anyway)
  const points = Array.isArray(state.monthPoints) ? state.monthPoints : [];
  const bucketToRates = new Map();
  for (const p of points) {
    const bt = Math.floor(p.t / BUCKET_MS) * BUCKET_MS;
    // keep latest point in that bucket (if duplicates ever happen)
    bucketToRates.set(bt, p.rates);
  }

  function usdToCurFromRates(rates, cur) {
    if (cur === "USD") return 1;

    // preferred: CUR per USD (e.g. AED)
    const direct = rates?.[cur];
    if (Number.isFinite(direct) && direct > 0) return direct;

    // fallback: USD<cur> is USD per CUR (invert)
    const inv = rates?.[`USD${cur}`];
    if (Number.isFinite(inv) && inv > 0) return 1 / inv;

    return NaN;
  }

  // Labels: show date on day boundaries, otherwise HH:MM (sparser display via autoskip)
  const labels = timeline.map((t) => {
    const dt = new Date(t);
    if (dt.getHours() === 0 && dt.getMinutes() === 0) {
      return dt.toLocaleDateString([], { month: "short", day: "2-digit" });
    }
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });

  // Data: for each bucket in the timeline, either compute value or leave gap (null)
  const data = timeline.map((t) => {
    const rates = bucketToRates.get(t);
    if (!rates) return null;

    const usdXau = rates?.USDXAU;
    if (!Number.isFinite(usdXau) || usdXau <= 0) return null;

    const usdToCur = usdToCurFromRates(rates, state.currency);
    if (!Number.isFinite(usdToCur) || usdToCur <= 0) return null;

    const usdPerGram24 = usdXau / TROY_OUNCE_GRAMS;
    const curPerGram24 = usdPerGram24 * usdToCur;

    return curPerGram24 * factor;
  });

  // Make single-point periods visible (early month / just launched)
  const knownCount = data.reduce((n, v) => (v == null ? n : n + 1), 0);
  const fewKnown = knownCount <= 2;

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
        pointRadius: fewKnown ? 3 : 0,
        pointHoverRadius: 6,
        spanGaps: false // show gaps until we have data for those buckets
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
        x: {
          ticks: { color: "#9bb0d4", autoSkip: true, maxRotation: 0 },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: {
          ticks: { color: "#9bb0d4" },
          grid: { color: "rgba(255,255,255,0.06)" }
        }
      }
    }
  };

  if (!chart) chart = new Chart(ctx, config);
  else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].label = `${state.karat}K (${state.currency})`;
    chart.data.datasets[0].pointRadius = fewKnown ? 3 : 0;
    chart.update();
  }
}

function applyUI() {
  $("currencyLabel") && ($("currencyLabel").textContent = state.currency);

  const perGramSelectedK = state.price24PerGram * karatFactor(state.karat);
  $("pricePerGramLabel") && ($("pricePerGramLabel").textContent = fmtMoney(perGramSelectedK, state.currency));
  $("calcPricePerGramLabel") && ($("calcPricePerGramLabel").textContent = fmtMoney(perGramSelectedK, state.currency));

  setActiveKaratButtons();
  updateTotal();
  renderCurrencyList();
  renderChart();
  applyTranslations();
}

async function refreshNow() {
  try {
    // 1) Latest (tile values + update times)
    const latest = await fetchLatestRates();

    const usdXau = latest?.rates?.USDXAU;
    if (!Number.isFinite(usdXau) || usdXau <= 0) throw new Error("Missing USDXAU rate");

    const usdToCur = state.currency === "USD" ? 1 : latest?.rates?.[state.currency];
    if (!Number.isFinite(usdToCur) || usdToCur <= 0) throw new Error(`Missing ${state.currency} rate`);

    state.usdToCurrency = usdToCur;

    const usdPerGram24 = usdXau / TROY_OUNCE_GRAMS;
    state.price24PerGram = usdPerGram24 * usdToCur;

    state.lastUpdatedAt = Date.now();
    persist();

    // 2) True month points (server)
    state.monthPoints = await fetchMonthHistory();

    applyUI();
  } catch (e) {
    console.error(e);
    if (document.visibilityState === "visible") alert(String(e?.message || e));
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);

  // When app becomes visible again, do a refresh
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshNow();
  });

  refreshTimer = setInterval(refreshNow, AUTO_REFRESH_MS);
}

function initEvents() {
  // Tabs
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.tab));
  });

  // Currency view
  $("btnCurrency")?.addEventListener("click", () => showView("currency"));
  $("btnBackHome1")?.addEventListener("click", () => showView("home"));
  $("btnBackHome2")?.addEventListener("click", () => showView("home"));

  // Language
  $("btnLang")?.addEventListener("click", () => {
    state.lang = state.lang === "ar" ? "en" : "ar";
    persist();
    applyUI();
  });

  // Karat buttons
  document.querySelectorAll(".karat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.karat = Number(btn.dataset.karat);
      persist();
      applyUI(); // chart re-converts immediately
    });
  });

  // Calculator grams input
  $("gramsInput")?.addEventListener("input", updateTotal);
}

(function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }

  initEvents();
  applyUI();   // initial render (blank chart until loaded)
  refreshNow();
  startAutoRefresh();
})();
