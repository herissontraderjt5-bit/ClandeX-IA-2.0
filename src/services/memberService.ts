import { MemberRecord, UserSession } from '../types/trading';
import { getSupabase } from './supabaseClient';

export const ADMIN_MASTER_EMAIL = 'herisson.trader.jt5@gmail.com';
const LOCAL_STORAGE_REGISTRY_KEY = 'clandex_members_registry';

/**
 * Normaliza e-mail
 */
function normalizeEmail(email: string): string {
  return (email || '').toLowerCase().trim();
}

/**
 * Lê membros salvos no localStorage como backup local
 */
function getLocalMembers(): Record<string, MemberRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_REGISTRY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Salva membros no localStorage
 */
function saveLocalMembers(map: Record<string, MemberRecord>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_REGISTRY_KEY, JSON.stringify(map));
  } catch { }
}

/**
 * Verifica se o acesso de um membro expirou
 */
export function isMemberExpired(member: { expiresAt?: number; status?: string }): boolean {
  if (member.status === 'EXPIRED') return true;
  if (!member.expiresAt) return false;
  return Date.now() > member.expiresAt;
}

/**
 * Registra IMEDIATAMENTE qualquer tentativa de login no Supabase e no cache local
 * Garante que todo usuário que digite seu e-mail apareça no Painel ADM instantaneamente,
 * mesmo antes de ter feito depósito ou antes da liberação de dias pelo administrador.
 */
