import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'herisson.trader.jt5@gmail.com').toLowerCase().trim();
const HIOVE_API_URL = 'https://access.hiove.io/api/v1/access-check';

export interface MemberRecord {
  email: string;
  name: string;
  hasAccess: boolean;
  hasDeposit?: boolean;
  isAdmin: boolean;
  status: 'ACTIVE' | 'PENDING_DEPOSIT' | 'REVOKED' | 'EXPIRED';
  firstValidatedAt: number;
  lastCheckedAt: number;
  lastActiveAt?: number;
  isOnline?: boolean;
  accessDays?: number;
  expiresAt?: number;
  notes?: string;
  source: 'HIOVE_API' | 'ADMIN_MANUAL' | 'ADMIN_BYPASS' | 'LOGIN_ATTEMPT' | 'HIOVE_LOGIN';
}

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const REGISTRY_FILE = path.resolve(DATA_DIR, 'members_registry.json');

// In-memory registry cache
let membersMap: Record<string, MemberRecord> = {};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
      console.warn('[MemberRegistry] Falha ao criar diretório data:', e);
    }
  }
}

export function loadRegistry() {
  ensureDataDir();
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const content = fs.readFileSync(REGISTRY_FILE, 'utf-8');
      membersMap = JSON.parse(content) || {};
    }
  } catch (err) {
    console.warn('[MemberRegistry] Erro ao carregar arquivo de membros, reiniciando:', err);
    membersMap = {};
  }

  // Garantir administrador sempre cadastrado e ativo
  membersMap[ADMIN_EMAIL] = {
    email: ADMIN_EMAIL,
    name: 'Herisson',
    hasAccess: true,
    isAdmin: true,
    status: 'ACTIVE',
    firstValidatedAt: membersMap[ADMIN_EMAIL]?.firstValidatedAt || Date.now(),
    lastCheckedAt: Date.now(),
    lastActiveAt: Date.now(),
    source: 'ADMIN_BYPASS',
    accessDays: 9999,
    expiresAt: Date.now() + 9999 * 86400 * 1000,
    notes: 'Administrador Master CandleX-IA',
  };

  saveRegistryFile();
  syncWithSupabaseAsync();
}

function saveRegistryFile() {
  ensureDataDir();
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(membersMap, null, 2), 'utf-8');
  } catch (err) {
    console.error('[MemberRegistry] Erro ao salvar arquivo de membros:', err);
  }
}

/**
 * Sincroniza bidirecionalmente em segundo plano com a tabela app_settings do Supabase
 * Mescla com os dados existentes na nuvem para que nenhum usuário registrado pelo frontend seja perdido
 */
export async function syncWithSupabaseAsync() {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return;

  try {
    // 1. Lê os membros atuais salvos no Supabase na chave members_registry
    const getRes = await fetch(`${sbUrl}/rest/v1/app_settings?id=eq.members_registry`, {
      method: 'GET',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
      },
    });

    if (getRes.ok) {
      const rows = await getRes.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].weights) {
        const cloudWeights = rows[0].weights as Record<string, MemberRecord>;
        // Mescla: mantém o que já está na nuvem e adiciona/atualiza da memória local
        for (const [em, cloudMember] of Object.entries(cloudWeights)) {
          if (!membersMap[em]) {
            membersMap[em] = cloudMember;
          } else {
            // Preserva a liberação mais recente ou status ativo
            if (cloudMember.hasAccess && !membersMap[em].hasAccess) {
              membersMap[em] = cloudMember;
            }
            // Preserva timestamps mais recentes para não apagar o status online
            membersMap[em].lastActiveAt = Math.max(
              membersMap[em].lastActiveAt || 0,
              cloudMember.lastActiveAt || 0
            );
            membersMap[em].lastCheckedAt = Math.max(
              membersMap[em].lastCheckedAt || 0,
              cloudMember.lastCheckedAt || 0
            );
          }
        }
      }
    }

    saveRegistryFile();

    // 2. Grava de volta na chave principal members_registry (lida pelo frontend e painel ADM)
    await fetch(`${sbUrl}/rest/v1/app_settings`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: 'members_registry',
        weights: membersMap,
        thresholds: {
          totalUsers: Object.keys(membersMap).length,
          lastUpdated: Date.now(),
        },
        updated_at: new Date().toISOString(),
      }),
    });

    // 3. Grava também no hiove_access_registry para compatibilidade total
    const list = Object.values(membersMap).map((m) => ({
      email: m.email,
      name: m.name,
      hasAccess: m.hasAccess,
      isAdmin: m.isAdmin,
      status: m.status,
      validatedAt: m.firstValidatedAt,
      accessDays: m.accessDays,
      expiresAt: m.expiresAt,
    }));

    await fetch(`${sbUrl}/rest/v1/app_settings`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: 'hiove_access_registry',
        weights: { membersList: list, total: list.length },
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('[MemberRegistry] Aviso na sincronização com Supabase:', e);
  }
}

