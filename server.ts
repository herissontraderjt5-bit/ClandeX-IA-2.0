import http from 'http';
import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  validateUserAccess,
  getAllMembers,
  grantMemberManual,
  revokeMember,
  deleteMember,
  queryHioveApi,
  ADMIN_EMAIL,
} from './server/memberRegistry.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/live' });

app.use(express.json());

// Endpoint de sincronização atômica de tempo UTC com a corretora Hiove
app.get('/api/time', (_req: Request, res: Response) => {
  res.json({
    serverTimeMs: Date.now(),
    serverSec: Math.floor(Date.now() / 1000),
  });
});

// Proxy de alta velocidade para o scanner oficial do TradingView (elimina bloqueios de CORS e latência)
app.post('/api/tradingview/scan', async (req: Request, res: Response) => {
  try {
    const category = req.query.category === 'crypto' ? 'crypto' : 'forex';
    const targetUrl = `https://scanner.tradingview.com/${category}/scan`;
    const tvResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(req.body),
    });

    if (!tvResponse.ok) {
      return res.status(tvResponse.status).json({ success: false, error: 'TradingView scanner respondeu com erro' });
    }

    const data = await tvResponse.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha no proxy TradingView' });
  }
});

/**
 * =========================================================================
 * AUTENTICAÇÃO E VALIDAÇÃO DE ACESSO DA CORRETORA HIOVE
 * =========================================================================
 */
// Valida se o cliente possui cadastro e depósito ativo na corretora Hiove
app.post('/api/auth/validate-access', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const result = await validateUserAccess(email);
    res.json(result);
  } catch (err: any) {
    console.error('[Auth API] Erro ao validar:', err);
    res.status(500).json({
      success: false,
      access: false,
      isAdmin: false,
      message: 'Não conseguimos validar agora, tente em alguns minutos.',
      error: err.message,
    });
  }
});

// Painel do Administrador: Lista de Membros e Estatísticas
app.get('/api/admin/members', (req: Request, res: Response) => {
  const adminEmail = (req.headers['x-admin-email'] || req.query.adminEmail || '').toString().toLowerCase().trim();
  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Acesso restrito ao Administrador Master.' });
  }

  const members = getAllMembers();
  const activeCount = members.filter((m) => m.hasAccess).length;
  const pendingCount = members.filter((m) => !m.hasAccess).length;

  res.json({
    success: true,
    adminEmail: ADMIN_EMAIL,
    total: members.length,
    activeCount,
    pendingCount,
    members,
    hioveKeyConfigured: Boolean(process.env.HIOVE_ACCESS_KEY),
    hioveKeyPreview: process.env.HIOVE_ACCESS_KEY
      ? `${process.env.HIOVE_ACCESS_KEY.slice(0, 14)}...${process.env.HIOVE_ACCESS_KEY.slice(-6)}`
      : 'NÃO CONFIGURADA',
  });
});

