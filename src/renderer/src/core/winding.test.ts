import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { machine3 as machine, baseInput as input } from './test-fixtures'
import type { WindingInput } from './types'
import { missingFields, planWinding } from './winding'

describe('missingFields', () => {
  it('boş girdide eksik alanları söyler', () => {
    const empty: WindingInput = {
      mandrelDiameter: null,
      windLength: null,
      bandWidth: null,
      bandThickness: null,
      feedRate: null,
      turnDwellMinDeg: null,
      standoff: null,
      layers: []
    }
    const m = missingFields(empty, 4)
    expect(m).toContain('Mandrel çapı')
    expect(m).toContain('Kafa boşluğu (Y)')
    expect(m).toContain('En az bir katman')
  })

  it('geçerli girdide boş döner', () => {
    expect(missingFields(input, 3)).toEqual([])
  })

  it('85° üstü helisel açıyı reddeder', () => {
    const bad = { ...input, layers: [{ id: 'x', kind: 'helical' as const, angleDeg: 88 }] }
    expect(missingFields(bad, 3).length).toBe(1)
  })
})

describe('helisel katman', () => {
  const plan = planWinding(input, 3)
  const info = plan.layers[0]
  const passes = plan.moves.filter((m) => m.kind === 'pass')

  it('tek geçişte A dönüşü L·tanα/r', () => {
    const r = 25 + 0.15
    const expected = ((500 * Math.tan((45 * Math.PI) / 180)) / r) * (180 / Math.PI)
    const first = plan.moves[1].a - plan.moves[0].a
    expect(first).toBeCloseTo(expected, 6)
  })

  it('uç dönüşü asgari değerden küçük değil', () => {
    expect(info.turnDwellDeg).toBeGreaterThanOrEqual(20 - 1e-9)
  })

  it('tam kapsama: bant sayısı çevreyi kapatır', () => {
    expect(info.coverage).toBeGreaterThanOrEqual(1)
    expect(info.coverage).toBeLessThan(1.2)
  })

  it('gidiş geçişlerinin x=0 başlangıç fazları çevreyi eşit böler (j=1)', () => {
    // devre başlangıç A'sı = position A + k·θc ; θc mod 360 = 360/bands
    const starts: number[] = []
    let a = plan.moves[0].a
    for (let k = 0; k < info.bands; k++) {
      starts.push(((a % 360) + 360) % 360)
      a = plan.moves[1 + (k + 1) * 4 - 1].a
    }
    const uniq = new Set(starts.map((s) => Math.round(s * 1000)))
    expect(uniq.size).toBe(info.bands)
    const sorted = [...starts].sort((p, q) => p - q)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(360 / info.bands, 6)
    }
  })

  it('geçişler X yönünü değiştirir ve C işaret değiştirir', () => {
    expect(passes[0].x).toBe(500)
    expect(passes[1].x).toBe(0)
    expect(passes[0].c).toBe(45)
    expect(passes[1].c).toBe(-45)
  })

  it('A hiç geri gitmez', () => {
    for (let i = 1; i < plan.moves.length; i++) {
      expect(plan.moves[i].a).toBeGreaterThanOrEqual(plan.moves[i - 1].a - 1e-9)
    }
  })
})

describe('hoop katman', () => {
  const hoop: WindingInput = { ...input, layers: [{ id: 'h', kind: 'hoop', angleDeg: null }] }
  const plan = planWinding(hoop, 3)

  it('adım bant genişliğini aşmaz', () => {
    expect(plan.layers[0].coverage).toBeGreaterThanOrEqual(1)
    expect(plan.layers[0].angleDeg).toBeGreaterThan(85)
  })

  it('gidiş-dönüş aynı sayıda tur, arada uç dönüşü (asgari açı) ve C işaret değiştirir', () => {
    const [p0, p1, d, p2] = plan.moves
    expect(d.kind).toBe('dwell')
    expect(p1.a - p0.a).toBeCloseTo(p2.a - d.a, 9)
    expect(d.a - p1.a).toBeCloseTo(20, 9)
    expect(p1.c).toBeGreaterThan(85)
    expect(d.c).toBeCloseTo(-p1.c, 9)
    expect(p2.c).toBeCloseTo(-p1.c, 9)
  })
})

describe('çok katman', () => {
  it('yarıçap her katmanda 2t artar, 4 eksende Y buna uyar', () => {
    const multi: WindingInput = {
      ...input,
      layers: [
        { id: 'a', kind: 'helical', angleDeg: 30 },
        { id: 'b', kind: 'hoop', angleDeg: null }
      ]
    }
    const plan = planWinding(multi, 4)
    expect(plan.layers[1].radius - plan.layers[0].radius).toBeCloseTo(0.3, 9)
    expect(plan.outerDiameter).toBeCloseTo(50 + 4 * 0.3 * 1, 9)
    const y0 = plan.moves.find((m) => m.layer === 0)!.y
    const y1 = plan.moves.find((m) => m.layer === 1)!.y
    expect(y0).toBeCloseTo(25 + 0.3 + 30, 9)
    expect(y1).toBeCloseTo(25 + 0.6 + 30, 9)
  })
})

describe('G-code', () => {
  const plan = planWinding(input, 3)

  it('LinuxCNC M2 ile biter, Mach3 M30 ile', () => {
    expect(generateGcode(plan, input, machine).trim().endsWith('M2')).toBe(true)
    expect(generateGcode(plan, input, { ...machine, controller: 'mach3' }).trim().endsWith('M30')).toBe(true)
  })

  it('G94: hareket süresi elyaf hızıyla tutarlı', () => {
    const lines = generateGcode(plan, input, machine).split('\n').filter((l) => l.startsWith('G1'))
    const pass = lines[0]
    const dx = Number(/X(-?[\d.]+)/.exec(pass)![1])
    const f = Number(/F([\d.]+)/.exec(pass)![1])
    const minutes = dx / f
    expect(minutes).toBeCloseTo(plan.moves[1].fiberLength / 3000, 3)
  })

  it('G93: F = 1/süre', () => {
    const lines = generateGcode(plan, input, { ...machine, feedMode: 'G93' }).split('\n').filter((l) => l.startsWith('G1'))
    const f = Number(/F([\d.]+)/.exec(lines[0])![1])
    expect(f).toBeCloseTo(3000 / plan.moves[1].fiberLength, 3)
  })

  it('eksen tersleme işareti çevirir', () => {
    const g = generateGcode(plan, input, { ...machine, invert: { ...machine.invert, mandrel: true } })
    expect(/A-\d/.test(g.split('\n').find((l) => l.startsWith('G1'))!)).toBe(true)
  })

  it('4 eksende Y yazılır, 3 eksende yazılmaz', () => {
    expect(generateGcode(planWinding(input, 4), input, { ...machine, axisCount: 4 })).toMatch(/G0 .*Y/)
    expect(generateGcode(plan, input, machine)).not.toMatch(/G1 .*Y/)
  })

  it('katman arası duraklama M0 ekler', () => {
    const multi: WindingInput = {
      ...input,
      layers: [
        { id: 'a', kind: 'hoop', angleDeg: null },
        { id: 'b', kind: 'hoop', angleDeg: null }
      ]
    }
    const g = generateGcode(planWinding(multi, 3), multi, { ...machine, pauseBetweenLayers: true })
    // 1 katman sınırı + REQ-001 ilk G1 öncesi elyaf bağlama
    expect(g.match(/^M0$/gm)?.length).toBe(2)
    expect(generateGcode(planWinding(multi, 3), multi, machine).match(/^M0$/gm)?.length).toBe(1)
  })
})
