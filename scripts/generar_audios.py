#!/usr/bin/env python3
"""Genera la narración (español o inglés) de una o varias páginas de storycard.

Lee de cada HTML los textos y las rutas EXACTAS de audio (voiceSrc) y crea los
archivos en esas rutas. Entiende los dos formatos de página que usas:
  · las del robot:   voiceSrc: "ruta",  text: "texto"
  · las manuales:    voiceSrc: 'ruta',  text: `texto`   (comillas simples o backticks)
Si la ruta acaba en .wav convierte con ffmpeg. El idioma se detecta por
<html lang="..."> (es -> voz española, otro -> voz inglesa; se puede forzar con EDGE_VOICE).

Si una página no existe en la raíz, la busca en subcarpetas; si no la encuentra
la salta y sigue con las demás. Los audios que ya existen se saltan (usa --forzar
para regenerarlos). Si algo falla, el script termina con error AL FINAL, después
de haber procesado todo lo demás.

Uso:  python scripts/generar_audios.py capainterior.html semilladeluz-en.html
      python scripts/generar_audios.py --forzar capainterior.html
      python scripts/generar_audios.py --dry-run capainterior.html
"""
import asyncio, glob, os, re, shutil, subprocess, sys, tempfile

VOZ_FORZADA = os.environ.get("EDGE_VOICE")
VOZ_ES = os.environ.get("EDGE_VOICE_ES", "es-ES-AlvaroNeural")
VOZ_EN = os.environ.get("EDGE_VOICE_EN", "en-US-GuyNeural")
RATE = os.environ.get("EDGE_RATE", "-5%")
FORZAR = "--forzar" in sys.argv or os.environ.get("FORZAR", "").lower() in ("1", "true", "si", "sí")
DRY = "--dry-run" in sys.argv
PAGINAS = [a for a in sys.argv[1:] if not a.startswith("--")]
MIN_BYTES = 2000          # un audio más pequeño se considera fallido
INTENTOS = 3
TIMEOUT = 180             # segundos por audio

MAPA_ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def leer_literal(s, i):
    """Lee el literal de cadena JS ('...', "..." o `...`) que empieza en s[i]. Devuelve (texto, posición_final)."""
    q, j, out = s[i], i + 1, []
    while j < len(s):
        c = s[j]
        if c == "\\":
            n = s[j + 1]
            if n in MAPA_ESC:
                out.append(MAPA_ESC[n]); j += 2
            elif n == "u":
                if s[j + 2] == "{":
                    k = s.index("}", j); out.append(chr(int(s[j + 3:k], 16))); j = k + 1
                else:
                    out.append(chr(int(s[j + 2:j + 6], 16))); j += 6
            elif n == "x":
                out.append(chr(int(s[j + 2:j + 4], 16))); j += 4
            elif n == "\n":
                j += 2                                   # continuación de línea
            elif n == "\r":
                j += 3 if s[j + 2:j + 3] == "\n" else 2
            else:
                out.append(n); j += 2
        elif c == q:
            texto = "".join(out)
            # une pares sustitutos (emojis escritos como \uD83D\uDE00)
            texto = texto.encode("utf-16", "surrogatepass").decode("utf-16", "replace")
            return texto, j + 1
        else:
            out.append(c); j += 1
    raise ValueError("literal de texto sin cerrar")


RE_TIPO = re.compile(r"""type\s*:\s*['"`](\w+)['"`]""")
RE_VOZ = re.compile(r"""['"]?voiceSrc['"]?\s*:\s*(['"`])""")
RE_TEXTO = re.compile(r"""(?<![\w.])['"]?text['"]?\s*:\s*(['"`])""")


