import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { readGcode } from './gcode-reader.testutil'
import { estimateMinutes, peakSpeeds, slowdownSummary, speedWarnings, type AxisKey } from './limits'
import { baseInput, machine3, rng } from './test-fixtures'
import type { Layer, MachineConfig, WindingInput } from './types'
import { verifyGcode } from './verify'
import { planWinding } from './winding'

/** Hız limitine göre süre uzatma (limits.moveMinutes): G-code doğrulayıcının bağımsız tepe hızı ≤ limit. */

/**
 * Tepe hız toleransı yalnız kayan nokta için: gcode.ts limiti yazılan (3 ondalık) koordinatlarla uygular ve
 * yavaşlatılan harekette F'i aşağı yuvarlar, bu yüzden G-code'dan okunan hız limiti yuvarlamayla da aşmamalı.
 */
const TOL = 1e-6

function randomCase(seed: number): { input: WindingInput; m: MachineConfig; label: string } {
  const rand = rng(seed)
  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand()
  const D = range(20, 250)
  const layers: Layer[] = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => {
    const p = rand()
    if (p < 0.3) return { id: `h${k}`, kind: 'hoop', angleDeg: null }
    if (p < 0.65) return { id: `d${k}`, kind: 'helical', angleDeg: range(10, 70), dome: true, domeHeight: range(5, D) }
    return { id: `a${k}`, kind: 'helical', angleDeg: range(5, 80) }
  })
  const input: WindingInput = {
    mandrelDiameter: D,
    windLength: range(50, 1200),
    bandWidth: range(3, 25),
    bandThickness: range(0.05, 0.4),
    feedRate: range(500, 8000),
    turnDwellMinDeg: range(2, 90),
    standoff: range(5, 60),
    layers
  }
  const axisCount = rand() < 0.5 ? 3 : 4
  const base: MachineConfig = {
    ...machine3,
    axisCount,
    controller: rand() < 0.5 ? 'linuxcnc' : 'mach3',
    feedMode: rand() < 0.5 ? 'G94' : 'G93',
    invert: { carriage: rand() < 0.3, mandrel: rand() < 0.3, head: rand() < 0.3, cross: rand() < 0.3 }
  }
  const peak = peakSpeeds(planWinding(input, axisCount), input.feedRate!)
  // her eksende limit: girilmemiş (null) ya da tepe hızın %20–%95'i
  const lim = (k: AxisKey): number | null => (rand() < 0.25 || peak[k] === 0 ? null : peak[k] * range(0.2, 0.95))
  const m: MachineConfig = { ...base, maxSpeed: { carriage: lim('carriage'), mandrel: lim('mandrel'), head: lim('head'), cross: lim('cross') } }
  return { input, m, label: `${axisCount}e ${base.feedMode} ${base.controller} [${layers.map((l) => (l.kind === 'hoop' ? 'H' : l.dome ? 'D' : 'S')).join('')}]` }
}

describe('hız limitli çıktı: doğrulayıcının bağımsız tepe hızı ≤ limit', () => {
  for (let i = 0; i < 40; i++) {
    const { input, m, label } = randomCase(5100 + i)
    it(`#${i} ${label}`, () => {
      const plan = planWinding(input, m.axisCount)
      const g = generateGcode(plan, input, m)
      expect(g).not.toMatch(/NaN|Infinity|undefined/)
      const r = verifyGcode(g, m, plan)
      const keys: AxisKey[] = m.axisCount === 4 ? ['carriage', 'mandrel', 'head', 'cross'] : ['carriage', 'mandrel', 'head']
      for (const k of keys) {
        const lim = m.maxSpeed![k]
        if (lim !== null) expect(r.peak[k]).toBeLessThanOrEqual(lim * (1 + TOL))
      }
      // hız uyarısı yok, hata yok, süre oranı 1
      expect(r.issues.filter((x) => /tepe hızı/.test(x.message))).toEqual([])
      expect(r.issues.filter((x) => x.level === 'error')).toEqual([])
      expect(Math.abs(r.planTimeRatio! - 1)).toBeLessThan(1e-3)
      // plan tarafı da limit altında, uyarı üretmiyor
      expect(speedWarnings(peakSpeeds(plan, input.feedRate!, m), m)).toEqual([])
      const s = slowdownSummary(plan, m)
      if (keys.some((k) => m.maxSpeed![k] !== null)) {
        expect(s.slowedMoves).toBeGreaterThan(0)
        expect(s.minutes).toBeGreaterThan(s.baseMinutes)
        expect(g).toMatch(new RegExp(`\\(Eksen hiz limiti: ${s.slowedMoves} hareket yavaslatildi`))
      }
    })
  }
})

