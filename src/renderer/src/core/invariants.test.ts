import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { baseInput, machine3, rng } from './test-fixtures'
import type { Layer, MachineConfig, WindingInput } from './types'
import { missingFields, patternCandidates, planWinding } from './winding'
import { checkReq011, readGcode as read, stationaryRuns } from './gcode-reader.testutil'

/**
 * Değişmez (invariant) testleri: üretilen G-code plandan ve verify.ts'ten bağımsız, satır satır geri okunur.
 * Rakipte (docs/research/flamenet-comparison.md §7.3 #1–#6) depoya giren hataları yakalayacak kurallar:
 * A geri gitmez, ilk G1'den sonra G0 yok, hoop'ta ΔA/ΔX = 360°/adım, R iki katına çıkınca ΔA yarıya iner,
 * M1 hiç üretilmez, M0 sonrasında A geri gitmez.
 */

function randomCase(seed: number): { input: WindingInput; m: MachineConfig; label: string } {
  const rand = rng(seed)
  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand()
  const D = range(20, 300)
  const nLayers = 1 + Math.floor(rand() * 4)
  const layers: Layer[] = Array.from({ length: nLayers }, (_, k) => {
    const p = rand()
    if (p < 0.3) return { id: `h${k}`, kind: 'hoop', angleDeg: null }
    if (p < 0.65) return { id: `d${k}`, kind: 'helical', angleDeg: range(10, 75), dome: true, domeHeight: range(5, D) }
    return { id: `a${k}`, kind: 'helical', angleDeg: range(5, 80) }
  })
  const input: WindingInput = {
    mandrelDiameter: D,
    windLength: range(50, 1500),
    bandWidth: range(3, 30),
    bandThickness: range(0.05, 0.5),
    feedRate: range(300, 8000),
    turnDwellMinDeg: range(1, 90),
    standoff: range(5, 80),
    layers
  }
  const axisCount = rand() < 0.5 ? 3 : 4
  const m: MachineConfig = {
    ...machine3,
    axisCount,
    controller: rand() < 0.5 ? 'linuxcnc' : 'mach3',
    feedMode: rand() < 0.5 ? 'G94' : 'G93',
    pauseBetweenLayers: rand() < 0.5,
    zeroAxesAtStart: rand() < 0.7,
    invert: { carriage: rand() < 0.3, mandrel: rand() < 0.3, head: rand() < 0.3, cross: rand() < 0.3 }
  }
  // REQ-003: C sözleşmesi rastgele (yeni 'fiber', eski 'mirror', eski kayıt = alan yok). Önceki rastgele
  // diziyi bozmamak için ayrı üreteç.
  const p = rng(seed + 500_000)()
  if (p < 0.5) m.headAngleMode = 'fiber'
  else if (p < 0.8) m.headAngleMode = 'mirror'
  const kinds = layers.map((l) => (l.kind === 'hoop' ? 'H' : l.dome ? 'D' : 'S')).join('')
  return { input, m, label: `${axisCount}e ${m.feedMode} ${m.controller} dur=${m.pauseBetweenLayers} C=${m.headAngleMode ?? 'yok'} [${kinds}]` }
}