def leer_pagina(ruta):
    h = open(ruta, encoding="utf8").read()
    m = re.search(r'<html[^>]*\blang\s*=\s*["\']?(\w+)', h)
    lang = m.group(1).lower() if m else "en"
    tipos = list(RE_TIPO.finditer(h))
    items, avisos = [], []
    for k, t in enumerate(tipos):
        if t.group(1) != "story":
            continue
        fin = tipos[k + 1].start() if k + 1 < len(tipos) else len(h)
        bloque = h[t.start():fin]
        mv, mt = RE_VOZ.search(bloque), RE_TEXTO.search(bloque)
        if not mv or not mt:
            avisos.append(f"capítulo {len(items) + 1}: falta voiceSrc o text")
            continue
        voz, _ = leer_literal(bloque, mv.end() - 1)
        texto, _ = leer_literal(bloque, mt.end() - 1)
        if mt.group(1) == "`" and "${" in texto:
            avisos.append(f"{voz}: el texto contiene ${{...}} (se leerá tal cual)")
        if voz.strip() and texto.strip():
            items.append((voz.strip(), texto.strip()))
    return lang, items, avisos


def resolver(pagina):
    if os.path.isfile(pagina):
        return pagina
    base = os.path.basename(pagina)
    hallados = [p for p in glob.glob(f"**/{base}", recursive=True)
                if not p.startswith((".git" + os.sep, "node_modules" + os.sep))]
    if len(hallados) == 1:
        print(f"  (no está en la raíz; la encontré en {hallados[0]})")
        return hallados[0]
    return None


async def sintetizar(texto, voz, destino):
    import edge_tts
    await asyncio.wait_for(edge_tts.Communicate(texto, voz, rate=RATE).save(destino), TIMEOUT)
    if not os.path.exists(destino) or os.path.getsize(destino) < MIN_BYTES:
        raise RuntimeError("audio vacío o demasiado pequeño")


async def generar(ruta, texto, voz):
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    ultimo = None
    for intento in range(1, INTENTOS + 1):
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False).name
        try:
            if ruta.lower().endswith(".wav"):
                await sintetizar(texto, voz, tmp)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ar", "24000", "-ac", "1", ruta], check=True)
            else:
                await sintetizar(texto, voz, tmp)
                shutil.move(tmp, ruta)
            return
        except Exception as e:                      # reintenta: Edge TTS falla a veces de forma puntual
            ultimo = e
            print(f"    intento {intento}/{INTENTOS} falló: {e}")
            await asyncio.sleep(3 * intento)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    raise ultimo


async def main():
    errores = []
    for pedida in PAGINAS:
        print(f"\n== {pedida}")
        pagina = resolver(pedida)
        if not pagina:
            msg = f"{pedida}: no existe en el repositorio (¿está subida y escrita igual, con .html?)"
            print("  ERROR", msg); errores.append(msg); continue
        try:
            lang, items, avisos = leer_pagina(pagina)
        except Exception as e:
            msg = f"{pedida}: no se pudo leer ({e})"
            print("  ERROR", msg); errores.append(msg); continue
        for a in avisos:
            print("  aviso:", a)
        if not items:
            msg = f"{pedida}: no encontré capítulos con voiceSrc y text"
            print("  ERROR", msg); errores.append(msg); continue
        voz = VOZ_FORZADA or (VOZ_ES if lang == "es" else VOZ_EN)
        print(f"  {len(items)} audios · idioma {lang} · voz {voz}")
        for ruta, texto in items:
            if DRY:
                print("  (dry-run)", ruta, f"{len(texto)} caracteres"); continue
            if not FORZAR and os.path.exists(ruta) and os.path.getsize(ruta) >= MIN_BYTES:
                print("  ya existe", ruta); continue
            try:
                await generar(ruta, texto, voz)
                print("  OK", ruta)
            except Exception as e:
                msg = f"{pedida}: {ruta} -> {e}"
                print("  ERROR", msg); errores.append(msg)
    print()
    if errores:
        print(f"Terminado con {len(errores)} problema(s):")
        for e in errores:
            print("  -", e)
        sys.exit(1)
    print("Terminado sin errores.")


if not PAGINAS:
    sys.exit(__doc__)
if shutil.which("ffmpeg") is None and not DRY:
    print("AVISO: falta ffmpeg (necesario para .wav)")
asyncio.run(main())