// Painel do Administrador: Liberação Manual de Membro
app.post('/api/admin/manual-grant', (req: Request, res: Response) => {
  const adminEmail = (req.headers['x-admin-email'] || req.body.adminEmail || '').toString().toLowerCase().trim();
  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Acesso restrito ao Administrador Master.' });
  }

  const { email, notes } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'E-mail inválido.' });
  }

  try {
    const member = grantMemberManual(email, notes);
    res.json({ success: true, member, message: `Acesso liberado com sucesso para ${email}.` });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Painel do Administrador: Revogar Acesso de Membro
app.post('/api/admin/revoke', (req: Request, res: Response) => {
  const adminEmail = (req.headers['x-admin-email'] || req.body.adminEmail || '').toString().toLowerCase().trim();
  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Acesso restrito ao Administrador Master.' });
  }

  const { email, notes } = req.body;
  try {
    const member = revokeMember(email, notes);
    res.json({ success: true, member, message: `Acesso do membro ${email} revogado.` });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Painel do Administrador: Excluir Membro
app.post('/api/admin/delete', (req: Request, res: Response) => {
  const adminEmail = (req.headers['x-admin-email'] || req.body.adminEmail || '').toString().toLowerCase().trim();
  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Acesso restrito ao Administrador Master.' });
  }

  const { email } = req.body;
  try {
    const ok = deleteMember(email);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Painel do Administrador: Testar e-mail diretamente contra API da Hiove
app.post('/api/admin/test-hiove', async (req: Request, res: Response) => {
  const adminEmail = (req.headers['x-admin-email'] || req.body.adminEmail || '').toString().toLowerCase().trim();
  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Acesso restrito ao Administrador Master.' });
  }

  const { email } = req.body;
  try {
    const result = await queryHioveApi(email);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Initialize Gemini Client with server-side API Key
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * Real-Time Voice Conversation with Gemini Live (gemini-3.8-live)
 * Low-latency bidirectional audio streaming via WebSocket
 */
wss.on('connection', (clientWs: WebSocket) => {
  let session: any = null;
  let isConnecting = false;

  clientWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Start session
      if (msg.type === 'start') {
        if (session || isConnecting) return;
        isConnecting = true;

        const { marketContext, voiceName = 'Aoede', userName = 'Herisson' } = msg;
        const asset = marketContext?.asset || 'EUR/USD';
        const currentPrice = marketContext?.currentPrice ?? 'N/A';
        const timeframe = marketContext?.timeframe || 'M1';
        const trend = marketContext?.marketAnalysis?.trend || 'LATERAL';
        const buyerStrength = marketContext?.marketAnalysis?.buyerStrength || 'MODERADA';
        const sellerStrength = marketContext?.marketAnalysis?.sellerStrength || 'MODERADA';
        const keyLevels = Array.isArray(marketContext?.marketAnalysis?.keyLevels) ? marketContext.marketAnalysis.keyLevels : [];
        const supports = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price);
        const resistances = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price);
        const confluences = marketContext?.confluences;
        const tv = marketContext?.marketAnalysis?.tradingView;
        const upcomingHigh = marketContext?.upcomingHighImpact;
        const relevantEvents = Array.isArray(marketContext?.relevantEvents) ? marketContext.relevantEvents : [];
        const marketSession = marketContext?.marketSession;

        const upcomingNewsSummary = upcomingHigh
          ? `${upcomingHigh.event} (${upcomingHigh.currency}) às ${upcomingHigh.time} - Impacto: ${upcomingHigh.impact}${upcomingHigh.minutesUntil !== undefined ? ` (faltam aprox. ${upcomingHigh.minutesUntil > 0 ? `${upcomingHigh.minutesUntil} minutos` : 'poucos instantes'})` : ''}. Projeção: ${upcomingHigh.forecast || 'N/A'} | Anterior: ${upcomingHigh.previous || 'N/A'}`
          : 'Sem notícias críticas de alto impacto agendadas para os próximos minutos.';

        const newsListSummary = relevantEvents.length > 0
          ? relevantEvents.slice(0, 4).map((e: any) => `${e.time}: [${e.currency}] ${e.event} (${e.impact === 'HIGH' ? 'ALTO IMPACTO' : 'Médio'})`).join('; ')
          : 'Sem eventos programados.';

        const systemInstruction = `
Você é a CandleX, assistente inteligente e mentora de trading institucional de Opções Binárias e Forex para o aplicativo CandleX-IA.
Você está em uma conversa falada contínua diretamente com o trader humano via microfone.

MEMÓRIA PESSOAL DO TRADER (REGRA SUPREMA):
- O nome do trader com quem você está conversando é ${userName || 'Herisson'}.
- Você SEMPRE sabe, reconhece e lembra que ele se chama ${userName || 'Herisson'}.
- Sempre que o ${userName || 'Herisson'} disser saudações ou cumprimentos (como "Olá", "Oi", "Bom dia", "Boa tarde", "Boa noite", "Tudo bem?", ou iniciar a conversa), cumprimente-o nominalmente de forma calorosa, acolhedora e respeitosa: "Olá, ${userName || 'Herisson'}!", "Bom dia, ${userName || 'Herisson'}!", "Boa tarde, ${userName || 'Herisson'}!" ou "Boa noite, ${userName || 'Herisson'}!".
- Mantenha sempre esse relacionamento próximo e profissional de mentoria de alta performance.

PERSONALIDADE (CANDLEX):
Profissional, natural, objetiva e amigável. Fale como um assistente humano especializado em análise técnica.

DADOS EM TEMPO REAL DO MERCADO ATUAL NO PAINEL:
- Ativo na tela: ${marketContext?.assetName || asset} (${asset.replace('/', ' ')})
- Timeframe: ${timeframe} | Preço Atual: ${currentPrice}
- Tendência Principal: ${trend}
- Força Compradora: ${buyerStrength} | Força Vendedora: ${sellerStrength}
- Suportes Técnicos: ${supports.length > 0 ? supports.join(', ') : 'Zonas dinâmicas'}
- Resistências Técnicas: ${resistances.length > 0 ? resistances.join(', ') : 'Zonas dinâmicas'}
- TradingView Recomendação: ${tv?.recommendation || 'NEUTRO'} (RSI: ${tv?.rsi || 'N/A'}, MACD: ${tv?.macdSignal || 'N/A'})
- Confluência do Robô: ${confluences?.totalScore ?? 0}/100 (${confluences?.direction ?? 'NEUTRO'})
- Próxima Notícia: ${upcomingNewsSummary}

DIRETRIZES DA CONVERSAÇÃO (ETAPA 7):
1. Responda naturalmente e com clareza em Português do Brasil.
2. Evite respostas longas: responda estritamente em 1 a 2 frases faladas.
3. Não use formatação markdown, asteriscos, tópicos ou numerações na fala.
4. Mantenha o contexto da conversa e entenda referências (ex: "e no gráfico de cinco minutos?").
5. Domine Price Action, Suporte e Resistência, Fluxo de candles, Tendência, Consolidação, Rompimento, Rejeição, CALL, PUT, M1, M5, Forex e Criptomoedas.
6. Não invente preços ou indicadores.
7. Não prometa lucros e não garanta resultados.
8. Se não houver confluência ou dados suficientes, informe com clareza.
9. PRONÚNCIA OBRIGATÓRIA DE ATIVOS E MOEDAS: NUNCA soletre pares de moedas ou ativos letra por letra (NUNCA diga "E-U-R U-S-D", "G-B-P U-S-D" ou "S-O-L"). Fale sempre o nome completo e natural: "Euro USD", "GBP USD", "Bitcoin USD", "Ethereum USD", "Solana USD", "Dólar Iene". NUNCA use barras ("/") ou hifens na sua fala ao citar o par, pois causam soletração robótica na síntese de áudio.
        `;

        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY') {
          isConnecting = false;
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: 'error',
                error: 'Chave GEMINI_API_KEY não configurada no servidor. Configure sua chave no .env para áudio Gemini Live.',
              })
            );
          }
          return;
        }

        const candidateModels = [
          process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
          'gemini-3.1-flash-live-preview',
          'gemini-3.8-flash',
          'gemini-3.5-flash',
        ];

        let connected = false;
        let lastErrorMsg = '';

        for (const candidate of candidateModels) {
          try {
            session = await ai.live.connect({
              model: candidate,
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: voiceName || 'Aoede' },
                  },
                },
                systemInstruction,
                outputAudioTranscription: {},
                inputAudioTranscription: {},
              },
              callbacks: {
                onmessage: (message: LiveServerMessage) => {
                  const parts = message.serverContent?.modelTurn?.parts || [];
                  for (const part of parts) {
                    if (part.inlineData?.data && clientWs.readyState === WebSocket.OPEN) {
                      clientWs.send(JSON.stringify({ type: 'audio', audio: part.inlineData.data }));
                    }
                    if (part.text && clientWs.readyState === WebSocket.OPEN) {
                      clientWs.send(JSON.stringify({ type: 'text', text: part.text }));
                    }
                  }

                  const outputText =
                    (message.serverContent as any)?.outputTranscription?.text ||
                    (message.serverContent as any)?.outputAudioTranscription?.text;
                  if (outputText && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'text', text: outputText }));
                  }

                  const userText =
                    (message.serverContent as any)?.inputTranscription?.text ||
                    (message.serverContent as any)?.inputAudioTranscription?.text;
                  if (userText && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'user_text', userText }));
                  }

                  if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'interrupted' }));
                  }

                  if (message.serverContent?.turnComplete && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'turn_complete' }));
                  }
                },
                onclose: () => {
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'closed' }));
                  }
                },
                onerror: (err: any) => {
                  console.error(`Gemini Live session error (${candidate}):`, err);
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'error', error: 'Erro na sessão de voz.' }));
                  }
                },
              },
            });

            connected = true;
            console.log(`[Gemini Live] Conectado com sucesso usando o modelo: ${candidate}`);
            break;
          } catch (connErr: any) {
            lastErrorMsg = connErr?.message || String(connErr);
            console.warn(`[Gemini Live] Falha com modelo ${candidate}: ${lastErrorMsg}`);
          }
        }

        isConnecting = false;
        if (connected && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'ready' }));
        } else if (!connected && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', error: lastErrorMsg || 'Falha ao conectar no Gemini Live.' }));
        }
      }

      // Audio from client microphone (16kHz PCM little-endian base64)
      if (msg.audio && session) {
        try {
          session.sendRealtimeInput({
            media: [{ data: msg.audio, mimeType: 'audio/pcm;rate=16000' }],
          });
        } catch (audioErr) {
          console.error('[Gemini Live] Erro ao enviar chunk de áudio:', audioErr);
        }
      }

      // Turn complete / Client Content / Direct Text
      if ((msg.type === 'turn_complete' || msg.type === 'client_content') && session) {
        try {
          if (msg.text && typeof msg.text === 'string' && msg.text.trim()) {
            console.log(`[Gemini Live] Enviando clientContent com texto: "${msg.text.trim()}"`);
            session.sendClientContent({
              turns: [
                {
                  role: 'user',
                  parts: [{ text: msg.text.trim() }],
                },
              ],
              turnComplete: true,
            });
          } else {
            console.log('[Gemini Live] Sinalizando turnComplete: true para o áudio...');
            session.sendClientContent({ turnComplete: true });
          }
        } catch (turnErr) {
          console.error('[Gemini Live] Erro ao enviar turnComplete:', turnErr);
        }
      } else if (msg.text && session) {
        try {
          session.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [{ text: msg.text }],
              },
            ],
            turnComplete: true,
          });
        } catch (txtErr) {
          console.error('[Gemini Live] Erro ao enviar texto:', txtErr);
        }
      }

      // Stop session
      if (msg.type === 'stop') {
        if (session) {
          try {
            session.close();
          } catch {}
          session = null;
        }
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'stopped' }));
        }
      }
    } catch (e) {
      console.error('Error in wss onmessage:', e);
    }
  });

  clientWs.on('close', () => {
    if (session) {
      try {
        session.close();
      } catch {}
      session = null;
    }
  });
});

