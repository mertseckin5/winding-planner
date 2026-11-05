import { DEG, RAD } from './angles'
import { domeGeodesic, domeThickness, type DomePath, type DomePoint } from './dome'
import { axialReq, stationaryIntervals, thetaReqDeg } from './slip'
import type { HeadAngleMode, Layer, LayerInfo, MachineConfig, Move, WindingInput, WindingPlan } from './types'

export const MAX_HELICAL_DEG = 85

/**
 * planWinding / missingFields hedefi. Makine verilirse makineye bağlı kurallar (REQ-002 strok, REQ-004 göz
 * yarıçapı) ve C sözleşmesi (REQ-003) uygulanır. Yalnız eksen sayısı verilirse (eski çağrı biçimi; testler ve
 * desen adayları) yalnız geometri denetlenir, C eski ±φ sözleşmesiyle yazılır, Re yok. Uygulama makineyi verir.
 */
export type PlanTarget = 3 | 4 | Pick<MachineConfig, 'axisCount' | 'headAngleMode' | 'eyeRadius' | 'travel'>

/** Alan yoksa (eski kayıt/persist) eski davranış: ±φ. Arayüz ve G-code başlığı bu durumu ayrıca uyarır. */
export function resolveHeadMode(m: { headAngleMode?: HeadAngleMode } | undefined): HeadAngleMode {
  return m?.headAngleMode ?? 'mirror'
}

const axisOf = (t: PlanTarget): 3 | 4 => (typeof t === 'number' ? t : t.axisCount)

/** REQ-002 eksik alan metni (testler de bu sabiti kullanır) */
export const DOME_TRAVEL_FIELD = 'X strok sınırları (domlu katman X\'i −h·cosα\'ya götürüyor)'

export function missingFields(input: WindingInput, target: PlanTarget): string[] {
  const axisCount = axisOf(target)
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
  // REQ-006: μ isteğe bağlı (boş = kayma kontrolü yok); girildiyse sonlu ve pozitif
  const mu = input.friction
  if (mu !== null && mu !== undefined && !(Number.isFinite(mu) && mu > 0)) out.push('Sürtünme katsayısı μ (> 0)')
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
  if (typeof target !== 'number') {
    // REQ-002: dom X'i mandrel ucunun ötesine (ayna/punta bölgesine) götürür; strok sınırı olmadan üretim yok
    const t = target.travel?.carriage
    const set = (v: number | null | undefined): boolean => v !== null && v !== undefined && Number.isFinite(v)
    if (input.layers.some((l) => l.kind === 'helical' && l.dome) && !(set(t?.min) && set(t?.max))) out.push(DOME_TRAVEL_FIELD)
    // REQ-004: 3 eksende girilmiş göz yarıçapı her katman yarıçapından büyük olmalı (boşsa kontrol yok)
    const re = target.eyeRadius
    if (axisCount === 3 && re !== null && re !== undefined) {
      if (!Number.isFinite(re) || re <= 0) out.push('Göz yarıçapı Re (> 0 mm)')
      else {
        const k = input.layers.findIndex((_, i) => {
          const r = layerRadius(input, i)
          return r !== null && re <= r
        })
        if (k >= 0) {
          out.push(
            `Göz yarıçapı Re=${re} mm katman ${k + 1} yarıçapından (${layerRadius(input, k)!.toFixed(2)} mm) küçük: kafa mandrele çarpar`
          )
        } else {
          // REQ-009: göz Re'de sabit, sargı büyür; bağlayıcı yüzey son katmanın dış yarıçapı (eşitlik = temas)
          const ro = outerRadius(input)
          if (ro !== null && re <= ro) {
            out.push(`Göz yarıçapı Re=${re} mm parçanın dış yarıçapından (${ro.toFixed(2)} mm) büyük olmalı: kafa son katmanda sargıya değer`)
          }
        }
      }
    }
  }
  return out
}

/**
 * REQ-004 serbest elyaf: temas noktasından teğet boyunca göze kadar düz elyaf. Teğet üzerinde λ ilerleyince
 * çevresel bileşen λ·sinα yüzeyden radyal uzaklaştırır (√(r² + (λ sinα)²) = Re), eksenel bileşen λ·cosα.
 * Re ≤ r ise (göz yüzeyin içinde) null.
 */
