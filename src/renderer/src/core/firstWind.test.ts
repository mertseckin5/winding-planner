import { describe, expect, it } from 'vitest'
import { firstWindSteps } from './firstWind'
import { machine3 } from './test-fixtures'
import type { MachineConfig } from './types'

const text = (m: MachineConfig, hasDome = false): string =>
  firstWindSteps(m, { hasDome })
    .map((s) => [s.title, ...s.items].join('\n'))
    .join('\n')

describe('ilk sarım adım listesi', () => {
  it('eksen adları makine ayarından yansır', () => {
    const m: MachineConfig = { ...machine3, axisCount: 4, names: { carriage: 'Z', mandrel: 'B', head: 'W', cross: 'V' } }
    const t = text(m, true)
    expect(t).toMatch(/Yalnız mandrel \(B\)/)
    expect(t).toMatch(/Z kızağı/)
    expect(t).toMatch(/W kafa dönüşü/)
    expect(t).toMatch(/V kafa boşluğu/)
    expect(t).toMatch(/Z, B, W, V eksenlerinin/)
    // varsayılan adlar hiç geçmemeli (X/A/C/Y harfleri tek başına kelime olarak)
    expect(t).not.toMatch(/\b[XACY]\b/)
  })

  it('3 eksende Y adımları yok; dom adımı yalnız domlu katman varsa', () => {
    const t3 = text(machine3)
    expect(t3).not.toMatch(/\bY\b/)
    expect(t3).not.toMatch(/Dom geçişi/)
    expect(text(machine3, true)).toMatch(/Dom geçişi/)
    expect(firstWindSteps(machine3).length).toBe(9)
    expect(firstWindSteps(machine3, { hasDome: true }).length).toBe(10)
  })

  it('ölçüm/eşik üretmez: gerilim değeri (N) veya sayısal sınır yok, M1 önerilmez', () => {
    const t = text({ ...machine3, axisCount: 4 }, true)
    expect(t).not.toMatch(/\d+(,\d+)?\s*N\b/)
    expect(t).not.toMatch(/\bM0?1\b/)
    // yalnız komut açıları (360°, ±90°) ve M0 geçer
    const nums = t.match(/\d+/g) ?? []
    expect([...new Set(nums)].sort()).toEqual(['0', '360', '90'])
  })
})
