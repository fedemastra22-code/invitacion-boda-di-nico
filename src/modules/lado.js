// Filtro previo: el invitado elige de qué lado viene. Sólo cambia los alias
// del regalo; el resto de la invitación es igual para todos.
const ALIAS = {
  nico: { pesos: 'PALA.CONEJO.PASION', dolares: 'DORADO.CASCO.CIMA' },
  diana: { pesos: 'Bodadiynico', dolares: null }, // Diana no muestra alias en dólares
}
const CLAVE = 'ladoInvitado'

function aplicar(lado) {
  const alias = ALIAS[lado] || ALIAS.nico
  const pesos = document.getElementById('aliasPesos')
  const dolares = document.getElementById('aliasDolares')
  const dolaresCard = document.getElementById('aliasDolaresCard')
  if (pesos) pesos.textContent = alias.pesos
  if (dolaresCard) dolaresCard.classList.toggle('hidden', !alias.dolares)
  if (dolares && alias.dolares) dolares.textContent = alias.dolares
}

// Copiar alias: lee el texto en el momento del click (no un valor fijo), así
// siempre copia el alias que está mostrado según el lado elegido (Nico o
// Diana). El texto pegado en WhatsApp/Mercado Pago/apps bancarias debe ser
// el alias solo, sin espacios extra.
function initCopiarAlias() {
  document.querySelectorAll('[data-copy-target]').forEach((btn) => {
    const span = document.getElementById(btn.dataset.copyTarget)
    if (!span) return
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(span.textContent.trim())
      } catch {
        return // clipboard bloqueado (permisos/http sin TLS); no hay fallback razonable acá
      }
      btn.classList.add('is-copied')
      setTimeout(() => btn.classList.remove('is-copied'), 1500)
    })
  })
}

/** Resuelve con el lado elegido, ya aplicado a la página. */
export function initLado() {
  initCopiarAlias()
  const gate = document.getElementById('lado')
  return new Promise((resolve) => {
    if (!gate) return resolve('nico')
    document.body.style.overflow = 'hidden'

    const elegir = (lado) => {
      localStorage.setItem(CLAVE, lado)
      aplicar(lado)
      gate.classList.add('is-done')
      setTimeout(() => gate.remove(), 900)
      resolve(lado)
    }

    // Forzamos que siempre se muestre el selector (eliminamos el bypass de localStorage)

    // 'click' solo, a veces no alcanza en iOS Safari: en pantalla completa
    // fixed (como este gate) el gesto de tap a veces no llega a sintetizar
    // el evento click (se pierde contra el reconocedor de gestos nativo de
    // WebKit, sobre todo con apple-mobile-web-app-capable activado, como
    // acá) — el botón se ve pero no responde a nada. 'touchend' es más
    // directo y no depende de esa síntesis. Con una bandera para no
    // disparar los dos si el navegador sí sintetiza el click después.
    gate.querySelectorAll('[data-lado]').forEach((btn) => {
      let yaElegido = false
      const disparar = () => {
        if (yaElegido) return
        yaElegido = true
        elegir(btn.dataset.lado)
      }
      btn.addEventListener('touchend', (e) => { e.preventDefault(); disparar() }, { passive: false })
      btn.addEventListener('click', disparar)
    })
  })
}
