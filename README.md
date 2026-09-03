# Invitación Di & Nico — 17.10.2026

Vite + Tailwind v4 + Vanilla JS. Backend: Google Apps Script → Google Sheets.

## Estructura

```
invitacion-boda/
├─ index.html              # markup semántico (hero, secciones, modal RSVP)
├─ vite.config.js
├─ .env.example            # copiar a .env con la URL del backend
├─ .asset/                 # originales sin procesar (video, foto, tema)
├─ public/media/           # intro.mp4, intro-poster.jpg, portada.jpg, ambient.mp3
├─ Gabi.md                 # notas del proyecto y decisiones
├─ src/
│  ├─ main.js              # bootstrap: calendario + reveal on scroll
│  ├─ config.js            # datos del evento y endpoint
│  ├─ style.css            # Tailwind + parallax + reveal
│  └─ modules/
│     ├─ intro.js          # video presentador antes de la portada
│     ├─ countdown.js
│     ├─ audio.js          # loop de 20 s, arranca con la 1ª interacción
│     └─ rsvp.js           # modal + fetch al Apps Script
└─ apps-script/Code.gs     # backend a pegar en la planilla
```

## Paso 1 — Backend (Google Sheets)

1. Google Sheets → nueva planilla "Confirmaciones Boda".
2. Extensiones → Apps Script. Borrar todo y pegar `apps-script/Code.gs`.
3. Implementar → Nueva implementación → Aplicación web.
   Ejecutar como: **Yo** · Quién tiene acceso: **Cualquier persona**.
4. Copiar la URL `/exec`.

La hoja `Confirmaciones` y sus encabezados se crean solos en el primer envío.

## Paso 2 — Frontend

```bash
npm install
cp .env.example .env   # y pegar ahí la URL del paso 1
npm run dev
```

## Paso 3 — Multimedia

Ya generado en `public/media/` a partir de `.asset/` (ver `Gabi.md`).
Para regenerar con ffmpeg:

```bash
# intro: recorte al encuadre de la pareja + bloom sobre la espuma + cámara lenta
ffmpeg -y -i .asset/IMG_2315.MOV -an -filter_complex \
  "[0:v]crop=1080:1530:0:340,format=gbrp,split=2[base][hi];\
   [hi]curves=all='0/0 0.72/0 1/1',gblur=sigma=22[glow];\
   [base][glow]blend=all_mode=screen:all_opacity=0.9,eq=saturation=1.08:contrast=1.05,\
   setpts=PTS/0.7,scale=810:1148,fps=30,format=yuv420p" \
  -c:v libx264 -profile:v main -level 4.0 -tune fastdecode -crf 26 -maxrate 2M -bufsize 4M \
  -preset slow -g 60 -movflags +faststart public/media/intro.mp4
ffmpeg -y -ss 7.0 -i public/media/intro.mp4 -frames:v 1 -q:v 3 public/media/intro-poster.jpg

# portada
ffmpeg -y -i .asset/IMG_2297.PNG -vf "scale='min(1600,iw)':-2" -q:v 4 public/media/portada.jpg

# música: 20 s desde 192.5 s, con fades para que el loop empalme
ffmpeg -y -ss 192.5 -t 20 -i ".asset/Feeling Good.mp3.mpeg" \
  -af "afade=t=in:st=0:d=1,afade=t=out:st=18.6:d=1.4,loudnorm=I=-18:TP=-2" \
  -c:a libmp3lame -b:a 160k public/media/ambient.mp3
```

Para mover el fragmento de la música, cambiar el `-ss` (y `AMBIENT_CLIP` en `src/config.js`).

## Paso 4 — Deploy

GitHub → Vercel → "Add New Project" → detecta Vite → Deploy.
Cargar `VITE_RSVP_ENDPOINT` en Settings → Environment Variables.