// Signals in-memory persistent cache for server session
let savedSignals: any[] = [];

/**
 * AI Technical Commentary & SMC Interpretation
 */
app.post('/api/gemini/analyze', async (req: Request, res: Response) => {
  try {
    const { asset, timeframe, currentPrice, confluences, marketAnalysis } = req.body;

    const prompt = `
Você é a inteligência artificial analítica do sistema ClandeX-IA para Opções Binárias, especializado em confluências institucionais (Price Action, Smart Money Concepts, Suporte/Resistência e Fluxo de Velas) integrado para operações na corretora Hiove.

Dados Atuais do Mercado:
- Ativo: ${asset}
- Timeframe: ${timeframe}
- Preço Atual: ${currentPrice}
- Fonte de Análise Técnica: TRADINGVIEW DIRECT (${marketAnalysis?.tradingView?.symbol || asset})
- Recomendação TradingView: ${marketAnalysis?.tradingView?.recommendation || 'N/A'}
- RSI TradingView (14): ${marketAnalysis?.tradingView?.rsi || 'N/A'} (${marketAnalysis?.tradingView?.rsiCondition || ''})
- MACD TradingView: ${marketAnalysis?.tradingView?.macdSignal || 'N/A'}
- Médias Móveis TradingView: ${marketAnalysis?.tradingView?.movingAveragesScore?.buy || 0} Compra / ${marketAnalysis?.tradingView?.movingAveragesScore?.sell || 0} Venda
- Tendência: ${marketAnalysis?.trend || 'N/A'}
- Força Compradora: ${marketAnalysis?.buyerStrength || 'N/A'} | Força Vendedora: ${marketAnalysis?.sellerStrength || 'N/A'}
- Rompimento de Estrutura (BOS): ${marketAnalysis?.bos ? 'Detectado' : 'Não detectado'}
- Quebra de Caráter (CHoCH): ${marketAnalysis?.choch ? 'Detectado' : 'Não detectado'}
- Varredura de Liquidez (Sweep): ${marketAnalysis?.liquiditySweep || 'Nenhum'}
- Order Block Ativo: ${marketAnalysis?.activeOrderBlock ? JSON.stringify(marketAnalysis.activeOrderBlock) : 'Nenhum'}
- Fair Value Gap (FVG): ${marketAnalysis?.activeFVG ? JSON.stringify(marketAnalysis.activeFVG) : 'Nenhum'}
- Em Consolidação: ${marketAnalysis?.inConsolidation ? 'SIM (Risco de ruído)' : 'NÃO'}
- Pontuação de Confluência: ${confluences?.totalScore}/100 (${confluences?.classification})
- Direção Sugerida: ${confluences?.direction}
- Motivos Técnicos: ${confluences?.reasons?.join(', ') || 'N/A'}

Forneça um parecer técnico sucinto, objetivo e estritamente profissional (máximo de 3 parágrafos curtos) em português brasileiro:
1. Validação cruzada entre a indicação do TradingView, Price Action e Smart Money Concepts (SMC).
2. Riscos imediatos (ex: proximidade de S/R oposto, divergência de RSI ou consolidação).
3. Conclusão para operação de expiração rápida (${timeframe === 'M1' ? '1 minuto' : '5 minutos'}) na corretora Hiove.
NUNCA prometa lucros fixos ou garantias.
    `;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: 'Você é o analista técnico sênior da ClandeX-IA. Responda em tom direto, institucional e cirúrgico.',
        temperature: 0.3,
      },
    });

    const analysisText = response.text || 'Análise concluída com base nas confluências determinísticas calculadas.';

    res.json({
      success: true,
      analysis: analysisText,
    });
  } catch (error: any) {
    console.error('Gemini analysis error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Não foi possível gerar a interpretação via IA no momento. Confluências determinísticas continuam ativas.',
    });
  }
});

