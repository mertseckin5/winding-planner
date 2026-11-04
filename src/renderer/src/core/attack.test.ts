import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { machine3 as machine, baseInput as base, rng } from './test-fixtures'
import type { MachineConfig, WindingInput } from './types'
import { missingFields, planWinding } from './winding'

interface Line {
  code: string
  x: number
  a: number
  c: number
  y: number | null
  f: number | null
}

/** G-code'u bağımsız olarak geri okur (planın iç yapısına bakmadan). */
function parse(gcode: string): { lines: Line[]; layerRadius: number[] } {
  const lines: Line[] = []
  const layerRadius: number[] = []
  for (const raw of gcode.split('\n')) {
    const lm = /^\(Katman \d+: .* yaricap=([\d.]+)/.exec(raw)
    if (lm) layerRadius.push(Number(lm[1]))
    const m = /^(G0|G1) /.exec(raw)
    if (!m) continue
    const g = (ax: string): number | null => {
      const r = new RegExp(`${ax}(-?[\\d.]+)`).exec(raw)
      return r ? Number(r[1]) : null
    }
    lines.push({ code: m[1], x: g('X')!, a: g('A')!, c: g('C')!, y: g('Y'), f: g('F') })
  }
  return { lines, layerRadius }
}

describe('rastgele girdilerle sağlamlık', () => {
  const rand = rng(12345)
  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand()

  for (let i = 0; i < 60; i++) {
    const input: WindingInput = {
      mandrelDiameter: range(10, 300),
      windLength: range(50, 2000),
      bandWidth: range(2, 40),
      bandThickness: range(0.05, 0.5),
      feedRate: range(200, 8000),
      turnDwellMinDeg: range(1, 90),
      standoff: range(5, 80),
      layers: Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, k) =>
        rand() < 0.3
          ? { id: `h${k}`, kind: 'hoop' as const, angleDeg: null }
          : { id: `a${k}`, kind: 'helical' as const, angleDeg: range(5, 80) }
      )
    }
    const axisCount = rand() < 0.5 ? 3 : 4
    const feedMode = rand() < 0.5 ? 'G94' : 'G93'
    const controller = rand() < 0.5 ? 'linuxcnc' : 'mach3'

    it(`#${i}: ${axisCount} eksen ${feedMode} ${controller}, ${input.layers.length} katman`, () => {
      expect(missingFields(input, axisCount)).toEqual([])
      const plan = planWinding(input, axisCount)
      const m: MachineConfig = { ...machine, axisCount, feedMode, controller }
      const gcode = generateGcode(plan, input, m)

      // 1) sonlu sayılar
      expect(gcode).not.toMatch(/NaN|Infinity|undefined/)

      const { lines, layerRadius } = parse(gcode)
      expect(layerRadius.length).toBe(input.layers.length)

      // 2) A geri gitmez, X [0, L] içinde
      for (let k = 1; k < lines.length; k++) {
        expect(lines[k].a).toBeGreaterThanOrEqual(lines[k - 1].a - 0.002)
      }
      for (const l of lines) {
        // G-code 3 haneye yuvarlar
        expect(l.x).toBeGreaterThanOrEqual(-6e-4)
        expect(l.x).toBeLessThanOrEqual(input.windLength! + 6e-4)
      }

      // 3) Elyaf hızı bağımsız yeniden hesapla: her G1 için süre*hız = elyaf boyu
      let layer = -1
      let prev = { x: 0, a: 0, c: 0, y: 0 }
      let totalFiber = 0
      let seenFirstPosition = false
      let curLayer = -1
      for (const raw of gcode.split('\n')) {
        if (/^\(Katman/.test(raw)) {
          layer++
          curLayer = layer
          continue
        }
        const mm = /^(G0|G1) /.exec(raw)
        if (!mm) continue
        const L = parse(raw).lines[0]
        if (mm[1] === 'G0') {
          prev = { x: L.x, a: L.a, c: L.c, y: L.y ?? 0 }
          seenFirstPosition = true
          continue
        }
        expect(seenFirstPosition).toBe(true)
        const dx = L.x - prev.x
        const dy = (L.y ?? 0) - prev.y
        const dA = L.a - prev.a
        const dC = L.c - prev.c
        const r = layerRadius[curLayer]
        // yüzeyde elyaf yolu: eksenel dx + çevresel r·dA (rad) (+ katman geçişinde radyal Y); C kafa dönüşü, elyaf boyuna katılmaz
        const fiber = Math.hypot(dx, dy, r * ((dA * Math.PI) / 180))
        let minutes: number
        if (feedMode === 'G93') {
          minutes = 1 / L.f!
        } else {
          // LinuxCNC: X veya Y hareket ediyorsa F lineer (X/Y) uzunluğa uygulanır
          const lin = Math.hypot(dx, dy)
          const rot = Math.hypot(dA, dC)
          minutes = (lin > 1e-9 ? lin : rot) / L.f!
        }
        // 3 hane yuvarlama + F yuvarlama toleransı
        const speed = fiber / minutes
        expect(speed / input.feedRate!).toBeGreaterThan(0.97)
        expect(speed / input.feedRate!).toBeLessThan(1.03)
        totalFiber += fiber
        prev = { x: L.x, a: L.a, c: L.c, y: L.y ?? 0 }
      }
      // 4) toplam elyaf planla uyumlu (%1)
      expect(Math.abs(totalFiber - plan.totalFiberLength) / plan.totalFiberLength).toBeLessThan(0.01)

      // 5) kapsama ve uç dönüşü
      for (const li of plan.layers) {
        expect(li.coverage).toBeGreaterThanOrEqual(1 - 1e-9)
        if (li.kind === 'helical') {
          expect(li.turnDwellDeg).toBeGreaterThanOrEqual(input.turnDwellMinDeg! - 1e-6)
        }
      }
    })
  }
})

