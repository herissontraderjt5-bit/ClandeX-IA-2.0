#!/usr/bin/env python3
"""
=============================================================================
ClandeX-IA 2.0 — Live Voice & Vision (Gemini 3.8 Multimodal Live API)
=============================================================================
Conecta diretamente à Live API do Gemini 3.8 (models/gemini-3.8-live) com
transmissão bidirecional de áudio em tempo real e captura de tela (TradingView).

Requisitos:
    pip install google-genai opencv-python pyaudio pillow mss python-dotenv

Execução:
    python gemini_live_voice.py --mode screen   (Analisa a tela do TradingView)
    python gemini_live_voice.py --mode camera   (Analisa a webcam)
    python gemini_live_voice.py --mode none     (Apenas áudio / microfone)
"""

import os
import sys
import asyncio
import base64
import io
import traceback
import argparse
from pathlib import Path

# Carrega automaticamente chave GEMINI_API_KEY do arquivo .env
def load_env_file():
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k and not os.environ.get(k):
                            os.environ[k] = v
        except Exception:
            pass

load_env_file()

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("VITE_GEMINI_API_KEY")
if not api_key:
    print("ERRO: GEMINI_API_KEY não encontrada no ambiente nem no arquivo .env.")
    print("Por favor, defina GEMINI_API_KEY ou insira no arquivo .env")
    sys.exit(1)

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Biblioteca google-genai não encontrada.")
    print("Execute: pip install google-genai")
    sys.exit(1)

try:
    import pyaudio
except ImportError:
    print("Biblioteca pyaudio não encontrada.")
    print("Execute: pip install pyaudio (no Windows: pip install pipwin && pipwin install pyaudio se necessário)")
    pyaudio = None

try:
    import PIL.Image
except ImportError:
    print("Biblioteca pillow não encontrada. Execute: pip install pillow")
    PIL = None

FORMAT = pyaudio.paInt16 if pyaudio else 2
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024

MODEL = os.environ.get("GEMINI_LIVE_MODEL", "models/gemini-3.8-live")
if not MODEL.startswith("models/"):
    MODEL = f"models/{MODEL}"

DEFAULT_MODE = "screen"

SYSTEM_INSTRUCTION = """
Você é a CandleX, assistente inteligente e parceira de trading institucional de Opções Binárias e Forex no app CandleX-IA.
Você conversa em áudio em tempo real com o trader e está visualizando a tela dele (gráfico do TradingView com candles, tendências, suportes e resistências).

DIRETRIZES DA CONVERSAÇÃO (100% NATURAL, HUMANA E DIRETA):
1. Converse como uma parceira de trading real brasileira: ágil, calorosa, confiante e atenta.
2. Analise a tela que você está vendo em tempo real (identifique o par de moedas, a cor e padrão do candle atual, suporte, resistência e confluência).
3. Responda SEMPRE de forma concisa e rápida (1 a 2 frases curtas faladas, máximo 30 palavras) para uma conversa fluida sem atrasos.
4. NUNCA use formatação markdown, asteriscos ou tópicos na sua fala.
5. Fale nomes normais de moedas ("Euro USD", "GBP USD", "Bitcoin", "Dólar Iene"). NUNCA soletre letra por letra.
"""

client = genai.Client(
    http_options={"api_version": "v1beta"},
    api_key=api_key,
)

CONFIG = types.LiveConnectConfig(
    response_modalities=[
        "AUDIO",
    ],
    media_resolution="MEDIA_RESOLUTION_MEDIUM",
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Zephyr")
        )
    ),
    system_instruction=types.Content(
        parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)]
    ),
    context_window_compression=types.ContextWindowCompressionConfig(
        trigger_tokens=104857,
        sliding_window=types.SlidingWindow(target_tokens=52428),
    ),
)

pya = pyaudio.PyAudio() if pyaudio else None


