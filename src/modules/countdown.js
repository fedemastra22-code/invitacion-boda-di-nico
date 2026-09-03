import { WEDDING } from '../config.js'

const pad = (n) => String(Math.max(0, n)).padStart(2, '0')

export function initCountdown() {
  const rootCover = document.getElementById('countdown')
  const rootIntro = document.getElementById('introCountdown')
  
  const setup = (root) => {
    if (!root) return null
    const el = (k) => root.querySelector(`[data-cd="${k}"]`)
    return { days: el('days'), hours: el('hours'), mins: el('mins'), secs: el('secs') }
  }

  const outCover = setup(rootCover)
  const outIntro = setup(rootIntro)

  let id
  const tick = () => {
    const diff = WEDDING.date - Date.now()
    if (diff <= 0) {
      if (outCover) Object.values(outCover).forEach((n) => n && (n.textContent = '00'))
      if (outIntro) Object.values(outIntro).forEach((n) => n && (n.textContent = '00'))
      clearInterval(id)
      return
    }
    const d = pad(Math.floor(diff / 86400000))
    const h = pad(Math.floor(diff / 3600000) % 24)
    const m = pad(Math.floor(diff / 60000) % 60)
    const s = pad(Math.floor(diff / 1000) % 60)

    if (outCover) {
      outCover.days.textContent = d
      outCover.hours.textContent = h
      outCover.mins.textContent = m
      outCover.secs.textContent = s
    }
    if (outIntro) {
      outIntro.days.textContent = d
      outIntro.hours.textContent = h
      outIntro.mins.textContent = m
      outIntro.secs.textContent = s
    }
  }

  tick()
  id = setInterval(tick, 1000)
}
