import { DEG, RAD } from './angles'
import { domeGeodesic, domeThickness } from './dome'
import type { Layer, LayerInfo, Move, WindingInput, WindingPlan } from './types'

export const MAX_HELICAL_DEG = 85

export function missingFields(input: WindingInput, axisCount: 3 | 4): string[] {
  const out: string[] = []
  const need: [keyof WindingInput, string][] = [
    ['mandrelDiameter', 'Mandrel çapı'],
    ['windLength', 'Sarım uzunluğu'],
    ['bandWidth', 'Bant genişliği'],
    ['bandThickness', 'Bant kalınlığı'],
    ['feedRate', 'Elyaf hızı'],
    ['turnDwellMinDeg', 'Uç dönüş açısı (asgari)']
  ]
  for (const [k, label] of need) {
    const v = input[k] as number | null
    if (v === null || !Number.isFinite(v) || v <= 0) out.push(label)
  }
  if (axisCount === 4) {
    const s = input.standoff
    if (s === null || !Number.isFinite(s) || s < 0) out.push('Kafa boşluğu (Y)')
  }
  if (input.layers.length === 0) out.push('En az bir katman')
  input.layers.forEach((l, i) => {
    if (l.kind === 'helical' && (l.angleDeg === null || !(l.angleDeg > 0 && l.angleDeg <= MAX_HELICAL_DEG))) {
      out.push(`Katman ${i + 1} açısı (0–${MAX_HELICAL_DEG}°)`)
    }
    if (l.kind === 'helical' && l.dome) {
      const h = l.domeHeight
      if (h === null || h === undefined || !Number.isFinite(h) || h <= 0) out.push(`Katman ${i + 1} dom yüksekliği (>0)`)
      // Clairaut kutup açıklığı r0 = R·sin(α) < R: α ≤ MAX_HELICAL_DEG olduğundan her zaman sağlanır
    }
    if (l.kind === 'helical' && l.patternSkip !== null && l.patternSkip !== undefined) {
      const j = l.patternSkip
      const n = layerBands(input, i)
      if (!Number.isInteger(j) || j < 1) out.push(`Katman ${i + 1} desen atlaması j (1 veya daha büyük tam sayı)`)
      else if (n !== null && !(j <= Math.max(1, n - 1) && gcd(j, n) === 1)) {
        out.push(`Katman ${i + 1} desen atlaması j=${j}: bant sayısı n=${n} ile aralarında asal ve 1…${Math.max(1, n - 1)} aralığında olmalı`)
      }
    }
  })
  return out
}

export function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b]
  return Math.abs(a)
}

const positive = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v) && v > 0

/**
 * Katman yarıçapı: planWinding ile aynı sırada ve aynı işlemlerle (bit bit aynı sonuç).
 * Gerekli girdiler eksikse null.
 */
function layerRadius(input: WindingInput, index: number): number | null {
  if (!positive(input.mandrelDiameter) || !positive(input.bandThickness)) return null
  const lt = 2 * input.bandThickness
  let r0 = input.mandrelDiameter / 2
  for (let k = 0; k < index; k++) r0 += lt
  return r0 + lt / 2
}

/** Helisel (düz/domlu) katmanın bant sayısı n = ceil(2πR·cosα / w); hesaplanamıyorsa null. */
export function layerBands(input: WindingInput, index: number): number | null {
  const l = input.layers[index]
  const r = layerRadius(input, index)
  if (!l || l.kind !== 'helical' || r === null || !positive(input.bandWidth)) return null
  if (!(positive(l.angleDeg) && l.angleDeg <= MAX_HELICAL_DEG)) return null
  return Math.max(1, Math.ceil((2 * Math.PI * r * Math.cos(l.angleDeg * RAD)) / input.bandWidth))
}

export interface PatternCandidate {
  /** Desen atlaması (gcd(j, n) = 1) */
  j: number
  /** Devre başına tam tur sayısı N (θc = 2πN + 2πj/n) */
  nTurns: number
  /** Uç dönüşü (derece), asgari değerden küçük değil */
  dwellDeg: number
}

/**
 * Helisel katman için geçerli desen adayları: 1 ≤ j ≤ n−1, gcd(j, n) = 1; uç dönüşü küçükten büyüğe.
 * Diğer girdiler eksikse boş liste. Gizli seçim yok: varsayılan j=1, kullanıcı seçer.
 */
