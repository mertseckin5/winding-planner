import { describe, expect, it } from 'vitest'
import { generateDryRun } from './dryrun'
import { generateGcode } from './gcode'
import { baseInput, machine3, rng } from './test-fixtures'
import type { MachineConfig, WindingInput } from './types'
import { verifyGcode } from './verify'
import { planWinding } from './winding'

const errors = (r: ReturnType<typeof verifyGcode>): string[] => r.issues.filter((i) => i.level === 'error').map((i) => i.message)

describe('üretilen G-code doğrulayıcıdan temiz geçer', () => {
  for (const [name, m] of [
    ['LinuxCNC G94', machine3],
    ['LinuxCNC G93', { ...machine3, feedMode: 'G93' as const }],
    ['Mach3 G93 4 eksen', { ...machine3, controller: 'mach3' as const, feedMode: 'G93' as const, axisCount: 4 as const }],
    ['ters eksenler', { ...machine3, invert: { carriage: true, mandrel: true, head: true, cross: false } }],
    ['farklı eksen adları', { ...machine3, names: { carriage: 'Z', mandrel: 'B', head: 'C', cross: 'Y' } }]
  ] as [string, MachineConfig][]) {
    it(name, () => {
      const plan = planWinding(baseInput, m.axisCount)
      const g = generateGcode(plan, baseInput, m)
      const r = verifyGcode(g, m, plan)
      expect(errors(r)).toEqual([])
      expect(r.issues.filter((i) => i.level === 'warning')).toEqual([])
      expect(r.planTimeRatio).toBeCloseTo(1, 3)
      expect(r.feedMoves).toBe(plan.moves.filter((x) => x.kind !== 'position').length)
      expect(r.rapidMoves).toBe(plan.moves.filter((x) => x.kind === 'position').length)
    })
  }

  it('G-code süresi planla %0,1 içinde eşleşir ve elle hesapla uyumlu (29,0 m / 3000 mm/dk)', () => {
    const plan = planWinding(baseInput, 3)
    const r = verifyGcode(generateGcode(plan, baseInput, machine3), machine3, plan)
    const handMinutes = plan.totalFiberLength / 3000
    expect(r.minutes / handMinutes).toBeGreaterThan(0.999)
    expect(r.minutes / handMinutes).toBeLessThan(1.001)
  })

  it('eksen aralığı: X 0..500, plana uygun', () => {
    const plan = planWinding(baseInput, 3)
    const r = verifyGcode(generateGcode(plan, baseInput, machine3), machine3, plan)
    expect(r.range.carriage.min).toBeCloseTo(0, 6)
    expect(r.range.carriage.max).toBeCloseTo(500, 3)
  })

  it('bağımsız tepe hız plan tabanlı hesapla uyuşur', async () => {
    const { peakSpeeds } = await import('./limits')
    const plan = planWinding(baseInput, 3)
    const r = verifyGcode(generateGcode(plan, baseInput, machine3), machine3, plan)
    const p = peakSpeeds(plan, 3000)
    expect(r.peak.carriage / p.carriage).toBeCloseTo(1, 2)
    expect(r.peak.mandrel / p.mandrel).toBeCloseTo(1, 2)
    expect(r.peak.head / p.head).toBeCloseTo(1, 2)
  })

  it('ters eksende mantıksal aralık işaret değiştirmez (negatif X yok)', () => {
    const m = { ...machine3, invert: { ...machine3.invert, carriage: true } }
    const plan = planWinding(baseInput, 3)
    const r = verifyGcode(generateGcode(plan, baseInput, m), m, plan)
    expect(r.range.carriage.min).toBeCloseTo(0, 6)
    expect(r.range.carriage.max).toBeCloseTo(500, 3)
  })
})

