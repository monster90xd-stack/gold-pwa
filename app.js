// ====== CONFIG ======
const GOLDAPI_KEY = "goldapi-jemsmm6x5l5r-io";
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
const GOLDAPI_BASE = "https://www.goldapi.io/api";

const state = {
  currency: localStorage.getItem("currency") || DEFAULT_CURRENCY,
  karat: Number(localStorage.getItem("karat") || DEFAULT_KARAT),
  price24PerGram: Number(localStorage.getItem("price24PerGram") || 0),
  history24PerGram: JSON.parse(localStorage.getItem("history24PerGram") || "[]"),
  lastUpdated: localStorage.getItem("lastUpdated") || ""
};

const $ = (id) => document.getElementById(id);

let chart;

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

function persistState() {
  localStorage.setItem("currency", state.currency);
  localStorage.setItem("karat", String(state.karat));
  localStorage.setItem("price24PerGram", String(state.price24PerGram || 0));
  localStorage.setItem("history24PerGram", JSON.stringify(state.history24PerGram || []));
  localStorage.setItem("lastUpdated", state.lastUpdated || "");
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
      await refreshAll();
      showView("home");
    });
    currencyList.appendChild(div);
  });
}

function renderChart() {
  const canvas = $("priceChart");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const factor = karatFactor(state.karat);

  const labels = (state.history24PerGram || []).map(p => p.date);
  const data = (state.history24PerGram || []).map(p => p.value * factor);

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
  renderChart();
}

async function goldApiFetch(path) {
  const res = await fetch(`${GOLDAPI_BASE}${path}`, {
    headers: { "x-access-token": GOLDAPI_KEY, "Content-Type": "application/json" }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GoldAPI error ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchCurrent24kPerGram(currency) {
  const json = await goldApiFetch(`/XAU/${currency}`);
  const price = json.price ?? json.ask ?? json.bid;
  const unit = (json.unit || "ounce").toLowerCase();
  if (!Number.isFinite(price)) throw new Error("GoldAPI response missing price");
  return unit.includes("gram") ? price : price / 31.1034768;
}

async function fetchHistory24kPerGram(currency, days = 30) {
  const points = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const json = await goldApiFetch(`/XAU/${currency}/${dateStr}`);
    const price = json.price ?? json.ask ?? json.bid;
    const unit = (json.unit || "ounce").toLowerCase();
    if (!Number.isFinite(price)) continue;

    const perGram = unit.includes("gram") ? price : price / 31.1034768;
    points.push({ date: dateStr.slice(5), value: perGram });
  }

  return points;
}

async function refreshAll() {
  const btn = $("btnRefresh");
  try {
    btn.textContent = "Refreshing...";

    state.price24PerGram = await fetchCurrent24kPerGram(state.currency);
    state.history24PerGram = await fetchHistory24kPerGram(state.currency, 30);

    state.lastUpdated = new Date().toLocaleString();
    persistState();
    applyUI();
  } catch (e) {
    console.error(e);
    alert(String(e.message || e));
  } finally {
    btn.textContent = "Refresh";
  }
}

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
    }
  }
});

$("btnRefresh").addEventListener("click", refreshAll);
$("gramsInput").addEventListener("input", updateTotal);

(function init(){
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
  applyUI();
  if (!state.price24PerGram || !state.history24PerGram?.length) refreshAll();
})();
