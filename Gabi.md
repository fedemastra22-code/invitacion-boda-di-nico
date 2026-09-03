# Gabi.md — Invitación Di & Nico

Notas del proyecto: qué es, qué decisiones se tomaron y qué tocar para cambiar algo.

## Qué es

Landing page / web app de la invitación de boda de **Di & Nico**
— 17 de octubre de 2026, 17:30 hs, Quinta Doña Elvira, Mendoza.
Stack: Vite + Tailwind v4 + Vanilla JS. Backend: Google Apps Script → Google Sheets.

## Recorrido de la página

0. **Filtro de lado** — antes de todo, el invitado elige si viene por Nico o por Diana. Lo único que cambia es el alias del regalo (`ALIAS` en `src/modules/lado.js`). La elección queda en `localStorage` (`ladoInvitado`), así que no se vuelve a preguntar; para volver a verlo, borrar esa clave.
1. **Intro** — video presentador (`intro.mp4`) con títulos encadenados encima y música de fondo. Se reproduce **una única vez**, sin control manual: no hay botón para volver a verlo ni para pausar la música — es intencional, la sorpresa es de una sola vez. Se dispara sola apenas se elige el lado (`initLado().then(playIntro)` en `main.js`) y se corta con el botón SALTAR o sola al terminar la secuencia (23s). Los tiempos de cada título viven en `playIntro()` de `src/modules/intro.js` (bloque `setTimeout` comentado paso a paso).
2. **Portada** — `portada.jpg` fija de fondo (parallax), nombres con animación *settle* estilo keynote, countdown en vivo. Las píldoras de fecha/lugar llevan `bg-black/45` (no glass transparente): sobre una foto con follaje oscuro, un fondo translúcido se pierde — hace falta un fondo casi opaco para que el texto blanco se lea siempre, sea cual sea el fondo detrás.
3. **Frase de apertura**, RSVP, regalo (alias — cambian según `lado`), detalles (fecha + lugar), banda parallax "17 · 10 · 26" (viñedo), paletas, **Nosotros** (collage), **muro de deseos**, footer parallax (atardecer).
   El único control flotante que queda es 🔒 (login admin) — video y música no tienen botón, ver punto 1.
4. **Carta RSVP** — modal `<dialog>` con estilo de **invitación real**: marco vino sólido (`.invitation-card`), sello de lacre arriba (`.wax-seal`), papel cream adentro (`.invitation-inner`, no glass — necesita contraste fuerte para leerse como invitación, no como una tarjeta más). Los inputs son renglones de carta (`.letter-field`), sin cajas. Acompañantes: solo **Voy Solo** (1) o **En Pareja** (2) — sin la opción "familia" que había antes. El campo final pregunta *"¿Qué tema no puede faltar en la fiesta?"* (`name="cancion"`), no es un campo de mensaje libre.

## Multimedia (originales en `.asset/`, procesados en `public/media/`)

| Original | Procesado | Cómo |
|---|---|---|
| `IMG_2315.MOV` (HEVC, 5.3 s) | `intro.mp4` (7.57 s) + `intro-poster.jpg` | H.264 Main yuv420p sin audio; recortado a `crop=1080:1530:0:340` (se saca la copa vacía del árbol) + **bloom** sobre la espuma + cámara lenta 0.7x grabada con `setpts` |
| `Foto1..foto8.jpeg` | `galeria-1..8.jpg`, `paisaje.jpg`, `atardecer.jpg` | 900 px la galería, 1600 px las bandas parallax |
| `IMG_2297.PNG` | `portada.jpg` | escalado a 1600 px de ancho |
| `Feeling Good.mp3.mpeg` (237 s) | `ambient.mp3` | recorte de **20 s desde 192.5 s**, fade in 1 s / fade out 1.4 s, loudnorm |

El punto de corte (192.5 s) salió de escanear el RMS del tema y quedarse con la
ventana de 20 s más intensa — el clímax, estilo reel de Instagram. Está anotado
en `src/config.js` (`AMBIENT_CLIP`); para moverlo, cambiar el `-ss` del comando
del README y regenerar.

### El bloom de la espuma