class AudioLoop:
    def __init__(self, video_mode=DEFAULT_MODE):
        self.video_mode = video_mode
        self.audio_in_queue = None
        self.out_queue = None
        self.session = None
        self.audio_stream = None

    async def send_text(self):
        while True:
            text = await asyncio.to_thread(input, "Você > ")
            if text.lower() == "q":
                break
            if self.session is not None and text.strip():
                await self.session.send(input=text, end_of_turn=True)

    def _get_frame(self, cap):
        try:
            import cv2
        except ImportError:
            return None
        ret, frame = cap.read()
        if not ret:
            return None
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = PIL.Image.fromarray(frame_rgb)
        img.thumbnail((1024, 1024))

        image_io = io.BytesIO()
        img.save(image_io, format="jpeg", quality=75)
        image_io.seek(0)

        mime_type = "image/jpeg"
        image_bytes = image_io.read()
        return {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode()}

    async def get_frames(self):
        try:
            import cv2
        except ImportError:
            print("[Aviso] OpenCV (cv2) não instalado. Modo câmera desativado.")
            return

        cap = await asyncio.to_thread(cv2.VideoCapture, 0)
        while True:
            frame = await asyncio.to_thread(self._get_frame, cap)
            if frame is None:
                await asyncio.sleep(0.5)
                continue

            await asyncio.sleep(1.0)
            if self.out_queue is not None:
                await self.out_queue.put(frame)
        cap.release()

    def _get_screen(self):
        try:
            import mss
        except ImportError:
            return None
        sct = mss.mss()
        monitor = sct.monitors[0]
        i = sct.grab(monitor)
        mime_type = "image/jpeg"
        image_bytes = mss.tools.to_png(i.rgb, i.size)
        img = PIL.Image.open(io.BytesIO(image_bytes))
        img.thumbnail((1024, 1024))

        image_io = io.BytesIO()
        img.save(image_io, format="jpeg", quality=75)
        image_io.seek(0)
        image_bytes = image_io.read()
        return {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode()}

    async def get_screen(self):
        try:
            import mss
        except ImportError:
            print("[Aviso] Pacote 'mss' não instalado para captura de tela. Execute: pip install mss")
            return

        print("[ClandeX-IA] Captura de tela do TradingView ativa a 1 frame por segundo.")
        while True:
            frame = await asyncio.to_thread(self._get_screen)
            if frame is None:
                await asyncio.sleep(1.0)
                continue

            await asyncio.sleep(1.0)
            if self.out_queue is not None:
                await self.out_queue.put(frame)

    async def send_realtime(self):
        while True:
            if self.out_queue is not None:
                msg = await self.out_queue.get()
                if self.session is not None:
                    await self.session.send(input=msg)

    async def listen_audio(self):
        if not pya:
            print("[Aviso] PyAudio não disponível. Entrada de microfone ignorada.")
            return
        mic_info = pya.get_default_input_device_info()
        self.audio_stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=SEND_SAMPLE_RATE,
            input=True,
            input_device_index=mic_info["index"],
            frames_per_buffer=CHUNK_SIZE,
        )
        kwargs = {"exception_on_overflow": False}
        while True:
            data = await asyncio.to_thread(self.audio_stream.read, CHUNK_SIZE, **kwargs)
            if self.out_queue is not None:
                await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})

    async def receive_audio(self):
        while True:
            if self.session is not None:
                turn = self.session.receive()
                async for response in turn:
                    if data := response.data:
                        self.audio_in_queue.put_nowait(data)
                        continue
                    if text := response.text:
                        print(text, end="", flush=True)

                while not self.audio_in_queue.empty():
                    self.audio_in_queue.get_nowait()

    async def play_audio(self):
        if not pya:
            return
        stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
        )
        while True:
            if self.audio_in_queue is not None:
                bytestream = await self.audio_in_queue.get()
                await asyncio.to_thread(stream.write, bytestream)

    async def run(self):
        print(f"\n=======================================================")
        print(f"🔥 ClandeX-IA 2.0 — Conectando ao Gemini Live ({MODEL})")
        print(f"🎙 Voz: Zephyr (Multimodal com Áudio 24kHz)")
        print(f"🖥 Modo de Vídeo/Tela: {self.video_mode.upper()}")
        print(f"=======================================================\n")
        try:
            async with (
                client.aio.live.connect(model=MODEL, config=CONFIG) as session,
                asyncio.TaskGroup() as tg,
            ):
                self.session = session
                print("[ClandeX-IA Live] Conectado com sucesso! Pode falar no microfone.\n")

                self.audio_in_queue = asyncio.Queue()
                self.out_queue = asyncio.Queue(maxsize=5)

                send_text_task = tg.create_task(self.send_text())
                tg.create_task(self.send_realtime())
                tg.create_task(self.listen_audio())
                if self.video_mode == "camera":
                    tg.create_task(self.get_frames())
                elif self.video_mode == "screen":
                    tg.create_task(self.get_screen())

                tg.create_task(self.receive_audio())
                tg.create_task(self.play_audio())

                await send_text_task
                raise asyncio.CancelledError("User requested exit")

        except asyncio.CancelledError:
            pass
        except Exception as e:
            if self.audio_stream is not None:
                self.audio_stream.close()
            traceback.print_exc()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ClandeX-IA 2.0 Gemini Live Voice & Vision")
    parser.add_argument(
        "--mode",
        type=str,
        default=DEFAULT_MODE,
        help="Fonte visual para análise",
        choices=["camera", "screen", "none"],
    )
    args = parser.parse_args()
    loop = AudioLoop(video_mode=args.mode)
    asyncio.run(loop.run())
