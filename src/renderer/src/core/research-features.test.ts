import { describe, expect, it } from 'vitest'
import { controllerChecklist } from './checklist'
import { generateDryRun } from './dryrun'
import { generateGcode } from './gcode'
import { hasAnySpeedLimit, peakSpeeds, speedWarnings } from './limits'
import { machine3 as machine, baseInput as input } from './test-fixtures'
import { planWinding } from './winding'

describe('tepe hız', () => {
  const plan = planWinding(input, 3)
  const peak = peakSpeeds(plan, 3000)

  it('araba: 500 mm geçiş, elyaf 707,1 mm → 2121,3 mm/dk (elle hesap)', () => {
    expect(peak.carriage).toBeCloseTo((500 * 3000) / Math.hypot(500, 500), 1)
  })

  it('mandrel: geçiş ve uç dönüşünün büyüğü (elle hesap)', () => {
    const r = 25 + 0.15
    const passRotDeg = ((500 * Math.tan(Math.PI / 4)) / r) * (180 / Math.PI)
    const passMin = Math.hypot(500, 500) / 3000
    const dwellDeg = plan.layers[0].turnDwellDeg
    const dwellMin = (r * dwellDeg * (Math.PI / 180)) / 3000
    const expected = Math.max(passRotDeg / passMin, dwellDeg / dwellMin)
    expect(peak.mandrel).toBeCloseTo(expected, 0)
  })

  it('kafa C: uç dönüşünde 90°→−90° çevrilir (180° / dwell süresi)', () => {
    const r = 25.15
    const dwellMin = (r * plan.layers[0].turnDwellDeg * (Math.PI / 180)) / 3000
    expect(peak.head).toBeCloseTo(90 / dwellMin, 0)
  })

  it('3 eksende Y hızı 0', () => {
    expect(peak.cross).toBe(0)
  })

  it('elyaf hızı iki katına çıkınca tüm tepe hızlar iki katına çıkar', () => {
    const fast = peakSpeeds(plan, 6000)
    expect(fast.mandrel).toBeCloseTo(peak.mandrel * 2, 6)
    expect(fast.carriage).toBeCloseTo(peak.carriage * 2, 6)
  })
})

describe('hız limiti uyarısı', () => {
  const plan = planWinding(input, 3)
  const peak = peakSpeeds(plan, 3000)

  it('limit girilmediyse uyarı yok ve hasAnySpeedLimit false', () => {
    expect(speedWarnings(peak, machine)).toEqual([])
    expect(hasAnySpeedLimit(machine)).toBe(false)
    expect(hasAnySpeedLimit({ ...machine, maxSpeed: { carriage: null, mandrel: null, head: null, cross: null } })).toBe(false)
  })

  it('limit aşılırsa uyarı ve elyaf hızı düşüş oranı', () => {
    const limit = peak.mandrel / 2
    const w = speedWarnings(peak, { ...machine, maxSpeed: { carriage: null, mandrel: limit, head: null, cross: null } })
    expect(w[0]).toMatch(/Mandrel \(A\)/)
    expect(w[w.length - 1]).toMatch(/%50/)
  })

  it('limit tepe hızdan büyükse uyarı yok', () => {
    const w = speedWarnings(peak, {
      ...machine,
      maxSpeed: { carriage: peak.carriage * 2, mandrel: peak.mandrel * 2, head: peak.head * 2, cross: null }
    })
    expect(w).toEqual([])
  })

  it('en kötü eksen oranı belirler', () => {
    const w = speedWarnings(peak, {
      ...machine,
      maxSpeed: { carriage: peak.carriage / 2, mandrel: peak.mandrel / 4, head: null, cross: null }
    })
    expect(w[w.length - 1]).toMatch(/%25/)
  })

  it('3 eksende çapraz limiti yok sayılır', () => {
    const w = speedWarnings({ ...peak, cross: 1e6 }, { ...machine, maxSpeed: { carriage: null, mandrel: null, head: null, cross: 1 } })
    expect(w).toEqual([])
  })
})