export function patternCandidates(input: WindingInput, layerIndex: number, axisCount: 3 | 4): PatternCandidate[] {
  const cleared: WindingInput = { ...input, layers: input.layers.map((l) => ({ ...l, patternSkip: null })) }
  if (missingFields(cleared, axisCount).length > 0) return []
  const layer = input.layers[layerIndex]
  const n = layerBands(input, layerIndex)
  const r = layerRadius(input, layerIndex)
  if (!layer || n === null || r === null) return []
  const alpha = layer.angleDeg! * RAD
  const L = input.windLength!
  const bodyRot = (L * Math.tan(alpha)) / r
  const passRot = layer.dome ? 2 * domeGeodesic(r, layer.domeHeight!, r * Math.sin(alpha)).theta + bodyRot : bodyRot
  const dwellMin = input.turnDwellMinDeg! * RAD
  const out: PatternCandidate[] = []
  for (let j = 1; j <= Math.max(1, n - 1); j++) {
    if (gcd(j, n) !== 1) continue
    const p = circuitPlan(passRot, n, dwellMin, j)
    out.push({ j, nTurns: p.nTurns, dwellDeg: p.dwell * DEG })
  }
  return out.sort((a, b) => a.dwellDeg - b.dwellDeg || a.j - b.j)
}

interface Ctx {
  L: number
  w: number
  t: number
  feed: number
  dwellMin: number
  standoff: number
  axisCount: 3 | 4
}

type Push = (m: Omit<Move, 'y'> & { y?: number }) => void

/** Katman başı konumlama (G0): elyaf yolu yok, A birikimli mutlak. */
function positionMove(layer: number, x: number, startA: number, c: number, y: number, radius: number): Move {
  return { kind: 'position', layer, x, a: startA * DEG, c, y, fiberLength: 0, radius }
}

/**
 * Sarım yolunu üretir. Çağırmadan önce missingFields boş olmalı.
 * Mandrel hep aynı yönde döner (A artar); carriage yön değiştirir → ±α helis.
 */
export function planWinding(input: WindingInput, axisCount: 3 | 4): WindingPlan {
  const ctx: Ctx = {
    L: input.windLength!,
    w: input.bandWidth!,
    t: input.bandThickness!,
    feed: input.feedRate!,
    dwellMin: input.turnDwellMinDeg! * RAD,
    standoff: input.standoff ?? 0,
    axisCount
  }
  const moves: Move[] = []
  const infos: LayerInfo[] = []
  let r0 = input.mandrelDiameter! / 2
  let a = 0
  let totalFiber = 0

  const push: Push = (m) => {
    moves.push({ ...m, y: m.y ?? 0 })
  }

  // Önceki domlu katmanlar (kalınlık birikimi için): katman yarıçapı ve açı
  const priorDomes: { R: number; alpha: number }[] = []

  input.layers.forEach((layer, index) => {
    const lt = 2 * ctx.t
    const r = r0 + lt / 2
    const y = axisCount === 4 ? r0 + lt + ctx.standoff : 0
    // İlk katmandan sonra elyaf bağlı: geçiş G0 olamaz. Uç dönüşü gibi A asgari dönüş kadar dönerken
    // X/C/Y yeni katmanın başlangıcına gider (katmanın ilk hareketi 'transition' olur).
    const startA = index === 0 ? a : a + ctx.dwellMin
    const first = moves.length
    const res =
      layer.kind === 'helical' && layer.dome
        ? domedHelicalLayer(ctx, layer, index, r, y, startA, push, priorDomes)
        : layer.kind === 'helical'
        ? helicalLayer(ctx, layer, index, r, y, startA, push)
        : hoopLayer(ctx, index, r, y, startA, push)
    if (index > 0) {
      const m = moves[first]
      const prev = moves[first - 1]
      const len = Math.hypot(m.x - prev.x, m.y - prev.y, m.radius * ctx.dwellMin)
      moves[first] = { ...m, kind: 'transition', fiberLength: len }
      res.info.fiberLength += len
    }
    a = res.endA
    infos.push(res.info)
    if (layer.kind === 'helical' && layer.dome) priorDomes.push({ R: r, alpha: layer.angleDeg! * RAD })
    totalFiber += res.info.fiberLength
    r0 += lt
  })

  for (const m of moves) {
    if (![m.x, m.a, m.c, m.y, m.fiberLength, m.radius].every(Number.isFinite)) {
      throw new Error('Sarım yolu sonlu olmayan değer üretti (girdi aşırı büyük/küçük olabilir)')
    }
  }

  return {
    moves,
    layers: infos,
    totalFiberLength: totalFiber,
    totalMinutes: totalFiber / ctx.feed,
    feedRate: ctx.feed,
    outerDiameter: 2 * r0
  }
}

