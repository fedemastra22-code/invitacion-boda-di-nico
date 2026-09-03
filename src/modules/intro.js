// Video presentador: ocupa la pantalla, se reproduce una vez y se disuelve
// hacia la portada. Se puede volver a ver con el botón de video.
let intro, video, hideTimer
let animationTimers = []

// Sonido de Reloj (Eliminado)

// Canvas para el descorchazo 3D y Confeti
let canvas, ctx, animationFrameId
let particles = []
let confettiList = []
let canvasActive = false

// Partícula de Lluvia (Canvas Vanilla)
class RainDrop {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.reset(true)
  }

  reset(randomY = false) {
    this.x = Math.random() * this.w
    this.y = randomY ? Math.random() * this.h : Math.random() * -100 - 10
    this.z = Math.random() * 20 + 2
    this.vy = (Math.random() * 10 + 15) * (15 / this.z)
    this.length = this.vy * 1.5
    
    // 15% de probabilidad de ser una gota resbalando por la lente (vidrio)
    this.isSplatter = Math.random() < 0.15
    if (this.isSplatter) {
      this.vy = Math.random() * 2 + 1 // resbala lento
      this.size = Math.random() * 4 + 2
      this.length = 0
    }
  }

  update() {
    this.y += this.vy
    if (this.isSplatter) {
      // Resbalón en zig zag
      this.x += (Math.random() - 0.5) * 0.3
      this.size *= 0.998
    } else {
      // Viento sutil hacia la derecha
      this.x += 15 / this.z * 0.1
    }

    if (this.y > this.h + 100 || (this.isSplatter && this.size < 0.2)) {
      this.reset()
    }
  }

  draw(c) {
    c.save()
    if (this.isSplatter) {
      const r = this.size
      // Estela
      c.beginPath()
      c.moveTo(this.x, this.y - r * 2)
      c.lineTo(this.x, this.y)
      c.strokeStyle = 'rgba(255, 255, 255, 0.05)'
      c.lineWidth = r
      c.stroke()
      
      // Cuerpo de la gota
      c.beginPath()
      c.arc(this.x, this.y, r, 0, Math.PI * 2)
      c.fillStyle = 'rgba(220, 220, 230, 0.15)'
      c.fill()
      
      // Borde de refracción
      c.strokeStyle = 'rgba(0, 0, 0, 0.3)'
      c.lineWidth = r * 0.1
      c.stroke()
      
      // Brillo
      c.beginPath()
      c.arc(this.x - r * 0.3, this.y - r * 0.3, r * 0.25, 0, Math.PI * 2)
      c.fillStyle = 'rgba(255, 255, 255, 0.7)'
      c.fill()
    } else {
      // Gota cayendo
      c.beginPath()
      c.moveTo(this.x, this.y)
      c.lineTo(this.x - (15 / this.z * 0.1 * this.length), this.y - this.length)
      c.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      c.lineWidth = 15 / this.z * 0.15
      c.stroke()
    }
    c.restore()
  }
}

function initCanvas() {
  canvas = document.getElementById('champagneCanvas')
  if (!canvas) return
  ctx = canvas.getContext('2d')
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
}

