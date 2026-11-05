#!/usr/bin/env python3
"""Genera la narración en inglés de una o varias páginas de storycard.
Lee de cada HTML los textos y las rutas exactas de audio (voiceSrc) y crea
los archivos en esas rutas. Si la ruta acaba en .wav convierte con ffmpeg.

Uso:  python scripts/generar_audios_en.py alasdelibertad-en.html elelegido-en.html
      python scripts/generar_audios_en.py --dry-run alasdelibertad-en.html
"""
import asyncio, json, os, re, shutil, subprocess, sys, tempfile
import edge_tts

voz  = os.environ.get("EDGE_VOICE_EN", "en-US-GuyNeural")
rate = os.environ.get("EDGE_RATE", "-5%")
args = [a for a in sys.argv[1:] if a != "--dry-run"]
dry  = "--dry-run" in sys.argv

def leer(pagina):
    h = open(pagina, encoding="utf8").read()
    pares = re.findall(r'voiceSrc:\s*"([^"]+)",\s*text:\s*("(?:[^"\\]|\\.)*")', h)
    return [(ruta, json.loads(t)) for ruta, t in pares]

async def generar(ruta, texto):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    if ruta.lower().endswith(".wav"):
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False).name
        await edge_tts.Communicate(texto, voz, rate=rate).save(tmp)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp,
                        "-ar", "44100", "-ac", "1", ruta], check=True)
        os.remove(tmp)
    else:
        await edge_tts.Communicate(texto, voz, rate=rate).save(ruta)

async def main():
    for pagina in args:
        items = leer(pagina)
        print(f"{pagina}: {len(items)} audios")
        for ruta, texto in items:
            if dry:
                print("  (dry-run)", ruta, f"{len(texto)} caracteres")
                continue
            await generar(ruta, texto)
            print("  OK", ruta)

if not args: sys.exit(__doc__)
if shutil.which("ffmpeg") is None and not dry: print("AVISO: falta ffmpeg (necesario para .wav)")
asyncio.run(main())
