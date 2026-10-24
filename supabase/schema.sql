-- =========================================================================
-- ClandeX-IA 2.0 — Supabase Schema & Realtime Architecture
-- Project: https://qxojtaqselrgitdmmora.supabase.co
-- =========================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. SIGNALS TABLE (Sinais de Trading, SMC, Price Action e Confluência)
CREATE TABLE IF NOT EXISTS public.signals (
    id TEXT PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    formatted_time TEXT NOT NULL,
    asset TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    expiration TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('CALL', 'PUT')),
    stage TEXT NOT NULL CHECK (stage IN ('PRE_ALERT', 'CONFIRMED', 'CANCELLED')),
    confluence_score NUMERIC NOT NULL,
    entry_price NUMERIC NOT NULL,
    exit_price NUMERIC,
    result TEXT NOT NULL DEFAULT 'PENDING' CHECK (result IN ('WIN', 'LOSS', 'EMPATE', 'PENDING')),
    reasons JSONB DEFAULT '[]'::jsonb,
    ai_analysis TEXT,
    candle_close_time BIGINT,
    expiration_timestamp BIGINT,
    is_estimated_result BOOLEAN DEFAULT false,
    resolved_at BIGINT,
    cancelled_at BIGINT,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Indexes for lightning fast queries on signals
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON public.signals(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signals_asset ON public.signals(asset);
CREATE INDEX IF NOT EXISTS idx_signals_result ON public.signals(result);
CREATE INDEX IF NOT EXISTS idx_signals_stage ON public.signals(stage);

-- 3. APP SETTINGS TABLE (Pesos de Confluência, Alertas, Webhook & Perfil)
CREATE TABLE IF NOT EXISTS public.app_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    weights JSONB NOT NULL DEFAULT '{
        "marketStructure": 25,
        "priceAction": 25,
        "supportResistance": 20,
        "smc": 20,
        "volatility": 10
    }'::jsonb,
    thresholds JSONB NOT NULL DEFAULT '{
        "observation": 60,
        "strong": 75,
        "veryStrong": 90
    }'::jsonb,
    sound_enabled BOOLEAN DEFAULT true,
    pre_alert_sound BOOLEAN DEFAULT true,
    confirmed_sound BOOLEAN DEFAULT true,
    auto_ai_analysis BOOLEAN DEFAULT true,
    default_expiration TEXT DEFAULT '1m',
    panel_minimized BOOLEAN DEFAULT false,
    panel_position JSONB DEFAULT '{"x": 20, "y": 80}'::jsonb,
    panel_size JSONB DEFAULT '{"width": 420, "height": 650}'::jsonb,
    active_mode TEXT DEFAULT 'REAL',
    webhook JSONB DEFAULT '{
        "enabled": false,
        "url": "",
        "format": "STANDARD_JSON",
        "sendPreAlert": false,
        "sendConfirmed": true,
        "sendResult": true
    }'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Insert default settings row if not present
INSERT INTO public.app_settings (id) 
VALUES ('default') 
ON CONFLICT (id) DO NOTHING;

-- 4. WEBHOOK LOGS TABLE (Auditoria de envios Discord/Telegram/Custom)
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id TEXT PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    formatted_time TEXT NOT NULL,
    event TEXT NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'ERROR')),
    http_code INTEGER,
    response_message TEXT,
    payload_preview TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_timestamp ON public.webhook_logs(timestamp DESC);

-- 5. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- 6. RLS POLICIES (Acesso anônimo/público e autenticado com chave pública anon)
-- Signals policies
DROP POLICY IF EXISTS "Permitir leitura pública de sinais" ON public.signals;
CREATE POLICY "Permitir leitura pública de sinais"
    ON public.signals FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir inserção de sinais" ON public.signals;
CREATE POLICY "Permitir inserção de sinais"
    ON public.signals FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir atualização de sinais" ON public.signals;
CREATE POLICY "Permitir atualização de sinais"
    ON public.signals FOR UPDATE
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir exclusão de sinais" ON public.signals;
CREATE POLICY "Permitir exclusão de sinais"
    ON public.signals FOR DELETE
    TO anon, authenticated
    USING (true);

-- App Settings policies
DROP POLICY IF EXISTS "Permitir leitura pública de configurações" ON public.app_settings;
CREATE POLICY "Permitir leitura pública de configurações"
    ON public.app_settings FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir atualização de configurações" ON public.app_settings;
CREATE POLICY "Permitir atualização de configurações"
    ON public.app_settings FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Webhook Logs policies
DROP POLICY IF EXISTS "Permitir leitura pública de logs de webhook" ON public.webhook_logs;
CREATE POLICY "Permitir leitura pública de logs de webhook"
    ON public.webhook_logs FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir inserção de logs de webhook" ON public.webhook_logs;
CREATE POLICY "Permitir inserção de logs de webhook"
    ON public.webhook_logs FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir exclusão de logs de webhook" ON public.webhook_logs;
CREATE POLICY "Permitir exclusão de logs de webhook"
    ON public.webhook_logs FOR DELETE
    TO anon, authenticated
    USING (true);

-- 7. SUPABASE REALTIME REPLICATION
-- Habilita escuta em tempo real para sincronização instantânea entre abas e dispositivos
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