```
crop=1080:1530:0:340, format=gbrp, split → curves (aplasta todo bajo 0.72 a negro)
→ gblur sigma=22 → blend screen 0.9 sobre el original
```

Como la espuma es lo único muy brillante del cuadro, la curva la aísla sola: no
hubo que enmascarar nada. **`format=gbrp` es obligatorio**: sin eso el `blend`
opera sobre los planos YUV y el video sale magenta.

## Decisiones

- **Loop nativo del `<audio>`**, no recorte por JS: el archivo ya dura 20 s con fades, así que el empalme es limpio sin código.
- **Parallax con `position: sticky`**, no con `background-attachment: fixed` (ver la sección de iOS más abajo).
- **`<dialog>` nativo** para el modal: focus trap, Escape y backdrop gratis, sin dependencias.
- **Tailwind v4 con `@tailwindcss/vite`**: sin `tailwind.config.js` ni postcss, los tokens viven en `@theme` dentro de `src/style.css`.
- **Muro de deseos**: mismo endpoint que el RSVP, ruteado por `tipo` en el JSON. Va a la hoja `Mensajes`; la columna `Visible` en FALSE baja un mensaje sin borrarlo (moderación a mano). Los mensajes se escapan en el cliente antes de pintarlos.
- **El muro no tiene lista propia**: los mensajes se insertan como tarjetas de vidrio *dentro* del collage de "Nosotros", una cada tres celdas, con el mismo `aspect-[3/4]` que las fotos para que la grilla cierre. El formulario queda abajo, en su propia sección.
- **Sin panel admin**: la planilla de Google Sheets ya es el panel. La versión vieja tenía la clave hardcodeada en el HTML.
- **Sin Google Forms**: el RSVP va por `fetch` al Apps Script.
- Se respeta `prefers-reduced-motion`: se apagan animaciones y scroll suave.

## iPhone / Safari en iOS

Safari en iOS no es "Chrome más lento": tiene reglas propias que rompen cosas que
en Android y en escritorio andan solas. Todo lo de acá abajo ya está resuelto,
pero conviene conocerlo antes de tocar la portada, las bandas o la intro.

### 1. El fondo fijo al scrollear

`background-attachment: fixed` **no funciona en iOS**. Safari lo ignora (y en
algunas versiones lo dibuja con un zoom gigante), así que el efecto simplemente
no existía en iPhone.

La solución no usa `background-attachment` en absoluto:

```html
<section class="parallax-clip relative h-[85vh]">
  <div class="parallax-stick">                     <!-- sticky, top:0, alto 0 -->
    <div class="parallax-layer" style="…"></div>   <!-- absolute, alto 100vh -->
  </div>
  …contenido…
</section>
```

La capa mide 100vh y queda clavada arriba mientras la sección le pasa por
delante. Es el mismo efecto visual, con **una sola implementación** para iOS,
Android y escritorio — nada de ramas por navegador.

Dos trampas que ya están esquivadas y que es fácil volver a meter:

| Trampa | Qué pasa | Cómo se evita |
|---|---|---|
| `overflow: hidden` en la sección para recortar la capa | `overflow` crea un **contenedor de scroll**, el sticky se ancla a él, deja de moverse y el efecto desaparece | Se recorta con `clip-path: inset(0)` (clase `.parallax-clip`), que recorta igual pero no crea contenedor de scroll |
| Botones flotantes dentro del `<header>` | `clip-path` recorta también a los descendientes `position: fixed`: los botones se cortan al scrollear | Los tres botones y el `<audio>` viven sueltos en el `<body>`, fuera del hero |

Y `height: 100vh` en la capa, **no `dvh`**: `dvh` cambia cuando iOS oculta la
barra de direcciones y el fondo pegaría un salto en pleno scroll.

| Trampa | Qué pasa | Cómo se evita |
|---|---|---|
| Sección mucho más baja que la capa (100vh) | La capa es siempre 100vh y no se mueve — el recorte de la sección (`clip-path`) sólo muestra la franja de arriba de esos 100vh. Con una sección de 45vh nunca se llega a ver nada más abajo del ~45% de la imagen, sea cual sea el `background-position` | La sección tiene que medir **cerca de 100vh** (hoy `h-[90vh]`) para que la imagen se vea completa y para que haya scroll de sobra como para que el efecto se note |

