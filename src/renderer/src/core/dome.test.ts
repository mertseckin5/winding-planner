import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { machine3 } from './test-fixtures'
import type { WindingInput } from './types'
import { missingFields, planWinding } from './winding'

const RAD = Math.PI / 180
const machine = { ...machine3, axisCount: 4 as const }
const mk = (over: Partial<WindingInput> = {}, angle = 30, h = 40): WindingInput => ({
  mandrelDiameter: 100,
  windLength: 300,
  bandWidth: 8,
  bandThickness: 0.2,
  feedRate: 3000,
  turnDwellMinDeg: 20,
  standoff: 25,
  layers: [{ id: 'd', kind: 'helical', angleDeg: angle, dome: true, domeHeight: h }],
  ...over
})

/**
 * Bağımsız yarım-elips geodezik dönüşü: tanh-sinh kareleme (uç tekilliklerini kendi başına çözer),
 * dom kodundaki Gauss–Legendre / u=u0·sinψ yönteminden farklı bir yol.
 * θ = ∫₀^u0 c·√(h²cos²u+R²sin²u) / (R cos u · √(R²cos²u − c²)) du
 */
function domeThetaIndependent(R: number, h: number, c: number): number {
  const u0 = Math.acos(c / R)
  const f = (u: number, distToEnd: number): number => {
    const r = R * Math.cos(u)
    const root = R * Math.sqrt(Math.sin(distToEnd) * Math.sin(u0 + u)) // √(r²−c²)
    return (c * Math.sqrt(h * h * Math.cos(u) ** 2 + R * R * Math.sin(u) ** 2)) / (r * root)
  }
  let sum = 0
  const hStep = 1 / 64
  for (let k = -400; k <= 400; k++) {
    const t = k * hStep
    const s = (Math.PI / 2) * Math.sinh(t)
    const x = Math.tanh(s)
    const w = ((Math.PI / 2) * Math.cosh(t)) / Math.cosh(s) ** 2
    const dist = (u0 / 2) * (1 - x) // u0 − u
    const u = (u0 / 2) * (1 + x)
    if (!(dist > 0) || !(u > 0)) continue
    sum += f(u, dist) * w * (u0 / 2) * hStep
  }
  return sum
}

interface L {
  code: string
  x: number
  a: number
  c: number
  y: number
}
function parse(g: string): L[] {
  const out: L[] = []
  for (const raw of g.split('\n')) {
    const m = /^(G0|G1) /.exec(raw)
    if (!m) continue
    const v = (ax: string): number => {
      const r = new RegExp(`${ax}(-?[\\d.]+)`).exec(raw)
      return r ? Number(r[1]) : 0
    }
    out.push({ code: m[1], x: v('X'), a: v('A'), c: v('C'), y: v('Y') })
  }
  return out
}

describe('domlu helisel: geometri (G-code geri okuma)', () => {
  const cases: [number, number, number, number][] = [
    [100, 300, 30, 40],
    [60, 200, 45, 15],
    [200, 500, 10, 120],
    [80, 150, 70, 30]
  ]
  for (const [D, L, angle, h] of cases) {
    it(`D=${D} L=${L} α=${angle} h=${h}`, () => {
      const inp = mk({ mandrelDiameter: D, windLength: L }, angle, h)
      expect(missingFields(inp, 4)).toEqual([])
      const plan = planWinding(inp, 4)
      const info = plan.layers[0]
      const R = D / 2 + 0.2 // ilk katman yarıçapı
      const c = R * Math.sin(angle * RAD)
      const yOff = 0.2 + 25 // Y = r + bandThickness + standoff
      const g1 = parse(generateGcode(plan, inp, machine)).filter((l) => l.code === 'G1')

      expect(info.dome!.poleRadius).toBeCloseTo(c, 9)
      expect(info.dome!.poleOffset).toBeCloseTo(h * Math.cos(angle * RAD), 9)

      let minR = Infinity
      let maxX = -Infinity
      let minX = Infinity
      for (const l of g1) {
        const r = l.y - yOff
        minR = Math.min(minR, r)
        minX = Math.min(minX, l.x)
        maxX = Math.max(maxX, l.x)
        // Clairaut: r·sinφ = c, φ = |C| (meridyenle açı)
        expect(Math.abs(r * Math.sin(Math.abs(l.c) * RAD) - c)).toBeLessThan(c * 2e-3 + 2e-3)
        // profil: yarım-elips (z/h)² + (r/R)² = 1, z ekvatordan uzaklık
        const z = l.x < 0 ? -l.x : l.x > L ? l.x - L : 0
        if (z > 0) expect(Math.abs((z / h) ** 2 + (r / R) ** 2 - 1)).toBeLessThan(2e-3)
      }
      expect(minR).toBeGreaterThanOrEqual(c - 1e-3)
      expect(minR).toBeLessThan(c + 1e-3) // kutup açıklığına gerçekten varılıyor
      expect(minX).toBeCloseTo(-h * Math.cos(angle * RAD), 2)
      expect(maxX).toBeCloseTo(L + h * Math.cos(angle * RAD), 2)
    })
  }
})

