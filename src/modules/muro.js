import { ref, push, get, serverTimestamp } from 'firebase/database'
import { db } from './firebase.js'

// Escapamos siempre: los mensajes los escriben los invitados.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

const LOCAL_KEY = 'muro_mensajes'

const defaultMessages = [
  { nombre: 'Juan y Flor', mensaje: '¡Qué emoción chicos! Ya estamos contando los días para celebrar con ustedes. 🥂' },
  { nombre: 'Matias', mensaje: '¡No me pierdo ese open bar por nada del mundo! Felicitaciones novios!!! 🎉' },
  { nombre: 'Sofi', mensaje: 'Di y Nico, les deseamos toda la felicidad del mundo en esta nueva etapa. Los queremos mucho.' },
  { nombre: 'Familia Perez', mensaje: '¡Qué alegría inmensa compartir este momento con ustedes! Que sean muy felices.' },
  { nombre: 'Gaby', mensaje: '¡Ya preparando el calzado para bailar toda la noche! Felicitaciones, Di y Nico.' },
  { nombre: 'Lucas y Valen', mensaje: 'Lo mejor en esta nueva etapa que comienza. ¡Nos vemos en octubre!' },
  { nombre: 'Clara', mensaje: '¡Que vivan los novios! Todo el amor del mundo para ustedes.' }
]

// Array para guardar en memoria local los mensajes cargados.
let mensajesActivos = []

