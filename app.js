async function fetchGoldUsdPerOunce() {
  const url =
    "https://api.metalpriceapi.com/v1/latest" +
    "?api_key=c04d99f9ac2f233a87135f316bbc2d90" +
    "&base=USD" +
    "&currencies=EUR,XAU,XAG";

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MetalpriceAPI error ${res.status}: ${text}`);
  }

  const json = await res.json();

  const usdXau = json?.rates?.USDXAU; // USD per 1 XAU (ounce)
  if (!Number.isFinite(usdXau) || usdXau <= 0) {
    throw new Error("Missing/invalid USDXAU rate from MetalpriceAPI");
  }

  return usdXau;
}