describe('rastgele girdiler: G-code plana uyar', () => {
  const rand = rng(777)
  const range = (lo: number, hi: number): number => lo + (hi - lo) * rand()
  for (let i = 0; i < 40; i++) {
    const dome = rand() < 0.3
    const input: WindingInput = {
      mandrelDiameter: range(40, 250),
      windLength: range(100, 1500),
      bandWidth: range(3, 30),
      bandThickness: range(0.05, 0.4),
      feedRate: range(300, 6000),
      turnDwellMinDeg: range(2, 60),
      standoff: range(10, 60),
      layers: Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) =>
        rand() < 0.3
          ? { id: `h${k}`, kind: 'hoop' as const, angleDeg: null }
          : dome
            ? { id: `d${k}`, kind: 'helical' as const, angleDeg: range(35, 80), dome: true, domeHeight: range(15, 120) }
            : { id: `a${k}`, kind: 'helical' as const, angleDeg: range(5, 80) }
      )
    }
    const axisCount = rand() < 0.5 ? 3 : 4
    const m: MachineConfig = {
      ...machine3,
      axisCount,
      feedMode: rand() < 0.5 ? 'G94' : 'G93',
      controller: rand() < 0.5 ? 'linuxcnc' : 'mach3'
    }
    it(`#${i} ${dome ? 'domlu ' : ''}${axisCount} eksen ${m.feedMode}`, () => {
      const plan = planWinding(input, axisCount)
      const r = verifyGcode(generateGcode(plan, input, m), m, plan)
      expect(errors(r)).toEqual([])
      expect(Math.abs((r.planTimeRatio ?? 0) - 1)).toBeLessThan(0.01)
    })
  }
})

describe('bozuk programlar yakalanır', () => {
  const hdr = 'G21 G90 G94\n'
  const msgs = (g: string, m: MachineConfig = machine3): string[] => verifyGcode(g, m).issues.map((i) => i.message)

  it('tanımsız eksen (Z)', () => {
    expect(msgs(hdr + 'G1 Z5 F100\nM2\n').join('|')).toMatch(/Tanımsız eksen Z/)
  })

  it('F tanımsız', () => {
    expect(msgs(hdr + 'G1 X5\nM2\n').join('|')).toMatch(/F tanımlı değil/)
  })

  it('F sıfır veya negatif', () => {
    expect(msgs(hdr + 'G1 X5 F0\nM2\n').join('|')).toMatch(/Geçersiz besleme/)
    expect(msgs(hdr + 'G1 X5 F-3\nM2\n').join('|')).toMatch(/Geçersiz besleme/)
  })

  it('G93 modunda satırda F yok', () => {
    expect(msgs('G21 G90 G93\nG1 X5 F1\nG1 X10\nM2\n').join('|')).toMatch(/G93 modunda her G1/)
  })

  it('G20 (inç) ile hareket', () => {
    expect(msgs('G20 G90 G94\nG1 X5 F100\nM2\n').join('|')).toMatch(/G21/)
  })

  it('hareket G0/G1 seçilmeden', () => {
    expect(msgs('G21 G90\nX5\nM2\n').join('|')).toMatch(/G0\/G1 seçilmemiş/)
  })

  it('ASCII dışı karakter', () => {
    expect(msgs(hdr + '(Katman ı)\nG1 X5 F100\nM2\n').join('|')).toMatch(/ASCII/)
  })

  it('M2 yok, G93 veya G91 modunda bitiş', () => {
    const t = msgs('G21 G91 G93\nG1 X5 F1\n').join('|')
    expect(t).toMatch(/M2\/M30 ile bitmiyor/)
    expect(t).toMatch(/G93 modunda bitiyor/)
    expect(t).toMatch(/G91/)
  })

  it('ayrıştırılamayan metin', () => {
    expect(msgs(hdr + 'G1 X5 F100 %%\nM2\n').join('|')).toMatch(/Ayrıştırılamayan/)
  })

  it('bitişten sonra kod', () => {
    expect(msgs(hdr + 'M2\nG1 X5 F100\n').join('|')).toMatch(/sonrasında kod/)
  })

  it('3 eksende Y kullanımı tanımsız', () => {
    expect(msgs(hdr + 'G1 Y5 F100\nM2\n').join('|')).toMatch(/Tanımsız eksen Y/)
    expect(msgs(hdr + 'G1 Y5 F100\nM2\n', { ...machine3, axisCount: 4 }).join('|')).not.toMatch(/Tanımsız eksen/)
  })
})

