/**
 * Yarım-elips dom üzerinde geodezik (Clairaut) yol.
 *
 * Dom profili: ekvatordan (z=0, r=R) kutba doğru r = R·cos u, z = h·sin u, u ∈ [0, π/2].
 * Geodezik: r·sinφ = c (sabit), φ = yolun meridyenle açısı; c = R·sinα (α gövdedeki helis açısı).
 * Yol r = c olduğunda (u0 = acos(c/R), kutup açıklığı) paralele teğet olur ve döner.
 *
 *   dθ = tanφ · dm / r     (dm = meridyen yay elemanı = √(h²cos²u + R²sin²u) du)
 *   ds = dm / cosφ         (ds = yol yay elemanı)
 * Her ikisi de u0'da 1/√ tekilliği taşır; u = u0·sinψ değişkeni bunu giderir (integrand sonlu kalır),
 * Gauss–Legendre 3 noktalı paneller ucu hiç değerlendirmez.
 */

export const DOME_SEGMENTS = 24

export interface DomePoint {
  /** Ekvatordan eksenel uzaklık (mm) */
  z: number
  /** Yarıçap (mm) */
  r: number
  /** Ekvatordan itibaren mandrel dönüşü (rad) */
  theta: number
  /** Ekvatordan itibaren yol uzunluğu (mm) */
  s: number
  /** Yolun meridyenle açısı (rad); kutup açıklığında π/2 */
  phi: number
}

export interface DomePath {
  /** points[0] = ekvator, points[last] = kutup açıklığı */
  points: DomePoint[]
  /** Ekvatordan kutup açıklığına toplam mandrel dönüşü (rad) */
  theta: number
  /** Ekvatordan kutup açıklığına yol uzunluğu (mm) */
  length: number
  /** Kutup açıklığının eksenel uzaklığı (= h·cosα) */
  poleZ: number
  poleRadius: number
}

const PANELS = 2048
const GL_X = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)]
const GL_W = [5 / 9, 8 / 9, 5 / 9]

/**
 * Domlu katmanın analitik kalınlığı (net teorisi, elyaf hacmi korunumu; t·r·cosφ = sabit):
 *   t(r) = T·R·cosα / √(r² − c²),  c = R·sinα,  T = katman kalınlığı (gidiş+dönüş = 2·bant kalınlığı)
 * Silindirde (r = R) t = T. r → c'de tekildir (sonsuz). Sınırlama (gizli eşik değil, bant geometrisi):
 * kutup açıklığından bir bant genişliği içinde (c ≤ r < c + w) kalınlık, formülün bu aralıktaki ortalaması
 * olarak sabit tutulur: ort(1/√(r²−c²)) = acosh((c + w)/c) / w. r < c'de elyaf yok, 0.
 * Model kaba: bant genişliği boyunca yığılma dağılımı, reçine akışı ve bantların kutupta kayması yok.
 */
export function domeThickness(R: number, alpha: number, w: number, T: number, r: number): number {
  const c = R * Math.sin(alpha)
  if (r < c) return 0
  const k = T * R * Math.cos(alpha)
  if (r < c + w) return (k * Math.acosh((c + w) / c)) / w
  return k / Math.sqrt(r * r - c * c)
}

export function domeGeodesic(R: number, h: number, c: number, segments = DOME_SEGMENTS): DomePath {
  if (![R, h, c].every((v) => Number.isFinite(v) && v > 0)) throw new Error('Dom: R, h ve c sonlu pozitif olmalı')
  if (!(c < R)) throw new Error('Dom: R·sin(α) ≥ dom ekvator yarıçapı, yol yok')
  if (!Number.isInteger(segments) || segments < 1) throw new Error('Dom: parça sayısı ≥ 1 tam sayı olmalı')

  const u0 = Math.acos(c / R)
  const HALF_PI = Math.PI / 2

  /** [dθ/dψ, ds/dψ] */
  const integrand = (psi: number): [number, number] => {
    const u = u0 * Math.sin(psi)
    const q = (HALF_PI - psi) / 2
    const du0 = 2 * u0 * Math.sin(q) ** 2 // u0 − u, kararlı biçimde
    const cu = Math.cos(u)
    const dm = Math.sqrt(h * h * cu * cu + R * R * Math.sin(u) ** 2)
    const root = R * Math.sqrt(Math.sin(du0) * Math.sin(u0 + u)) // √(R²cos²u − c²)
    const common = (dm * u0 * Math.cos(psi)) / root
    return [(c / (R * cu)) * common, R * cu * common]
  }

  const panel = (a: number, b: number): [number, number] => {
    const mid = (a + b) / 2
    const half = (b - a) / 2
    let t = 0
    let s = 0
    for (let i = 0; i < 3; i++) {
      const [ft, fs] = integrand(mid + half * GL_X[i])
      t += GL_W[i] * ft
      s += GL_W[i] * fs
    }
    return [t * half, s * half]
  }

  // Panel sınırlarında kümülatif θ, s
  const cumT = new Float64Array(PANELS + 1)
  const cumS = new Float64Array(PANELS + 1)
  const dPsi = HALF_PI / PANELS
  for (let k = 0; k < PANELS; k++) {
    const [t, s] = panel(k * dPsi, (k + 1) * dPsi)
    cumT[k + 1] = cumT[k] + t
    cumS[k + 1] = cumS[k] + s
  }
  const totT = cumT[PANELS]
  const totS = cumS[PANELS]

  // Çıktı noktaları: θ ve s karışımında eşit aralık (kutup yakınında θ hızlı değişir, ekvatorda s)
  const blend = (k: number): number => 0.5 * (cumT[k] / totT + cumS[k] / totS)
  const points: DomePoint[] = []
  let k = 0
  for (let j = 0; j <= segments; j++) {
    let psi: number
    let theta: number
    let s: number
    if (j === 0) {
      psi = 0
      theta = 0
      s = 0
    } else if (j === segments) {
      psi = HALF_PI
      theta = totT
      s = totS
    } else {
      const target = j / segments
      while (k < PANELS - 1 && blend(k + 1) < target) k++
      const b0 = blend(k)
      const b1 = blend(k + 1)
      const f = (target - b0) / (b1 - b0)
      psi = (k + f) * dPsi
      const [t, ss] = panel(k * dPsi, psi)
      theta = cumT[k] + t
      s = cumS[k] + ss
    }
    const u = u0 * Math.sin(psi)
    const r = j === segments ? c : R * Math.cos(u)
    points.push({
      z: h * Math.sin(u),
      r,
      theta,
      s,
      phi: j === segments ? HALF_PI : Math.asin(Math.min(1, c / r))
    })
  }
  const last = points[points.length - 1]
  last.z = h * Math.sin(u0)
  return { points, theta: totT, length: totS, poleZ: last.z, poleRadius: c }
}
