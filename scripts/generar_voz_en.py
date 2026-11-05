#!/usr/bin/env python3
"""Genera la narración en inglés (voz1.mp3 ... vozN.mp3) de una storycard -en.
Uso:  python generar_voz_en.py thelastvoyageofvalenkael-en
Lee los textos del propio <slug>.html y guarda en storycard/<slug>/vozN.mp3"""
import asyncio, json, os, re, sys
import edge_tts

slug = sys.argv[1]
voz  = os.environ.get("EDGE_VOICE_EN", "en-US-GuyNeural")
rate = os.environ.get("EDGE_RATE", "-5%")

html = open(f"{slug}.html", encoding="utf8").read()
textos = re.findall(r'voiceSrc: "[^"]+",\s*text: ("(?:[^"\\]|\\.)*")', html)
os.makedirs(f"storycard/{slug}", exist_ok=True)

async def main():
    for n, t in enumerate(textos, 1):
        destino = f"storycard/{slug}/voz{n}.mp3"
        await edge_tts.Communicate(json.loads(t), voz, rate=rate).save(destino)
        print("OK", destino)

asyncio.run(main())
