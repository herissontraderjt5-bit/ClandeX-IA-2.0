export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {}
    }

    const category = req.query?.category === 'crypto' ? 'crypto' : 'forex';
    const targetUrl = `https://scanner.tradingview.com/${category}/scan`;

    const tvResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: typeof body === 'object' ? JSON.stringify(body) : body,
    });

    if (!tvResponse.ok) {
      return res.status(tvResponse.status).json({ success: false, error: 'TradingView scanner respondeu com erro' });
    }

    const data = await tvResponse.json();
    res.status(200).json(data);
  } catch (err: any) {
    console.error('[API TradingView Scan]', err);
    res.status(500).json({ success: false, error: err?.message || 'Falha no proxy TradingView' });
  }
}