**No usar la capa borrosa "de relleno" (`.bg-fill-blur`) atrás de una copia
nítida de la misma foto** — es el patrón `bg-fill-blur` + `bg-fit` que se usó
al principio para no recortar fotos verticales en pantallas anchas. Se ve
como si la foto estuviera duplicada (una versión nítida en el medio, una
borrosa a los costados) y así lo reportaron. La portada y la banda del
viñedo ahora son **una sola capa a `cover`** con `background-position`
ajustado a mano para que el sujeto de la foto quede en cuadro. La única
`.bg-fill-blur` que queda es detrás del *video* de la intro — ahí no aplica
la misma crítica porque el video no es una imagen estática, no se percibe
como "la misma foto dos veces".

### 2. El video que se trababa

Causas y arreglos, de dos rondas distintas:

| Causa | Arreglo |
|---|---|
| `video.playbackRate = 0.7` — Safari re-temporiza el video en vivo y entrecorta | La cámara lenta viene **grabada en el archivo** (`setpts=PTS/0.7` + `fps=30`), se reproduce a velocidad 1 |
| Una capa de `filter: blur(28px)` a pantalla completa detrás del video | En celular se oculta (`display:none` bajo 768 px) |
| El video se recomponía en cada frame junto con los títulos animados | `transform: translateZ(0)` en `#introVideo` lo manda a su propia capa de GPU |
| `filter: blur()` animado en los títulos (entrada de `NOS CASAMOS`, `the wedding`, fecha y el reloj) compitiendo por GPU con el video decodificando | En pantallas ≤767px, esos `@keyframes` se redefinen **sin** el `filter: blur()` (sólo escala + opacidad) — ver el bloque `@media (max-width: 767px)` antes de `.paper` en `style.css` |
| Resolución/bitrate más altos de lo necesario para el tamaño real en pantalla | Re-encodado a 810×1148 (antes 1080×1530), `-tune fastdecode` (x264 desactiva el filtro de deblocking en el loop, más liviano para decodificar), nivel 4.0 explícito — **ojo**: con esta resolución, nivel 3.1 excede su propio límite de macrobloques/segundo (`x264` tira warning y el archivo puede fallar en decoders estrictos); hace falta 4.0 |

El archivo bajó de 2.63 MB a 1.83 MB. Comando completo actualizado en el
README.

**Sobre la sincronía con la música**: el video (7.57 s) siempre estuvo
pensado para terminar y quedarse en el último cuadro mientras el resto de la
secuencia (títulos, reloj) sigue corriendo por más tiempo — la duración real
que importa es la de `ambient.mp3` (20 s), que es también la duración total
de la intro. Si en algún momento cambiás el audio por uno de otra duración,
hay que reescalar a mano todos los `setTimeout` de `playIntro()` en
`intro.js` (están comentados con el paso a paso) y las duraciones de
animación en `style.css` — no se calcula solo.

Si en algún iPhone viejo todavía se entrecorta, la siguiente palanca es sacar
los `filter: blur()` de los keyframes de los títulos (`mayor-a-menor-*`,
`fade-out-countdown`) en pantallas chicas: animar blur sobre texto grande es lo
más caro que queda en la intro.

### 3. Fotos a sangre en el celular

En escritorio las fotos verticales se muestran enteras (`contain`) sobre la
copia borrosa. En celular la pantalla ya es vertical como la foto, así que abajo
de 768 px pasan a `cover` y la copia borrosa se apaga: se ven a pantalla
completa y se ahorra el blur.

### Cómo probarlo de verdad

El emulador de Chrome **no** reproduce estos bugs: son del motor de Safari, no
del tamaño de pantalla. Para probar en serio, abrir la URL de red (`npm run dev`
ya expone la LAN) en el iPhone. Si hace falta ver la consola: Safari en Mac >
Desarrollo > [iPhone]. Sin una Mac, un iPhone real y mirar es lo que hay.

## Dashboard admin (`admin.html` + `src/admin/dashboard.js`)

Acceso: botón 🔒 en la landing → login con Google → solo entra si el email
coincide con `ADMIN_EMAIL` en `dashboard.js` (hoy `nicomastras@gmail.com`).

