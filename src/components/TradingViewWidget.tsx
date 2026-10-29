import React, { useEffect, useRef } from 'react';
import { TimeFrame } from '../types/trading';

interface TradingViewWidgetProps {
  symbol: string;
  timeframe?: TimeFrame;
  mode?: 'CHART' | 'TECHNICAL';
  className?: string;
  height?: string | number;
}

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({
  symbol,
  timeframe = 'M1',
  mode = 'CHART',
  className = 'w-full h-full',
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;

    // Converte Timeframe para o formato aceito pelo TradingView
    let interval = '1';
    if (timeframe === 'M2') interval = '2';
    else if (timeframe === 'M5') interval = '5';
    else if (timeframe === 'M15') interval = '15';
    else if (timeframe === 'M30') interval = '30';
    else if (timeframe === 'H1') interval = '60';
    else if (timeframe === 'H4') interval = '240';
    else if (timeframe === 'D1') interval = 'D';

    if (mode === 'CHART') {
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      script.innerHTML = JSON.stringify({
        autosize: true,
        symbol: symbol,
        interval: interval,
        timezone: 'America/Sao_Paulo',
        theme: 'dark',
        style: '1', // Velas japonesas (Candlesticks)
        locale: 'br',
        enable_publishing: false,
        allow_symbol_change: false,
        calendar: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        backgroundColor: '#07090e',
        gridColor: 'rgba(255, 255, 255, 0.04)',
        support_host: 'https://www.tradingview.com',
      });
    } else {
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
      script.innerHTML = JSON.stringify({
        interval: timeframe === 'M5' ? '5m' : '1m',
        width: '100%',
        isTransparent: true,
        height: height || 220,
        symbol: symbol,
        showIntervalTabs: false,
        displayMode: 'single',
        locale: 'br',
        colorTheme: 'dark',
      });
    }

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.width = '100%';
    widgetDiv.style.height = '100%';

    containerRef.current.appendChild(widgetDiv);
    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, timeframe, mode, height]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="tradingview-widget-container w-full h-full"
        ref={containerRef}
        style={{ height: height ? (typeof height === 'number' ? `${height}px` : height) : '100%' }}
      />
    </div>
  );
};