/**
 * Interactive Real-Time Trader AI Chat
 * Allows the trader to ask questions about support/resistance, trend strength, SMC, etc.
 */
app.post('/api/gemini/chat', async (req: Request, res: Response) => {
  try {
    const { messages, marketContext, userName = 'Herisson' } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'Lista de mensagens inválida.' });
    }

    const asset = marketContext?.asset || 'EUR/USD';
    const currentPrice = marketContext?.currentPrice ?? 'N/A';
    const timeframe = marketContext?.timeframe || 'M1';
    const trend = marketContext?.marketAnalysis?.trend || 'LATERAL';
    const buyerStrength = marketContext?.marketAnalysis?.buyerStrength || 'MODERADA';
    const sellerStrength = marketContext?.marketAnalysis?.sellerStrength || 'MODERADA';
    const keyLevels = Array.isArray(marketContext?.marketAnalysis?.keyLevels) ? marketContext.marketAnalysis.keyLevels : [];
    const supports = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price);
    const resistances = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price);
    const confluences = marketContext?.confluences;
    const tv = marketContext?.marketAnalysis?.tradingView;
    const upcomingHigh = marketContext?.upcomingHighImpact;
    const relevantEvents = Array.isArray(marketContext?.relevantEvents) ? marketContext.relevantEvents : [];
    const marketSession = marketContext?.marketSession;

    const upcomingNewsSummary = upcomingHigh
      ? `${upcomingHigh.event} (${upcomingHigh.currency}) às ${upcomingHigh.time} - Impacto: ${upcomingHigh.impact}${upcomingHigh.minutesUntil !== undefined ? ` (faltam aprox. ${upcomingHigh.minutesUntil > 0 ? `${upcomingHigh.minutesUntil} minutos` : 'poucos instantes'})` : ''}. Projeção: ${upcomingHigh.forecast || 'N/A'} | Anterior: ${upcomingHigh.previous || 'N/A'}`
      : 'Sem notícias críticas de alto impacto agendadas para os próximos minutos.';

    const newsListFormatted = relevantEvents.length > 0
      ? relevantEvents.slice(0, 6).map((e: any) => `• ${e.time} - [${e.currency}] ${e.event} (${e.impact === 'HIGH' ? 'ALTO IMPACTO' : 'Médio'})`).join('\n')
      : 'Sem eventos programados.';

    const systemInstruction = `
Você é a ClandeX-IA Conversacional, uma inteligência artificial institucional e mentora de alta performance para Opções Binárias e Forex, especializada em Price Action avançado, Suporte e Resistência, Força de Tendência e Smart Money Concepts (SMC) integrada à corretora Hiove.

MEMÓRIA PESSOAL DO TRADER:
- O nome do trader com quem você está conversando é ${userName || 'Herisson'}.
- Sempre que ele enviar saudações ("Olá", "Oi", "Bom dia", "Boa tarde", "Boa noite", "Tudo bem?"), cumprimente-o nominalmente de forma amigável e profissional: "Olá, ${userName || 'Herisson'}!", "Bom dia, ${userName || 'Herisson'}!", "Boa tarde, ${userName || 'Herisson'}!" ou "Boa noite, ${userName || 'Herisson'}!".

Você está conversando DIRETAMENTE com o trader humano. Ele pode tirar dúvidas, pedir análises de regiões, perguntar sobre a força da tendência, perguntar sobre a PRÓXIMA NOTÍCIA / CALENDÁRIO ECONÔMICO, perguntar se deve entrar agora ou aguardar um pullback.

DADOS EM TEMPO REAL DO MERCADO ATUAL (USE ESTES DADOS PARA EMBASAR TODAS AS SUAS RESPOSTAS):
- Ativo Selecionado: ${asset} (${marketContext?.assetName || ''})
- Timeframe: ${timeframe}
- Preço Atual: ${currentPrice}
- Spread: ${marketContext?.spread ?? 0.8} pips
- Tendência Predominante: ${trend}
- Força Compradora: ${buyerStrength} | Força Vendedora: ${sellerStrength}
- Suportes Técnicos Detectados: ${supports.length > 0 ? supports.join(', ') : 'Próximos em cálculo dinâmico'}
- Resistências Técnicas Detectadas: ${resistances.length > 0 ? resistances.join(', ') : 'Próximos em cálculo dinâmico'}
- Rompimento de Estrutura (BOS): ${marketContext?.marketAnalysis?.bos ? 'DETECTADO (Continuação provável)' : 'Nenhum recente'}
- Quebra de Caráter (CHoCH): ${marketContext?.marketAnalysis?.choch ? 'DETECTADO (Possível reversão)' : 'Nenhum'}
- Order Block Ativo: ${marketContext?.marketAnalysis?.activeOrderBlock ? JSON.stringify(marketContext.marketAnalysis.activeOrderBlock) : 'Nenhum'}
- Fair Value Gap (FVG): ${marketContext?.marketAnalysis?.activeFVG ? JSON.stringify(marketContext.marketAnalysis.activeFVG) : 'Nenhum'}
- Varredura de Liquidez (Liquidity Sweep): ${marketContext?.marketAnalysis?.liquiditySweep || 'Nenhum'}
- Em Consolidação: ${marketContext?.marketAnalysis?.inConsolidation ? 'SIM (Cuidado com falso rompimento)' : 'NÃO (Mercado em fluxo direcional)'}
- TradingView Técnico:
  * Recomendação Geral: ${tv?.recommendation || 'NEUTRO'}
  * RSI (14): ${tv?.rsi || 'N/A'} (${tv?.rsiCondition || 'Equilibrado'})
  * MACD: ${tv?.macdSignal || 'N/A'}
  * Médias Móveis: ${tv?.movingAveragesScore?.buy || 0} Compra / ${tv?.movingAveragesScore?.sell || 0} Venda
- Confluência Determinística do Robô:
  * Score Geral: ${confluences?.totalScore ?? 0}/100 (${confluences?.classification ?? 'NEUTRO'})
  * Direção Calculada: ${confluences?.direction ?? 'NEUTRO'}
  * Motivos de Entrada: ${confluences?.reasons?.join('; ') || 'Aguardando confluência plena'}

CALENDÁRIO ECONÔMICO & NOTÍCIAS EM TEMPO REAL:
- Sessão do Mercado: ${marketSession?.currentSession || 'Mercado Aberto'} (Horário Brasília: ${marketSession?.currentTimeBrasilia || 'N/A'})
- Próxima Notícia Crítica: ${upcomingNewsSummary}
- Calendário de Notícias do Ativo:
${newsListFormatted}

DIRETRIZES DE COMUNICAÇÃO:
1. Responda em Português do Brasil com clareza cirúrgica, tom profissional e empático de um trader mentor experiente.
2. Quando o trader perguntar sobre "notícia", "próxima notícia", "calendário econômico", "tem notícia agora?":
   - Informe EXATAMENTE o nome da próxima notícia (${upcomingHigh?.event || 'próximos dados'}), a moeda afetada (${upcomingHigh?.currency || 'USD'}), o horário agendado (${upcomingHigh?.time || 'em breve'}) e quanto tempo falta.
   - Forneça a projeção vs anterior se houver.
   - Dê uma recomendação operacional estrita: Não operar 5 a 10 minutos antes e depois de notícias de alto impacto devido a forte volatilidade, spread elevado e risco de rompimento falso.
   - NUNCA responda algo evasivo ou desconexo quando perguntarem sobre notícias.
3. Quando o trader perguntar sobre "suporte e resistência", cite explicitamente os valores das regiões calculadas, explique a distância atual do preço e se são zonas seguras para retração ou rompimento.
4. Quando o trader perguntar sobre a "força da tendência maior", faça o cruzamento entre a tendência principal (${trend}), o placar de Médias Móveis do TradingView (${tv?.movingAveragesScore?.buy || 0}C / ${tv?.movingAveragesScore?.sell || 0}V) e as forças compradora/vendedora.
5. Quando perguntar se "vale a pena entrar agora", avalie a pontuação de confluência atual (${confluences?.totalScore}/100) e o tempo de expiração (${timeframe === 'M1' ? '1 minuto' : '5 minutos'}). Se estiver em consolidação ou sem confluência suficiente (abaixo de 70), recomende prudência ou aguardar o pré-alerta.
6. Use formatação legível com tópicos breves ou negritos para os pontos mais cruciais.
7. Nunca prometa garantias de lucro ou certeza de 100%. Lembre sempre do gerenciamento de banca.
`;

    // Map conversation history
    const contents = messages.map((m: any) => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.text || m.content || '') }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
        temperature: 0.4,
      },
    });

    const reply = response.text || 'Entendido. Estou monitorando o gráfico e as confluências em tempo real.';

    res.json({
      success: true,
      reply,
    });
  } catch (error: any) {
    console.error('Gemini chat error:', error?.message || error);
    
    // Fallback heuristic response in case of API transient error
    const { marketContext, messages } = req.body || {};
    const lastMsg = messages?.[messages.length - 1]?.text?.toLowerCase() || '';
    const asset = marketContext?.asset || 'o ativo atual';
    const trend = marketContext?.marketAnalysis?.trend || 'LATERAL';
    const keyLevels = Array.isArray(marketContext?.marketAnalysis?.keyLevels) ? marketContext.marketAnalysis.keyLevels : [];
    const supports = keyLevels.filter((k: any) => k.type === 'SUPPORT').map((k: any) => k.price);
    const resistances = keyLevels.filter((k: any) => k.type === 'RESISTANCE').map((k: any) => k.price);
    const buyer = marketContext?.marketAnalysis?.buyerStrength || 'MODERADA';
    const seller = marketContext?.marketAnalysis?.sellerStrength || 'MODERADA';
    const score = marketContext?.confluences?.totalScore || 70;
    const upcomingHigh = marketContext?.upcomingHighImpact;

    let fallbackReply = `Estou monitorando ${asset} em tempo real. `;
    if (lastMsg.includes('notic') || lastMsg.includes('notíc') || lastMsg.includes('calend') || lastMsg.includes('impacto') || lastMsg.includes('evento') || lastMsg.includes('news')) {
      if (upcomingHigh) {
        fallbackReply = `📢 **Próxima Notícia de Alto Impacto para ${asset}:**\n\n• **Evento:** ${upcomingHigh.event}\n• **Moeda:** ${upcomingHigh.currency}\n• **Horário:** ${upcomingHigh.time} (${upcomingHigh.minutesUntil !== undefined && upcomingHigh.minutesUntil > 0 ? `faltam aprox. ${upcomingHigh.minutesUntil} minutos` : 'iminente'})\n• **Impacto:** 🔥 ALTO IMPACTO (3 Touros)\n• **Projeção:** ${upcomingHigh.forecast || 'N/A'} | Anterior: ${upcomingHigh.previous || 'N/A'}\n\n⚠️ **Recomendação de Risco:** Evite abrir operações nos 5 minutos anteriores e posteriores à divulgação para evitar oscilações abruptas e spread.`;
      } else {
        fallbackReply = `📅 **Calendário Econômico de ${asset}:**\nNão há notícias de alto impacto imediatas agendadas para os próximos minutos. O fluxo técnico de confluências está com caminho livre.`;
      }
    } else if (lastMsg.includes('suporte') || lastMsg.includes('resistencia') || lastMsg.includes('regio')) {
      fallbackReply += `As regiões calculadas são:\n• Suportes: ${supports.length > 0 ? supports.join(', ') : 'Zonas dinâmicas de fundo'}\n• Resistências: ${resistances.length > 0 ? resistances.join(', ') : 'Zonas dinâmicas de topo'}\nO preço atual está próximo a essas zonas de liquidez.`;
    } else if (lastMsg.includes('tendencia') || lastMsg.includes('forca')) {
      fallbackReply += `A tendência atual é de **${trend}**. A força compradora está avaliada como **${buyer}** e a força vendedora como **${seller}**.`;
    } else {
      fallbackReply += `A pontuação de confluência atual é de **${score}/100**. A tendência predominante é **${trend}**. Recomendo aguardar o pré-alerta e a confirmação para entrada.`;
    }

    res.json({
      success: true,
      reply: fallbackReply,
      fallback: true,
    });
  }
});

