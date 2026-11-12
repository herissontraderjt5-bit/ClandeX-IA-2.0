// ClandeX-IA — Service Worker / Background Script
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ClandeX-IA] Extensão de sincronização de cotações Hiove instalada.');
});

// Relayer de mensagens entre abas
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'CLANDEX_HIOVE_TICK') {
    // Reenvia para todas as abas onde o ClandeX-IA possa estar aberto
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && tab.id !== sender?.tab?.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    });
  }
  sendResponse({ received: true });
  return true;
});