/**
 * Devre dönüşü θc = 2πN + 2π·j/n (j=1: bir sonraki devre komşu banda düşer; gcd(j, n)=1 ise n devre
 * çevrenin n yuvasını birer kez ziyaret eder); uç dönüşü δ = (θc − 2·passRot)/2 ≥ dwellMin olan en küçük N.
 * passRot: tek geçişin toplam mandrel dönüşü (rad). step = devre başına faz ilerlemesi 2π·j/n.
 */
function circuitPlan(passRot: number, bands: number, dwellMin: number, j = 1): { nTurns: number; step: number; dwell: number } {
  const step = ((2 * Math.PI) / bands) * j
  const nTurns = Math.max(0, Math.ceil((2 * passRot + 2 * dwellMin - step) / (2 * Math.PI)))
  const circuitRot = 2 * Math.PI * nTurns + step
  return { nTurns, step, dwell: (circuitRot - 2 * passRot) / 2 }
}

function patternWarning(dwell: number, dwellMin: number, nTurns: number, step: number, j: number): string {
  const what = j === 1 ? 'komşu bant deseni' : `desen j=${j}`
  return `Uç dönüşü ${(dwell * DEG).toFixed(1)}° (asgari ${(dwellMin * DEG).toFixed(1)}°): ${what} (devre başına ${nTurns} tur + ${(step * DEG).toFixed(1)}°) bunu gerektiriyor`
}

function helicalLayer(
  ctx: Ctx,
  layer: Layer,
  index: number,
  r: number,
  y: number,
  startA: number,
  push: Push
): { info: LayerInfo; endA: number } {
  const alpha = layer.angleDeg! * RAD
  const { L } = ctx
  const warnings: string[] = []
  const passRot = (L * Math.tan(alpha)) / r // rad, tek geçiş
  const circumference = 2 * Math.PI * r * Math.cos(alpha)
  const bands = Math.max(1, Math.ceil(circumference / ctx.w))
  const j = layer.patternSkip ?? 1
  const { nTurns, step, dwell } = circuitPlan(passRot, bands, ctx.dwellMin, j)

  const cDeg = layer.angleDeg!
  const passLen = Math.hypot(L, r * passRot)
  const dwellLen = r * dwell

  push(positionMove(index, 0, startA, cDeg, y, r))
  let a = startA
  for (let k = 0; k < bands; k++) {
    a += passRot
    push({ kind: 'pass', layer: index, x: L, a: a * DEG, c: cDeg, y, fiberLength: passLen, radius: r })
    a += dwell
    push({ kind: 'dwell', layer: index, x: L, a: a * DEG, c: -cDeg, y, fiberLength: dwellLen, radius: r })
    a += passRot
    push({ kind: 'pass', layer: index, x: 0, a: a * DEG, c: -cDeg, y, fiberLength: passLen, radius: r })
    a += dwell
    push({ kind: 'dwell', layer: index, x: 0, a: a * DEG, c: cDeg, y, fiberLength: dwellLen, radius: r })
  }

  if (dwell > 2 * ctx.dwellMin) warnings.push(patternWarning(dwell, ctx.dwellMin, nTurns, step, j))
  if (layer.angleDeg! > 70) warnings.push('Açı 70° üstünde: hoop katman daha uygun olabilir')

  return {
    endA: a,
    info: {
      index,
      kind: 'helical',
      angleDeg: layer.angleDeg!,
      radius: r,
      bands,
      circuits: bands,
      turnDwellDeg: dwell * DEG,
      patternSkip: j,
      fiberLength: bands * (2 * passLen + 2 * dwellLen),
      coverage: (bands * ctx.w) / circumference,
      warnings
    }
  }
}

