export type AssetCategory = 'FOREX' | 'CRYPTO';

export interface Asset {
  symbol: string;
  name: string;
  category: AssetCategory;
  pipDecimals: number;
  currentPrice: number;
  change24h: number;
  status: 'OPEN' | 'CLOSED';
  spread: number;
  hiovePayoutPercent?: number;
  tvSymbol: string;
}

export type TimeFrame = 'M1' | 'M2' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';
export type ExpirationTime = '1m' | '2m' | '5m';

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface SupportResistanceLevel {
  price: number;
  touches: number;
  type: 'SUPPORT' | 'RESISTANCE';
  strength: 'STRONG' | 'MEDIUM';
}

export interface OrderBlock {
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  candleIndex: number;
  mitigated: boolean;
}

export interface FairValueGap {
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  candleIndex: number;
}

export interface MarketAnalysis {
  trend: 'ALTA' | 'BAIXA' | 'LATERAL';
  buyerStrength: 'FORTE' | 'MODERADA' | 'FRACA';
  sellerStrength: 'FORTE' | 'MODERADA' | 'FRACA';
  dominantForce: 'COMPRADOR' | 'VENDEDOR' | 'EQUILIBRADO';
  
  // Price Action
  rejectionCandle: boolean;
  engulfingPattern: 'BULLISH' | 'BEARISH' | null;
  candleSequences: {
    color: 'GREEN' | 'RED';
    count: number;
  };
  exhaustionDetected: boolean;
  momentumAccelerating: boolean;

  // SMC
  bos: boolean;
  choch: boolean;
  activeOrderBlock: OrderBlock | null;
  activeFVG: FairValueGap | null;
  liquiditySweep: 'HIGH' | 'LOW' | null;

  // S/R
  nearSupport: boolean;
  nearResistance: boolean;
  inConsolidation: boolean;
  keyLevels: SupportResistanceLevel[];

  // Volatility
  atr: number;
  volatilityStatus: 'BAIXA' | 'NORMAL' | 'ALTA';

  // TradingView Direct Indicators
  tradingView: {
    symbol: string;
    recommendation: 'FORTE COMPRA' | 'COMPRA' | 'NEUTRO' | 'VENDA' | 'FORTE VENDA';
    rsi: number;
    rsiCondition: 'SOBRECOMPRADO' | 'SOBREVENDIDO' | 'NEUTRO';
    macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRO';
    emaCross: 'ALTA' | 'BAIXA' | 'NEUTRO';
    oscillatorsScore: { buy: number; neutral: number; sell: number };
    movingAveragesScore: { buy: number; neutral: number; sell: number };
    isLiveTradingView?: boolean;
    recommendationScore?: number;
    livePrice?: number;
  };
}

export type SignalDirection = 'CALL' | 'PUT';
export type ConfluenceClassification = 
  | 'SEM ENTRADA' 
  | 'OPORTUNIDADE EM OBSERVAÇÃO' 
  | 'CONFLUÊNCIA FORTE' 
  | 'CONFLUÊNCIA MUITO FORTE';

export interface ConfluenceBreakdown {
  marketStructureScore: number; // max 25
  priceActionScore: number;     // max 25
  supportResistanceScore: number; // max 20
  smcScore: number;             // max 20
  volatilityScore: number;      // max 10
  totalScore: number;           // 0 - 100
  direction: SignalDirection | 'NEUTRO';
  classification: ConfluenceClassification;
  reasons: string[];
}

export type SignalStage = 'PRE_ALERT' | 'CONFIRMED' | 'CANCELLED';
export type TradeResult = 'WIN' | 'LOSS' | 'EMPATE' | 'PENDING';

export type AnalysisProfile = 'CONSERVADORA' | 'MODERADA' | 'AGRESSIVA';

export interface SignalRecord {
  id: string;
  timestamp: number;
  formattedTime: string;
  asset: string;
  timeframe: TimeFrame;
  expiration: ExpirationTime;
  direction: SignalDirection;
  stage: SignalStage;
  confluenceScore: number;
  entryPrice: number;
  exitPrice?: number;
  candleOpenPrice?: number;
  candleClosePrice?: number;
  isEntered?: boolean;
  result: TradeResult;
  reasons: string[];
  aiAnalysis?: string;
  candleCloseTime: number;
  expirationTimestamp: number;
  entryTimestamp?: number; // Momento exato em segundos em que a ordem inicia (abertura da vela do sinal)
  isEstimatedResult: boolean;
  resolvedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
}

export interface DataSourceInfo {
  providerName: string;
  sourceType: 'REAL_FEED' | 'DEMO_MODE';
  status: 'CONNECTED' | 'DISCONNECTED' | 'LATENCY_WARNING';
  latencyMs: number;
  lastTickTime: number;
  disclaimer: string;
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  format: 'STANDARD_JSON' | 'DISCORD' | 'TELEGRAM' | 'GENERIC';
  secretToken?: string;
  sendPreAlert: boolean;
  sendConfirmed: boolean;
  sendResult: boolean;
  customHeaders?: string;
}

export interface WebhookLog {
  id: string;
  timestamp: number;
  formattedTime: string;
  event: 'PRE_ALERT' | 'CONFIRMED' | 'RESULT' | 'CANCELLED' | 'TEST';
  url: string;
  status: 'SUCCESS' | 'ERROR';
  httpCode?: number;
  responseMessage?: string;
  payloadPreview?: string;
}

export interface AppSettings {
  weights: {
    marketStructure: number;
    priceAction: number;
    supportResistance: number;
    smc: number;
    volatility: number;
  };
  thresholds: {
    observation: number; // 60
    strong: number;      // 75
    veryStrong: number;  // 90
  };
  soundEnabled: boolean;
  preAlertSound: boolean;
  confirmedSound: boolean;
  autoAiAnalysis: boolean;
  defaultExpiration: ExpirationTime;
  panelMinimized: boolean;
  panelPosition: { x: number; y: number };
  panelSize: { width: number; height: number };
  activeMode: 'REAL' | 'DEMO';
  analysisProfile?: AnalysisProfile; // CONSERVADORA (Sniper), MODERADA (Mediana), AGRESSIVA (Alavancagem)
  timerOffsetSeconds?: number; // Ajuste fino de tempo em segundos com a Hiove (-15s a +15s)
  webhook: WebhookConfig;
}

export interface UserSession {
  email: string;
  name: string;
  hasAccess: boolean;
  hasDeposit?: boolean;
  isAdmin: boolean;
  validatedAt: number;
  status: 'ACTIVE' | 'PENDING_DEPOSIT' | 'REVOKED';
  source?: 'HIOVE_API' | 'ADMIN_MANUAL' | 'CACHE' | 'ADMIN_BYPASS';
}

export interface MemberRecord {
  email: string;
  name?: string;
  hasAccess: boolean;
  hasDeposit?: boolean;
  isAdmin: boolean;
  status: 'ACTIVE' | 'PENDING_DEPOSIT' | 'REVOKED';
  source?: 'HIOVE_API' | 'ADMIN_MANUAL' | 'CACHE' | 'ADMIN_BYPASS';
  firstValidatedAt: number;
  lastCheckedAt: number;
  notes?: string;
}

export interface EconomicEvent {
  id: string;
  currency: string;
  event: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  time: string;
  forecast?: string;
  previous?: string;
  actual?: string;
  minutesUntil?: number;
  isUpcoming: boolean;
}

export interface MarketSessionInfo {
  currentSession: string;
  activeSessions: string[];
  currentTimeBrasilia: string;
  currentTimeUtc: string;
  volatilityRecommendation: string;
  isHighLiquidity: boolean;
}