function resizeCanvas() {
  if (canvas) {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
}

function startCanvasAnimation() {
  canvasActive = false
}

export function initIntro() {
  intro = document.getElementById('intro')
  video = document.getElementById('introVideo')
  if (!intro) return

  initCanvas()

  video?.addEventListener('ended', () => {
    video.pause()
  })
  
  video?.addEventListener('error', endIntro)
  document.getElementById('introSkip')?.addEventListener('click', endIntro)
}

export function playIntro() {
  if (!intro) return
  
  // Limpiar timers
  clearTimeout(hideTimer)
  animationTimers.forEach(clearTimeout)
  animationTimers = []
  
  canvasActive = false
  cancelAnimationFrame(animationFrameId)
  
  const t1 = document.getElementById('introTitle1')
  const t2 = document.getElementById('introTitle2')
  const t3 = document.getElementById('introTitle3')
  const t4 = document.getElementById('introTitle4')
  const t5 = document.getElementById('introTitle5')

  intro.classList.remove('is-done', 'dissolve-bg')
  t1?.classList.remove('animate-active', 'animate-nos-casamos-loop')
  t2?.classList.remove('animate-active')
  t3?.classList.remove('animate-active', 'animate-nos-casamos-loop')
  t4?.classList.remove('animate-active')
  t5?.classList.remove('animate-active')

  document.body.style.overflow = 'hidden'

  // Activar Canvas
  startCanvasAnimation()

  // Música de fondo: suena una única vez, durante toda la presentación
  // (no hay control manual en la landing). ambient.mp3 dura 20s y la intro
  // 20s — igual a la duración de ambient.mp3, así que ya no hace falta loop:
  // el tema termina justo cuando termina la intro (ver "NUEVA SECUENCIA").
  const ambient = document.getElementById('ambient')
  if (ambient) {
    ambient.currentTime = 0
    ambient.loop = false
    ambient.volume = 0.35
    ambient.play().catch(() => {})
  }

  if (video) {
    video.currentTime = 0
    // La cámara lenta (0.7x) ya viene grabada en el archivo: intro.mp4 dura
    // 7.57 s a 30 fps constantes. Safari en iOS se traba cuando tiene que
    // re-temporizar el video con playbackRate, así que lo dejamos en 1.
    video.playbackRate = 1
    video.play().catch(endIntro)
  }

  // ================= NUEVA SECUENCIA DE TIEMPOS =================
  // Secuencia total: 20s (antes 23s) — 3s menos para terminar justo cuando
  // termina ambient.mp3 (20s exactos), en vez de dejarla sonando de más.
  // Cada momento se corrió al mismo factor (20/23 ≈ .87) para no perder el
  // ritmo relativo entre pasos; las duraciones de las animaciones CSS de
  // cada título se escalaron igual (ver .animate-active en style.css).

  // [.87s] Paso 1: "NOS CASAMOS" (dura 2.6s)
  animationTimers.push(setTimeout(() => {
    t1?.classList.add('animate-active')
  }, 870))

  // [3.48s] Paso 2: "Di & Nico" (choque y 2 rebotes, dura 4.35s)
  animationTimers.push(setTimeout(() => {
    t2?.classList.add('animate-active')
    t1?.classList.add('animate-nos-casamos-loop')
  }, 3480))

  // [7.83s] Paso 3: "The Wedding" (dura 2.6s)
  animationTimers.push(setTimeout(() => {
    t3?.classList.add('animate-active')
  }, 7830))

  // [10.44s] Paso 4: Fecha y Dirección (dura 1.74s). Acá también arranca el
  // loop de pulso de "the wedding" (t3), igual que t1 lo arranca al terminar
  // su propia animación de aparición (10.43s = 7.83s + 2.6s de duración de
  // mayor-a-menor-title-3) — si el loop se pone como clase estática en el
  // HTML, .animate-nos-casamos-loop pisa el opacity:0 inicial desde el
  // arranque (sus keyframes van de opacity .8 a 1, nunca 0) y "the wedding"
  // se ve parpadeando desde el segundo 0, antes de "Di & Nico".
  animationTimers.push(setTimeout(() => {
    t4?.classList.add('animate-active')
    t3?.classList.add('animate-nos-casamos-loop')
  }, 10440))

  // [13.04s - 18.7s] Paso 5: Aparece el reloj conteo y va desapareciendo
  animationTimers.push(setTimeout(() => {
    t5?.classList.add('animate-active')
  }, 13040))

  // [18.7s] Disolución del fondo — arranca justo antes de que termine el tema
  animationTimers.push(setTimeout(() => {
    intro.classList.add('dissolve-bg')
    const hero = document.getElementById('hero')
    if (hero) hero.style.opacity = '1'

    const countdown = document.getElementById('countdown')
    if (countdown) {
      countdown.classList.add('animate-countdown-entry')
    }
  }, 18700))

  // [20s] Cierre absoluto — coincide con el final de ambient.mp3
  animationTimers.push(setTimeout(() => {
    endIntro()
  }, 20000))
}

function endIntro() {
  if (!intro || intro.classList.contains('is-done')) return
  
  clearTimeout(hideTimer)
  animationTimers.forEach(clearTimeout)
  animationTimers = []
  
  canvasActive = false
  cancelAnimationFrame(animationFrameId)
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  intro.classList.add('is-done')
  document.body.style.overflow = ''
  video?.pause()

  // El audio se corta acá: cubre tanto el final natural de la secuencia
  // como el SALTAR — en los dos casos la música termina cuando termina la intro.
  const ambient = document.getElementById('ambient')
  if (ambient) { ambient.pause(); ambient.currentTime = 0 }
}