function hoopLayer(
  ctx: Ctx,
  index: number,
  r: number,
  y: number,
  startA: number,
  push: Push
): { info: LayerInfo; endA: number } {
  const { L } = ctx
  const turns = Math.ceil(L / ctx.w)
  const pitch = L / turns // bant genişliğini aşmaz → boşluksuz
  const rot = 2 * Math.PI * turns
  const angle = Math.atan((2 * Math.PI * r) / pitch) * DEG // eksene göre (~90°)
  const passLen = Math.hypot(L, r * rot)

  push(positionMove(index, 0, startA, angle, y, r))
  // Helisel ile aynı sözleşme: dönüş geçişinde elyaf yönü −açı; kafa uçta dönüş sırasında çevrilir
  const dwellLen = r * ctx.dwellMin
  let a = startA + rot
  push({ kind: 'pass', layer: index, x: L, a: a * DEG, c: angle, y, fiberLength: passLen, radius: r })
  a += ctx.dwellMin
  push({ kind: 'dwell', layer: index, x: L, a: a * DEG, c: -angle, y, fiberLength: dwellLen, radius: r })
  a += rot
  push({ kind: 'pass', layer: index, x: 0, a: a * DEG, c: -angle, y, fiberLength: passLen, radius: r })

  return {
    endA: a,
    info: {
      index,
      kind: 'hoop',
      angleDeg: angle,
      radius: r,
      bands: turns,
      circuits: 1,
      turnDwellDeg: ctx.dwellMin * DEG,
      patternSkip: 1,
      fiberLength: 2 * passLen + dwellLen,
      coverage: ctx.w / pitch,
      warnings: []
    }
  }
}

/**
 * Domlu helisel katman: gövde x∈[0,L], iki uçta yarım-elips dom (yükseklik h).
 * Geodezik: r·sinφ = R·sinα; kutup açıklığı r0 = R·sin(α), eksenel konumu x = −h·cosα ve L + h·cosα.
 * Devre: sol kutup açıklığı → (dom, gövde, dom) → sağ kutup açıklığı → dwell → dönüş (ayna yol) → sol kutup → dwell.
 * Faz kuralı helisel ile aynı: θc = 2πN + 2π/n, n = ceil(2πR·cosα / w); devre başlangıç fazları (sol kutup
 * açıklığından çıkış) çevreyi n eşit parçaya böler.
 */