describe('limitler', () => {
  const plan = planWinding(baseInput, 3)
  const g = generateGcode(plan, baseInput, machine3)

  it('X strok üst sınırı aşılırsa hata', () => {
    const m = { ...machine3, travel: { carriage: { min: 0, max: 400 } } }
    expect(errors(verifyGcode(g, m, plan)).join('|')).toMatch(/üst strok limitini/)
  })

  it('X strok alt sınırı aşılırsa hata (negatif X)', () => {
    const neg = 'G21 G90 G94\nG1 X-5 F100\nM2\n'
    const m = { ...machine3, travel: { carriage: { min: 0, max: null } } }
    expect(errors(verifyGcode(neg, m)).join('|')).toMatch(/alt strok limitini/)
  })

  it('sınır içindeyse hata yok, girilmemişse kontrol yok', () => {
    const ok = { ...machine3, travel: { carriage: { min: -1, max: 501 } } }
    expect(errors(verifyGcode(g, ok, plan))).toEqual([])
    expect(errors(verifyGcode(g, machine3, plan))).toEqual([])
  })

  it('hız limiti aşımı uyarı verir', () => {
    const m = { ...machine3, maxSpeed: { carriage: null, mandrel: 1000, head: null, cross: null } }
    const w = verifyGcode(g, m, plan).issues.filter((i) => i.level === 'warning').map((i) => i.message)
    expect(w.join('|')).toMatch(/A tepe hızı/)
  })

  it('G-code plandan farklıysa süre ve son konum hatası verir', () => {
    const tampered = g.replace(/F2121\.3/g, 'F1000.0')
    const t = errors(verifyGcode(tampered, machine3, plan)).join('|')
    expect(t).toMatch(/süresi plandan/)
    const cut = g.split('\n').slice(0, -20).join('\n') + '\nM2\n'
    expect(errors(verifyGcode(cut, machine3, plan)).join('|')).toMatch(/son konumu plandan farklı/)
  })
})

describe('G92 ve artımlı mod', () => {
  it('G92 ofseti sonrası program koordinatı ofsetli, makine aralığı doğru', () => {
    const g = 'G21 G90 G94\nG1 X10 F100\nG92 X0\nG1 X5 F100\nM2\n'
    const r = verifyGcode(g, machine3)
    expect(errors(r)).toEqual([])
    expect(r.finalPos.carriage).toBeCloseTo(15, 9)
    expect(r.range.carriage.max).toBeCloseTo(15, 9)
  })

  it('kuru çalıştırma programı: net hareket sıfır, G90/G94 ile temiz biter', () => {
    for (const m of [machine3, { ...machine3, feedMode: 'G93' as const, axisCount: 4 as const }]) {
      const r = verifyGcode(generateDryRun(m), m)
      expect(errors(r)).toEqual([])
      for (const k of ['carriage', 'mandrel', 'head', 'cross'] as const) expect(r.finalPos[k]).toBeCloseTo(0, 9)
    }
  })

  it('kuru test süresi: X 10 mm @F100 = 6 sn, A 10° @F600 = 1 sn, G93 F2 = 30 sn', () => {
    const r = verifyGcode(generateDryRun({ ...machine3, feedMode: 'G93' }), { ...machine3, feedMode: 'G93' })
    const expected = (2 * 10) / 100 + (2 * 10) / 600 + (2 * 10) / 600 + 2 * 0.5
    expect(r.minutes).toBeCloseTo(expected, 9)
  })
})
