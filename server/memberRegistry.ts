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
  status: 'ACTIVE' | 'PENDING_DEPOSIT' | 'REVOKED';
  firstValidatedAt: number;
  lastCheckedAt: number;
  notes?: string;
  source: 'HIOVE_API' | 'ADMIN_MANUAL' | 'ADMIN_BYPASS';
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
    source: 'ADMIN_BYPASS',
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
 * Sincroniza em segundo plano com a tabela app_settings do Supabase
 */
async function syncWithSupabaseAsync() {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return;

  try {
    const list = Object.values(membersMap).map((m) => ({
      email: m.email,
      name: m.name,
      hasAccess: m.hasAccess,
      isAdmin: m.isAdmin,
      status: m.status,
      validatedAt: m.firstValidatedAt,
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
  return Object.values(membersMap);
}

export function getMember(email: string): MemberRecord | null {
  const clean = email.toLowerCase().trim();
  return membersMap[clean] || null;
}

export function grantMemberManual(email: string, notes?: string): MemberRecord {
  const clean = email.toLowerCase().trim();
  const isAdmin = clean === ADMIN_EMAIL;
  const name = clean === ADMIN_EMAIL ? 'Herisson' : clean.split('@')[0];

  const record: MemberRecord = {
    email: clean,
    name,
    hasAccess: true,
    isAdmin,
    status: 'ACTIVE',
    firstValidatedAt: membersMap[clean]?.firstValidatedAt || Date.now(),
    lastCheckedAt: Date.now(),
    source: 'ADMIN_MANUAL',
    notes: notes || 'Liberado manualmente pelo administrador',
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
 */
export async function queryHioveApi(email: string): Promise<{
  status: number;
  access: boolean;
  raw: any;
  error?: string;
}> {
  const hioveKey = (process.env.HIOVE_ACCESS_KEY || '').trim();
  if (!hioveKey) {
    throw new Error('Chave HIOVE_ACCESS_KEY não configurada no servidor (.env).');
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

  return {
    status: response.status,
    access: raw?.access === true,
    raw,
  };
}

/**
 * Fluxo principal de validação de acesso:
 * 1. Admin Master -> Acesso imediato garantido
 * 2. Já liberado no banco -> Retorna direto sem gastar cota da API Hiove
 * 3. Novo ou pendente -> Consulta API da Hiove
 * 4. Trata erros (429, 401, 500, rede)
 */
export async function validateUserAccess(emailInput: string, registeredClaim?: boolean): Promise<{
  success: boolean;
  access: boolean;
  hasDeposit: boolean;
  isAdmin: boolean;
  name: string;
  email: string;
  cached: boolean;
  status: 'ACTIVE' | 'PENDING_DEPOSIT' | 'REVOKED';
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

  // 1. Administrador Master (Herisson)
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

  // 2. Consulta em cache/base local se já veio true com depósito confirmado
  const cachedMember = membersMap[email];
  if (cachedMember && cachedMember.hasAccess && cachedMember.status === 'ACTIVE') {
    return {
      success: true,
      access: true,
      hasDeposit: true,
      isAdmin: false,
      name: cachedMember.name || email.split('@')[0],
      email,
      cached: true,
      status: 'ACTIVE',
      message: 'Acesso ativo e validado na corretora Hiove.',
    };
  }

  // 3. Consulta à API Hiove
  try {
    const hioveResult = await queryHioveApi(email);

    if (hioveResult.status === 200) {
      const isDeposited =
        hioveResult.access === true ||
        hioveResult.raw?.hasDeposit === true ||
        hioveResult.raw?.deposited === true;

      const hasAccount =
        isDeposited ||
        hioveResult.raw?.hasAccount === true ||
        hioveResult.raw?.registered === true ||
        hioveResult.raw?.exists === true ||
        hioveResult.raw?.lead === true ||
        registeredClaim === true;

      if (isDeposited) {
        // Cliente cadastrado e já realizou depósito! Liberação total sem cadeado.
        const record: MemberRecord = {
          email,
          name: email.split('@')[0],
          hasAccess: true,
          hasDeposit: true,
          isAdmin: false,
          status: 'ACTIVE',
          firstValidatedAt: cachedMember?.firstValidatedAt || Date.now(),
          lastCheckedAt: Date.now(),
          source: 'HIOVE_API',
          notes: 'Validado via API Hiove com depósito confirmado',
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
      } else if (hasAccount) {
        // Conta criada com link de cadastro! Consegue entrar na ferramenta, mas com cadeado para depósito
        const record: MemberRecord = {
          email,
          name: email.split('@')[0],
          hasAccess: true,
          hasDeposit: false,
          isAdmin: false,
          status: 'PENDING_DEPOSIT',
          firstValidatedAt: cachedMember?.firstValidatedAt || Date.now(),
          lastCheckedAt: Date.now(),
          source: 'HIOVE_API',
          notes: 'Conta Hiove cadastrada (aguardando depósito mínimo de $10 para ativação)',
        };
        membersMap[email] = record;
        saveRegistryFile();

        return {
          success: true,
          access: true,
          hasDeposit: false,
          isAdmin: false,
          name: record.name,
          email,
          cached: false,
          status: 'PENDING_DEPOSIT',
          message: 'Conta Hiove identificada! Acesso à ferramenta liberado (com cadeado de depósito mínimo de $10 para ativação).',
        };
      } else {
        // Sem conta criada
        const record: MemberRecord = {
          email,
          name: email.split('@')[0],
          hasAccess: false,
          hasDeposit: false,
          isAdmin: false,
          status: 'PENDING_DEPOSIT',
          firstValidatedAt: cachedMember?.firstValidatedAt || Date.now(),
          lastCheckedAt: Date.now(),
          source: 'HIOVE_API',
          notes: 'Acesso recusado pela Hiove (sem cadastro)',
        };
        membersMap[email] = record;
        saveRegistryFile();

        return {
          success: false,
          access: false,
          hasDeposit: false,
          isAdmin: false,
          name: record.name,
          email,
          cached: false,
          status: 'PENDING_DEPOSIT',
          message: 'Conta não encontrada na corretora Hiove. Cadastre-se pelo link oficial (https://hiove.io/gSBstV) para ter acesso.',
          errorCode: 'NO_ACCOUNT',
        };
      }
    } else if (hioveResult.status === 429) {
      if (registeredClaim) {
        return {
          success: true,
          access: true,
          hasDeposit: false,
          isAdmin: false,
          name: email.split('@')[0],
          email,
          cached: false,
          status: 'PENDING_DEPOSIT',
          message: 'Conta registrada! Acesso liberado à ferramenta (depósito pendente para ativação).',
        };
      }
      return {
        success: false,
        access: false,
        hasDeposit: false,
        isAdmin: false,
        name: '',
        email,
        cached: false,
        status: 'PENDING_DEPOSIT',
        message: 'Limite temporário de consultas atingido (máx. 30/min). Por favor, aguarde alguns minutos e tente novamente.',
        errorCode: 'RATE_LIMIT_429',
      };
    } else if (hioveResult.status === 401) {
      if (registeredClaim) {
        return {
          success: true,
          access: true,
          hasDeposit: false,
          isAdmin: false,
          name: email.split('@')[0],
          email,
          cached: false,
          status: 'PENDING_DEPOSIT',
          message: 'Conta registrada! Acesso liberado à ferramenta (depósito pendente para ativação).',
        };
      }
      return {
        success: false,
        access: false,
        hasDeposit: false,
        isAdmin: false,
        name: '',
        email,
        cached: false,
        status: 'PENDING_DEPOSIT',
        message: 'Não conseguimos validar agora, tente em alguns minutos.',
        errorCode: 'AUTH_401',
      };
    } else {
      if (registeredClaim) {
        return {
          success: true,
          access: true,
          hasDeposit: false,
          isAdmin: false,
          name: email.split('@')[0],
          email,
          cached: false,
          status: 'PENDING_DEPOSIT',
          message: 'Conta registrada! Acesso liberado à ferramenta (depósito pendente para ativação).',
        };
      }
      return {
        success: false,
        access: false,
        hasDeposit: false,
        isAdmin: false,
        name: '',
        email,
        cached: false,
        status: 'PENDING_DEPOSIT',
        message: 'Não conseguimos validar agora, tente em alguns minutos.',
        errorCode: `HTTP_${hioveResult.status}`,
      };
    }
  } catch (err: any) {
    if (registeredClaim) {
      return {
        success: true,
        access: true,
        hasDeposit: false,
        isAdmin: false,
        name: email.split('@')[0],
        email,
        cached: false,
        status: 'PENDING_DEPOSIT',
        message: 'Conta registrada! Acesso liberado à ferramenta (depósito pendente para ativação).',
      };
    }
    return {
      success: false,
      access: false,
      hasDeposit: false,
      isAdmin: false,
      name: '',
      email,
      cached: false,
      status: 'PENDING_DEPOSIT',
      message: 'Não conseguimos validar agora, tente em alguns minutos.',
      errorCode: 'NETWORK_ERROR',
    };
  }
}

// Inicializar na importação
loadRegistry();