function domedHelicalLayer(
  ctx: Ctx,
  layer: Layer,
  index: number,
  r: number,
  yBody: number,
  startA: number,
  push: Push,
  priorDomes: { R: number; alpha: number }[]
): { info: LayerInfo; endA: number } {
  const alpha = layer.angleDeg! * RAD
  const h = layer.domeHeight!
  const { L } = ctx
  const warnings: string[] = []
  const c = r * Math.sin(alpha)
  const dome = domeGeodesic(r, h, c)

  const bodyRot = (L * Math.tan(alpha)) / r
  const passRot = 2 * dome.theta + bodyRot
  const circumference = 2 * Math.PI * r * Math.cos(alpha)
  const bands = Math.max(1, Math.ceil(circumference / ctx.w))
  const j = layer.patternSkip ?? 1
  const { nTurns, step, dwell } = circuitPlan(passRot, bands, ctx.dwellMin, j)
  const yOff = yBody - r // 4 eksen: Y = yol yarıçapı + (yarım katman + boşluk); dom boyunca yarıçapa uyar
  const yAt = (rr: number): number => (ctx.axisCount === 4 ? rr + yOff : 0)

  // İleri geçiş noktaları (sol kutup → sağ kutup): x, kümülatif θ, r, φ, parça uzunluğu
  interface P { x: number; th: number; r: number; phi: number; len: number }
  const pts: P[] = []
  const dp = dome.points
  const M = dp.length - 1
  for (let j = M; j >= 0; j--) {
    const prevS = j === M ? dp[M].s : dp[j + 1].s
    pts.push({ x: 0 - dp[j].z, th: dome.theta - dp[j].theta, r: dp[j].r, phi: dp[j].phi, len: j === M ? 0 : prevS - dp[j].s })
  }
  pts.push({
    x: L,
    th: dome.theta + bodyRot,
    r,
    phi: alpha,
    len: Math.hypot(L, r * bodyRot)
  })
  for (let j = 1; j <= M; j++) {
    pts.push({
      x: L + dp[j].z,
      th: dome.theta + bodyRot + dp[j].theta,
      r: dp[j].r,
      phi: dp[j].phi,
      len: dp[j].s - dp[j - 1].s
    })
  }
  // pts[0] = sol kutup açıklığı, pts[M] = sol ekvator (x=0), pts[M+1] = gövde sonu (x=L), pts[2M+1] = sağ kutup

  const poleLeftX = pts[0].x
  const cPole = dome.poleRadius
  const dwellLen = cPole * dwell
  const passLen = pts.reduce((sum, p) => sum + p.len, 0)

  push(positionMove(index, poleLeftX, startA, 90, yAt(cPole), cPole))
  let a = startA
  for (let k = 0; k < bands; k++) {
    const a0 = a
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]
      push({ kind: 'pass', layer: index, x: p.x, a: (a0 + p.th) * DEG, c: p.phi * DEG, y: yAt(p.r), fiberLength: p.len, radius: p.r })
    }
    a = a0 + passRot + dwell
    push({ kind: 'dwell', layer: index, x: pts[pts.length - 1].x, a: a * DEG, c: -90, y: yAt(cPole), fiberLength: dwellLen, radius: cPole })
    const a1 = a
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]
      push({ kind: 'pass', layer: index, x: L - p.x, a: (a1 + p.th) * DEG, c: -p.phi * DEG, y: yAt(p.r), fiberLength: p.len, radius: p.r })
    }
    a = a1 + passRot + dwell
    push({ kind: 'dwell', layer: index, x: poleLeftX, a: a * DEG, c: 90, y: yAt(cPole), fiberLength: dwellLen, radius: cPole })
  }

  if (dwell > 2 * ctx.dwellMin) warnings.push(patternWarning(dwell, ctx.dwellMin, nTurns, step, j))
  if (layer.angleDeg! > 70) warnings.push('Açı 70° üstünde: kutup açıklığı büyük, domun büyük kısmı sarılmaz')
  const poleFill = (bands * ctx.w) / (2 * Math.PI * cPole)
  if (poleFill > 1.0001) {
    warnings.push(
      `Kutup açıklığında bantlar sığmıyor: ${bands} bant × ${ctx.w} mm = çevrenin ${(poleFill * 100).toFixed(0)}% (r0=${cPole.toFixed(2)} mm); kutupta üst üste binme/kalınlaşma olur`
    )
  }
  warnings.push(
    `Dom: X ekseni ${(-dome.poleZ).toFixed(2)} … ${(L + dome.poleZ).toFixed(2)} mm aralığında (negatif X); sıfır noktası ve strok limitini buna göre ayarla`
  )

  // H3: analitik kalınlık (dome.domeThickness) ve önceki domlu katmanların birikimi.
  const T = 2 * ctx.t
  const thickness = dp.map((p) => ({ z: p.z, r: p.r, t: domeThickness(r, alpha, ctx.w, T, p.r) }))
  const maxThickness = domeThickness(r, alpha, ctx.w, T, cPole)
  // Model: her önceki katman (dom dahil) yarıçapa T ekler. Gerçek: dom üzerinde yalnız domlu katmanlar,
  // kendi kalınlık profiliyle. Fark aynı mutlak yarıçapta karşılaştırılır (katmanlar arası yarıçap kayması ihmal).
  // Her profil r'de artmayan, r < c_i'de 0: toplamın azamisi r = c (bu katman) veya bir c_i noktasında.
  const excessAt = (rr: number): number => priorDomes.reduce((s, d) => s + domeThickness(d.R, d.alpha, ctx.w, T, rr), 0) - T * index
  const probes = [cPole, ...priorDomes.map((d) => d.R * Math.sin(d.alpha)).filter((ci) => ci >= cPole && ci <= r), r]
  const buildup = Math.max(...probes.map(excessAt))
  const clearance = ctx.axisCount === 4 ? ctx.standoff - buildup : null
  if (clearance !== null && clearance < 0) {
    warnings.push(
      `Dom kalınlık birikimi: önceki domlu katmanlar kutup yakınında modelden ${buildup.toFixed(2)} mm kalın; etkin kafa boşluğu ${clearance.toFixed(2)} mm (negatif): kafa sarılmış yüzeye çarpabilir`
    )
  }

  return {
    endA: a,
    info: {
      index,
      kind: 'helical',
      angleDeg: layer.angleDeg!,
      radius: r,
      bands,
      circuits: bands,
      turnDwellDeg: dwell * DEG,
      patternSkip: j,
      fiberLength: bands * (2 * passLen + 2 * dwellLen),
      coverage: (bands * ctx.w) / circumference,
      warnings,
      dome: {
        height: h,
        poleRadius: cPole,
        poleOffset: dome.poleZ,
        thickness,
        maxThickness,
        capRadius: cPole + ctx.w,
        buildup,
        clearance
      }
    }
  }
}
