import React, { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
  symbol: string;
  timeframe: 'M1' | 'M5';
}

export const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({ symbol, timeframe }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
    script.type = 'text/javascript';
    script.async = true;

    // TradingView intervals: 1m, 5m
    const interval = timeframe === 'M1' ? '1m' : '5m';

    script.innerHTML = JSON.stringify({
      interval: interval,
      width: '100%',
      isTransparent: true,
      height: 220,
      symbol: symbol,
      showIntervalTabs: false,
      displayMode: 'single',
      locale: 'br',
      colorTheme: 'dark',
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, timeframe]);

  return (
    <div className="w-full overflow-hidden rounded-xl bg-neutral-950/70 border border-neutral-800/80 p-1">
      <div className="tradingview-widget-container" ref={containerRef}>
        <div className="tradingview-widget-container__widget"></div>
      </div>
    </div>
  );
};
