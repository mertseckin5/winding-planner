import type { MachineConfig, Move, WindingPlan } from './types'

export type AxisKey = 'carriage' | 'mandrel' | 'head' | 'cross'
export type AxisSpeeds = Record<AxisKey, number>

/** Kullanıcının girdiği, etkin eksenlere ait sonlu pozitif hız limitleri (boş alan = limit yok). */
function activeLimits(machine: MachineConfig | undefined): [AxisKey, number][] {
  const l = machine?.maxSpeed
  if (!l) return []
  const keys: AxisKey[] = machine!.axisCount === 4 ? ['carriage', 'mandrel', 'head', 'cross'] : ['carriage', 'mandrel', 'head']
  const out: [AxisKey, number][] = []
  for (const k of keys) {
    const v = l[k]
    if (v !== null && v !== undefined && Number.isFinite(v) && v > 0) out.push([k, v])
  }
  return out
}

/**
 * Hareket süresi (dak): max(elyaf boyu / elyaf hızı, |Δeksen| / eksen limiti). Limit girilmemişse yalnız
 * elyaf süresi (önceki davranışla bit bit aynı). G-code F'i, plan süresi ve tepe hızlar bu kuralı kullanır;
 * böylece kontrolcü sessizce yavaşlatmaz, süre ve elyaf hızı düşüşü önceden bilinir.
 */
export function moveMinutes(
  prev: Pick<Move, 'x' | 'a' | 'c' | 'y'>,
  m: Pick<Move, 'x' | 'a' | 'c' | 'y' | 'fiberLength'>,
  feedRate: number,
  machine?: MachineConfig
): number {
  let t = m.fiberLength / feedRate
  for (const [k, lim] of activeLimits(machine)) {
    const d = k === 'carriage' ? m.x - prev.x : k === 'mandrel' ? m.a - prev.a : k === 'head' ? m.c - prev.c : m.y - prev.y
    t = Math.max(t, Math.abs(d) / lim)
  }
  return t
}

/** Planın eksen limitleri dahil süresi (dak). Limit yoksa plan.totalMinutes (aynı değer). */
export function estimateMinutes(plan: WindingPlan, machine?: MachineConfig): number {
  return slowdownSummary(plan, machine).minutes
}

export interface SlowdownSummary {
  /** Eksen limiti nedeniyle süresi uzatılan G1 hareket sayısı */
  slowedMoves: number
  /** Limitsiz süre (elyaf boyu / elyaf hızı) */
  baseMinutes: number
  /** Limitli süre */
  minutes: number
}

export function slowdownSummary(plan: WindingPlan, machine?: MachineConfig): SlowdownSummary {
  if (activeLimits(machine).length === 0) return { slowedMoves: 0, baseMinutes: plan.totalMinutes, minutes: plan.totalMinutes }
  let slowed = 0
  let minutes = 0
  for (let i = 1; i < plan.moves.length; i++) {
    const m = plan.moves[i]
    if (m.kind === 'position') continue
    const base = m.fiberLength / plan.feedRate
    const t = moveMinutes(plan.moves[i - 1], m, plan.feedRate, machine)
    if (t > base) slowed++
    minutes += t
  }
  return { slowedMoves: slowed, baseMinutes: plan.totalMinutes, minutes }
}

/**
 * Plan hareketlerinden eksen başına tepe hız (X/Y mm/dk, A/C °/dk).
 * Süre = moveMinutes (machine verilirse eksen limitleri dahil); hız = |eksen değişimi| / süre.
 * Konumlama (G0) hareketleri dahil değil.
 */
export function peakSpeeds(plan: WindingPlan, feedRate: number, machine?: MachineConfig): AxisSpeeds {
  const peak: AxisSpeeds = { carriage: 0, mandrel: 0, head: 0, cross: 0 }
  for (let i = 1; i < plan.moves.length; i++) {
    const m = plan.moves[i]
    if (m.kind === 'position') continue
    const minutes = moveMinutes(plan.moves[i - 1], m, feedRate, machine)
    if (!(minutes > 0)) continue
    const p = plan.moves[i - 1]
    peak.carriage = Math.max(peak.carriage, Math.abs(m.x - p.x) / minutes)
    peak.mandrel = Math.max(peak.mandrel, Math.abs(m.a - p.a) / minutes)
    peak.head = Math.max(peak.head, Math.abs(m.c - p.c) / minutes)
    peak.cross = Math.max(peak.cross, Math.abs(m.y - p.y) / minutes)
  }
  return peak
}

const LABEL: Record<AxisKey, string> = { carriage: 'Araba', mandrel: 'Mandrel', head: 'Kafa', cross: 'Çapraz' }
const UNIT: Record<AxisKey, string> = { carriage: 'mm/dk', mandrel: '°/dk', head: '°/dk', cross: 'mm/dk' }

/**
 * Girilen eksen limitlerini aşan tepe hızlar için uyarı. Kontrolcü aşımda hareketi sessizce yavaşlatır;
 * elyaf hızı en kötü eksenin limit/tepe oranı kadar düşer. Limit girilmemiş eksen kontrol edilmez.
 */
export function speedWarnings(peak: AxisSpeeds, machine: MachineConfig): string[] {
  const limits = machine.maxSpeed
  const keys: AxisKey[] = machine.axisCount === 4 ? ['carriage', 'mandrel', 'head', 'cross'] : ['carriage', 'mandrel', 'head']
  const out: string[] = []
  let worst = 1
  for (const k of keys) {
    const lim = limits?.[k]
    if (lim === null || lim === undefined || !(lim > 0)) continue
    // 1e-9 göreli pay: süre limite göre uzatılmış harekette |Δ|/(|Δ|/limit) kayan noktada limiti aşabilir
    if (peak[k] > lim * (1 + 1e-9)) {
      const ratio = lim / peak[k]
      worst = Math.min(worst, ratio)
      out.push(
        `${LABEL[k]} (${machine.names[k]}) tepe hızı ${Math.round(peak[k])} ${UNIT[k]} > limit ${lim} ${UNIT[k]}`
      )
    }
  }
  if (out.length > 0) {
    out.push(`Elyaf hızı yaklaşık %${Math.round(worst * 100)} değerine düşer (kontrolcü yavaşlatır); hızı azalt veya limitleri kontrol et`)
  }
  return out
}

export function hasAnySpeedLimit(machine: MachineConfig): boolean {
  const l = machine.maxSpeed
  return !!l && Object.values(l).some((v) => v !== null && v > 0)
}