**Paleta**: fondo casi negro (`--color-dash: #1a0d13`) con los mismos vino/rosa
del sitio público (`--color-dash-wine`, `--color-dash-pink`) — son los colores
de la marca, no los de la foto de portada en sí (esa lleva un velo negro
encima igual). Un detalle no obvio: el `<body>` del admin usa la clase
`admin-dash` (regla CSS propia en `style.css`), **no** la utilidad `bg-dash`
de Tailwind. Tailwind envuelve sus utilidades en `@layer`, y una regla normal
(sin capa) — como ya había un `body{background:...}` para la landing — le
gana a *cualquier cosa en capa* sin importar la especificidad. `bg-dash` en el
`<body>` nunca se hubiera visto. Si agregás más color con utilidades de
Tailwind sobre el `<body>` directamente, va a pasar lo mismo — usá una clase
CSS propia como hice acá.

**Iconos**: los de fila (editar/eliminar) y los del encabezado (filtro,
importar) son SVG de trazo fino (`stroke-width="1.5"`, sin relleno) definidos
inline — no hay librería de iconos. La micro-animación al hover/click es CSS
puro (`.icon-btn`, `.row-icon-btn` en `style.css`): escala + leve rotación,
nada de JS.

**KPIs** (5, arriba de la tabla — todos clickeables, funcionan como filtro
de la tabla; click de nuevo sobre el mismo quita el filtro):
- **Total invitados** — número editable con el lápiz (`kpiEdit`, prompt),
  guardado en Firebase (`meta/totalInvitados`, default 300). El número en sí
  es un botón que **filtra** (limpia cualquier otro filtro y muestra todo);
  quedó separado del lápiz a propósito, para que "click para editar" y
  "click para filtrar" no compitan por el mismo gesto.
- **Confirmados** / **No asisten** — suman *personas* (1 solo, 2 pareja), no
  filas. Click filtra la tabla a esas filas.
- **Pendientes** = Total − Confirmados − No asisten (con piso en 0) para el
  número; pero el **click** muestra algo más útil: la gente del *padrón*
  (ver más abajo) que todavía no tiene ningún RSVP asociado. Si no
  importaste un padrón todavía, el click no tiene de dónde sacar esa lista y
  la tabla lo dice explícitamente en vez de mostrar vacío sin explicación.
- **Restricciones** — cuenta invitados (filas), no personas, con algo escrito
  en "Restricciones alimenticias". Click filtra la tabla a esas filas.

**Ranking de temas musicales** — agrupa el campo "¿Qué tema no puede faltar
en la fiesta?" de todos los RSVP por similitud de texto y cuenta cuántas
veces aparece cada grupo. **No hay ninguna llamada a un modelo de IA**: es un
algoritmo local en `src/admin/text-match.js` (tokeniza, saca tildes/stopwords,
compara por prefijo + distancia de Levenshtein) — suficiente para agrupar
"Nuevayol de Bad Bunny" con "Nueva York - BadBuny" sin pagar ni depender de
ningún servicio externo. Mismo algoritmo se reusa para el punto siguiente.

**Padrón e importación (`padron/{key}` en Firebase)** — es una lista maestra
separada de los RSVP, pensada para dos cosas:
1. **Reconocimiento inteligente de nombre/apellido**: el form público sólo
   pide "nombre y apellido" en un campo de texto libre. Si hay un padrón
   cargado, `dashboard.js` compara ese texto (fuzzy) contra `nombre+apellido`
   de cada entrada del padrón; si hay un match razonable (ej. "fede mastra"
   contra "Federico Mastrascusa"), usa el nombre/apellido *oficial* del
   padrón. Si no hay padrón o no matchea nada, cae al mismo split por
   palabras que había antes (primera palabra = nombre, resto = apellido).
2. **Detectar quién falta responder**: el KPI Pendientes cruza el padrón
   contra los RSVP ya matcheados.