describe('değişmezler: rastgele girdiler, G-code geri okuma', () => {
  for (let i = 0; i < 80; i++) {
    const { input, m, label } = randomCase(9000 + i)
    it(`#${i} ${label}`, () => {
      expect(missingFields(input, m.axisCount)).toEqual([])
      const plan = planWinding(input, m)
      const g = generateGcode(plan, input, m)
      expect(g).not.toMatch(/NaN|Infinity|undefined/)
      const rows = read(g, m)
      const motion = rows.filter((r) => r.code === 'G0' || r.code === 'G1')

      // A hiçbir satırda azalmaz (G-code 3 ondalık yazar → 1e-3 tolerans)
      for (let k = 1; k < rows.length; k++) expect(rows[k].pos.a).toBeGreaterThanOrEqual(rows[k - 1].pos.a - 1.5e-3)

      // ilk G1'den sonra hiç G0 yok
      const firstG1 = motion.findIndex((r) => r.code === 'G1')
      expect(firstG1).toBeGreaterThan(-1)
      expect(motion.slice(firstG1).filter((r) => r.code === 'G0')).toEqual([])

      // M1 hiç yok; M0 = ilk G1 öncesi elyaf bağlama (REQ-001, her zaman) + duraklatma açıksa katman sınırı sayısı
      expect(rows.filter((r) => r.code === 'M1')).toEqual([])
      const m0 = rows.filter((r) => r.code === 'M0')
      expect(m0.length).toBe((m.pauseBetweenLayers ? input.layers.length - 1 : 0) + 1)
      expect(m0[0].line).toBeLessThan(motion[firstG1].line)
      expect(firstG1).toBe(m.axisCount === 4 ? 3 : 1)

      // REQ-003: 'fiber' sözleşmesinde tüm G1'lerde 0 ≤ C ≤ 180 (yazılan 3 ondalık)
      if (m.headAngleMode === 'fiber') {
        for (const r of motion) {
          expect(r.pos.c).toBeGreaterThanOrEqual(0)
          expect(r.pos.c).toBeLessThanOrEqual(180)
        }
        // REQ-011: her durağan aralıkta (ΔX = 0) C monoton, 90°'yi yalnız carriage yön değiştirince geçer
        const runs = stationaryRuns(rows)
        if (input.layers.some((l) => !(l.kind === 'helical' && l.dome)) || input.layers.length > 1) expect(runs.length).toBeGreaterThan(0)
        checkReq011(runs)
      }
      // M0 sonrasında: sonraki tüm hareketlerde A, M0 anındaki A'dan küçük değil; ilk hareket G1 (rewind/G0 yok)
      for (const p of m0) {
        const after = motion.filter((r) => r.line > p.line)
        expect(after[0].code).toBe('G1')
        for (const r of after) expect(r.pos.a).toBeGreaterThanOrEqual(p.pos.a - 1.5e-3)
      }

      // hoop geçişleri: |ΔX| = L olan G1'lerde ΔA/|ΔX| = 360°/adım, adım = L / ceil(L/w) girdiden
      const L = input.windLength!
      const pitch = L / Math.ceil(L / input.bandWidth!)
      let hoopPasses = 0
      for (let k = 1; k < motion.length; k++) {
        const r = motion[k]
        if (r.code !== 'G1' || r.layerKind !== 'hoop') continue
        const dx = Math.abs(r.pos.x - motion[k - 1].pos.x)
        if (Math.abs(dx - L) > 2e-3) continue
        hoopPasses++
        const da = r.pos.a - motion[k - 1].pos.a
        // tolerans yalnız 3 ondalık yuvarlama: A ±1e-3 ve X ±1e-3 (oranın göreli hatası ΔX'ten)
        expect(Math.abs(da / dx - 360 / pitch)).toBeLessThan(((360 / pitch) * 2e-3 + 2e-3) / dx)
      }
      expect(hoopPasses).toBe(2 * input.layers.filter((l) => l.kind === 'hoop').length)
    })
  }
})

