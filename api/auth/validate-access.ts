import type { Request, Response } from 'express';
import { validateUserAccess } from '../../server/memberRegistry.js';

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
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
      try {
        body = JSON.parse(body);
      } catch {}
    }
    const email = body?.email;
    const result = await validateUserAccess(email);
    res.status(200).json(result);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Erro ao validar acesso:', err);
    res.status(500).json({
      success: false,
      access: false,
      hasDeposit: false,
      isAdmin: false,
      message: 'Não conseguimos validar agora, tente em alguns minutos.',
      error: err?.message,
    });
  }
}

