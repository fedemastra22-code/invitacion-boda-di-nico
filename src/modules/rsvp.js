import { ref, push, serverTimestamp } from 'firebase/database'
import { db } from './firebase.js'

// Audios de interacción para acompañantes — servidos desde /public/media
// (copiados de .asset/) en vez de apuntar a myinstants.com: no dependen de
// un sitio externo, cargan más rápido y no se rompen si esa página cambia.
const audioLonely = new Audio('/media/only_you.mp3')
audioLonely.volume = 0.7

const audioLatigazo = new Audio('/media/latigo.mp3')
audioLatigazo.volume = 0.7

const audioCapusotto = new Audio('/media/hdptm.mp3')
audioCapusotto.volume = 0.7

let currentAudio = null
let audioTimeout = null

function stopCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  if (audioTimeout) {
    clearTimeout(audioTimeout)
    audioTimeout = null
  }
}

export function initRsvp() {
  const modal = document.getElementById('rsvpModal')
  const form = document.getElementById('rsvpForm')
  const ok = document.getElementById('rsvpSuccess')
  const err = document.getElementById('rsvpError')
  const submit = document.getElementById('rsvpSubmit')
  const selectAsistencia = document.getElementById('asistencia')
  const radioAcompanantes = document.querySelectorAll('input[name="tipoAcompanante"]')
  const nombreInput = document.getElementById('nombre')
  const radioSolo = document.querySelector('input[name="tipoAcompanante"][value="solo"]')
  const stepAsistencia = document.getElementById('stepAsistencia')
  const stepAcompanantes = document.getElementById('stepAcompanantes')
  const stepNombreAcompanante = document.getElementById('stepNombreAcompanante')
  const stepRestricciones = document.getElementById('stepRestricciones')
  const stepRestriccionesAcompanante = document.getElementById('stepRestriccionesAcompanante')
  const stepCancion = document.getElementById('stepCancion')
  const stepSubmit = document.getElementById('stepSubmit')
  const nombreAcompananteInput = document.getElementById('nombreAcompanante')

  if (!modal || !form) return

  // ================= Revelado progresivo del form =================
  // Cada paso arranca oculto (.rsvp-step en style.css) y se va mostrando a
  // medida que se completa el anterior. "¿Nos acompañás?" además decide una
  // rama: con "No voy a poder" no tiene sentido preguntar acompañantes,
  // restricciones ni tema musical — se ocultan del todo (no sólo se
  // colapsan visualmente) y el required de los radios de acompañante se
  // saca para que el navegador no intente validar un campo escondido.
  const revealStep = (el, delay = 0) => {
    if (!el) return
    setTimeout(() => el.classList.add('rsvp-step-visible'), delay)
  }
  const hideStep = (el) => el?.classList.remove('rsvp-step-visible')

  // Revela la cascada de acompañante+restricciones según "Voy Solo" / "En
  // Pareja" — se separó de handleRadioChange (que sólo maneja el audio) para
  // no mezclar las dos responsabilidades en un mismo handler.
  const revealCascadaAcompanante = (esPareja) => {
    if (esPareja) {
      revealStep(stepNombreAcompanante)
      revealStep(stepRestricciones, 150)
      revealStep(stepRestriccionesAcompanante, 300)
      revealStep(stepCancion, 450)
      revealStep(stepSubmit, 600)
    } else {
      hideStep(stepNombreAcompanante)
      hideStep(stepRestriccionesAcompanante)
      if (nombreAcompananteInput) nombreAcompananteInput.value = ''
      revealStep(stepRestricciones)
      revealStep(stepCancion, 150)
      revealStep(stepSubmit, 300)
    }
  }

  const updateAsistenciaBranch = () => {
    if (!selectAsistencia) return
    if (selectAsistencia.value === 'No') {
      hideStep(stepAcompanantes)
      hideStep(stepNombreAcompanante)
      hideStep(stepRestricciones)
      hideStep(stepRestriccionesAcompanante)
      hideStep(stepCancion)
      radioSolo?.removeAttribute('required')
      revealStep(stepSubmit, 150)
    } else {
      radioSolo?.setAttribute('required', '')
      revealStep(stepAcompanantes)
      // Si ya había elegido acompañante (ej. tocó "No" y volvió a "Sí"),
      // no lo hace esperar de nuevo: reaparece toda la cascada de una.
      const elegido = [...radioAcompanantes].find((r) => r.checked)
      if (elegido) {
        revealCascadaAcompanante(elegido.value === 'pareja')
      } else {
        hideStep(stepNombreAcompanante)
        hideStep(stepRestricciones)
        hideStep(stepRestriccionesAcompanante)
        hideStep(stepCancion)
        hideStep(stepSubmit)
      }
    }
  }

  nombreInput?.addEventListener('input', () => {
    if (nombreInput.value.trim().length > 0 && !stepAsistencia?.classList.contains('rsvp-step-visible')) {
      stepAsistencia?.classList.add('rsvp-step-visible')
      updateAsistenciaBranch()
    }
  })

  selectAsistencia?.addEventListener('change', updateAsistenciaBranch)

  radioAcompanantes.forEach((radio) => radio.addEventListener('change', () => {
    revealCascadaAcompanante(radio.value === 'pareja')
  }))

  // Select de restricciones con "Otro": el input de texto libre sólo se
  // muestra (y sólo importa) cuando el select vale "Otro" — ver el submit
  // más abajo, donde ese texto reemplaza al valor "Otro" antes de guardar.
  const wireOtro = (selectId, inputId) => {
    const sel = document.getElementById(selectId)
    const otro = document.getElementById(inputId)
    if (!sel || !otro) return
    sel.addEventListener('change', () => otro.classList.toggle('hidden', sel.value !== 'Otro'))
  }
  wireOtro('restricciones', 'restriccionesOtro')
  wireOtro('restriccionesAcompanante', 'restriccionesAcompananteOtro')

  document.getElementById('openRsvp')?.addEventListener('click', () => {
    modal.showModal()
    // Desbloquear audios en móviles al interactuar con el botón (en silencio)
    [audioLonely, audioLatigazo, audioCapusotto].forEach(aud => {
      aud.volume = 0
      aud.play().then(() => {
        aud.pause()
        aud.currentTime = 0
        aud.volume = 0.7
      }).catch(() => {})
    })
  })
  document.getElementById('closeRsvp')?.addEventListener('click', () => {
    modal.close()
    stopCurrentAudio()
  })

  // Click fuera del panel cierra
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.close()
      stopCurrentAudio()
    }
  })

  // Lógica de audio y UI para los radio buttons de acompañamiento
  if (radioAcompanantes.length > 0) {
    const handleRadioChange = (e) => {
      const val = e.target.value
      
      // Detener cualquier audio previo antes de arrancar uno nuevo
      stopCurrentAudio()

      if (val === 'solo') {
        currentAudio = audioLonely
        currentAudio.currentTime = 0
        currentAudio.play().catch(() => {})

        // Detener a los 6 segundos exactos
        audioTimeout = setTimeout(() => {
          stopCurrentAudio()
        }, 6000)
      } else if (val === 'pareja') {
        currentAudio = audioLatigazo
        currentAudio.currentTime = 0
        currentAudio.play().catch(() => {})

        // Detener a los 3 segundos exactos
        audioTimeout = setTimeout(() => {
          stopCurrentAudio()
        }, 3000)
      }
    }

    radioAcompanantes.forEach(radio => radio.addEventListener('change', handleRadioChange))
  }

  // Lógica de audio para el campo "Nos Acompañas?"
  if (selectAsistencia) {
    selectAsistencia.addEventListener('change', (e) => {
      stopCurrentAudio()
      if (e.target.value === 'No') {
        currentAudio = audioCapusotto
        currentAudio.currentTime = 0
        currentAudio.play().catch(() => {})
        
        // Detener a los 3 segundos aprox
        audioTimeout = setTimeout(() => {
          stopCurrentAudio()
        }, 3500)
      }
    })
  }

  const fail = (msg) => {
    err.textContent = msg
    err.classList.remove('hidden')
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.classList.add('hidden')

    const data = Object.fromEntries(new FormData(form))
    if (!data.nombre?.trim()) return fail('Por favor escribí tu nombre.')

    // "Otro" es sólo el valor del <select> mientras se escribe el texto
    // libre — antes de guardar, se reemplaza por lo que puso la persona (o
    // por "Otro" a secas si lo dejó vacío). Los campos *Otro nunca se
    // guardan sueltos, no hace falta borrarlos del payload.
    if (data.restricciones === 'Otro') data.restricciones = data.restriccionesOtro?.trim() || 'Otro'
    if (data.restriccionesAcompanante === 'Otro') data.restriccionesAcompanante = data.restriccionesAcompananteOtro?.trim() || 'Otro'
    delete data.restriccionesOtro
    delete data.restriccionesAcompananteOtro

    submit.disabled = true
    submit.textContent = 'ENVIANDO…'

    try {
      // Guardado directo a Realtime Database — se sacó la Cloud Function con
      // IA (Genkit/Gemini) que estaba acá: necesitaba GEMINI_API_KEY
      // desplegada en Firebase Functions, y como nunca se volvió a
      // desplegar después de configurar esa variable, la función tiraba
      // error interno en cada llamada (se veía como un bloqueo de CORS en
      // el navegador, pero la causa real era que la función crasheaba al
      // arrancar Genkit sin la key). El panel de admin ya separa
      // nombre/apellido y matchea contra el padrón por su cuenta
      // (text-match.js), así que no hace falta IA acá para que el dato
      // llegue completo — esto es más simple y no depende de un deploy
      // aparte quedando sincronizado.
      await push(ref(db, 'rsvps'), {
        ...data,
        createdAt: serverTimestamp(),
        lado: localStorage.getItem('ladoInvitado') || 'Di y Nico'
      })

      form.classList.add('hidden')
      ok.classList.remove('hidden')
      stopCurrentAudio()
    } catch (error) {
      console.error(error)
      fail('No pudimos guardar tu confirmación. Probá de nuevo en un momento.')
      submit.disabled = false
      submit.textContent = 'ENVIAR CONFIRMACIÓN'
    }
  })
}
