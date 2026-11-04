import { getAllMembers } from '../../server/memberRegistry.js';

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

  try {
    const adminEmail = (req.query?.adminEmail || req.headers?.['x-admin-email'] || '').toLowerCase().trim();
    if (adminEmail !== 'herisson.trader.jt5@gmail.com') {
      res.status(403).json({ success: false, error: 'Acesso restrito ao Administrador Master.' });
      return;
    }

    const members = getAllMembers();
    const activeCount = members.filter((m: any) => m.status === 'ACTIVE').length;
    const pendingCount = members.filter((m: any) => m.status !== 'ACTIVE').length;

    res.status(200).json({
      success: true,
      members,
      total: members.length,
      activeCount,
      pendingCount,
      hioveKeyPreview: (process.env.HIOVE_KEY || '').substring(0, 8) + '...',
    });
  } catch (err: any) {
    console.error('[API Admin Members]', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