describe('değişmez: düz helisel, katman yarıçapı iki katına çıkınca aynı ΔX için ΔA yarıya iner', () => {
  const rand = rng(777)
  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand()
  for (let i = 0; i < 12; i++) {
    const t = range(0.05, 0.5)
    const D1 = range(20, 200)
    const r1 = D1 / 2 + t
    // r2 = D2/2 + t = 2·r1 → D2 = 4·r1 − 2t (ilk katman yarıçapı = mandrel yarıçapı + yarım katman = D/2 + t)
    const D2 = 4 * r1 - 2 * t
    const alpha = range(10, 70)
    const L = range(100, 1500)
    const axisCount = rand() < 0.5 ? 3 : 4
    const feedMode = rand() < 0.5 ? 'G94' : 'G93'
    it(`#${i}: D ${D1.toFixed(1)} → ${D2.toFixed(1)}, α ${alpha.toFixed(1)}°, ${axisCount}e ${feedMode}`, () => {
      const m: MachineConfig = { ...machine3, axisCount, feedMode }
      const passDA = (D: number): number[] => {
        const inp: WindingInput = { ...baseInput, mandrelDiameter: D, bandThickness: t, windLength: L, layers: [{ id: 'a', kind: 'helical', angleDeg: alpha }] }
        const rows = read(generateGcode(planWinding(inp, axisCount), inp, m), m).filter((r) => r.code === 'G0' || r.code === 'G1')
        const out: number[] = []
        for (let k = 1; k < rows.length; k++) {
          const dx = Math.abs(rows[k].pos.x - rows[k - 1].pos.x)
          if (Math.abs(dx - L) < 2e-3) out.push((rows[k].pos.a - rows[k - 1].pos.a) / dx)
        }
        return out
      }
      const a1 = passDA(D1)
      const a2 = passDA(D2)
      expect(a1.length).toBeGreaterThan(0)
      expect(a2.length).toBeGreaterThan(0)
      // her geçişte ΔA/ΔX sabit; ikinci mandrelde tam yarısı (yalnız G-code yuvarlaması kadar fark)
      for (const v of a1) expect(v).toBeCloseTo(a1[0], 5)
      for (const v of a2) expect(v).toBeCloseTo(a2[0], 5)
      expect(Math.abs(a2[0] / a1[0] - 0.5)).toBeLessThan(1e-5)
    })
  }
})

describe('saldırgan girdiler: desen, hız limiti, kalınlık', () => {
  const layer = (angleDeg: number, dome = false): Layer =>
    dome ? { id: 'd', kind: 'helical', angleDeg, dome: true, domeHeight: 30 } : { id: 'a', kind: 'helical', angleDeg }
  const variants: [string, WindingInput][] = [
    ['1° düz', { ...baseInput, layers: [layer(1)] }],
    ['85° düz', { ...baseInput, layers: [layer(85)] }],
    ['1° domlu', { ...baseInput, layers: [layer(1, true)] }],
    ['85° domlu', { ...baseInput, layers: [layer(85, true)] }],
    ['bant > çevre', { ...baseInput, bandWidth: 1000, layers: [layer(45), layer(30, true)] }],
    ['çok uzun parça', { ...baseInput, windLength: 50000, layers: [layer(20), { id: 'h', kind: 'hoop', angleDeg: null }] }],
    ['bant ≥ dom aralığı (c + w ≥ R)', { ...baseInput, mandrelDiameter: 12, bandWidth: 10, layers: [layer(40, true), layer(40, true)] }]
  ]
  for (const [name, input] of variants) {
    it(name, () => {
      for (const axisCount of [3, 4] as const) {
        expect(missingFields(input, axisCount)).toEqual([])
        const plan = planWinding(input, axisCount)
        input.layers.forEach((l, i) => {
          if (l.kind !== 'helical') return
          const c = patternCandidates(input, i, axisCount)
          expect(c.length).toBeGreaterThan(0)
          for (const x of c) expect([x.j, x.nTurns, x.dwellDeg].every(Number.isFinite)).toBe(true)
          const d = plan.layers[i].dome
          if (d) for (const v of [d.maxThickness, d.buildup, ...d.thickness.map((s) => s.t)]) expect(Number.isFinite(v)).toBe(true)
        })
        for (const feedMode of ['G94', 'G93'] as const) {
          // aşırı küçük limitler (1 birim/dk): süre çok uzar ama sonlu kalır
          const m: MachineConfig = { ...machine3, axisCount, feedMode, maxSpeed: { carriage: 1, mandrel: 1, head: 1, cross: 1 } }
          const g = generateGcode(plan, input, m)
          expect(g).not.toMatch(/NaN|Infinity|undefined/)
          for (const f of g.match(/F[\d.]+/g) ?? []) expect(Number(f.slice(1))).toBeGreaterThan(0)
        }
      }
    })
  }

  it('4 eksen + boş kafa boşluğu: eksik alan, aday listesi boş', () => {
    const input = { ...baseInput, standoff: null }
    expect(missingFields(input, 4)).toContain('Kafa boşluğu (Y)')
    expect(patternCandidates(input, 0, 4)).toEqual([])
    expect(patternCandidates(input, 0, 3).length).toBeGreaterThan(0)
  })
})
