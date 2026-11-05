import { DEG, RAD } from './angles'
import type { HeadAngleMode, Move } from './types'

/**
 * REQ-010 kayma kontrolü (silindir, kayma koşulu k_g ≤ μ·k_n). Elyaf yön açısı ψ ('fiber' C'si, 0 < ψ < 180)
 * durağan carriage'da ψ₁'den ψ₂'ye monoton değişiyorsa kaymasız asgari mandrel dönüşü
 *   θ_req = |ln tan(ψ₂/2) − ln tan(ψ₁/2)| / μ
 * (k_g = dψ/ds, k_n = sin²ψ/r, dθ = sinψ·ds/r ⇒ dθ ≥ dψ/(μ·sinψ)). 90°'den geçişte iki yarıyı kendiliğinden toplar:
 * θ_req(α, 180° − α) = 2·θ_t (REQ-006).
 */
export function thetaReqDeg(psi1Deg: number, psi2Deg: number, mu: number): number {
  const lt = (p: number): number => Math.log(Math.tan((p * RAD) / 2))
  return (Math.abs(lt(psi2Deg) - lt(psi1Deg)) / mu) * DEG
}

/**
 * Aynı yolun eksenel uzunluğu x_req = (r/μ)·|1/sinψ₁ − 1/sinψ₂|; 90°'den geçiyorsa ileri taşma + geri:
 * (r/μ)·(1/sinψ₁ + 1/sinψ₂ − 2).
 */
export function axialReq(psi1Deg: number, psi2Deg: number, r: number, mu: number): number {
  const g = (p: number): number => 1 / Math.sin(p * RAD)
  if ((psi1Deg - 90) * (psi2Deg - 90) < 0) return (r / mu) * (g(psi1Deg) - 1 + g(psi2Deg) - 1)
  return (r / mu) * Math.abs(g(psi1Deg) - g(psi2Deg))
}

/** C değerinden elyaf yön açısı ψ ∈ [0, 180]: 'mirror' kipinde C < 0 ise ψ = 180° + C. */
export function fiberAngle(c: number, mode: HeadAngleMode): number {
  return mode === 'mirror' && c < 0 ? 180 + c : c
}

export interface StationaryInterval {
  /** Aralığın ilk ve son hareketinin indeksi (moves); başlangıç konumu moves[first − 1] */
  first: number
  last: number
  /** Aralık başı ve sonu elyaf yön açısı (derece) */
  psiStart: number
  psiEnd: number
  /** Aralıktaki toplam mandrel dönüşü (derece) */
  turnDeg: number
  /** ψ aralık boyunca monoton mu (değilse θ_req alt sınırdır) */
  monotone: boolean
}

const EPS = 1e-9

/**
 * Durağan aralıklar (REQ-010): ardışık iki ΔX ≠ 0 hareket arasındaki ΔX = 0 hareket dizileri (düz uç dwell'i,
 * hoop uç dönüşü, katman geçişinin gövde kısmı; önceki katmanın son dwell'i + geçiş gövde kısmı tek aralıktır).
 * Programın başındaki/sonundaki ΔX = 0 diziler (öncesinde/sonrasında ΔX ≠ 0 hareket yok) aralık sayılmaz.
 * İlk hareket 'position'dır (G0); ΔX ≠ 0 sayılmaz.
 */
export function stationaryIntervals(moves: Move[], mode: HeadAngleMode): StationaryInterval[] {
  const out: StationaryInterval[] = []
  const moving = (i: number): boolean => i >= 1 && moves[i].kind !== 'position' && Math.abs(moves[i].x - moves[i - 1].x) > EPS
  let i = 1
  while (i < moves.length) {
    if (moving(i) || moves[i].kind === 'position') {
      i++
      continue
    }
    const first = i
    while (i < moves.length && !moving(i) && moves[i].kind !== 'position') i++
    const last = i - 1
    // öncesinde ve sonrasında ΔX ≠ 0 hareket olmalı
    if (!moving(first - 1) || i >= moves.length || !moving(i)) continue
    const psi = [moves[first - 1], ...moves.slice(first, last + 1)].map((m) => fiberAngle(m.c, mode))
    let up = false
    let down = false
    for (let k = 1; k < psi.length; k++) {
      if (psi[k] > psi[k - 1] + EPS) up = true
      if (psi[k] < psi[k - 1] - EPS) down = true
    }
    out.push({
      first,
      last,
      psiStart: psi[0],
      psiEnd: psi[psi.length - 1],
      turnDeg: moves[last].a - moves[first - 1].a,
      monotone: !(up && down)
    })
  }
  return out
}
