import './style.css'
import { WEDDING } from './config.js'
import { initLado } from './modules/lado.js'
import { initIntro, playIntro } from './modules/intro.js'
import { initCountdown } from './modules/countdown.js'
import { initRsvp } from './modules/rsvp.js'
import { initMuro } from './modules/muro.js'
import { initAdminLogin } from './modules/admin.js'

initIntro()
initCountdown()
initRsvp()
initMuro()
initAdminLogin()

// El video arranca recién cuando el invitado elige de qué lado viene.
initLado().then(playIntro)

// ---------- Agregar al calendario ----------
const ics = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '')
const calBtn = document.getElementById('calBtn')
if (calBtn) {
  calBtn.href =
    'https://calendar.google.com/calendar/render?' +
    new URLSearchParams({
      action: 'TEMPLATE',
      text: `Boda de ${WEDDING.names}`,
      dates: `${ics(WEDDING.date)}/${ics(WEDDING.endDate)}`,
      details: '¡Nos casamos! Ceremonia y fiesta en Quinta Doña Elvira.',
      location: WEDDING.place,
    })
}

// ---------- Reveal on scroll ----------
const io = new IntersectionObserver(
  (entries) => entries.forEach((en) => {
    if (en.isIntersecting) {
      en.target.classList.add('is-visible')
      io.unobserve(en.target)
    }
  }),
  { threshold: 0.15 },
)
document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