describe('limit girilmemiş / aşılmamışsa çıktı birebir aynı', () => {
  const inputs: WindingInput[] = [
    baseInput,
    { ...baseInput, layers: [{ id: 'd', kind: 'helical', angleDeg: 35, dome: true, domeHeight: 30 }, { id: 'h', kind: 'hoop', angleDeg: null }] }
  ]
  for (const [n, input] of inputs.entries()) {
    for (const fm of ['G94', 'G93'] as const) {
      it(`girdi ${n + 1} ${fm}`, () => {
        const m0: MachineConfig = { ...machine3, axisCount: 4, feedMode: fm }
        const plan = planWinding(input, 4)
        const ref = generateGcode(plan, input, m0)
        const empty = { ...m0, maxSpeed: { carriage: null, mandrel: null, head: null, cross: null } }
        expect(generateGcode(plan, input, empty)).toBe(ref)
        const pk = peakSpeeds(plan, input.feedRate!)
        const high = { ...m0, maxSpeed: { carriage: pk.carriage * 1.01, mandrel: pk.mandrel * 1.01, head: pk.head * 1.01, cross: pk.cross * 1.01 + 1 } }
        expect(generateGcode(plan, input, high)).toBe(ref)
        expect(estimateMinutes(plan, empty)).toBe(plan.totalMinutes)
        expect(estimateMinutes(plan, high)).toBeCloseTo(plan.totalMinutes, 9)
        expect(slowdownSummary(plan, high).slowedMoves).toBe(0)
      })
    }
  }
})

describe('elle hesap: kafa (C) limiti uç dönüşü süresini belirler', () => {
  it('düz 45°, C limiti 3600 °/dk → uç dönüşünde C 90° çevrilir: süre 90 / 3600 = 0,025 dk; G94 F bunu verir', () => {
    // baseInput: r = 25,15 mm, elyaf hızı 3000; uç dönüşü δ°, elyaf süresi r·δ·π/180 / 3000
    const plan = planWinding(baseInput, 3)
    const dwellDeg = plan.layers[0].turnDwellDeg
    const fiberMin = (25.15 * dwellDeg * (Math.PI / 180)) / 3000
    expect(fiberMin).toBeLessThan(0.025) // limitsiz C hızı 90/fiberMin > 3600
    const m: MachineConfig = { ...machine3, maxSpeed: { carriage: null, mandrel: null, head: 3600, cross: null } }
    const g = generateGcode(plan, baseInput, m)
    const rows = readGcode(g, m).filter((r) => r.code === 'G1')
    // uç dönüşü satırları: X değişmez, C işaret değiştirir (±45 → ∓45): |ΔC| = 90°; devre başına 2, toplam 2n
    let seen = 0
    for (let k = 1; k < rows.length; k++) {
      const p = rows[k - 1].pos
      const q = rows[k].pos
      if (Math.abs(q.x - p.x) > 1e-9) continue
      seen++
      const t = Math.hypot(q.a - p.a, q.c - p.c) / rows[k].f! // G94 döner hareket: F = döner vektör / süre
      expect(t).toBeCloseTo(Math.max(fiberMin, 90 / 3600), 6)
    }
    expect(seen).toBe(2 * plan.layers[0].bands)
  })
})
