// ClandeX-IA — Main Page Context WebSocket & Quote Interceptor
(function () {
  if (window.__CLANDEX_PAGE_HOOK_LOADED__) return;
  window.__CLANDEX_PAGE_HOOK_LOADED__ = true;

  console.log('[ClandeX-IA] Hook de cotação ativado no contexto principal da Hiove.');

  function extractPriceFromData(data) {
    if (!data) return null;
    let obj = data;
    if (typeof data === 'string') {
      try {
        obj = JSON.parse(data);
      } catch (e) {
        // Checagem rápida de regex em strings tipo "ticker,price,time"
        const match = data.match(/([0-9]+\.[0-9]{2,6})/);
        if (match) {
          const val = parseFloat(match[1]);
          if (!isNaN(val) && val > 0) return { price: val };
        }
        return null;
      }
    }

    if (typeof obj !== 'object' || obj === null) return null;

    let foundPrice = null;
    let foundTicker = obj.ticker || obj.symbol || obj.asset || obj.s || null;

    // Campos comuns de cotação em corretoras de opções binárias
    const priceCandidates = [
      obj.price, obj.p, obj.close, obj.c, obj.quote, obj.rate,
      obj.currentPrice, obj.value, obj.v, obj.lastPrice,
      obj.strike, obj.current
    ];

    for (const cand of priceCandidates) {
      if (typeof cand === 'number' && cand > 0) {
        foundPrice = cand;
        break;
      }
      if (typeof cand === 'string') {
        const parsed = parseFloat(cand);
        if (!isNaN(parsed) && parsed > 0) {
          foundPrice = parsed;
          break;
        }
      }
    }

    // Se for formato de array: [timestamp, open, high, low, close] ou [ticker, price]
    if (!foundPrice && Array.isArray(obj)) {
      if (typeof obj[0] === 'string' && (typeof obj[1] === 'number' || !isNaN(parseFloat(obj[1])))) {
        foundTicker = obj[0];
        foundPrice = typeof obj[1] === 'number' ? obj[1] : parseFloat(obj[1]);
      } else if (obj.length >= 4) {
        const lastVal = obj[obj.length - 1];
        if (typeof lastVal === 'number' && lastVal > 0) foundPrice = lastVal;
      }
    }

    if (foundPrice && !isNaN(foundPrice) && foundPrice > 0) {
      return { price: foundPrice, ticker: foundTicker };
    }
    return null;
  }

  // Interceptador de WebSocket nativo
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new OriginalWebSocket(...args);

    ws.addEventListener('message', function (event) {
      try {
        const extracted = extractPriceFromData(event.data);
        if (extracted && extracted.price > 0) {
          window.postMessage(
            {
              type: 'CLANDEX_HOOK_TICK',
              price: extracted.price,
              ticker: extracted.ticker || window.__CLANDEX_ACTIVE_TICKER__ || null,
              time: Date.now(),
            },
            '*'
          );
        }
      } catch (err) {}
    });

    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  console.log('[ClandeX-IA] Interceptador de WebSocket da Hiove engatado com sucesso.');
})();

