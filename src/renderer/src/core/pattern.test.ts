import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { readGcode } from './gcode-reader.testutil'
import { baseInput, machine3, rng } from './test-fixtures'
import type { Layer, MachineConfig, WindingInput } from './types'
import { missingFields, patternCandidates, planWinding } from './winding'

/** Euler totient, asal çarpanlara ayırmayla (koddaki gcd taramasından bağımsız). */
function totient(n: number): number {
  let out = n
  let m = n
  for (let p = 2; p * p <= m; p++) {
    if (m % p !== 0) continue
    while (m % p === 0) m /= p
    out -= out / p
  }
  if (m > 1) out -= out / m
  return out
}

const mod360 = (v: number): number => ((v % 360) + 360) % 360

/**
 * G-code'dan devre başlangıç A değerleri: ilk G0'ın A'sı + başlangıç tarafında (G0'ın X'i) X/Y değişmeden
 * A'nın arttığı her G1 (uç dönüşü sonu = sonraki devrenin başı). Ayrıca tüm uç dönüşü ΔA'ları.
 */
function circuitStarts(g: string, m: MachineConfig): { starts: number[]; dwells: number[] } {
  const rows = readGcode(g, m).filter((r) => r.code === 'G0' || r.code === 'G1')
  const startX = rows[0].pos.x
  const starts = [rows[0].pos.a]
  const dwells: number[] = []
  for (let k = 1; k < rows.length; k++) {
    const p = rows[k - 1].pos
    const q = rows[k].pos
    if (Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9 && q.a > p.a) {
      dwells.push(q.a - p.a)
      if (Math.abs(q.x - startX) < 1e-9) starts.push(q.a)
    }
  }
  return { starts, dwells }
}

function cases(): { name: string; input: WindingInput; m: MachineConfig }[] {
  const rand = rng(4242)
  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand()
  const out: { name: string; input: WindingInput; m: MachineConfig }[] = []
  for (let i = 0; i < 8; i++) {
    const dome = i % 2 === 1
    const D = range(30, 120)
    const layer: Layer = dome
      ? { id: 'd', kind: 'helical', angleDeg: range(15, 60), dome: true, domeHeight: range(10, D / 2) }
      : { id: 'a', kind: 'helical', angleDeg: range(10, 70) }
    const input: WindingInput = {
      ...baseInput,
      mandrelDiameter: D,
      windLength: range(80, 600),
      bandWidth: range(6, 20),
      turnDwellMinDeg: range(5, 120),
      layers: [layer]
    }
    const m: MachineConfig = { ...machine3, axisCount: rand() < 0.5 ? 3 : 4, feedMode: rand() < 0.5 ? 'G94' : 'G93' }
    out.push({ name: `${dome ? 'domlu' : 'düz'} D${D.toFixed(0)} α${layer.angleDeg!.toFixed(1)} ${m.axisCount}e ${m.feedMode}`, input, m })
  }
  return out
}