export async function recordUserLoginAttempt(
  emailInput: string,
  source: 'HIOVE_LOGIN' | 'HIOVE_API' | 'ADMIN_MANUAL' | 'LOGIN_ATTEMPT' = 'HIOVE_LOGIN'
): Promise<MemberRecord | null> {
  const email = normalizeEmail(emailInput);
  if (!email || !email.includes('@') || email.length < 5) return null;

  const now = Date.now();
  const isAdmin = email === ADMIN_MASTER_EMAIL;

  let registry: Record<string, MemberRecord> = getLocalMembers();
  const sb = getSupabase();

  if (sb) {
    try {
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
      }
    } catch (e) {
      console.warn('[MemberService] Aviso ao ler registro no login attempt:', e);
    }
  }

  const existing = registry[email];
  const accessDays = existing?.accessDays ?? (isAdmin ? 9999 : 0);
  const expiresAt = existing?.expiresAt ?? (isAdmin ? now + 9999 * 86400 * 1000 : 0);
  const isExpired = !isAdmin && expiresAt > 0 && now > expiresAt;
  const hasAccess = isAdmin ? true : (existing?.hasAccess ?? false) && !isExpired;
  const status = isAdmin ? 'ACTIVE' : (isExpired ? 'EXPIRED' : (existing?.status || 'PENDING_DEPOSIT'));

  const record: MemberRecord = {
    email,
    name: existing?.name || email.split('@')[0],
    hasAccess,
    hasDeposit: existing?.hasDeposit ?? isAdmin,
    isAdmin,
    status,
    source: existing?.source || source,
    firstValidatedAt: existing?.firstValidatedAt || now,
    lastCheckedAt: now,
    lastActiveAt: now,
    isOnline: true,
    accessDays,
    expiresAt,
    notes: existing?.notes || (hasAccess ? 'Usuário ativo na plataforma' : 'Login realizado na tela inicial (Aguardando liberação de acesso/dias)'),
  };

  registry[email] = record;
  saveLocalMembers(registry);

  // Grava imediatamente na nuvem Supabase
  if (sb) {
    try {
      await sb.from('app_settings').upsert({
        id: 'members_registry',
        weights: registry,
        thresholds: {
          totalUsers: Object.keys(registry).length,
          lastUpdated: now,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (err) {
      console.warn('[MemberService] Falha ao persistir login attempt no Supabase:', err);
    }
  }

  // Notifica o backend Node
  try {
    fetch('/api/admin/record-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source }),
    }).catch(() => { });
  } catch { }

  return record;
}

/**
 * Consulta se o e-mail tem permissão ativa ou se está bloqueado/expirado
 */
export async function checkMemberAccessStatus(emailInput: string): Promise<{
  allowed: boolean;
  member?: MemberRecord;
  reason?: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'NOT_FOUND';
  message?: string;
}> {
  const email = normalizeEmail(emailInput);
  if (!email) return { allowed: false, reason: 'NOT_FOUND' };

  if (email === ADMIN_MASTER_EMAIL) {
    return { allowed: true, reason: 'ACTIVE' };
  }

  let registry: Record<string, MemberRecord> = getLocalMembers();
  const sb = getSupabase();
  if (sb) {
    try {
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
        saveLocalMembers(registry);
      }
    } catch { }
  }

  const member = registry[email];
  if (!member) {
    return { allowed: false, reason: 'NOT_FOUND' };
  }

  if (member.status === 'REVOKED' || member.hasAccess === false) {
    return {
      allowed: false,
      member,
      reason: 'REVOKED',
      message: 'Acesso suspenso pelo administrador.',
    };
  }

  if (isMemberExpired(member)) {
    return {
      allowed: false,
      member,
      reason: 'EXPIRED',
      message: `Seu período de ${member.accessDays === 1 ? '24 horas (1 dia)' : `${member.accessDays || 30} dias`} de acesso encerrou. Entre em contato com o administrador Herisson para renovar.`,
    };
  }

  // Se o membro foi liberado manualmente pelo Admin no painel, garante hasDeposit: true (isento de depósito ou link Hiove)
  if (member.source === 'ADMIN_MANUAL' || member.source === 'ADMIN_BYPASS' || (member.hasAccess && member.status === 'ACTIVE')) {
    member.hasDeposit = true;
  }

  return { allowed: true, member, reason: 'ACTIVE' };
}

/**
 * Registra o usuário logado e atualiza seu heartbeat (presença ativa na ferramenta)
 * Executado automaticamente após validação Hiove ou login na IA
 */
export async function recordUserHeartbeat(session: UserSession): Promise<void> {
  const email = normalizeEmail(session.email);
  if (!email || !email.includes('@')) return;

  const now = Date.now();
  const isAdmin = email === ADMIN_MASTER_EMAIL || session.isAdmin === true;

  // Carrega lista atual do Supabase ou localStorage
  const sb = getSupabase();
  let registry: Record<string, MemberRecord> = getLocalMembers();

  if (sb) {
    try {
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
      }
    } catch (e) {
      console.warn('[MemberService] Aviso ao ler registro do Supabase:', e);
    }
  }

  // Prepara o registro do membro
  const existing = registry[email];
  const accessDays = existing?.accessDays ?? (isAdmin ? 9999 : (session.accessDays ?? 30));
  const expiresAt = existing?.expiresAt ?? (isAdmin ? now + 9999 * 86400 * 1000 : now + accessDays * 86400 * 1000);

  const isExpired = !isAdmin && Date.now() > expiresAt;
  const status = isExpired ? 'EXPIRED' : (existing?.status === 'REVOKED' ? 'REVOKED' : (session.status || 'ACTIVE'));

  const member: MemberRecord = {
    email,
    name: session.name || existing?.name || email.split('@')[0],
    hasAccess: !isExpired && status === 'ACTIVE',
    hasDeposit: session.hasDeposit ?? existing?.hasDeposit ?? true,
    isAdmin,
    status,
    source: session.source || existing?.source || 'HIOVE_API',
    firstValidatedAt: existing?.firstValidatedAt || now,
    lastCheckedAt: now,
    lastActiveAt: now,
    isOnline: true,
    accessDays,
    expiresAt,
    notes: existing?.notes || (isAdmin ? 'Administrador Master' : 'Usuário Hiove ativo'),
  };

  registry[email] = member;
  saveLocalMembers(registry);

  // Notifica o backend local imediatamente sobre o heartbeat
  try {
    fetch('/api/user/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: member.name }),
    }).catch(() => { });
  } catch { }

  // Persiste no Supabase na tabela app_settings
  if (sb) {
    try {
      await sb.from('app_settings').upsert({
        id: 'members_registry',
        weights: registry,
        thresholds: {
          totalUsers: Object.keys(registry).length,
          lastUpdated: now,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (err) {
      console.warn('[MemberService] Falha ao persistir heartbeat no Supabase:', err);
    }
  }
}

/**
 * Busca a lista completa de membros registrados (Hiove + manuais + logins na nuvem)
 */
export async function fetchMembersRegistry(adminEmail?: string): Promise<{
  success: boolean;
  members: MemberRecord[];
  total: number;
  activeCount: number;
  pendingCount: number;
  onlineCount: number;
}> {
  let registry: Record<string, MemberRecord> = getLocalMembers();
  const sb = getSupabase();

  if (sb) {
    try {
      // 1. Tabela principal members_registry
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
      }

      // 2. Tabela secundária hiove_access_registry (recupera qualquer membro histórico)
      const { data: hioveData } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'hiove_access_registry')
        .maybeSingle();

      if (hioveData && hioveData.weights) {
        const hWeights = hioveData.weights as any;
        if (Array.isArray(hWeights.membersList)) {
          hWeights.membersList.forEach((hm: any) => {
            if (hm.email && !registry[normalizeEmail(hm.email)]) {
              registry[normalizeEmail(hm.email)] = {
                email: normalizeEmail(hm.email),
                name: hm.name || hm.email.split('@')[0],
                hasAccess: Boolean(hm.hasAccess),
                hasDeposit: true,
                isAdmin: Boolean(hm.isAdmin),
                status: hm.status || 'ACTIVE',
                source: 'HIOVE_API',
                firstValidatedAt: hm.validatedAt || Date.now(),
                lastCheckedAt: Date.now(),
                lastActiveAt: Date.now(),
                isOnline: false,
                accessDays: 30,
                expiresAt: Date.now() + 30 * 86400 * 1000,
                notes: 'Recuperado da base Hiove',
              };
            }
          });
        }
      }

      saveLocalMembers(registry);
    } catch (e) {
      console.warn('[MemberService] Aviso ao sincronizar com Supabase:', e);
    }
  }

  // Tenta também consultar a API do servidor se estiver disponível
  try {
    const res = await fetch(`/api/admin/members?adminEmail=${encodeURIComponent(adminEmail || ADMIN_MASTER_EMAIL)}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.members)) {
      data.members.forEach((m: MemberRecord) => {
        if (m.email) {
          const norm = normalizeEmail(m.email);
          const prev = registry[norm];
          const bestLastActive = Math.max(prev?.lastActiveAt || 0, m.lastActiveAt || 0);
          const bestLastChecked = Math.max(prev?.lastCheckedAt || 0, m.lastCheckedAt || 0);
          registry[norm] = {
            ...prev,
            ...m,
            email: norm,
            lastActiveAt: bestLastActive > 0 ? bestLastActive : undefined,
            lastCheckedAt: bestLastChecked > 0 ? bestLastChecked : Date.now(),
          };
        }
      });
      saveLocalMembers(registry);
    }
  } catch { }

  // Garante que o Admin Master sempre exista
  if (!registry[ADMIN_MASTER_EMAIL]) {
    registry[ADMIN_MASTER_EMAIL] = {
      email: ADMIN_MASTER_EMAIL,
      name: 'Herisson (Master Admin)',
      hasAccess: true,
      hasDeposit: true,
      isAdmin: true,
      status: 'ACTIVE',
      source: 'ADMIN_MANUAL',
      firstValidatedAt: Date.now(),
      lastCheckedAt: Date.now(),
      lastActiveAt: Date.now(),
      isOnline: true,
      accessDays: 9999,
      expiresAt: Date.now() + 9999 * 86400 * 1000,
      notes: 'Administrador Master da Plataforma',
    };
  }

  const now = Date.now();
  const membersList: MemberRecord[] = Object.values(registry).map((m) => {
    const isOnline = m.lastActiveAt ? (now - m.lastActiveAt < 5 * 60 * 1000) : false;
    const isExpired = !m.isAdmin && m.expiresAt ? (now > m.expiresAt) : false;
    const status = isExpired ? 'EXPIRED' : (m.status || 'ACTIVE');

    return {
      ...m,
      isOnline,
      status,
      hasAccess: !isExpired && status === 'ACTIVE',
    };
  });

  // Ordena: Master Admin primeiro, depois online, depois mais recentes
  membersList.sort((a, b) => {
    if (a.isAdmin && !b.isAdmin) return -1;
    if (!a.isAdmin && b.isAdmin) return 1;
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return (b.lastActiveAt || b.lastCheckedAt || 0) - (a.lastActiveAt || a.lastCheckedAt || 0);
  });

  const total = membersList.length;
  const activeCount = membersList.filter((m) => m.status === 'ACTIVE').length;
  const pendingCount = membersList.filter((m) => m.status === 'PENDING_DEPOSIT' || m.status === 'EXPIRED').length;
  const onlineCount = membersList.filter((m) => m.isOnline).length;

  return {
    success: true,
    members: membersList,
    total,
    activeCount,
    pendingCount,
    onlineCount,
  };
}

/**
 * Atualiza os dias de acesso de um cliente (ex: 1 [24 horas], 7, 15, 30, 90 dias ou vitalício)
 */
export async function updateMemberAccessDays(
  adminEmail: string,
  targetEmail: string,
  days: number
): Promise<{ success: boolean; member?: MemberRecord; error?: string }> {
  const email = normalizeEmail(targetEmail);
  if (!email || !email.includes('@')) {
    return { success: false, error: 'E-mail inválido.' };
  }

  const now = Date.now();
  let registry = getLocalMembers();
  const sb = getSupabase();

  if (sb) {
    try {
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
      }
    } catch { }
  }

  const existing = registry[email];
  const accessDays = Math.max(1, days);
  // Se for 1 dia, calcula 24 horas exatas (86400 segundos = 86.400.000 ms)
  const expiresAt = accessDays >= 9999 ? now + 9999 * 86400 * 1000 : now + accessDays * 86400 * 1000;

  const updated: MemberRecord = {
    email,
    name: existing?.name || email.split('@')[0],
    hasAccess: true,
    hasDeposit: true, // Liberação manual pelo Admin dispensa exigência de depósito e link
    isAdmin: email === ADMIN_MASTER_EMAIL || existing?.isAdmin === true,
    status: 'ACTIVE',
    source: 'ADMIN_MANUAL',
    firstValidatedAt: existing?.firstValidatedAt || now,
    lastCheckedAt: now,
    lastActiveAt: existing?.lastActiveAt || now,
    accessDays,
    expiresAt,
    notes: accessDays === 1
      ? `Acesso liberado por 24 horas (1 dia) em ${new Date().toLocaleString('pt-BR')}`
      : `Acesso renovado para ${accessDays >= 9999 ? 'Vitalício' : `${accessDays} dias`} em ${new Date().toLocaleDateString('pt-BR')}`,
  };

  registry[email] = updated;
  saveLocalMembers(registry);

  // Persiste no Supabase imediatamente
  if (sb) {
    try {
      await sb.from('app_settings').upsert({
        id: 'members_registry',
        weights: registry,
        thresholds: {
          totalUsers: Object.keys(registry).length,
          lastUpdated: now,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (e) {
      console.warn('[MemberService] Falha ao persistir dias de acesso no Supabase:', e);
    }
  }

  // Notifica também a API do servidor se estiver rodando
  try {
    await fetch('/api/admin/update-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
      body: JSON.stringify({ adminEmail, email, days: accessDays }),
    });
  } catch { }

  return { success: true, member: updated };
}

/**
 * Concede acesso manual para um novo cliente com quantidade de dias definida (ex: 1 dia [24h], 7, 15, 30, etc.)
 */
export async function grantMemberManual(
  adminEmail: string,
  targetEmail: string,
  days: number = 1,
  notes?: string
): Promise<{ success: boolean; member?: MemberRecord; error?: string }> {
  const email = normalizeEmail(targetEmail);
  if (!email || !email.includes('@')) {
    return { success: false, error: 'E-mail inválido.' };
  }

  const now = Date.now();
  let registry = getLocalMembers();
  const sb = getSupabase();

  if (sb) {
    try {
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
      }
    } catch { }
  }

  const accessDays = Math.max(1, days);
  const expiresAt = accessDays >= 9999 ? now + 9999 * 86400 * 1000 : now + accessDays * 86400 * 1000;

  const record: MemberRecord = {
    email,
    name: email.split('@')[0],
    hasAccess: true,
    hasDeposit: true,
    isAdmin: email === ADMIN_MASTER_EMAIL,
    status: 'ACTIVE',
    source: 'ADMIN_MANUAL',
    firstValidatedAt: now,
    lastCheckedAt: now,
    lastActiveAt: now,
    accessDays,
    expiresAt,
    notes: notes || (accessDays === 1
      ? `Liberado por 24 horas (1 dia) por ${adminEmail}`
      : `Liberado manualmente por ${adminEmail} (${accessDays >= 9999 ? 'Vitalício' : `${accessDays} dias de acesso`})`),
  };

  registry[email] = record;
  saveLocalMembers(registry);

  if (sb) {
    try {
      await sb.from('app_settings').upsert({
        id: 'members_registry',
        weights: registry,
        thresholds: {
          totalUsers: Object.keys(registry).length,
          lastUpdated: now,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch { }
  }

  try {
    await fetch('/api/admin/manual-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
      body: JSON.stringify({ adminEmail, email, days: accessDays, notes: record.notes }),
    });
  } catch { }

  return { success: true, member: record };
}

/**
 * Revoga o acesso de um cliente
 */
export async function revokeMember(
  adminEmail: string,
  targetEmail: string,
  notes?: string
): Promise<{ success: boolean; member?: MemberRecord; error?: string }> {
  const email = normalizeEmail(targetEmail);
  if (email === ADMIN_MASTER_EMAIL) {
    return { success: false, error: 'Não é possível revogar o Administrador Master.' };
  }

  let registry = getLocalMembers();
  const sb = getSupabase();

  if (sb) {
    try {
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
      }
    } catch { }
  }

  if (registry[email]) {
    registry[email].hasAccess = false;
    registry[email].status = 'REVOKED';
    registry[email].notes = notes || 'Acesso revogado pelo Administrador';
    saveLocalMembers(registry);

    if (sb) {
      try {
        await sb.from('app_settings').upsert({
          id: 'members_registry',
          weights: registry,
          thresholds: {
            totalUsers: Object.keys(registry).length,
            lastUpdated: Date.now(),
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      } catch { }
    }
  }

  try {
    await fetch('/api/admin/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
      body: JSON.stringify({ adminEmail, email, notes }),
    });
  } catch { }

  return { success: true, member: registry[email] };
}

/**
 * Exclui um cliente da base de dados
 */
export async function deleteMember(
  adminEmail: string,
  targetEmail: string
): Promise<{ success: boolean; error?: string }> {
  const email = normalizeEmail(targetEmail);
  if (email === ADMIN_MASTER_EMAIL) {
    return { success: false, error: 'Não é possível excluir o Administrador Master.' };
  }

  let registry = getLocalMembers();
  const sb = getSupabase();

  if (sb) {
    try {
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...(data.weights as Record<string, MemberRecord>), ...registry };
      }
    } catch { }
  }

  delete registry[email];
  saveLocalMembers(registry);

  if (sb) {
    try {
      await sb.from('app_settings').upsert({
        id: 'members_registry',
        weights: registry,
        thresholds: {
          totalUsers: Object.keys(registry).length,
          lastUpdated: Date.now(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch { }
  }

  try {
    await fetch('/api/admin/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
      body: JSON.stringify({ adminEmail, email }),
    });
  } catch { }

  return { success: true };
}
