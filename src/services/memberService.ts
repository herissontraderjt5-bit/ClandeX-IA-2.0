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
  } catch {}
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
        registry = { ...registry, ...(data.weights as Record<string, MemberRecord>) };
        saveLocalMembers(registry);
      }
    } catch {}
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
      message: `Seu período de ${member.accessDays || 30} dias de acesso encerrou. Entre em contato com o administrador Herisson para renovar.`,
    };
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
        registry = { ...registry, ...(data.weights as Record<string, MemberRecord>) };
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
 * Busca a lista completa de membros registrados (Hiove + manuais)
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
      const { data } = await sb
        .from('app_settings')
        .select('*')
        .eq('id', 'members_registry')
        .maybeSingle();

      if (data && data.weights && typeof data.weights === 'object') {
        registry = { ...registry, ...(data.weights as Record<string, MemberRecord>) };
        saveLocalMembers(registry);
      }
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
        if (m.email) registry[normalizeEmail(m.email)] = { ...registry[normalizeEmail(m.email)], ...m };
      });
      saveLocalMembers(registry);
    }
  } catch {}

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
    const status = isExpired ? 'EXPIRED' : m.status;

    return {
      ...m,
      isOnline,
      status,
      hasAccess: !isExpired && status === 'ACTIVE',
    };
  });

  // Ordena: online primeiro, depois mais recentes
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
 * Atualiza os dias de acesso de um cliente (ex: 7, 15, 30, 90 dias ou vitalício)
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
  const registry = getLocalMembers();
  const existing = registry[email];

  const accessDays = Math.max(1, days);
  const expiresAt = now + accessDays * 86400 * 1000;

  const updated: MemberRecord = {
    email,
    name: existing?.name || email.split('@')[0],
    hasAccess: true,
    hasDeposit: existing?.hasDeposit ?? true,
    isAdmin: email === ADMIN_MASTER_EMAIL || existing?.isAdmin === true,
    status: 'ACTIVE',
    source: existing?.source || 'ADMIN_MANUAL',
    firstValidatedAt: existing?.firstValidatedAt || now,
    lastCheckedAt: now,
    lastActiveAt: existing?.lastActiveAt || now,
    accessDays,
    expiresAt,
    notes: `Acesso renovado para ${accessDays} dias em ${new Date().toLocaleDateString('pt-BR')}`,
  };

  registry[email] = updated;
  saveLocalMembers(registry);

  // Persiste no Supabase
  const sb = getSupabase();
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
  } catch {}

  return { success: true, member: updated };
}

/**
 * Concede acesso manual para um novo cliente com quantidade de dias definida
 */
export async function grantMemberManual(
  adminEmail: string,
  targetEmail: string,
  days: number = 30,
  notes?: string
): Promise<{ success: boolean; member?: MemberRecord; error?: string }> {
  const email = normalizeEmail(targetEmail);
  if (!email || !email.includes('@')) {
    return { success: false, error: 'E-mail inválido.' };
  }

  const now = Date.now();
  const registry = getLocalMembers();
  const accessDays = Math.max(1, days);
  const expiresAt = now + accessDays * 86400 * 1000;

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
    notes: notes || `Liberado manualmente por ${adminEmail} (${accessDays} dias de acesso)`,
  };

  registry[email] = record;
  saveLocalMembers(registry);

  const sb = getSupabase();
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
    } catch {}
  }

  try {
    await fetch('/api/admin/manual-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
      body: JSON.stringify({ adminEmail, email, days: accessDays, notes: record.notes }),
    });
  } catch {}

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

  const registry = getLocalMembers();
  if (registry[email]) {
    registry[email].hasAccess = false;
    registry[email].status = 'REVOKED';
    registry[email].notes = notes || 'Acesso revogado pelo Administrador';
    saveLocalMembers(registry);

    const sb = getSupabase();
    if (sb) {
      try {
        await sb.from('app_settings').upsert({
          id: 'members_registry',
          weights: registry,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      } catch {}
    }
  }

  try {
    await fetch('/api/admin/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail },
      body: JSON.stringify({ adminEmail, email, notes }),
    });
  } catch {}

  return { success: true, member: registry[email] };
}

/**
 * Exclui um cliente da base
 */
export async function deleteMember(
  adminEmail: string,
  targetEmail: string
): Promise<{ success: boolean; error?: string }> {
  const email = normalizeEmail(targetEmail);
  if (email === ADMIN_MASTER_EMAIL) {
    return { success: false, error: 'Não é possível excluir o Administrador Master.' };
  }

  const registry = getLocalMembers();
  if (registry[email]) {
    delete registry[email];
    saveLocalMembers(registry);

    const sb = getSupabase();
    if (sb) {
      try {
        await sb.from('app_settings').upsert({
          id: 'members_registry',
          weights: registry,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      } catch {}
    }
  }

  return { success: true };
}