describe('G-code başlığı ve sonu', () => {
  const plan = planWinding(input, 3)

  it('tepe hız ve ayar kontrol yorumları var, tüm yorumlar ASCII', () => {
    const g = generateGcode(plan, input, machine)
    expect(g).toMatch(/\(Tepe hiz:/)
    expect(g).toMatch(/\(AYAR KONTROL:/)
    for (const l of g.split('\n')) {
      if (l.startsWith('(')) {
        expect(/^[\x20-\x7e]*$/.test(l)).toBe(true)
        expect((l.match(/\(/g) ?? []).length).toBe(1)
        expect((l.match(/\)/g) ?? []).length).toBe(1)
      }
    }
  })

  it('program G94 ile biter ve ardından M2 / M30 gelir', () => {
    const a = generateGcode(plan, input, machine).trim().split('\n')
    expect(a.slice(-2)).toEqual(['G94', 'M2'])
    const b = generateGcode(plan, input, { ...machine, controller: 'mach3' }).trim().split('\n')
    expect(b.slice(-2)).toEqual(['G94', 'M30'])
  })

  it('G93 modunda G93 seçili başlar ve G94 ile biter', () => {
    const g = generateGcode(plan, input, { ...machine, feedMode: 'G93' })
    expect(g.split('\n').indexOf('G93')).toBeGreaterThan(-1)
    expect(g.trim().split('\n').slice(-2)[0]).toBe('G94')
  })
})

describe('kontrol listesi', () => {
  it('LinuxCNC: trivkins coordinates standart X Y Z A B C sırasında', () => {
    expect(controllerChecklist(machine).join('\n')).toMatch(/coordinates=xac\b/)
    const four = controllerChecklist({ ...machine, axisCount: 4 }).join('\n')
    expect(four).toMatch(/coordinates=xyac\b/)
  })

  it('eksen adları değişince listeye yansır', () => {
    const m = { ...machine, names: { carriage: 'Z', mandrel: 'B', head: 'C', cross: 'Y' } }
    const t = controllerChecklist(m).join('\n')
    expect(t).toMatch(/AXIS_B/)
    expect(t).toMatch(/coordinates=zbc/)
  })

  it('Mach3: rollover ve short-rot uyarısı var', () => {
    const t = controllerChecklist({ ...machine, controller: 'mach3' }).join('\n')
    expect(t).toMatch(/Rot 360 Rollover/)
    expect(t).toMatch(/Short Rot on G0/)
  })
})

describe('kuru çalıştırma programı', () => {
  it('artımlı (G91), her eksen + sonra − gider, G90 ile biter', () => {
    const g = generateDryRun(machine)
    expect(g).toMatch(/^G91$/m)
    expect(g).toMatch(/G1 X10\.000 F100\nG1 X-10\.000 F100/)
    expect(g).toMatch(/G1 A10\.000 F600\nG1 A-10\.000 F600/)
    expect(g).toMatch(/G1 C10\.000 F600\nG1 C-10\.000 F600/)
    expect(g.trim().split('\n').slice(-3)).toEqual(['G90', '(Bitis)', 'M2'])
  })

  it('ters eksen işareti çevrilir, eksen adı değişir', () => {
    const g = generateDryRun({ ...machine, invert: { ...machine.invert, mandrel: true }, names: { ...machine.names, carriage: 'Z' } })
    expect(g).toMatch(/G1 A-10\.000 F600\nG1 A10\.000 F600/)
    expect(g).toMatch(/G1 Z10\.000 F100/)
    expect(g).not.toMatch(/G1 X/)
  })

  it('4 eksende Y testi var, 3 eksende yok', () => {
    expect(generateDryRun({ ...machine, axisCount: 4 })).toMatch(/G1 Y10\.000 F100/)
    expect(generateDryRun(machine)).not.toMatch(/G1 Y/)
  })

  it('G93 seçiliyse birleşik hareket F2 (30 sn), G94 seçiliyse G93 yok', () => {
    const g93 = generateDryRun({ ...machine, feedMode: 'G93' })
    expect(g93).toMatch(/^G93$/m)
    expect(g93).toMatch(/G1 X10\.000 A10\.000 F2\nG1 X-10\.000 A-10\.000 F2\nG94/)
    expect(generateDryRun(machine)).not.toMatch(/^G93$/m)
  })

  it('Mach3: M30 ile biter, yorumlar ASCII', () => {
    const g = generateDryRun({ ...machine, controller: 'mach3' })
    expect(g.trim().endsWith('M30')).toBe(true)
    for (const l of g.split('\n')) expect(/^[\x20-\x7e]*$/.test(l)).toBe(true)
  })

  it('net hareket sıfır: her eksende toplam artım 0', () => {
    const g = generateDryRun({ ...machine, axisCount: 4, feedMode: 'G93' })
    const sum: Record<string, number> = {}
    for (const l of g.split('\n')) {
      if (!l.startsWith('G1 ')) continue
      for (const m of l.matchAll(/([XACY])(-?[\d.]+)/g)) sum[m[1]] = (sum[m[1]] ?? 0) + Number(m[2])
    }
    for (const k of ['X', 'A', 'C', 'Y']) expect(sum[k]).toBeCloseTo(0, 9)
  })
})