export function getAllMembers(): MemberRecord[] {
  const now = Date.now();
  return Object.values(membersMap).map((m) => ({
    ...m,
    isOnline: Boolean(m.lastActiveAt && (now - m.lastActiveAt < 3 * 60 * 1000)),
  }));
}

export function getMember(email: string): MemberRecord | null {
  const clean = email.toLowerCase().trim();
  const m = membersMap[clean];
  if (!m) return null;
  const now = Date.now();
  return {
    ...m,
    isOnline: Boolean(m.lastActiveAt && (now - m.lastActiveAt < 3 * 60 * 1000)),
  };
}

/**
 * Registra o heartbeat em tempo real do usuário navegando na IA/ferramenta
 */
export function recordHeartbeat(emailInput: string, nameInput?: string): MemberRecord | null {
  const clean = emailInput.toLowerCase().trim();
  if (!clean || !clean.includes('@')) return null;
  const now = Date.now();
  const isAdmin = clean === ADMIN_EMAIL;
  let record = membersMap[clean];

  if (!record) {
    record = {
      email: clean,
      name: nameInput || clean.split('@')[0],
      hasAccess: isAdmin,
      isAdmin,
      status: isAdmin ? 'ACTIVE' : 'PENDING_DEPOSIT',
      firstValidatedAt: now,
      lastCheckedAt: now,
      lastActiveAt: now,
      isOnline: true,
      source: isAdmin ? 'ADMIN_BYPASS' : 'LOGIN_ATTEMPT',
      notes: isAdmin ? 'Administrador Master' : 'Acesso inicial registrado via heartbeat',
    };
    membersMap[clean] = record;
  } else {
    record.lastActiveAt = now;
    record.lastCheckedAt = now;
    record.isOnline = true;
    if (nameInput && nameInput.trim() && (record.name === clean.split('@')[0] || !record.name)) {
      record.name = nameInput.trim();
    }
  }

  saveRegistryFile();
  syncWithSupabaseAsync();
  return record;
}

/**
 * Registra qualquer tentativa de login na plataforma para aparecer no Painel ADM
 */
export function recordLoginAttempt(emailInput: string, source: string = 'HIOVE_LOGIN'): MemberRecord {
  const clean = emailInput.toLowerCase().trim();
  const isAdmin = clean === ADMIN_EMAIL;
  const existing = membersMap[clean];
  const now = Date.now();

  const accessDays = existing?.accessDays ?? (isAdmin ? 9999 : 0);
  const expiresAt = existing?.expiresAt ?? (isAdmin ? now + 9999 * 86400 * 1000 : 0);
  const isExpired = !isAdmin && expiresAt > 0 && now > expiresAt;
  const hasAccess = isAdmin ? true : (existing?.hasAccess ?? false) && !isExpired;
  const status = isAdmin ? 'ACTIVE' : (isExpired ? 'EXPIRED' : (existing?.status || 'PENDING_DEPOSIT'));

  const record: MemberRecord = {
    email: clean,
    name: existing?.name || clean.split('@')[0],
    hasAccess,
    hasDeposit: existing?.hasDeposit ?? isAdmin,
    isAdmin,
    status,
    firstValidatedAt: existing?.firstValidatedAt || now,
    lastCheckedAt: now,
    lastActiveAt: now,
    accessDays,
    expiresAt,
    source: existing?.source || (source as any),
    notes: existing?.notes || (hasAccess ? 'Usuário ativo' : 'Login realizado na tela inicial (Aguardando liberação de dias)'),
  };

  membersMap[clean] = record;
  saveRegistryFile();
  syncWithSupabaseAsync();
  return record;
}