3. Botón ⬆️ arriba a la izquierda de "Exportar PDF" (menú con dos opciones):
   - *Descargar plantilla (.xlsx)* — columnas `Nombre, Apellido, Categoria,
     DeParteDe`, vacío, para completar y volver a subir.
   - *Subir lista (.xlsx)* — antes de escribir nada, compara cada fila contra
     el padrón actual (por nombre+apellido normalizado) y muestra un modal
     con el resumen ("X nuevos, Y actualizados, Z sin cambios") con botones
     OK/Anular — nunca pisa el padrón sin que el admin confirme.
   - **Scope real, no lo prometido literal**: solo importa/exporta `.xlsx`.
     Word/PDF/PNG no dan datos tabulares reimportables de forma confiable
     (un PDF o una foto necesitarían OCR + IA para convertirse en filas, y
     esa parte no está implementada) — si hace falta de verdad, es un
     proyecto aparte.

**Tabla inteligente** — cada fila normal sale de un RSVP guardado en
Firebase (`rsvps/{key}`):
- **Nombre / Apellido**: ver "reconocimiento inteligente" arriba.
- **Conteo**: personas para catering. `0` si "Asiste" es No, si no 1 (solo) o
  2 (pareja). Campo *derivado*, no se edita.
- **De parte de / Categoría**: editables con el ícono ✏️. "De parte de"
  arranca con el valor que ya viaja en el RSVP (`lado`, capturado de
  `localStorage` al enviar el form público), pisable a mano. "Categoría"
  tiene 4 predefinidas + "nueva etiqueta" — una vez usada, queda disponible
  en el filtro para todos.
- **Usuario / Fecha de carga**: quién y cuándo tocó por última vez ese
  registro *desde el panel* — se completan solos al editar etiquetas o al
  importar (`auth.currentUser.email` + `Date.now()`). Los RSVP que llegan
  directo del formulario público (nadie logueado ahí) muestran "—" hasta que
  un admin los edite por primera vez.
- **Archivar** (📥) saca la fila de la vista activa sin borrar nada — ver
  "Conciliación" más abajo. **Eliminar** (🗑️, borrado real) sólo aparece en
  filas marcadas como posible duplicado.

### Conciliación (`conciliacion/{key}`) — por qué `rsvps` ya no se edita ni se borra

Pedido explícito: los RSVP que la gente carga desde el link público no se
pueden perder ni pisar — es la única fuente de verdad de quién confirmó qué.
Antes, "editar etiquetas" y "eliminar" escribían directo sobre `rsvps/{key}`;
ahora `rsvps` es **de solo lectura desde el panel** (ni un update ni un
remove le tocan un campo) y todo lo que el admin cambia vive en un nodo
paralelo, `conciliacion/{key}`, con la misma key que el RSVP que corrige:

```js
conciliacion/{key} = {
  tagLado, tagCategoria,   // pisan lado/categoria del RSVP original al mostrarlo
  archivado: bool,          // true = oculto de la vista activa (soft-delete)
  usuario, fechaCarga,      // quién y cuándo tocó esta reconciliación
}
```

La tabla que ve el admin (`registros` en `dashboard.js`) es el **merge** de
ambos nodos en memoria — nunca se guarda ese merge en Firebase, se recalcula
en cada carga (`computeRegistrosUnsafe()`). Esto la convierte en lo que pidió
el cliente: una capa de conciliación entre el RSVP crudo (inmutable) y la
"versión final" editable, sin duplicar el dato ni arriesgar perderlo.

Dos acciones, no una:
- **Archivar** (antes "eliminar") — soft-delete: `conciliacion/{key}.archivado
  = true`. La fila desaparece de la vista normal pero sigue en Firebase
  intacta (`rsvps` y `conciliacion`); con el checkbox "Mostrar archivados"
  del filtro se la vuelve a ver, con un único botón "Restaurar" que pone
  `archivado = false`. Es la acción por defecto para sacar a alguien de la
  lista — nunca pierde el dato.
- **Eliminar duplicado** (🗑️, borrado real con `remove()`) — sólo se ofrece
  en filas que el sistema marcó `esDuplicado` (mismo nombre+apellido
  normalizado que otra fila activa, ver más abajo). Borra **de verdad**
  `rsvps/{key}` y `conciliacion/{key}`, sin vuelta atrás — es la única
  situación en la que perder el registro es correcto, porque es una copia
  sobrante del mismo RSVP, no información nueva.

