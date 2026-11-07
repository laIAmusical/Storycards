#!/usr/bin/env python3
"""Genera la narración (español o inglés) de una o varias páginas de storycard.
Lee de cada HTML los textos y las rutas exactas de audio (voiceSrc) y crea
los archivos en esas rutas. Si la ruta acaba en .wav convierte con ffmpeg.
El idioma se detecta por <html lang="..."> de cada página: es -> voz española,
otro -> voz inglesa. Se puede forzar con EDGE_VOICE.

Uso:  python scripts/generar_audios_en.py alasdelibertad-en.html elelegido-en.html
      python scripts/generar_audios_en.py --dry-run alasdelibertad-en.html
"""
import asyncio, json, os, re, shutil, subprocess, sys, tempfile
import edge_tts

VOZ_FORZADA = os.environ.get("EDGE_VOICE")
VOZ_ES = os.environ.get("EDGE_VOICE_ES", "es-ES-AlvaroNeural")
VOZ_EN = os.environ.get("EDGE_VOICE_EN", "en-US-GuyNeural")
rate = os.environ.get("EDGE_RATE", "-5%")
args = [a for a in sys.argv[1:] if a != "--dry-run"]
dry  = "--dry-run" in sys.argv

def leer(pagina):
    h = open(pagina, encoding="utf8").read()
    lang = (re.search(r'<html[^>]*\blang="(\w+)"', h) or [None, "en"])[1].lower()
    pares = re.findall(r'voiceSrc:\s*"([^"]+)",\s*text:\s*("(?:[^"\\]|\\.)*")', h)
    return lang, [(ruta, json.loads(t)) for ruta, t in pares]

async def generar(ruta, texto, voz):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    if ruta.lower().endswith(".wav"):
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False).name
        await edge_tts.Communicate(texto, voz, rate=rate).save(tmp)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp,
                        "-ar", "24000", "-ac", "1", ruta], check=True)
        os.remove(tmp)
    else:
        await edge_tts.Communicate(texto, voz, rate=rate).save(ruta)

async def main():
    for pagina in args:
        lang, items = leer(pagina)
        voz = VOZ_FORZADA or (VOZ_ES if lang == "es" else VOZ_EN)
        print(f"{pagina}: {len(items)} audios · idioma {lang} · voz {voz}")
        for ruta, texto in items:
            if dry:
                print("  (dry-run)", ruta, f"{len(texto)} caracteres")
                continue
            await generar(ruta, texto, voz)
            print("  OK", ruta)

if not args: sys.exit(__doc__)
if shutil.which("ffmpeg") is None and not dry: print("AVISO: falta ffmpeg (necesario para .wav)")
asyncio.run(main())