export function initMuro() {
  const form = document.getElementById('muroForm')
  const collage = document.getElementById('collage')
  const estado = document.getElementById('muroEstado')
  const err = document.getElementById('muroError')
  const submit = document.getElementById('muroSubmit')
  
  // Elementos del Lightbox
  const lightbox = document.getElementById('lightboxModal')
  const lightboxImg = document.getElementById('lightboxImg')
  const lightboxComments = document.getElementById('lightboxComments')
  const closeLightbox = document.getElementById('closeLightbox')

  if (!form || !collage) return

  // 1. Inicializar los contenedores de fotos del collage
  const fotos = Array.from(collage.querySelectorAll('figure'))
  fotos.forEach((fig) => {
    // Aseguramos clases para contenedor relativo y cursor
    fig.classList.add('relative', 'cursor-pointer', 'group', 'overflow-hidden')
    
    // Inyectamos el div del overlay de comentarios si no existe
    if (!fig.querySelector('.comment-overlay')) {
      const overlay = document.createElement('div')
      overlay.className = 'comment-overlay absolute inset-0 opacity-0 bg-black/55 backdrop-blur-[3px] transition-all duration-1000 flex flex-col justify-center items-center text-center p-4 pointer-events-none z-20'
      overlay.innerHTML = `
        <blockquote class="text-white font-display italic text-[clamp(0.85rem,2.1vw,1.15rem)] leading-relaxed px-2 line-clamp-5"></blockquote>
        <p class="text-[#EA4C93] text-[9px] tracking-[0.2em] mt-3 font-semibold uppercase"></p>
      `
      fig.appendChild(overlay)
    }

    // Configurar doble click (Desktop) y doble toque (Mobile)
    const img = fig.querySelector('img')
    const imgSrc = img ? img.getAttribute('src') : ''

    let lightboxInterval = null

    const openZoom = () => {
      if (!lightbox || !lightboxImg || !lightboxComments) return
      lightboxImg.src = imgSrc
      
      if (mensajesActivos.length > 0) {
        // Franja superpuesta sobre el borde inferior de la foto — 50% de
        // transparencia (bg-black/50), no un cartel flotante debajo.
        lightboxComments.innerHTML = `
          <div class="w-full max-w-full rounded-xl bg-black/50 border border-white/15 p-5 backdrop-blur-md shadow-2xl transition-opacity duration-1000" id="iceCommentBox">
            <blockquote id="iceCommentText" class="italic text-sm font-medium leading-relaxed text-white text-center"></blockquote>
            <p id="iceCommentAuthor" class="text-[10px] tracking-widest text-[#EA4C93] mt-3 font-bold uppercase text-center"></p>
          </div>
        `
        const box = document.getElementById('iceCommentBox')
        const text = document.getElementById('iceCommentText')
        const author = document.getElementById('iceCommentAuthor')

        let currentIndex = 0
        const showComment = () => {
          if (!box || !text || !author) return
          const m = mensajesActivos[currentIndex]
          box.style.opacity = '0'
          setTimeout(() => {
            text.textContent = `“${m.mensaje}”`
            author.textContent = m.nombre
            box.style.opacity = '1'
            currentIndex = (currentIndex + 1) % mensajesActivos.length
          }, 500) // tiempo del fade out
        }

        showComment()
        // Rotar cada 10 segundos
        if (window.activeLightboxInterval) clearInterval(window.activeLightboxInterval)
        window.activeLightboxInterval = setInterval(showComment, 10000)
      } else {
        lightboxComments.innerHTML = ''
      }
      
      lightbox.showModal()
      document.body.style.overflow = 'hidden'
    }

    // Doble click (Desktop)
    fig.addEventListener('dblclick', openZoom)

    // Doble toque (Móvil)
    let lastTap = 0
    fig.addEventListener('touchstart', (e) => {
      const now = Date.now()
      const tapLength = now - lastTap
      if (tapLength < 300 && tapLength > 0) {
        e.preventDefault() // Evitar zoom del sistema
        openZoom()
      }
      lastTap = now
    }, { passive: false })
  })

  // Configuración de cierre de Lightbox
  if (closeLightbox && lightbox) {
    closeLightbox.addEventListener('click', () => {
      if (window.activeLightboxInterval) clearInterval(window.activeLightboxInterval)
      lightbox.close()
      document.body.style.overflow = ''
    })
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        if (window.activeLightboxInterval) clearInterval(window.activeLightboxInterval)
        lightbox.close()
        document.body.style.overflow = ''
      }
    })
  }

  // 2. Lógica de comentarios rotativos y alternados de forma asíncrona (10s de lectura, staggered)
  const slots = [
    { index: 1, offset: 0 },
    { index: 2, offset: 5 },
    { index: 5, offset: 10 },
    { index: 6, offset: 15 }
  ]

  const actualizarComentariosRotativos = () => {
    if (!mensajesActivos.length) return
    const nowSeconds = Math.floor(Date.now() / 1000)

    slots.forEach(({ index, offset }) => {
      const fig = fotos[index]
      if (!fig) return
      const overlay = fig.querySelector('.comment-overlay')
      if (!overlay) return

      const localT = (nowSeconds + offset) % 20
      const isShowing = localT < 10
      const currentlyVisible = overlay.classList.contains('opacity-100')

      if (isShowing) {
        if (!currentlyVisible) {
          // Elige un comentario aleatorio al cambiar de estado
          const randomMsg = mensajesActivos[Math.floor(Math.random() * mensajesActivos.length)]
          const q = overlay.querySelector('blockquote')
          const author = overlay.querySelector('p')
          
          if (q && author) {
            q.textContent = `“${randomMsg.mensaje}”`
            author.textContent = randomMsg.nombre
          }
          
          overlay.classList.remove('opacity-0')
          overlay.classList.add('opacity-100')
        }
      } else {
        if (currentlyVisible) {
          overlay.classList.remove('opacity-100')
          overlay.classList.add('opacity-0')
        }
      }
    })
  }

  // 3. Cargar comentarios iniciales desde Realtime Database
  const cargar = async () => {
    try {
      // Traemos el nodo entero y ordenamos acá. Ordenar en el servidor con
      // orderByChild('createdAt') exige declarar ".indexOn": "createdAt" en las
      // reglas de la base; sin eso Firebase rechaza la consulta y no cargaba
      // ningún mensaje. Para un muro de invitados (decenas de mensajes) ordenar
      // en el cliente no cuesta nada y no depende de la configuración.
      const snapshot = await get(ref(db, 'mensajes'))
      const mensajes = []

      if (snapshot.exists()) {
        snapshot.forEach((childSnapshot) => {
          mensajes.push(childSnapshot.val())
        })
      }

      // Más nuevos primero. Los recién enviados pueden tener createdAt todavía
      // sin resolver (serverTimestamp), así que sin fecha van arriba.
      mensajes.sort((a, b) => (b?.createdAt ?? Infinity) - (a?.createdAt ?? Infinity))

      mensajesActivos = mensajes.length ? mensajes : defaultMessages
      estado.textContent = mensajesActivos.length ? '' : 'Todavía no hay mensajes. Estrenalo vos.'
    } catch (e) {
      console.error("Error al cargar mensajes de Firebase: ", e)
      mensajesActivos = defaultMessages
      estado.textContent = ''
    }

    actualizarComentariosRotativos();
    setInterval(actualizarComentariosRotativos, 1000);
  }

  // 4. Envío del formulario del muro a Firestore
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.classList.add('hidden')
    const data = Object.fromEntries(new FormData(form))
    data.tipo = 'mensaje'

    if (!data.nombre?.trim() || !data.mensaje?.trim()) {
      err.textContent = 'Completá tu nombre y el mensaje.'
      err.classList.remove('hidden')
      return
    }

    submit.disabled = true
    submit.textContent = 'ENVIANDO…'

    try {
      await push(ref(db, 'mensajes'), {
        ...data,
        createdAt: serverTimestamp()
      });

      mensajesActivos.unshift(data);
      form.reset();
      estado.textContent = '';
      submit.textContent = '¡GRACIAS! ♥';
      
      // Actualizar overlays
      actualizarComentariosRotativos();

      setTimeout(() => {
        submit.disabled = false
        submit.textContent = 'DEJAR MI MENSAJE'
      }, 2500)
    } catch (error) {
      console.error(error);
      err.textContent = 'No pudimos publicar tu mensaje. Probá de nuevo.'
      err.classList.remove('hidden')
      submit.disabled = false
      submit.textContent = 'DEJAR MI MENSAJE'
    }
  })

  cargar()
}