describe('domlu helisel: A dönüşü', () => {
  it('geçiş başına A = 2·θdom + L·tanα/R (bağımsız kareleme), devre = 2πN + 2π/n', () => {
    const cases: [number, number][] = [
      [30, 40],
      [55, 25],
      [12, 90]
    ]
    for (const [angle, h] of cases) {
      const inp = mk({}, angle, h)
      const plan = planWinding(inp, 4)
      const info = plan.layers[0]
      const R = 50.2
      const c = R * Math.sin(angle * RAD)
      const thetaDom = domeThetaIndependent(R, h, c)
      const passRot = (2 * thetaDom + (300 * Math.tan(angle * RAD)) / R) / RAD
      const lines = parse(generateGcode(plan, inp, machine))
      const startA = lines[0].a
      // ilk dwell: X aynı, C işareti ters
      let idx = 1
      while (idx < lines.length) {
        if (Math.abs(lines[idx].c - lines[idx - 1].c) > 170 && lines[idx].x === lines[idx - 1].x) break
        idx++
      }
      const aBeforeDwell = lines[idx - 1].a
      expect(aBeforeDwell - startA).toBeCloseTo(passRot, 1)
      const dwellDeg = lines[idx].a - aBeforeDwell
      expect(dwellDeg).toBeCloseTo(info.turnDwellDeg, 2)
      expect(dwellDeg).toBeGreaterThanOrEqual(20 - 1e-6)
      // devre = 2 geçiş + 2 dwell = 360N + 360/n
      const circuit = 2 * passRot + 2 * dwellDeg
      const n = Math.round((circuit - 360 / info.bands) / 360)
      expect(circuit - 360 * n).toBeCloseTo(360 / info.bands, 1)
      expect(lines[lines.length - 1].a).toBeCloseTo(info.bands * circuit, 0)
    }
  })

  it('devre başlangıç fazları çevreyi n eşit parçaya böler', () => {
    const inp = mk({}, 35, 30)
    const plan = planWinding(inp, 4)
    const bands = plan.layers[0].bands
    const lines = parse(generateGcode(plan, inp, machine))
    // devre başı: sol kutup G0 konumu + her devrenin sol kutuptaki dwell'i sonrası A (C = +90)
    const starts = [lines[0].a]
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].c === 90 && lines[i - 1].c !== 90 && lines[i].x === lines[i - 1].x && lines[i].x < 0) starts.push(lines[i].a)
    }
    expect(starts.length).toBe(bands + 1)
    const mod = starts
      .slice(0, bands)
      .map((s) => ((s % 360) + 360) % 360)
      .sort((p, q) => p - q)
    for (let k = 1; k < mod.length; k++) expect(mod[k] - mod[k - 1]).toBeCloseTo(360 / bands, 1)
  })
})