describe('helisel faz düzeni, G-code geri okunarak', () => {
  it('x=0 uçtaki geçiş başlangıçları çevreyi eşit böler ve tekrarlamaz', () => {
    for (const angle of [10, 30, 45, 60, 75]) {
      const inp: WindingInput = { ...base, layers: [{ id: 'l', kind: 'helical', angleDeg: angle }] }
      const plan = planWinding(inp, 3)
      const { lines } = parse(generateGcode(plan, inp, machine))
      const bands = plan.layers[0].bands
      // lines[0] = G0 konum, sonra devre başına 4 G1: devre başlangıç A = bir önceki devrenin son A'sı
      const starts: number[] = [lines[0].a]
      for (let k = 0; k < bands - 1; k++) starts.push(lines[4 + k * 4].a)
      const mod = starts.map((s) => ((s % 360) + 360) % 360).sort((p, q) => p - q)
      for (let k = 1; k < mod.length; k++) {
        expect(mod[k] - mod[k - 1]).toBeCloseTo(360 / bands, 1)
      }
      // tüm bantlar arasında boşluk bant genişliğinden büyük değil: çevresel aralık*cosα ≤ w
      const r = plan.layers[0].radius
      const gapWidth = ((2 * Math.PI * r) / bands) * Math.cos((angle * Math.PI) / 180)
      expect(gapWidth).toBeLessThanOrEqual(inp.bandWidth! + 1e-9)
    }
  })
})

describe('uç durumlar', () => {
  it('çok küçük ve büyük açı', () => {
    for (const angle of [0.5, 1, 85]) {
      const inp: WindingInput = { ...base, layers: [{ id: 'l', kind: 'helical', angleDeg: angle }] }
      expect(missingFields(inp, 3)).toEqual([])
      const g = generateGcode(planWinding(inp, 3), inp, machine)
      expect(g).not.toMatch(/NaN|Infinity/)
    }
  })

  it('bant çevreden geniş: 1 bant, kapsama ≥ 1', () => {
    const inp: WindingInput = { ...base, mandrelDiameter: 5, bandWidth: 40 }
    const plan = planWinding(inp, 3)
    expect(plan.layers[0].bands).toBe(1)
    expect(plan.layers[0].coverage).toBeGreaterThanOrEqual(1)
    expect(generateGcode(plan, inp, machine)).not.toMatch(/NaN|Infinity/)
  })

  it('hoop: bant uzunluktan geniş → 1 tur', () => {
    const inp: WindingInput = { ...base, windLength: 20, bandWidth: 40, layers: [{ id: 'h', kind: 'hoop', angleDeg: null }] }
    const plan = planWinding(inp, 3)
    expect(plan.layers[0].bands).toBe(1)
    expect(generateGcode(plan, inp, machine)).not.toMatch(/NaN|Infinity/)
  })

  it('geçersiz girdiler reddedilir: NaN, Infinity, negatif, sıfır', () => {
    for (const bad of [NaN, Infinity, -1, 0]) {
      expect(missingFields({ ...base, mandrelDiameter: bad }, 3)).toContain('Mandrel çapı')
      expect(missingFields({ ...base, bandWidth: bad }, 3)).toContain('Bant genişliği')
      expect(missingFields({ ...base, feedRate: bad }, 3)).toContain('Elyaf hızı')
    }
    expect(missingFields({ ...base, layers: [{ id: 'x', kind: 'helical', angleDeg: NaN }] }, 3).length).toBe(1)
    expect(missingFields({ ...base, layers: [{ id: 'x', kind: 'helical', angleDeg: 0 }] }, 3).length).toBe(1)
    expect(missingFields({ ...base, standoff: -1 }, 4)).toContain('Kafa boşluğu (Y)')
    expect(missingFields({ ...base, standoff: 0 }, 4)).toEqual([])
  })

  it('çok ince bantta hareket sayısı ve süre makul kalır', () => {
    const inp: WindingInput = { ...base, mandrelDiameter: 200, bandWidth: 0.5 }
    const t0 = Date.now()
    const plan = planWinding(inp, 3)
    generateGcode(plan, inp, machine)
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(plan.moves.length).toBeLessThan(200_000)
  })

  it('LinuxCNC ve Mach3 hareket satırları aynı, yalnız başlık/son farklı', () => {
    const plan = planWinding(base, 3)
    const moves = (g: string): string[] => g.split('\n').filter((l) => /^G[01] /.test(l))
    expect(moves(generateGcode(plan, base, machine))).toEqual(moves(generateGcode(plan, base, { ...machine, controller: 'mach3' })))
  })

  it('yorumlarda parantez G-code'+"'"+'u bozmaz', () => {
    const g = generateGcode(planWinding(base, 3), base, machine)
    for (const l of g.split('\n')) {
      if (l.startsWith('(')) expect((l.match(/\(/g) ?? []).length).toBe(1)
    }
  })

  it('aynı girdi iki kez aynı çıktıyı verir (deterministik)', () => {
    const a = generateGcode(planWinding(base, 3), base, machine)
    const b = generateGcode(planWinding(base, 3), base, machine)
    expect(a).toBe(b)
  })
})
