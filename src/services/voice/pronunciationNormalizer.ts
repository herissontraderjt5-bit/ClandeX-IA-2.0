/**
 * pronunciationNormalizer.ts
 * Normaliza e higieniza textos de trading para pronúncia natural em voz alta (TTS e IA).
 * Evita que o sintetizador ou a IA soletrem pares de moedas ("E-U-R U-S-D") letra por letra.
 */

export function normalizeTradingPronunciation(rawText: string): string {
  if (!rawText) return '';

  let text = rawText;

  // 1. Remove caracteres de formatação markdown que atrapalham o sintetizador
  text = text.replace(/[*_#`~>\[\]\(\)\{\}]/g, ' ');

  // 2. Corrige soletrações já fragmentadas (ex: "E U R", "E-U-R", "U-S-D")
  text = text.replace(/\bE[\s\-_.]+U[\s\-_.]+R\b/gi, 'Euro');
  text = text.replace(/\bU[\s\-_.]+S[\s\-_.]+D\b/gi, 'USD');
  text = text.replace(/\bG[\s\-_.]+B[\s\-_.]+P\b/gi, 'GBP');
  text = text.replace(/\bS[\s\-_.]+O[\s\-_.]+L\b/gi, 'Solana');
  text = text.replace(/\bE[\s\-_.]+T[\s\-_.]+H\b/gi, 'Ethereum');
  text = text.replace(/\bB[\s\-_.]+T[\s\-_.]+C\b/gi, 'Bitcoin');

  // 3. Pares de Moedas Forex principais (com barra, hífen ou colados)
  text = text.replace(/\bEUR[\s\/\-_]*USD\b/gi, 'Euro USD');
  text = text.replace(/\bGBP[\s\/\-_]*USD\b/gi, 'GBP USD');
  text = text.replace(/\bUSD[\s\/\-_]*JPY\b/gi, 'Dólar Iene');
  text = text.replace(/\bAUD[\s\/\-_]*USD\b/gi, 'Dólar Australiano USD');
  text = text.replace(/\bUSD[\s\/\-_]*CAD\b/gi, 'Dólar Canadense');
  text = text.replace(/\bUSD[\s\/\-_]*CHF\b/gi, 'Dólar Franco');
  text = text.replace(/\bEUR[\s\/\-_]*GBP\b/gi, 'Euro GBP');
  text = text.replace(/\bEUR[\s\/\-_]*JPY\b/gi, 'Euro Iene');
  text = text.replace(/\bGBP[\s\/\-_]*JPY\b/gi, 'GBP Iene');
  text = text.replace(/\bNZD[\s\/\-_]*USD\b/gi, 'Dólar Neozelandês USD');

  // 4. Pares Cripto principais
  text = text.replace(/\bBTC[\s\/\-_]*USD[T]?\b/gi, 'Bitcoin USD');
  text = text.replace(/\bETH[\s\/\-_]*USD[T]?\b/gi, 'Ethereum USD');
  text = text.replace(/\bSOL[\s\/\-_]*USD[T]?\b/gi, 'Solana USD');
  text = text.replace(/\bXRP[\s\/\-_]*USD[T]?\b/gi, 'XRP USD');
  text = text.replace(/\bDOGE[\s\/\-_]*USD[T]?\b/gi, 'Dogecoin USD');
  text = text.replace(/\bADA[\s\/\-_]*USD[T]?\b/gi, 'Cardano USD');

  // 5. Criptos e Moedas Isoladas
  text = text.replace(/\bUSDT\b/gi, 'Dólar Téter');
  text = text.replace(/\bBTC\b/g, 'Bitcoin');
  text = text.replace(/\bETH\b/g, 'Ethereum');
  text = text.replace(/\bSOL\b/g, 'Solana');

  // 6. Jargões e Timeframes de Opções Binárias
  text = text.replace(/\bM1\b/g, '1 minuto');
  text = text.replace(/\bM5\b/g, '5 minutos');
  text = text.replace(/\bM15\b/g, '15 minutos');
  text = text.replace(/\bM30\b/g, '30 minutos');
  text = text.replace(/\bH1\b/g, '1 hora');
  text = text.replace(/\bH4\b/g, '4 horas');
  text = text.replace(/\bD1\b/g, 'diário');

  // 7. S/R, CALL, PUT
  text = text.replace(/\bS\/R\b/gi, 'suporte e resistência');
  text = text.replace(/\bCALL\b/g, 'Call');
  text = text.replace(/\bPUT\b/g, 'Put');

  // 8. Remove barras restantes entre palavras para não falar "barra"
  text = text.replace(/([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)/g, '$1 $2');
  text = text.replace(/\//g, ' ');

  // 9. Limpa espaços duplos
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
