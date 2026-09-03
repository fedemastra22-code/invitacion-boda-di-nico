// Reconocimiento "inteligente" de texto libre: sin IA paga ni API externa,
// con un algoritmo de similitud por tokens (prefijo + distancia de Levenshtein).
// Suficiente para dos usos del dashboard:
//   1) matchear "fede mastra" contra el padrón "Federico Mastrascusa"
//   2) agrupar variantes de un mismo tema musical en el ranking

const DIACRITICS = new RegExp('[̀-ͯ]', 'g')

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(DIACRITICS, '') // saca acentos
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOPWORDS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'y', 'ft', 'feat', 'con', 'the'])

function tokens(s) {
  return normalize(s).split(' ').filter((w) => w && !STOPWORDS.has(w))
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}
function levRatio(a, b) {
  const maxLen = Math.max(a.length, b.length)
  return maxLen ? 1 - levenshtein(a, b) / maxLen : 1
}

// Similitud entre dos textos libres (0 a 1). Para cada palabra de `a` busca
// la mejor coincidencia en `b`: exacta, por prefijo ("fede" ⊂ "federico") o
// por distancia de edición (tolera errores de tipeo).
export function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b)
  if (!ta.length || !tb.length) return 0
  let total = 0
  for (const wa of ta) {
    let best = 0
    for (const wb of tb) {
      let s = 0
      if (wa === wb) s = 1
      else if (wa.length >= 3 && wb.startsWith(wa)) s = 0.9
      else if (wb.length >= 3 && wa.startsWith(wb)) s = 0.9
      else { const r = levRatio(wa, wb); if (r > 0.75) s = r }
      if (s > best) best = s
    }
    total += best
  }
  return total / ta.length
}

// Busca el mejor candidato para `query` dentro de `candidates`.
export function bestMatch(query, candidates, key = (x) => x, threshold = 0.6) {
  let best = null, bestScore = 0
  for (const c of candidates) {
    const score = similarity(query, key(c))
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore >= threshold ? { item: best, score: bestScore } : null
}

// Agrupa strings parecidos (temas musicales) y cuenta cuántas veces aparece
// cada grupo. Clustering greedy: cada item nuevo se suma al primer grupo
// existente con el que supera el umbral, o abre uno nuevo.
export function clusterSimilar(items, threshold = 0.55) {
  const clusters = []
  for (const raw of items) {
    if (!raw || !raw.trim()) continue
    const target = clusters.find((c) => similarity(raw, c.label) >= threshold)
    if (target) { target.count++; target.members.push(raw) }
    else clusters.push({ label: raw.trim(), count: 1, members: [raw] })
  }
  return clusters.sort((a, b) => b.count - a.count)
}

export { normalize, tokens }
