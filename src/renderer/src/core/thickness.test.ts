import { describe, expect, it } from 'vitest'
import { domeThickness } from './dome'
import { generateGcode } from './gcode'
import { readGcode } from './gcode-reader.testutil'
import { baseInput, machine3, rng } from './test-fixtures'
import type { MachineConfig, WindingInput } from './types'
import { planWinding } from './winding'

const RAD = Math.PI / 180

describe('H3: domlu katman analitik kalınlığı t(r) = T·R·cosα / √(r² − c²)', () => {
  const rand = rng(31)
  for (let i = 0; i < 10; i++) {
    const R = 10 + rand() * 150
    const alpha = (10 + rand() * 60) * RAD
    const w = 2 + rand() * 10
    const T = 0.1 + rand() * 0.8
    const c = R * Math.sin(alpha)
    it(`#${i}: R ${R.toFixed(1)} α ${(alpha / RAD).toFixed(1)}° w ${w.toFixed(1)}`, () => {
      if (c + w >= R) return // bant tüm dom aralığından geniş: silindir değeri sınırlama bölgesinde
      expect(domeThickness(R, alpha, w, T, R)).toBeCloseTo(T, 12)
      // r ekvatordan c + w'ye inerken artar
      let prev = 0
      for (let k = 0; k <= 50; k++) {
        const r = R - ((R - (c + w)) * k) / 50
        const t = domeThickness(R, alpha, w, T, r)
        expect(t).toBeGreaterThanOrEqual(prev)
        prev = t
      }
      // c ≤ r < c+w: sabit, sonlu, bant genişliği ortalaması (r = c+w'deki değerden büyük); r < c: 0
      const cap = domeThickness(R, alpha, w, T, c)
      expect(Number.isFinite(cap)).toBe(true)
      expect(cap).toBeGreaterThan(domeThickness(R, alpha, w, T, c + w))
      expect(domeThickness(R, alpha, w, T, c + w / 2)).toBe(cap)
      expect(domeThickness(R, alpha, w, T, c * 0.999)).toBe(0)
      // ortalama sayısal: [c, c+w] üzerinde formülün orta nokta toplamı (u = √(r−c) ile tekillik giderilmiş)
      const N = 20000
      let sum = 0
      for (let k = 0; k < N; k++) {
        const u = ((k + 0.5) / N) * Math.sqrt(w)
        const r = c + u * u
        sum += ((T * R * Math.cos(alpha)) / Math.sqrt(r * r - c * c)) * 2 * u * (Math.sqrt(w) / N)
      }
      expect(cap).toBeCloseTo(sum / w, 6)
    })
  }
})

describe('H3: kalınlık G-code geometrisinden bağımsız hacim hesabıyla eşleşir', () => {
  // 4 eksen: Y = yol yarıçapı + (bant kalınlığı + kafa boşluğu) → r = Y − t − s; C = yolun meridyen açısı φ.
  // Katman başına her paralel çember 2n kez geçilir (gidiş + dönüş), her geçiş w/cosφ çevresel genişlik kaplar:
  //   t_hacim(r) = 2n · (w / cosφ) · t_bant / (2πr)
  // Formül ideal kapsama (n·w = 2πR·cosα) için yazılır: t_hacim / kapsama = t(r).
  const cases: WindingInput[] = [
    { ...baseInput, layers: [{ id: 'd', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 }] },
    { ...baseInput, mandrelDiameter: 120, bandWidth: 8, bandThickness: 0.3, layers: [{ id: 'd', kind: 'helical', angleDeg: 25, dome: true, domeHeight: 50 }] },
    { ...baseInput, mandrelDiameter: 80, bandWidth: 4, layers: [{ id: 'd', kind: 'helical', angleDeg: 60, dome: true, domeHeight: 20 }] }
  ]
  for (const [n, input] of cases.entries()) {
    it(`girdi ${n + 1}`, () => {
      const m: MachineConfig = { ...machine3, axisCount: 4 }
      const plan = planWinding(input, 4)
      const info = plan.layers[0]
      const d = info.dome!
      const tb = input.bandThickness!
      const w = input.bandWidth!
      let checked = 0
      for (const row of readGcode(generateGcode(plan, input, m), m)) {
        if (row.code !== 'G1') continue
        const r = row.pos.y - tb - input.standoff!
        if (r < d.capRadius) continue
        const phi = Math.abs(row.pos.c) * RAD
        const tVol = (2 * info.bands * (w / Math.cos(phi)) * tb) / (2 * Math.PI * r)
        const t = domeThickness(info.radius, info.angleDeg * RAD, w, 2 * tb, r)
        expect(Math.abs(tVol / info.coverage / t - 1)).toBeLessThan(1e-3)
        checked++
      }
      expect(checked).toBeGreaterThan(20)
      // LayerInfo örnekleri: ekvatorda 2t, kutupta azami
      expect(d.thickness[0].t).toBeCloseTo(2 * tb, 9)
      expect(d.thickness[d.thickness.length - 1].t).toBe(d.maxThickness)
      expect(d.maxThickness).toBe(Math.max(...d.thickness.map((s) => s.t)))
    })
  }
})

