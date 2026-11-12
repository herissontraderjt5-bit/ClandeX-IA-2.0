// ClandeX-IA — Content Script para a Corretora Hiove (hiove.com / hiove.io)
(function () {
  if (window.__CLANDEX_CONTENT_SCRIPT_INITIALIZED__) return;
  window.__CLANDEX_CONTENT_SCRIPT_INITIALIZED__ = true;

  console.log('[ClandeX-IA] Content Script ativado na Hiove.');

  // 1. Injeta o page_hook.js no contexto principal da página
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page_hook.js');
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    console.warn('[ClandeX-IA] Não foi possível injetar page_hook via URL, usando script inline:', e);
  }

  // Canal Broadcast para comunicação entre abas com o ClandeX-IA
  let broadcastChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel('clandex_hiove_channel');
    }
  } catch (e) {}

  let lastSentPrice = 0;
  let lastSentTime = 0;
  let activeTicker = '';

  // Função central para despachar ticks da Hiove para o ClandeX-IA
  function dispatchHioveTick(price, ticker) {
    if (!price || isNaN(price) || price <= 0) return;

    const now = Date.now();
    // Evita enxurrada redundante se o preço e tempo forem idênticos em menos de 20ms
    if (price === lastSentPrice && now - lastSentTime < 25) return;

    lastSentPrice = price;
    lastSentTime = now;
    if (ticker) activeTicker = ticker;

    const payload = {
      type: 'CLANDEX_HIOVE_TICK',
      price: price,
      ticker: activeTicker || ticker || undefined,
      time: now,
    };

    // 1. Envia para o parent (caso esteja rodando no iframe do ClandeX-IA)
    try {
      window.parent.postMessage(payload, '*');
    } catch (e) {}

    // 2. Envia para todas as abas abertas via BroadcastChannel
    try {
      if (broadcastChannel) {
        broadcastChannel.postMessage(payload);
      }
    } catch (e) {}

    // 3. Envia para a extensão / background
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage(payload).catch(() => {});
      }
    } catch (e) {}

    // Atualiza o mini badge flutuante
    updateFloatingBadge(price, activeTicker);
  }

  // Ouve ticks vindos do page_hook.js (WebSocket interceptor)
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CLANDEX_HOOK_TICK') {
      dispatchHioveTick(event.data.price, event.data.ticker);
    }
  });

  // 2. DOM Scanner de Alta Frequência (Fallback Robusto)
  // Varre a tela procurando o elemento onde o preço ao vivo da Hiove é renderizado
  function scanDomPrice() {
    try {
      // 1. Tenta identificar o ativo na URL ou na tela
      if (!activeTicker) {
        const urlParams = new URLSearchParams(window.location.search);
        const tickerParam = urlParams.get('ticker') || urlParams.get('asset') || urlParams.get('symbol');
        if (tickerParam) {
          activeTicker = tickerParam.toUpperCase();
        }
      }

      // 2. Procura elementos com seletores comuns de corretoras de opções binárias
      const priceSelectors = [
        '[class*="currentPrice"]',
        '[class*="current-price"]',
        '[class*="chartPrice"]',
        '[class*="chart-price"]',
        '[class*="lastPrice"]',
        '[class*="quoteValue"]',
        '[data-testid*="price"]',
        '[data-test*="price"]',
        '.strike-price',
        '.current-quote',
        'div[class*="strike"]',
        'span[class*="price"]',
      ];

      for (const sel of priceSelectors) {
        const els = document.querySelectorAll(sel);
        for (let i = 0; i < els.length; i++) {
          const text = (els[i].textContent || '').trim().replace(',', '.');
          const num = parseFloat(text);
          if (!isNaN(num) && num > 0 && num < 1000000) {
            dispatchHioveTick(num, activeTicker);
            return;
          }
        }
      }

      // 3. Scanner dinâmico nos botões de CALL/PUT (costumam ter o preço da taxa/strike)
      const buttons = document.querySelectorAll('button');
      for (let i = 0; i < buttons.length; i++) {
        const bText = (buttons[i].textContent || '').trim().replace(',', '.');
        const match = bText.match(/([0-9]+\.[0-9]{2,6})/);
        if (match) {
          const num = parseFloat(match[1]);
          if (!isNaN(num) && num > 0 && num < 1000000) {
            dispatchHioveTick(num, activeTicker);
            return;
          }
        }
      }
    } catch (e) {}
  }

  // Executa o scanner a cada 60ms para precisão tick-a-tick instantânea
  setInterval(scanDomPrice, 60);

  // 3. Mini Badge Flutuante Discreto da ClandeX-IA na Hiove
  let badgeEl = null;
  function updateFloatingBadge(price, ticker) {
    if (!badgeEl && document.body) {
      badgeEl = document.createElement('div');
      badgeEl.id = 'clandex-hiove-sync-badge';
      badgeEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-family:monospace;font-size:11px;font-weight:bold;">
          <span style="display:inline-block;width:7px;height:7px;background:#10b981;border-radius:50%;box-shadow:0 0 8px #10b981;animation:pulse 1.5s infinite;"></span>
          <span style="color:#06b6d4;">CLANDEX-IA:</span>
          <span id="clandex-badge-price" style="color:#fff;">--</span>
          <span style="font-size:9px;color:#10b981;background:rgba(16,185,129,0.2);padding:1px 4px;border-radius:4px;border:1px solid rgba(16,185,129,0.4);">0ms</span>
        </div>
      `;
      document.body.appendChild(badgeEl);
    }

    if (badgeEl) {
      const priceSpan = badgeEl.querySelector('#clandex-badge-price');
      if (priceSpan) {
        priceSpan.textContent = price.toString() + (ticker ? ` (${ticker})` : '');
      }
    }
  }
})();

