import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { baseInput, machine3 } from './test-fixtures'
import type { WindingInput } from './types'
import { verifyGcode } from './verify'
import { planWinding } from './winding'

/** docs/research/flamenet-comparison.md'de bulunan hataların (H1, H2, H5, H6) geri gelmemesi için. */

const mixed: WindingInput = {
  ...baseInput,
  layers: [
    { id: 'd', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 },
    { id: 'h', kind: 'hoop', angleDeg: null },
    { id: 'a', kind: 'helical', angleDeg: 30 }
  ]
}

describe('H1: katman geçişinde G0 yok (elyaf bağlı)', () => {
  for (const axisCount of [3, 4] as const) {
    it(`${axisCount} eksen: yalnız ilk konumlama G0, geçişler G1 ve doğrulayıcı temiz`, () => {
      const m = { ...machine3, axisCount }
      const plan = planWinding(mixed, axisCount)
      const g = generateGcode(plan, mixed, m)
      const lines = g.split('\n')
      const g0 = lines.filter((l) => l.startsWith('G0'))
      // REQ-001: 4 eksende konumlama üç satır (Y geri, X/A/C, Y başlangıç); hepsi ilk G1'den önce
      expect(g0.length).toBe(axisCount === 4 ? 3 : 1)
      expect(lines.findIndex((l) => l.startsWith('G1'))).toBeGreaterThan(lines.lastIndexOf(g0[g0.length - 1]))
      const r = verifyGcode(g, m, plan)
      expect(r.issues).toEqual([])
    })
  }

  it('geçiş hareketi: gövde kısmı (ΔX = 0) A asgari uç dönüşü kadar döner; domdan çıkışta önce dom yolu (REQ-007)', () => {
    const plan = planWinding(mixed, 3)
    const tr = plan.moves.filter((x) => x.kind === 'transition')
    // domlu → hoop: 24 dom inişi + 1 gövde; hoop → 30°: 1 gövde
    expect(tr.length).toBe(26)
    for (const t of tr) expect(t.fiberLength).toBeGreaterThan(0)
    const body = tr.filter((t) => {
      const prev = plan.moves[plan.moves.indexOf(t) - 1]
      return Math.abs(t.x - prev.x) < 1e-12
    })
    expect(body.length).toBe(2)
    for (const t of body) {
      const prev = plan.moves[plan.moves.indexOf(t) - 1]
      expect(t.a - prev.a).toBeCloseTo(20, 9)
      expect(t.x).toBe(0)
    }
    // domlu katman X −28,3'te biter; geçiş dom yolu boyunca X 0'a iner (G1, X monoton artar)
    const first = plan.moves.indexOf(tr[0])
    expect(plan.moves[first - 1].x).toBeLessThan(-20)
    for (let i = first; i < first + 24; i++) expect(plan.moves[i].x).toBeGreaterThan(plan.moves[i - 1].x)
    expect(plan.moves[first + 23].x).toBe(0)
  })

  it('geçişler toplam elyaf ve süreye dahil (plan ↔ G-code süre oranı 1)', () => {
    const plan = planWinding(mixed, 4)
    const m = { ...machine3, axisCount: 4 as const }
    const r = verifyGcode(generateGcode(plan, mixed, m), m, plan)
    expect(r.planTimeRatio).toBeCloseTo(1, 3)
  })

  it('doğrulayıcı program ortasındaki G0 için uyarır', () => {
    const g = 'G21 G90 G94\nG0 X0\nG1 X10 F100\nG0 X0\nM2\n'
    const w = verifyGcode(g, machine3).issues.filter((i) => i.level === 'warning')
    expect(w.length).toBe(1)
    expect(w[0].line).toBe(4)
    expect(w[0].message).toMatch(/G1 sonrasında G0/)
  })
})

describe('H2: G93 uzun harekette F hassasiyeti', () => {
  const big: WindingInput = {
    ...baseInput,
    mandrelDiameter: 250,
    windLength: 1500,
    feedRate: 300,
    layers: [{ id: 'h', kind: 'hoop', angleDeg: null }]
  }
  const m = { ...machine3, feedMode: 'G93' as const }

  it('çok uzun hoop geçişinde süre planla %0,1 içinde, F asla 0 değil', () => {
    const plan = planWinding(big, 3)
    const g = generateGcode(plan, big, m)
    const fs = g.split('\n').filter((l) => l.startsWith('G1')).map((l) => Number(/F([\d.]+)/.exec(l)![1]))
    for (const f of fs) expect(f).toBeGreaterThan(0)
    const r = verifyGcode(g, m, plan)
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(Math.abs(r.planTimeRatio! - 1)).toBeLessThan(0.001)
  })

  it('F en az 5 anlamlı basamakla yazılır (küçük ve büyük değerlerde)', () => {
    const plan = planWinding(big, 3)
    for (const fm of ['G93', 'G94'] as const) {
      const g = generateGcode(plan, big, { ...machine3, feedMode: fm })
      for (const l of g.split('\n').filter((x) => x.startsWith('G1'))) {
        const digits = /F([\d.]+)/.exec(l)![1].replace('.', '').replace(/^0+/, '')
        expect(digits.length).toBeGreaterThanOrEqual(5)
      }
    }
  })
})

describe('H5: Mach3 + G94 birleşik hareket uyarısı', () => {
  const plan = planWinding(baseInput, 3)
  const warn = (m: typeof machine3): string[] =>
    verifyGcode(generateGcode(plan, baseInput, m), m, plan)
      .issues.filter((i) => i.level === 'warning')
      .map((i) => i.message)

  it('Mach3 + G94: uyarı var', () => {
    expect(warn({ ...machine3, controller: 'mach3' }).join('|')).toMatch(/Mach3 \+ G94/)
  })
  it('Mach3 + G93 ve LinuxCNC + G94: uyarı yok', () => {
    expect(warn({ ...machine3, controller: 'mach3', feedMode: 'G93' })).toEqual([])
    expect(warn(machine3)).toEqual([])
  })
})

describe('H6: hoop dönüş geçişi helisel ile aynı C sözleşmesi', () => {
  it('gidiş +açı, dönüş −açı; işaret değişimi uç dönüşünde (geçiş G1 içinde değil)', () => {
    const inp: WindingInput = { ...baseInput, layers: [{ id: 'h', kind: 'hoop', angleDeg: null }] }
    const plan = planWinding(inp, 3)
    const passes = plan.moves.filter((x) => x.kind === 'pass')
    expect(passes[0].c).toBeGreaterThan(85)
    expect(passes[1].c).toBeCloseTo(-passes[0].c, 9)
    // dönüş geçişinin başlangıcı (önceki hareket) zaten −açı: C geçiş boyunca sabit
    const i = plan.moves.indexOf(passes[1])
    expect(plan.moves[i - 1].c).toBeCloseTo(passes[1].c, 9)
  })
})
