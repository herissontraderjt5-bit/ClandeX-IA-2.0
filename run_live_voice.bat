@echo off
title ClandeX-IA 2.0 - Gemini Live Voice & Vision
echo =======================================================
echo    ClandeX-IA 2.0 - Gemini Live Voice & Vision (3.8)
echo =======================================================
echo.

echo [1/2] Verificando dependencias...
pip install -r requirements-live.txt

echo.
echo [2/2] Iniciando Gemini Live com analise de tela TradingView...
echo (Pressione Ctrl+C para encerrar)
echo.

python gemini_live_voice.py --mode screen
pause
