// Updated app.js

async function fetchGoldPrices() {
    const response = await fetch('https://api.metalpriceapi.com/v1/latest?api_key=c04d99f9ac2f233a87135f316bbc2d90&base=USD&currencies=EUR,XAU,XAG');
    const data = await response.json();
    return data.rates;
}

async function getGoldPriceInUSDPerGram() {
    const rates = await fetchGoldPrices();
    const goldUSDPerOunce = rates.USDXAU;
    const goldUSDPerGram = goldUSDPerOunce / 31.1034768;
    return goldUSDPerGram;
}

// Continue using Frankfurter for USD->GCC conversion and local daily gold history as previously described.
// ...