/**
 * Atualiza os dias de acesso de um usuário (1 dia [24h], 7d, 15d, 30d, 9999d vitalício)
 */
export function updateMemberDays(emailInput: string, days: number): MemberRecord {
  const clean = emailInput.toLowerCase().trim();
  const existing = membersMap[clean];
  const now = Date.now();
  const accessDays = Math.max(1, days);
  const expiresAt = accessDays >= 9999 ? now + 9999 * 86400 * 1000 : now + accessDays * 86400 * 1000;

  const record: MemberRecord = {
    email: clean,
    name: existing?.name || clean.split('@')[0],
    hasAccess: true,
    hasDeposit: true, // Liberação manual pelo Admin dispensa exigência de depósito e link
    isAdmin: clean === ADMIN_EMAIL || existing?.isAdmin === true,
    status: 'ACTIVE',
    firstValidatedAt: existing?.firstValidatedAt || now,
    lastCheckedAt: now,
    lastActiveAt: existing?.lastActiveAt || now,
    accessDays,
    expiresAt,
    source: 'ADMIN_MANUAL',
    notes: accessDays === 1
      ? `Acesso liberado por 24 horas (1 dia) em ${new Date().toLocaleString('pt-BR')}`
      : `Acesso renovado para ${accessDays >= 9999 ? 'Vitalício' : `${accessDays} dias`} em ${new Date().toLocaleDateString('pt-BR')}`,
  };

  membersMap[clean] = record;
  saveRegistryFile();
  syncWithSupabaseAsync();
  return record;
}

export function grantMemberManual(email: string, notes?: string, days: number = 1): MemberRecord {
  const clean = email.toLowerCase().trim();
  const isAdmin = clean === ADMIN_EMAIL;
  const name = clean === ADMIN_EMAIL ? 'Herisson' : clean.split('@')[0];
  const now = Date.now();
  const accessDays = Math.max(1, days);
  const expiresAt = accessDays >= 9999 ? now + 9999 * 86400 * 1000 : now + accessDays * 86400 * 1000;

  const record: MemberRecord = {
    email: clean,
    name,
    hasAccess: true,
    hasDeposit: true,
    isAdmin,
    status: 'ACTIVE',
    firstValidatedAt: membersMap[clean]?.firstValidatedAt || now,
    lastCheckedAt: now,
    lastActiveAt: now,
    accessDays,
    expiresAt,
    source: 'ADMIN_MANUAL',
    notes: notes || (accessDays === 1
      ? `Liberado por 24 horas (1 dia) pelo administrador`
      : `Liberado manualmente pelo administrador (${accessDays >= 9999 ? 'Vitalício' : `${accessDays} dias`})`),
  };

  membersMap[clean] = record;
  saveRegistryFile();
  syncWithSupabaseAsync();
  return record;
}

export function revokeMember(email: string, notes?: string): MemberRecord | null {
  const clean = email.toLowerCase().trim();
  if (clean === ADMIN_EMAIL) {
    throw new Error('Não é possível revogar o acesso do Administrador Master.');
  }

  const existing = membersMap[clean];
  if (!existing) return null;

  existing.hasAccess = false;
  existing.status = 'REVOKED';
  existing.lastCheckedAt = Date.now();
  if (notes) existing.notes = notes;

  saveRegistryFile();
  syncWithSupabaseAsync();
  return existing;
}

