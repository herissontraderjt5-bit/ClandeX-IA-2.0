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
 * POST https://access.hiove.io/api/v1/access-check
 * Authorization: Bearer process.env.HIOVE_KEY
 * Content-Type: application/json
 * Body: {"email": "cliente@exemplo.com"}
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
 * Fluxo de validação de acesso conforme as especificações oficiais:
 * 1. Admin Master -> Acesso imediato liberado
 * 2. Já liberado na base (access: true guardado) -> Retorna direto sem consultar a API Hiove
 * 3. Usuário novo ou quem veio false -> Consulta a API da Hiove (POST /api/v1/access-check)
 *    - {"access": true} -> É cliente cadastrado pelo link e já fez depósito na corretora. Pode liberar.
 *    - {"access": false} -> Não liberar (não tem cadastro pelo link ou ainda não depositou).
 * 4. Tratamento de erros:
 *    - 400: e-mail vazio ou inválido
 *    - 401, 429, 500 ou falha de conexão: NÃO LIBERAR.
 *      Mostra: "Não conseguimos validar agora, tente em alguns minutos."
 */
export async function validateUserAccess(emailInput: string): Promise<{
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

  // 2. Regra: "Consulte uma vez e guarde o resultado. Quando vier true, marque o usuário como liberado na sua base e não consulte de novo a cada login."
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

  // 3. Regra: "Quem veio false você pode consultar de novo depois, por exemplo quando a pessoa disser que já depositou."
  try {
    const hioveResult = await queryHioveApi(email);

    if (hioveResult.status === 200) {
      if (hioveResult.access === true) {
        // {"access": true} → é cliente cadastrado pelo seu link e já fez depósito na corretora. Pode liberar.
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
        // {"access": false} → não liberar (não tem cadastro pelo seu link ou ainda não depositou).
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
          notes: 'Não liberado pela API Hiove (sem cadastro pelo link ou sem depósito)',
        };
        membersMap[email] = record;
        saveRegistryFile();

        return {
          success: false,
          access: false,
          hasDeposit: false,
          isAdmin: false,
          name: '',
          email,
          cached: false,
          status: 'PENDING_DEPOSIT',
          message: 'Acesso não liberado. Certifique-se de que cadastrou sua conta na Hiove pelo nosso link e efetuou o depósito para ativar o acesso.',
          errorCode: 'NO_ACCESS',
        };
      }
    } else if (hioveResult.status === 400) {
      // 400: e-mail vazio ou inválido
      return {
        success: false,
        access: false,
        hasDeposit: false,
        isAdmin: false,
        name: '',
        email,
        cached: false,
        status: 'PENDING_DEPOSIT',
        message: 'E-mail vazio ou inválido na corretora Hiove.',
        errorCode: 'INVALID_EMAIL_400',
      };
    } else {
      // 401: chave errada ou desativada
      // 429: limite de consultas atingido (30/min, 3000/dia)
      // 500 ou outros: falha no servidor
      // Regra: "Se der erro (401, 429, 500 ou falha de conexão), não libere o acesso. Mostre algo como 'não conseguimos validar agora, tente em alguns minutos'."
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
    console.error('[Hiove API] Erro na consulta ou falha de conexão:', err?.message || err);
    // Regra: falha de conexão -> não liberar o acesso e mostrar mensagem padrão
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
      errorCode: 'CONNECTION_ERROR',
    };
  }
}

// Inicializar na importação
loadRegistry();