export function freeFiber(re: number, r: number, alpha: number): { freeLength: number; axialLag: number } | null {
  if (!(re > r)) return null
  const q = Math.sqrt(re * re - r * r)
  return { freeLength: q / Math.sin(alpha), axialLag: q / Math.tan(alpha) }
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

/** Tüm katmanlar sarıldıktan sonraki dış yarıçap (= plan.outerDiameter / 2, aynı işlem sırası); eksikse null. */
function outerRadius(input: WindingInput): number | null {
  if (!positive(input.mandrelDiameter) || !positive(input.bandThickness)) return null
  const lt = 2 * input.bandThickness
  let r0 = input.mandrelDiameter / 2
  for (let k = 0; k < input.layers.length; k++) r0 += lt
  return r0
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
  /**
   * Dönüş geçişinde (ve dönüşe giden uç dönüşünde) C, gidiş açısı φ'den: REQ-003 'fiber' 180° − φ
   * (dom kutbunda 90° → 90°, C dönmez), 'mirror' −φ (eski).
   */
  back: (phiDeg: number) => number
}

type Push = (m: Omit<Move, 'y'> & { y?: number }) => void

/** REQ-007: domlu katmanın sol dom yolu (ekvator → kutup noktaları), toplam dönüşü ve 4 eksen Y kayması (Y = r + yOff) */
interface DomeTrack {
  points: DomePoint[]
  theta: number
  yOff: number
}

/** Katman başı konumlama (G0): elyaf yolu yok, A birikimli mutlak. */
function positionMove(layer: number, x: number, startA: number, c: number, y: number, radius: number): Move {
  return { kind: 'position', layer, x, a: startA * DEG, c, y, fiberLength: 0, radius }
}

/**
 * Sarım yolunu üretir. Çağırmadan önce missingFields boş olmalı.
 * Mandrel hep aynı yönde döner (A artar); carriage yön değiştirir → ±α helis.
 */
export function planWinding(input: WindingInput, target: PlanTarget): WindingPlan {
  const axisCount = axisOf(target)
  const headAngleMode = typeof target === 'number' ? 'mirror' : resolveHeadMode(target)
  const eye = typeof target === 'number' ? null : target.eyeRadius
  const ctx: Ctx = {
    L: input.windLength!,
    w: input.bandWidth!,
    t: input.bandThickness!,
    feed: input.feedRate!,
    dwellMin: input.turnDwellMinDeg! * RAD,
    standoff: input.standoff ?? 0,
    axisCount,
    back: headAngleMode === 'fiber' ? (phi) => 180 - phi : (phi) => -phi
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
  // REQ-007: önceki katman domluysa onun sol dom yolu (katman sol kutupta biter, geçiş bu yoldan ekvatora iner)
  let prevTrack: DomeTrack | null = null
  const mu: number | null =
    input.friction !== null && input.friction !== undefined && Number.isFinite(input.friction) && input.friction > 0 ? input.friction : null
  // REQ-009: 3 eksende girilmiş Re (geçersizse missingFields zaten durdurur; burada yalnız sonlu değer)
  const eyeOk = axisCount === 3 && eye !== null && eye !== undefined && Number.isFinite(eye)

  input.layers.forEach((layer, index) => {
    const lt = 2 * ctx.t
    const r = r0 + lt / 2
    const y = axisCount === 4 ? r0 + lt + ctx.standoff : 0
    const domed = layer.kind === 'helical' && !!layer.dome
    const alpha = layer.kind === 'helical' ? layer.angleDeg! * RAD : 0
    const dome = domed ? domeGeodesic(r, layer.domeHeight!, r * Math.sin(alpha)) : null
    // İlk katmandan sonra elyaf bağlı: geçiş G0 olamaz. REQ-007: geçiş = [önceki katmanın sol dom inişi
    // (kutup → ekvator)] + gövdede x = 0'da asgari uç dönüşü + [yeni katmanın sol dom çıkışı (ekvator → kutup)].
    const bodyA = index === 0 ? a : a + (prevTrack ? prevTrack.theta : 0) + ctx.dwellMin
    const startA = index === 0 ? a : bodyA + (dome ? dome.theta : 0)
    const first = moves.length
    const res =
      domed
        ? domedHelicalLayer(ctx, layer, index, r, y, startA, push, priorDomes, dome!)
        : layer.kind === 'helical'
        ? helicalLayer(ctx, layer, index, r, y, startA, push)
        : hoopLayer(ctx, index, r, y, startA, push)
    if (index > 0) {
      const target = moves[first]
      const prevEnd = moves[first - 1]
      const tr: Move[] = []
      if (prevTrack) {
        // önceki katmanın gidiş geçişinin ilk dom kısmı: aynı c, aynı parçalar, C = φ (gidiş)
        const { points: dp, theta, yOff } = prevTrack
        for (let j = dp.length - 2; j >= 0; j--) {
          tr.push({
            kind: 'transition',
            layer: index,
            x: 0 - dp[j].z,
            a: (a + theta - dp[j].theta) * DEG,
            c: dp[j].phi * DEG,
            y: axisCount === 4 ? dp[j].r + yOff : 0,
            fiberLength: dp[j + 1].s - dp[j].s,
            radius: dp[j].r
          })
        }
      }
      const from = tr.length > 0 ? tr[tr.length - 1] : prevEnd
      // gövde kısmı (ΔX = 0, uç dönüşü gibi): domlu hedefte yeni katmanın sol ekvatoruna, C = dönüş açısı
      // (dom çıkışı −X yönünde); düz hedefte doğrudan katman başına
      const bodyEnd: Move = dome
        ? { kind: 'transition', layer: index, x: 0, a: bodyA * DEG, c: ctx.back(layer.angleDeg!), y, fiberLength: 0, radius: r }
        : { ...target, kind: 'transition' }
      bodyEnd.fiberLength = Math.hypot(bodyEnd.x - from.x, bodyEnd.y - from.y, r * ctx.dwellMin)
      tr.push(bodyEnd)
      // REQ-011 ('fiber'): önceki düz katmanın son dwell'i ile gövde kısmı tek durağan aralıktır (ΔX = 0). C bu
      // aralıkta monoton olmalı: dwell sonu C'si [dwell başı C, gövde sonu C] aralığına kıstırılır. Zaten
      // aradaysa değişmez (ör. düz → daha küçük açılı düz); düz → domluda (gövde sonu dönüş açısı) dwell'de
      // C değişmez, düz → hoop / büyük açılı düzde C'nin hepsini dwell döner. A, X, Y ve süre değişmez.
      if (headAngleMode === 'fiber' && !prevTrack && prevEnd.kind === 'dwell' && first >= 2) {
        const cs = moves[first - 2].c
        const lo = Math.min(cs, bodyEnd.c)
        const hi = Math.max(cs, bodyEnd.c)
        moves[first - 1] = { ...prevEnd, c: Math.min(hi, Math.max(lo, prevEnd.c)) }
      }
      if (dome) {
        // yeni katmanın dönüş geçişinin son dom kısmı (ekvator → sol kutup), C = dönüş açısı; son nokta = katman başı
        const dp = dome.points
        const M = dp.length - 1
        const yOff = y - r
        for (let j = 1; j <= M; j++) {
          tr.push({
            kind: 'transition',
            layer: index,
            x: 0 - dp[j].z,
            a: (bodyA + dp[j].theta) * DEG,
            c: j === M ? target.c : ctx.back(dp[j].phi * DEG),
            y: axisCount === 4 ? dp[j].r + yOff : 0,
            fiberLength: dp[j].s - dp[j - 1].s,
            radius: dp[j].r
          })
        }
      }
      moves.splice(first, 1, ...tr)
      res.info.fiberLength += tr.reduce((s, m) => s + m.fiberLength, 0)
    }
    prevTrack = dome ? { points: dome.points, theta: dome.theta, yOff: y - r } : null
    // REQ-006: uç dönüşü kayma kontrolü (k_g ≤ μ·k_n); μ boşsa sayısal kontrol yok
    if (layer.kind === 'helical') {
      if (!domed) {
        if (mu !== null) {
          const turnAxial = (r / mu) * (1 / Math.sin(alpha) - 1)
          const turnRotationDeg = (Math.log(1 / Math.tan(alpha / 2)) / mu) * DEG
          // REQ-010: tam uç dönüşü φ → 90° → 180° − φ iki yarıdır (2θ_t)
          const turnFullDeg = thetaReqDeg(layer.angleDeg!, 180 - layer.angleDeg!, mu)
          res.info.slip = { ...emptySlip(mu), turnAxial, turnRotationDeg, turnFullDeg }
          // dwell'in eksenel uzunluğu 0 (< x_t) olduğundan düz katmanda her zaman (REQ-006)
          res.info.warnings.push(
            `Uç dönüşü sürtünmeyle tutulamaz (gereken ≥ ${turnFullDeg.toFixed(1)}° dönüş (her yarıda ${turnRotationDeg.toFixed(1)}°), ≥ ${turnAxial.toFixed(1)} mm uç taşması, μ=${mu}; uç dönüşü ΔA ${res.info.turnDwellDeg.toFixed(1)}°, eksenel 0); pim halkası/uç tutucu gerekli`
          )
        } else {
          res.info.warnings.push('Düz uç dönüşü yalnız pim halkası/uç tutucuyla güvenilir (μ girilmedi, sayısal kayma kontrolü yapılmadı)')
        }
      } else if (mu !== null) {
        const h = layer.domeHeight!
        const c = r * Math.sin(alpha)
        const poleRatio = ((r / h) * Math.sqrt(r * r - c * c)) / c
        res.info.slip = { ...emptySlip(mu), poleRatio }
        if (poleRatio > mu) {
          res.info.warnings.push(
            `Kutupta ${res.info.turnDwellDeg.toFixed(1)}° dwell kutup parçası desteği olmadan kayar (k_g/k_n = ${poleRatio.toFixed(3)}, μ = ${mu}); daha kısa uç dönüşlü desen (j) seç veya kutup parçası kullan`
          )
        }
      }
    }
    if (eyeOk) res.info.eyeClearance = eye! - (r0 + lt)
    // REQ-004: 4 eksende göz Y'de (gövde Y'si), 3 eksende kullanıcının Re'si (boşsa hesap yok)
    const re = axisCount === 4 ? y : eye !== null && eye !== undefined && Number.isFinite(eye) ? eye : null
    const lag = re !== null ? freeFiber(re, r, res.info.angleDeg * RAD) : null
    if (lag && re !== null) {
      let poleFreeLength: number | null = null
      const d = res.info.dome
      if (d) {
        const reP = axisCount === 4 ? d.poleRadius + (y - r) : re
        poleFreeLength = reP > d.poleRadius ? Math.sqrt(reP * reP - d.poleRadius * d.poleRadius) : null
      }
      res.info.fiberLag = { eyeRadius: re, ...lag, poleFreeLength }
      if (layer.kind === 'helical') {
        res.info.warnings.push(
          `Elyaf mandrele kafanın ~${lag.axialLag.toFixed(1)} mm gerisinde değiyor; uç dönüşü x≈${lag.axialLag.toFixed(0)} / ${(ctx.L - lag.axialLag).toFixed(0)} mm civarında başlar (serbest elyaf λ=${lag.freeLength.toFixed(1)} mm, göz yolu düzeltilmedi)`
        )
      }
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

  if (mu !== null) stationarySlip(moves, input, infos, mu, headAngleMode)

  return {
    moves,
    layers: infos,
    totalFiberLength: totalFiber,
    totalMinutes: totalFiber / ctx.feed,
    feedRate: ctx.feed,
    outerDiameter: 2 * r0,
    eyeClearance: eyeOk ? eye! - r0 : null,
    headAngleMode
  }
}

function emptySlip(mu: number): NonNullable<LayerInfo['slip']> {
  return {
    friction: mu,
    turnAxial: null,
    turnRotationDeg: null,
    turnFullDeg: null,
    poleRatio: null,
    transitionTurnDeg: null,
    transitionRequiredDeg: null,
    transitionAxial: null
  }
}

/**
 * REQ-010: her durağan aralık (ΔX = 0; dom kutup dwell'i hariç, REQ-006 k_g/k_n geçerli) için θ_req ile ΔA
 * karşılaştırması. Geçiş içeren aralık yeni katmana yazılır (alanlar + ayrı uyarı); katmanın kendi aralıkları
 * düz helisel katmanda REQ-006 uyarısıyla (2θ_t) zaten kapsanır, hoop'ta katman başına tek uyarı.
 * r = aralığın son hareketinin yarıçapı (geçişte yeni katman). G-code değişmez.
 */
function stationarySlip(moves: Move[], input: WindingInput, infos: LayerInfo[], mu: number, mode: HeadAngleMode): void {
  const hoopWarned = new Set<number>()
  for (const iv of stationaryIntervals(moves, mode)) {
    const span = moves.slice(iv.first, iv.last + 1)
    if (span.some((m) => m.kind === 'dwell' && input.layers[m.layer].kind === 'helical' && input.layers[m.layer].dome)) continue
    const end = moves[iv.last]
    const info = infos[end.layer]
    const req = thetaReqDeg(iv.psiStart, iv.psiEnd, mu)
    const ax = axialReq(iv.psiStart, iv.psiEnd, end.radius, mu)
    const transition = span.some((m) => m.kind === 'transition')
    const text = (who: string): string =>
      `${who}: x = ${end.x.toFixed(1)} mm ucunda elyaf yönü ${iv.psiStart.toFixed(1)}° → ${iv.psiEnd.toFixed(1)}° değişiyor; kaymasız için ≥ ${req.toFixed(1)}° dönüş ve ≥ ${ax.toFixed(1)} mm eksenel gerekir, ΔA = ${iv.turnDeg.toFixed(1)}°${iv.monotone ? '' : ' (C bu aralıkta monoton değil, değer alt sınır)'}; pim halkası/uç tutucu gerekli`
    if (transition) {
      info.slip = { ...(info.slip ?? emptySlip(mu)), transitionTurnDeg: iv.turnDeg, transitionRequiredDeg: req, transitionAxial: ax }
      // monoton değilse θ_req alt sınırdır: ΔA ≥ θ_req kaymasızlığı kanıtlamaz, uyarı yine verilir
      if (iv.turnDeg < req || !iv.monotone) info.warnings.push(text(`Katman ${end.layer}→${end.layer + 1} geçişi`))
    } else if (info.kind === 'hoop') {
      // katman başı geçişi önce gelir: slip zaten olabilir; ilk kendi dwell'inin değeri yazılır
      const s = info.slip ?? emptySlip(mu)
      if (s.turnFullDeg === null) info.slip = { ...s, turnFullDeg: req }
      if ((iv.turnDeg < req || !iv.monotone) && !hoopWarned.has(end.layer)) {
        hoopWarned.add(end.layer)
        info.warnings.push(text(`Katman ${end.layer + 1} uç dönüşü`))
      }
    }
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
    push({ kind: 'dwell', layer: index, x: L, a: a * DEG, c: ctx.back(cDeg), y, fiberLength: dwellLen, radius: r })
    a += passRot
    push({ kind: 'pass', layer: index, x: 0, a: a * DEG, c: ctx.back(cDeg), y, fiberLength: passLen, radius: r })
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
      warnings,
      fiberLag: null,
      eyeClearance: null,
      slip: null
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
  // Helisel ile aynı sözleşme: dönüş geçişinde C = ctx.back(açı); kafa uçta dönüş sırasında çevrilir
  // ('fiber': 89,1° → 90,9°, yalnız 180° − 2·açı; 'mirror': +açı → −açı)
  const dwellLen = r * ctx.dwellMin
  let a = startA + rot
  push({ kind: 'pass', layer: index, x: L, a: a * DEG, c: angle, y, fiberLength: passLen, radius: r })
  a += ctx.dwellMin
  push({ kind: 'dwell', layer: index, x: L, a: a * DEG, c: ctx.back(angle), y, fiberLength: dwellLen, radius: r })
  a += rot
  push({ kind: 'pass', layer: index, x: 0, a: a * DEG, c: ctx.back(angle), y, fiberLength: passLen, radius: r })

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
      warnings: [],
      fiberLag: null,
      eyeClearance: null,
      slip: null
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
  priorDomes: { R: number; alpha: number }[],
  dome: DomePath
): { info: LayerInfo; endA: number } {
  const alpha = layer.angleDeg! * RAD
  const h = layer.domeHeight!
  const { L } = ctx
  const warnings: string[] = []

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
    // kutup dwell'i: 'fiber' 90° → 90° (elyaf yönü kutupta değişmez), 'mirror' 90° → −90°
    push({ kind: 'dwell', layer: index, x: pts[pts.length - 1].x, a: a * DEG, c: ctx.back(90), y: yAt(cPole), fiberLength: dwellLen, radius: cPole })
    const a1 = a
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]
      push({ kind: 'pass', layer: index, x: L - p.x, a: (a1 + p.th) * DEG, c: ctx.back(p.phi * DEG), y: yAt(p.r), fiberLength: p.len, radius: p.r })
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
      fiberLag: null,
      eyeClearance: null,
      slip: null,
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