describe('desen seçimi (j, gcd(j,n)=1)', () => {
  for (const c of cases()) {
    describe(c.name, () => {
      const cands = patternCandidates(c.input, 0, c.m.axisCount)
      const n = planWinding(c.input, c.m.axisCount).layers[0].bands
      const dwellMin = c.input.turnDwellMinDeg!

      it('aday listesi: φ(n) aday, hepsi aralarında asal, uç dönüşü küçükten büyüğe, [asgari, asgari+180°)', () => {
        expect(cands.length).toBe(n === 1 ? 1 : totient(n))
        expect(cands.some((x) => x.j === 1)).toBe(true)
        for (let k = 1; k < cands.length; k++) expect(cands[k].dwellDeg).toBeGreaterThanOrEqual(cands[k - 1].dwellDeg)
        for (const x of cands) {
          expect(x.dwellDeg).toBeGreaterThanOrEqual(dwellMin - 1e-9)
          // en küçük N: bir tur az olsaydı uç dönüşü 180° küçülür ve asgarinin altına inerdi
          expect(x.dwellDeg - 180).toBeLessThan(dwellMin)
        }
      })

      it('her aday j: devre başlangıçları çevreyi n eşit parçaya böler, k. devre fazı k·j·360/n, kapanış tam, uç dönüşü ≥ asgari', () => {
        expect(cands.length).toBeGreaterThan(0)
        for (const cand of cands.slice(0, 12)) {
          const input: WindingInput = { ...c.input, layers: [{ ...c.input.layers[0], patternSkip: cand.j }] }
          expect(missingFields(input, c.m.axisCount)).toEqual([])
          const plan = planWinding(input, c.m.axisCount)
          expect(plan.layers[0].coverage).toBeGreaterThanOrEqual(1)
          const { starts, dwells } = circuitStarts(generateGcode(plan, input, c.m), c.m)
          expect(starts.length).toBe(n + 1)
          // A 3 ondalık yuvarlanır, faz 1e-2° içinde
          const slot = 360 / n
          const phases = starts.slice(0, n).map((a) => mod360(a - starts[0]))
          for (let k = 0; k < n; k++) {
            const want = mod360(k * cand.j * slot)
            const d = Math.abs(phases[k] - want)
            expect(Math.min(d, 360 - d)).toBeLessThan(1e-2)
          }
          const sorted = [...phases].sort((p, q) => p - q)
          sorted.forEach((p, k) => expect(Math.abs(p - k * slot)).toBeLessThan(1e-2))
          const close = mod360(starts[n] - starts[0])
          expect(Math.min(close, 360 - close)).toBeLessThan(1e-2)
          for (const d of dwells) {
            expect(d).toBeGreaterThanOrEqual(dwellMin - 2e-3)
            expect(Math.abs(d - cand.dwellDeg)).toBeLessThan(2e-3)
          }
        }
      })
    })
  }

  it('j yok / null / 1: G-code bit bit aynı (düz ve domlu)', () => {
    for (const layer of [baseInput.layers[0], { id: 'd', kind: 'helical' as const, angleDeg: 40, dome: true, domeHeight: 25 }]) {
      const out = [undefined, null, 1].map((j) => {
        const input: WindingInput = { ...baseInput, layers: [{ ...layer, patternSkip: j }] }
        return generateGcode(planWinding(input, 4), input, { ...machine3, axisCount: 4 })
      })
      expect(out[1]).toBe(out[0])
      expect(out[2]).toBe(out[0])
    }
  })

  it('geçersiz j: missingFields hata verir, G-code üretilmez', () => {
    // baseInput: n = ceil(2π·25,15·cos45° / 6) = 19 (asal) → j ∈ 1…18 geçerli
    const n = planWinding(baseInput, 3).layers[0].bands
    expect(n).toBe(Math.ceil((2 * Math.PI * 25.15 * Math.cos(Math.PI / 4)) / 6))
    const bad = (j: number): string[] =>
      missingFields({ ...baseInput, layers: [{ ...baseInput.layers[0], patternSkip: j }] }, 3)
    for (const j of [0, -1, 1.5, n, n + 1, 1e9, NaN, Infinity]) expect(bad(j).join('|')).toMatch(/desen atlaması/)
    for (const j of [1, 2, n - 1]) expect(bad(j)).toEqual([])
    // n bileşik: 20 → j=2, 4, 5, 10 geçersiz; 3, 7 geçerli
    const in20: WindingInput = { ...baseInput, mandrelDiameter: 40, bandWidth: 1, layers: [{ id: 'a', kind: 'helical', angleDeg: 60 }] }
    const n20 = planWinding(in20, 3).layers[0].bands
    expect(n20 % 2).toBe(0)
    const bad20 = (j: number): string[] => missingFields({ ...in20, layers: [{ ...in20.layers[0], patternSkip: j }] }, 3)
    expect(bad20(2).join('|')).toMatch(new RegExp(`n=${n20}`))
    expect(bad20(n20 / 2).length).toBe(1)
    const cands = patternCandidates(in20, 0, 3)
    for (const x of cands) expect(x.j % 2).toBe(1)
  })

  it('hoop katmanında j yok sayılır; diğer girdiler eksikse aday listesi boş', () => {
    const hoop: WindingInput = { ...baseInput, layers: [{ id: 'h', kind: 'hoop', angleDeg: null, patternSkip: 7 }] }
    expect(missingFields(hoop, 3)).toEqual([])
    expect(patternCandidates(hoop, 0, 3)).toEqual([])
    expect(patternCandidates({ ...baseInput, bandWidth: null }, 0, 3)).toEqual([])
    expect(patternCandidates({ ...baseInput, standoff: null }, 0, 4)).toEqual([])
    expect(patternCandidates(baseInput, 5, 3)).toEqual([])
  })

  it('j≠1 seçilince G-code katman yorumunda j yazılır, doğrulayıcı temiz', async () => {
    const { verifyGcode } = await import('./verify')
    const input: WindingInput = { ...baseInput, layers: [{ ...baseInput.layers[0], patternSkip: 5 }] }
    const plan = planWinding(input, 3)
    const g = generateGcode(plan, input, machine3)
    expect(g).toMatch(/bant=19 j=5/)
    expect(verifyGcode(g, machine3, plan).issues).toEqual([])
  })
})
