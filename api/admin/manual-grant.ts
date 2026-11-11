import { grantMemberManual } from '../../server/memberRegistry.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-email'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }

    const adminEmail = (body?.adminEmail || req.headers?.['x-admin-email'] || '').toLowerCase().trim();
    if (adminEmail !== 'herisson.trader.jt5@gmail.com') {
      res.status(403).json({ success: false, error: 'Acesso restrito ao Administrador Master.' });
      return;
    }

    const email = (body?.email || '').toLowerCase().trim();
    const days = parseInt(body?.days, 10) || 1;
    const hours = body?.hours ? parseInt(body?.hours, 10) : undefined;
    const notes = body?.notes || (hours ? `Liberado para teste por ${hours} horas pelo administrador` : 'Liberado manualmente pelo administrador');

    const updated = grantMemberManual(email, notes, days, hours);
    res.status(200).json({ success: true, member: updated });
  } catch (err: any) {
    console.error('[API Admin Manual Grant]', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