/**
 * Signals History Persistence
 */
app.get('/api/signals', (req: Request, res: Response) => {
  res.json({ signals: savedSignals });
});

app.post('/api/signals', (req: Request, res: Response) => {
  const signal = req.body;
  if (signal && signal.id) {
    const existingIndex = savedSignals.findIndex(s => s.id === signal.id);
    if (existingIndex >= 0) {
      savedSignals[existingIndex] = signal;
    } else {
      savedSignals.unshift(signal);
      if (savedSignals.length > 200) savedSignals.pop();
    }
  }
  res.json({ success: true, count: savedSignals.length });
});

/**
 * Webhook Dispatcher & External Automation System
 */
async function dispatchWebhook(options: {
  url: string;
  format: string;
  secretToken?: string;
  customHeaders?: string;
  event: string;
  signal: any;
}) {
  const startTime = Date.now();
  let bodyPayload: any = {};

  const sig = options.signal || {};
  const isCall = sig.direction === 'CALL';

  if (options.format === 'DISCORD') {
    bodyPayload = {
      content: options.event === 'TEST'
        ? '🧪 **[TESTE] Conexão ClandeX-IA Webhook Ativa!**'
        : `🚨 **ClandeX-IA • SINAL ${options.event === 'PRE_ALERT' ? 'PRÉ-ALERTA' : 'CONFIRMADO'}**`,
      embeds: [
        {
          title: `${sig.asset || 'EUR/USD'} — ${sig.direction || 'CALL'} (${isCall ? 'COMPRA' : 'VENDA'})`,
          description: options.event === 'PRE_ALERT'
            ? 'Aguardando fechamento da vela para confirmação.'
            : options.event === 'RESULT'
            ? `Operação finalizada: Resultado ${sig.result || 'WIN'}`
            : 'Entrada na abertura da próxima vela.',
          color: isCall ? 3066993 : 15158332,
          fields: [
            { name: 'Timeframe', value: `${sig.timeframe || 'M1'}`, inline: true },
            { name: 'Expiração', value: `${sig.expiration || '1m'}`, inline: true },
            { name: 'Confluência', value: `${sig.confluenceScore || 85}/100`, inline: true },
            { name: 'Preço Ref.', value: `${sig.entryPrice || 'Mercado'}`, inline: true },
            { name: 'TradingView', value: `${sig.tradingView?.symbol || 'FX'} • ${sig.tradingView?.recommendation || 'OK'}`, inline: true },
            { name: 'Corretora', value: 'Hiove (hiove.io)', inline: true },
            { name: 'Motivos Técnicos', value: Array.isArray(sig.reasons) ? sig.reasons.join(', ') : 'Confluência Price Action + SMC' },
          ],
          footer: { text: 'ClandeX-IA • Trading Automation' },
          timestamp: new Date().toISOString(),
        },
      ],
    };
  } else if (options.format === 'TELEGRAM') {
    const textMsg = `🎯 *CLANDEX-IA • ${options.event === 'PRE_ALERT' ? 'PRÉ-ALERTA' : options.event === 'TEST' ? 'TESTE DE CONEXÃO' : options.event === 'RESULT' ? 'RESULTADO DE OPERAÇÃO' : 'SINAL CONFIRMADO'}*\n\n` +
      `📈 *ATIVO:* ${sig.asset || 'EUR/USD'}\n` +
      `🧭 *DIREÇÃO:* ${sig.direction || 'CALL'} (${isCall ? 'COMPRA' : 'VENDA'})\n` +
      `⏱ *TIMEFRAME:* ${sig.timeframe || 'M1'} (Exp: ${sig.expiration || '1m'})\n` +
      `💎 *CONFLUÊNCIA:* ${sig.confluenceScore || 85}/100\n` +
      `📊 *TRADINGVIEW:* ${sig.tradingView?.recommendation || 'FORTE COMPRA'}\n` +
      `🏛 *CORRETORA:* Hiove (hiove.io)\n` +
      `🏷 *PREÇO:* ${sig.entryPrice || 'Mercado'}\n` +
      (sig.result ? `🏆 *RESULTADO:* ${sig.result}\n` : '') +
      `📝 *MOTIVOS:* ${Array.isArray(sig.reasons) ? sig.reasons.slice(0, 2).join('; ') : 'Price Action & SMC'}\n\n` +
      `_Opere com gerenciamento de risco._`;
    bodyPayload = {
      text: textMsg,
      parse_mode: 'Markdown',
    };
  } else {
    // STANDARD_JSON / GENERIC
    bodyPayload = {
      event: options.event,
      source: 'ClandeX-IA',
      timestamp: Date.now(),
      broker: 'Hiove',
      signal: sig,
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ClandeX-IA-Webhook/1.0',
  };

  if (options.secretToken) {
    headers['Authorization'] = `Bearer ${options.secretToken}`;
    headers['X-Webhook-Secret'] = options.secretToken;
  }

  if (options.customHeaders) {
    try {
      const parsed = JSON.parse(options.customHeaders);
      Object.assign(headers, parsed);
    } catch {
      options.customHeaders.split('\n').forEach(line => {
        const [k, ...v] = line.split(':');
        if (k && v.length) headers[k.trim()] = v.join(':').trim();
      });
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const elapsed = Date.now() - startTime;
    let responseText = '';
    try {
      responseText = await response.text();
    } catch {}

    const isOk = response.ok;
    return {
      success: isOk,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: elapsed,
      responsePreview: responseText.slice(0, 300),
      message: isOk
        ? `Webhook entregue com sucesso (HTTP ${response.status}) em ${elapsed}ms.`
        : `Servidor de destino retornou erro HTTP ${response.status}.`,
    };
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    return {
      success: false,
      status: 0,
      elapsedMs: elapsed,
      error: err.name === 'AbortError' ? 'Tempo limite de requisição excedido (timeout de 8s)' : err.message,
      message: `Falha ao conectar com o Webhook: ${err.message}`,
    };
  }
}

app.post('/api/webhook/test', async (req: Request, res: Response) => {
  const { url, format, secretToken, customHeaders } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL do Webhook é obrigatória.' });
  }

  const sampleSignal = {
    id: `test_${Date.now()}`,
    timestamp: Date.now(),
    formattedTime: new Date().toLocaleTimeString('pt-BR'),
    asset: 'EUR/USD',
    timeframe: 'M1',
    expiration: '1m',
    direction: 'CALL',
    confluenceScore: 92,
    entryPrice: 1.08485,
    reasons: ['Padrão Engolfo de Alta', 'SMC: Order Block Comprador', 'TradingView: FORTE COMPRA'],
    tradingView: {
      symbol: 'FX:EURUSD',
      recommendation: 'FORTE COMPRA',
      rsi: 62,
      macdSignal: 'BULLISH',
    },
  };

  const dispatchResult = await dispatchWebhook({
    url,
    format: format || 'STANDARD_JSON',
    secretToken,
    customHeaders,
    event: 'TEST',
    signal: sampleSignal,
  });

  res.json(dispatchResult);
});

app.post('/api/webhook/send', async (req: Request, res: Response) => {
  const { url, format, secretToken, customHeaders, event, signal } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL do Webhook é obrigatória.' });
  }

  const dispatchResult = await dispatchWebhook({
    url,
    format: format || 'STANDARD_JSON',
    secretToken,
    customHeaders,
    event: event || 'CONFIRMED',
    signal,
  });

  res.json(dispatchResult);
});

/**
 * Chrome Extension Source Bundler
 * Provides downloadable code so traders can inject ClandeX-IA directly into hiove.io
 */
app.get('/api/extension/manifest', (req: Request, res: Response) => {
  const extensionManifest = {
    manifest_version: 3,
    name: "ClandeX-IA — HUD Flutuante Hiove",
    version: "1.0.0",
    description: "Painel flutuante arrastável com sinais de Price Action e SMC para a corretora Hiove.",
    permissions: ["storage", "activeTab"],
    host_permissions: ["https://hiove.io/*", "https://*.hiove.io/*"],
    action: {
      default_title: "Abrir ClandeX-IA HUD",
      default_popup: "popup.html"
    },
    content_scripts: [
      {
        matches: ["https://hiove.io/*", "https://*.hiove.io/*"],
        js: ["content_script.js"],
        run_at: "document_idle"
      }
    ]
  };
  res.json(extensionManifest);
});

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req: Request, res: Response) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  server.listen(PORT, () => {
    console.log(`[ClandeX-IA] Server running on port ${PORT} (HTTP + Live WebSocket)`);
  });
}

startServer();