describe('H3: birikmiş kalınlık ve etkin kafa boşluğu (4 eksen)', () => {
  const two = (standoff: number): WindingInput => ({
    ...baseInput,
    standoff,
    layers: [
      { id: 'd1', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 },
      { id: 'd2', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 }
    ]
  })

  it('elle: Ø50, t 0,15, w 6, 45°: 2. katmanın kutbunda (r = c2) 1. katman sınırlama bölgesinde', () => {
    const R1 = 25.15
    const R2 = 25.45
    const s = Math.SQRT1_2
    const c1 = R1 * s
    const c2 = R2 * s
    expect(c2 - c1).toBeLessThan(6) // c2, 1. katmanın [c1, c1+w) bölgesinde
    const t1 = (0.3 * R1 * s * Math.acosh((c1 + 6) / c1)) / 6
    const expected = t1 - 0.3 // model 1 önceki katman × 2t varsayar
    const plan = planWinding(two(30), 4)
    expect(plan.layers[0].dome!.buildup).toBe(0)
    expect(plan.layers[1].dome!.buildup).toBeCloseTo(expected, 9)
    expect(plan.layers[1].dome!.clearance).toBeCloseTo(30 - expected, 9)
    expect(plan.layers[1].warnings.join('|')).not.toMatch(/kalınlık birikimi/)
  })

  it('kafa boşluğu birikimden küçükse negatif boşluk uyarısı; 3 eksende boşluk yok, uyarı yok', () => {
    const p4 = planWinding(two(0.2), 4)
    const b = p4.layers[1].dome!.buildup
    expect(b).toBeGreaterThan(0.2)
    expect(p4.layers[1].dome!.clearance!).toBeLessThan(0)
    expect(p4.layers[1].warnings.join('|')).toMatch(/kalınlık birikimi.*etkin kafa boşluğu -/)
    const p3 = planWinding(two(0.2), 3)
    expect(p3.layers[1].dome!.clearance).toBeNull()
    expect(p3.layers[1].dome!.buildup).toBeCloseTo(b, 12)
    expect(p3.layers[1].warnings.join('|')).not.toMatch(/kalınlık birikimi/)
  })

  it('arada hoop/düz katman: model onlar için de 2t ekler, dom birikimi yalnız domlulardan', () => {
    const input: WindingInput = {
      ...baseInput,
      layers: [
        { id: 'd1', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 },
        { id: 'h', kind: 'hoop', angleDeg: null },
        { id: 'd2', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 }
      ]
    }
    const p = planWinding(input, 4)
    const d = p.layers[2].dome!
    const c3 = p.layers[2].radius * Math.SQRT1_2
    const t1 = domeThickness(p.layers[0].radius, 45 * RAD, 6, 0.3, c3)
    expect(d.buildup).toBeCloseTo(Math.max(t1 - 0.6, 0 - 0.6, domeThickness(p.layers[0].radius, 45 * RAD, 6, 0.3, p.layers[2].radius) - 0.6), 9)
  })
})