export function deleteMember(email: string): boolean {
  const clean = email.toLowerCase().trim();
  if (clean === ADMIN_EMAIL) {
    throw new Error('Não é possível excluir o Administrador Master.');
  }
  if (membersMap[clean]) {
    delete membersMap[clean];
    saveRegistryFile();
    syncWithSupabaseAsync();
    return true;
  }
  return false;
}

/**
 * Consulta a API da Hiove de forma segura no servidor
 * POST https://access.hiove.io/api/v1/access-check
 */
export async function queryHioveApi(emailInput: string): Promise<{
  status: number;
  access: boolean;
  raw: any;
  error?: string;
}> {
  const email = (emailInput || '').toLowerCase().trim();
  const hioveKey = (process.env.HIOVE_KEY || process.env.HIOVE_ACCESS_KEY || '').trim();
  if (!hioveKey) {
    throw new Error('Chave HIOVE_KEY não configurada no servidor (.env).');
  }

  const response = await fetch(HIOVE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hioveKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  let raw: any = null;
  try {
    raw = await response.json();
  } catch {
    raw = null;
  }

  console.log('[Hiove API Query]', email, 'Status:', response.status, 'Response:', JSON.stringify(raw));

  return {
    status: response.status,
    access: response.ok && raw?.access === true,
    raw,
  };
}

/**
 * Fluxo de validação de acesso
 */
export async function validateUserAccess(emailInput: string): Promise<{
  success: boolean;
  access: boolean;
  hasDeposit: boolean;
  isAdmin: boolean;
  name: string;
  email: string;
  cached: boolean;
  status: 'ACTIVE' | 'PENDING_DEPOSIT' | 'REVOKED' | 'EXPIRED';
  message: string;
  errorCode?: string;
}> {
  const email = (emailInput || '').toLowerCase().trim();
  if (!email || !email.includes('@') || email.length < 5) {
    return {
      success: false,
      access: false,
      hasDeposit: false,
      isAdmin: false,
      name: '',
      email,
      cached: false,
      status: 'PENDING_DEPOSIT',
      message: 'Por favor, insira um e-mail válido.',
      errorCode: 'INVALID_EMAIL',
    };
  }

  // 1. Administrador Master (Herisson) - Acesso vitalício garantido
  if (email === ADMIN_EMAIL) {
    return {
      success: true,
      access: true,
      hasDeposit: true,
      isAdmin: true,
      name: 'Herisson',
      email: ADMIN_EMAIL,
      cached: true,
      status: 'ACTIVE',
      message: 'Bem-vindo, Herisson! Acesso de Administrador Master liberado.',
    };
  }

  // Sincroniza previamente com o Supabase para carregar liberações manuais feitas pelo Admin no painel
  await syncWithSupabaseAsync().catch(() => {});

  // 2. Se já estiver liberado na base com acesso ativo e dentro do prazo
  const cachedMember = membersMap[email];
  const now = Date.now();
  const isExpired = cachedMember?.expiresAt ? now > cachedMember.expiresAt : false;

  // SE O USUÁRIO FOI LIBERADO MANUALMENTE PELO ADMINISTRADOR (ex: teste 24h, licença no Painel ADM):
  // ELE NÃO PRECISA DE CONTA OU DEPÓSITO NA HIOVE COM LINK DE AFILIADO!
  if (
    cachedMember &&
    (cachedMember.source === 'ADMIN_MANUAL' || cachedMember.source === 'ADMIN_BYPASS' || cachedMember.hasAccess) &&
    cachedMember.status === 'ACTIVE' &&
    !isExpired
  ) {
    cachedMember.lastActiveAt = now;
    cachedMember.lastCheckedAt = now;
    cachedMember.hasAccess = true;
    cachedMember.hasDeposit = true;
    saveRegistryFile();

    return {
      success: true,
      access: true,
      hasDeposit: true,
      isAdmin: false,
      name: cachedMember.name || email.split('@')[0],
      email,
      cached: true,
      status: 'ACTIVE',
      message: 'Acesso ativo e liberado pelo Administrador Master (Sem necessidade de depósito Hiove).',
    };
  }

  if (cachedMember && isExpired) {
    return {
      success: false,
      access: false,
      hasDeposit: false,
      isAdmin: false,
      name: cachedMember.name || email.split('@')[0],
      email,
      cached: true,
      status: 'EXPIRED',
      message: `Seu período de teste ou acesso (${cachedMember.accessDays === 1 ? '24 horas (1 dia)' : `${cachedMember.accessDays || 30} dias`}) encerrou. Entre em contato com o suporte para renovar.`,
      errorCode: 'EXPIRED',
    };
  }

  // 3. Consulta à API da Hiove
  try {
    const hioveResult = await queryHioveApi(email);

    if (hioveResult.status === 200) {
      if (hioveResult.access === true) {
        // {"access": true} → é cliente cadastrado pelo link e já fez depósito na corretora. Pode liberar.
        const record: MemberRecord = {
          email,
          name: email.split('@')[0],
          hasAccess: true,
          hasDeposit: true,
          isAdmin: false,
          status: 'ACTIVE',
          firstValidatedAt: cachedMember?.firstValidatedAt || now,
          lastCheckedAt: now,
          lastActiveAt: now,
          accessDays: cachedMember?.accessDays || 30,
          expiresAt: cachedMember?.expiresAt || (now + 30 * 86400 * 1000),
          source: 'HIOVE_API',
          notes: 'Validado via API Hiove (cadastro e depósito confirmados)',
        };
        membersMap[email] = record;
        saveRegistryFile();
        syncWithSupabaseAsync();

        return {
          success: true,
          access: true,
          hasDeposit: true,
          isAdmin: false,
          name: record.name,
          email,
          cached: false,
          status: 'ACTIVE',
          message: 'Conta Hiove validada com sucesso! Depósito confirmado e acesso liberado.',
        };
      } else {
        // {"access": false} → não liberar, MAS SALVA NO SUPABASE para aparecer no Painel ADM
        const record: MemberRecord = {
          email,
          name: email.split('@')[0],
          hasAccess: false,
          hasDeposit: false,
          isAdmin: false,
          status: 'PENDING_DEPOSIT',
          firstValidatedAt: cachedMember?.firstValidatedAt || now,
          lastCheckedAt: now,
          lastActiveAt: now,
          accessDays: 0,
          expiresAt: 0,
          source: 'HIOVE_API',
          notes: 'Login realizado via Hiove (sem depósito confirmado ou aguardando liberação manual)',
        };
        membersMap[email] = record;
        saveRegistryFile();
        syncWithSupabaseAsync();

        return {
          success: false,
          access: false,
          hasDeposit: false,
          isAdmin: false,
          name: '',
          email,
          cached: false,
          status: 'PENDING_DEPOSIT',
          message: 'Acesso pendente. E-mail registrado no sistema. Aguarde a liberação ou entre em contato com o suporte.',
          errorCode: 'NO_ACCESS',
        };
      }
    } else {
      // Outro status HTTP da Hiove: salva o usuário para que o ADM possa liberá-lo manualmente
      recordLoginAttempt(email, 'HIOVE_LOGIN');
      return {
        success: false,
        access: false,
        hasDeposit: false,
        isAdmin: false,
        name: '',
        email,
        cached: false,
        status: 'PENDING_DEPOSIT',
        message: 'Não conseguimos validar agora na Hiove. Seu login foi registrado para liberação pelo administrador.',
        errorCode: 'API_ERROR',
      };
    }
  } catch (err: any) {
    // Falha de conexão: registra o e-mail no Supabase
    recordLoginAttempt(email, 'HIOVE_LOGIN');
    return {
      success: false,
      access: false,
      hasDeposit: false,
      isAdmin: false,
      name: '',
      email,
      cached: false,
      status: 'PENDING_DEPOSIT',
      message: 'Não conseguimos validar agora na Hiove. Seu login foi registrado para liberação pelo administrador.',
      errorCode: 'CONNECTION_ERROR',
    };
  }
}