**Detección de duplicados**: sobre las filas activas (no archivadas), agrupa
por `normalize(nombre + apellido)` (mismo normalizador de `text-match.js`
que ya se usaba para el padrón) y marca `esDuplicado = true` a toda fila
cuyo grupo tenga más de un integrante. Se resalta con `.row-duplicado`
(degradé amarillo suave en `style.css`) y es filtrable con el checkbox
"Solo posibles duplicados" del filtro — así el admin decide caso por caso:
si es un nombre mal tipeado, lo corrige con "Editar etiquetas"; si es un
duplicado real, usa "Eliminar duplicado".

**Scope, a propósito**: esto sólo aplica a `rsvps`/`conciliacion` (la
confirmación de asistencia, que era el pedido puntual). El `padrón`
(`padron/{key}`, la lista maestra importada) sigue con `remove()` directo
como antes — es una lista de referencia que el admin sube y corrige él
mismo, no una confirmación que llega de terceros; no tiene el mismo riesgo
de pérdida de información que justifique la misma protección.

**Ordenar / Columnas / Agrupar** — tres íconos a la izquierda del filtro
(en ese orden), cada uno con su propio popover glass, todos alimentados por
el mismo registro `COLUMNS` en `dashboard.js` (agregar una columna nueva es
sumarla ahí + en `celdaValor`/`celdaHtml`, nada más se toca):
- **Ordenar** — click en una columna la agrega como criterio (↑), un segundo
  click la invierte (↓), un tercero la saca. Varias columnas activas ordenan
  en cascada, en el orden en que se clickearon (como un `ORDER BY col1,
  col2` de SQL). Estado: `ordenarPor = [{ key, dir }]`.
- **Columnas visibles** — checkboxes, una por columna. Por defecto: Nombre,
  Apellido, Fecha de carga, Conteo. El resto arranca oculto; tildarlas las
  agrega al header y a cada fila al instante. Estado: `colVisibles` (un
  `Set`).
- **Agrupar** — click en una columna la agrega como nivel de agrupado, en
  orden (primera click = grupo de afuera, segunda = subgrupo, etc.); otro
  click sobre la misma la saca. Por defecto arranca agrupado por **De parte
  de → Categoría**. Cada grupo muestra un renglón separador con la cantidad
  de invitados y la suma de "Conteo" del grupo, y al final de la tabla hay
  una fila de TOTAL general. Estado: `agruparPor` (array de keys, el orden
  importa). La vista de "Pendientes" (gente del padrón sin RSVP) no tiene
  agrupado/orden/columnas propios — son sólo 5 datos fijos, no hacía falta
  esa maquinaria ahí.

Los tres estados (`ordenarPor`, `colVisibles`, `agruparPor`) viven sólo en
memoria de la sesión del navegador — recargar la página vuelve a los
defaults. Si en algún momento se quiere que la vista elegida por el admin
persista entre sesiones, es cuestión de guardarlos en `localStorage` al
cambiar y leerlos al arrancar; no está hecho porque no se pidió y hoy
funciona bien como preferencia de "esta sesión de trabajo".

**Filtro** — ícono de embudo en el encabezado de la tabla; al click se abre
una mini ventana con **glassmorfismo real** (`backdrop-filter: blur`, se ve
borroso lo que queda atrás, no es una imagen ni un overlay opaco): buscador
de nombre con sugerencias en vivo, más selects de "De parte de" y categoría.
Se combina con el filtro por KPI (podés filtrar por "Confirmados" y además
buscar un nombre adentro de esos). Todo corre en memoria sobre los datos ya
cargados.

⚠️ **Bug de build encontrado y arreglado acá mismo**: cualquier `filter` o
`backdrop-filter` con **dos funciones separadas por espacio** (ej.
`blur(24px) saturate(1.4)`) se rompe en producción — el minificador de
Tailwind v4 (Lightning CSS) le come el espacio y queda `blur(24px)saturate(1.4)`,
CSS inválido que el navegador ignora entero. Pasaba también, sin que nadie lo
notara, en el blur de fondo de las fotos de portada (`.bg-fill-blur`). Los
dos quedaron arreglados usando un solo `blur()`. **Regla para el futuro**: si
vas a combinar dos funciones de filtro, probá el build de producción
(`npm run build && npm run preview`), no solo `npm run dev` — el bug es
específico del minificador, en dev no se nota.