describe('domlu helisel: geçersiz durum ve güvenlik', () => {
  it('dom yüksekliği boş / ≤0 / NaN / Infinity → missingFields', () => {
    for (const bad of [null, undefined, 0, -5, NaN, Infinity]) {
      const inp = mk()
      inp.layers[0].domeHeight = bad as number | null
      expect(missingFields(inp, 3).some((m) => m.includes('dom yüksekliği'))).toBe(true)
    }
  })

  it('dom kapalıyken dom yüksekliği istenmez, plan düz helisel ile aynı', () => {
    const a = mk()
    a.layers[0] = { id: 'x', kind: 'helical', angleDeg: 30, dome: false, domeHeight: null }
    const b = mk()
    b.layers[0] = { id: 'x', kind: 'helical', angleDeg: 30 }
    expect(missingFields(a, 3)).toEqual([])
    expect(generateGcode(planWinding(a, 3), a, machine)).toBe(generateGcode(planWinding(b, 3), b, machine))
  })

  it('uyarılar: negatif X ve kutup sığmazlığı', () => {
    const inp = mk({ bandWidth: 30 }, 5, 40)
    const w = planWinding(inp, 3).layers[0].warnings.join('|')
    expect(w).toMatch(/negatif X/)
    expect(w).toMatch(/Kutup açıklığında bantlar sığmıyor/)
  })

  it('karma katmanlar (domlu + düz + hoop) NaN üretmez', () => {
    const inp = mk()
    inp.layers = [
      { id: '1', kind: 'helical', angleDeg: 40, dome: true, domeHeight: 30 },
      { id: '2', kind: 'hoop', angleDeg: null },
      { id: '3', kind: 'helical', angleDeg: 20 },
      { id: '4', kind: 'helical', angleDeg: 60, dome: true, domeHeight: 10 }
    ]
    for (const ax of [3, 4] as const) {
      for (const fm of ['G94', 'G93'] as const) {
        const g = generateGcode(planWinding(inp, ax), inp, { ...machine, axisCount: ax, feedMode: fm })
        expect(g).not.toMatch(/NaN|Infinity|undefined/)
      }
    }
  })
})

/** Tekrarlanabilir rastgele sayı üreteci (mulberry32). */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('rastgele girdilerle domlu sağlamlık', () => {
  const rand = rng(777)
  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand()
  for (let i = 0; i < 50; i++) {
    const t = range(0.05, 0.5)
    const inp: WindingInput = {
      mandrelDiameter: range(10, 300),
      windLength: range(20, 1500),
      bandWidth: range(2, 40),
      bandThickness: t,
      feedRate: range(200, 8000),
      turnDwellMinDeg: range(1, 90),
      standoff: range(5, 80),
      layers: Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => {
        const r = rand()
        if (r < 0.2) return { id: `h${k}`, kind: 'hoop' as const, angleDeg: null }
        return {
          id: `d${k}`,
          kind: 'helical' as const,
          angleDeg: range(3, 84),
          dome: r < 0.85,
          domeHeight: range(1, 250)
        }
      })
    }
    const axisCount = rand() < 0.5 ? 3 : 4
    const feedMode = rand() < 0.5 ? 'G94' : 'G93'
    it(`#${i}: ${axisCount} eksen ${feedMode}, ${inp.layers.length} katman`, () => {
      expect(missingFields(inp, axisCount)).toEqual([])
      const plan = planWinding(inp, axisCount)
      const g = generateGcode(plan, inp, { ...machine, axisCount, feedMode })
      expect(g).not.toMatch(/NaN|Infinity|undefined/)
      const lines = parse(g)
      for (let k = 1; k < lines.length; k++) expect(lines[k].a).toBeGreaterThanOrEqual(lines[k - 1].a - 0.002)
      // her G1'in F'i yazılan hanelerde pozitif kalmalı
      for (const raw of g.split('\n')) {
        const m = /^G1 .* F([\d.]+)$/.exec(raw)
        if (m) expect(Number(m[1])).toBeGreaterThan(0)
      }
      // X sınırı: kutup açıklığı kadar dışarı taşar, daha fazla değil
      const maxOff = Math.max(...plan.layers.map((l) => l.dome?.poleOffset ?? 0))
      for (const l of lines) {
        expect(l.x).toBeGreaterThanOrEqual(-maxOff - 6e-4)
        expect(l.x).toBeLessThanOrEqual(inp.windLength! + maxOff + 6e-4)
      }
      // Clairaut her domlu katmanda (4 eksen: r = Y − (t + standoff))
      if (axisCount === 4) {
        const chunks = g.split(/\n\(Katman \d+:/).slice(1)
        chunks.forEach((chunk, ci) => {
          const c = plan.layers[ci].dome?.poleRadius
          if (c === undefined) return
          for (const l of parse(chunk)) {
            if (l.code !== 'G1') continue
            const r = l.y - (t + inp.standoff!)
            expect(Math.abs(r * Math.sin(Math.abs(l.c) * RAD) - c)).toBeLessThan(c * 3e-3 + 3e-3)
          }
        })
      }
    })
  }
})