⚠️ **El bug que se comió media tarde — `snapshot.forEach` + `Array.push`**:
la tabla mostraba siempre un solo invitado (el primero) sin importar cuántos
hubiera en Firebase, de forma 100% reproducible. La causa, después de
descartar sync en tiempo real, condiciones de carrera y todo lo demás:

```js
// MAL — corta después del primer hijo
snapshot.forEach((child) => rawRsvps.push(child.val()))

// BIEN — el callback no devuelve nada
snapshot.forEach((child) => { rawRsvps.push(child.val()) })
```

`DataSnapshot.forEach()` de Firebase corta la enumeración apenas el callback
devuelve algo *truthy* (es la forma que tiene la API de "salir antes", como un
`break`). `Array.prototype.push()` devuelve el nuevo largo del array — `1` la
primera vez, y `1` ya es truthy. Con una flecha de una sola expresión
(`child => arr.push(x)`), ese valor de retorno se cuela sin querer y frena la
vuelta en el primer elemento, siempre. Nunca tira error: simplemente deja de
iterar, así que `rawRsvps`/`padron` quedaban con longitud 1 en silencio.

**Por qué costó tanto encontrarlo**: el síntoma (headers de la SPA distintos,
condición de carrera de red, reglas de seguridad, IDs de Firebase duplicados)
se manifestaba igual con datos de prueba escritos de a uno — cada registro
nuevo aparecía y desaparecía el anterior, así que "solo veo 1" parecía sync
en tiempo real fallando, no un corte de iteración. Se destapó recién al
escribir **4 registros de una sola vez** y ver que ni siquiera un `get()`
manual, sin nada concurrente, devolvía más de uno.

**Regla para el futuro**: cualquier `.forEach()` sobre un `DataSnapshot` de
Firebase (Realtime Database) — nunca uses una flecha de una sola expresión
cuyo valor de retorno pueda ser truthy (`push`, asignaciones, etc.). Siempre
con llaves: `(child) => { ... }`. `muro.js` ya lo hacía bien por casualidad
(su forEach usa llaves) — la única instancia rota estaba en el
`dashboard.js` de esta sesión, ya corregida en las dos apariciones
(`rsvps` y `padron`).

Separado de esto, y como buena práctica igual: `refrescarDesdeServidor()`
tiene un mutex simple (una sola relectura en vuelo, el resto se encola como
un único refresco pendiente) — sin eso, los tres disparadores que pueden
pedir una relectura casi al mismo tiempo al cargar la página (el listener de
`rsvps`, el de `padron`, y el refresco inicial explícito) mandarían llamadas
`get()` concurrentes de sobra. No era la causa de este bug, pero evita
gastar de más en cada carga.

## Dónde tocar qué

| Quiero cambiar… | Archivo |
|---|---|
| Fecha, lugar | `src/config.js` |
| Textos, secciones, estructura | `index.html` |
| Colores, tipografías, animaciones | `src/style.css` (`@theme` + keyframes) |
| Config de Firebase (proyecto, claves) | `src/modules/firebase.js` |
| Quién puede entrar al dashboard | `ADMIN_EMAIL` en `src/admin/dashboard.js` |
| Etiquetas de categoría predefinidas | `DEFAULT_CATEGORIAS` en `dashboard.js` + `<option>` en `admin.html` |
| Umbral de similitud (nombres / ranking musical) | `threshold` en las llamadas a `bestMatch`/`clusterSimilar` (`src/admin/text-match.js`) |
| Columnas de la plantilla de importación | `descargarPlantilla()` + `prepararImportacion()` en `dashboard.js` |

**Nota**: el backend real hoy es **Firebase** (Realtime Database), no Google
Sheets/Apps Script — `apps-script/Code.gs` y `VITE_RSVP_ENDPOINT` son de una
versión anterior del proyecto y quedaron sin usar. Si nadie los necesita para
algo puntual, se pueden borrar.

## Pendientes

- Nada bloqueante conocido a la fecha de esta nota.
