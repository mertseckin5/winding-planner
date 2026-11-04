import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { baseInput, machine3 } from './test-fixtures'
import type { MachineConfig, WindingInput } from './types'
import { planWinding } from './winding'

/**
 * Altın çıktı: desen seçimi (j) ve hız limitine göre süre uzatma eklenmeden ÖNCEKİ kodun (2026-11-04, 255 test)
 * ürettiği G-code'un FNV-1a özeti ve uzunluğu. j yok/1 ve hız limiti girilmemişken çıktı bit bit aynı kalmalı
 * (tek bilinçli istisna aşağıda, G94 + dom F düzeltmesi).
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const mixed: WindingInput = {
  ...baseInput,
  layers: [
    { id: 'd', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 },
    { id: 'h', kind: 'hoop', angleDeg: null },
    { id: 'a', kind: 'helical', angleDeg: 30 },
    { id: 'e', kind: 'helical', angleDeg: 20, dome: true, domeHeight: 15 }
  ]
}
const big: WindingInput = { ...baseInput, mandrelDiameter: 180, windLength: 1200, bandWidth: 9, feedRate: 1500, turnDwellMinDeg: 35 }

export const GOLDEN_CASES: { name: string; input: WindingInput; m: MachineConfig }[] = [
  { name: 'base 3e G94 lnx', input: baseInput, m: machine3 },
  { name: 'base 4e G93 mach3', input: baseInput, m: { ...machine3, axisCount: 4, feedMode: 'G93', controller: 'mach3' } },
  { name: 'mixed 3e G94 lnx', input: mixed, m: machine3 },
  { name: 'mixed 4e G93 lnx dur', input: mixed, m: { ...machine3, axisCount: 4, feedMode: 'G93', pauseBetweenLayers: true } },
  { name: 'mixed 4e G94 mach3 ters', input: mixed, m: { ...machine3, axisCount: 4, controller: 'mach3', invert: { carriage: true, mandrel: false, head: true, cross: false } } },
  { name: 'big 3e G93 mach3', input: big, m: { ...machine3, feedMode: 'G93', controller: 'mach3' } }
]

const GOLDEN: Record<string, [string, number]> = {
  'base 3e G94 lnx': ['2b6596b2', 3760],
  'base 4e G93 mach3': ['ad8f6664', 4334],
  // G94 + dom: BİLEREK değişti (2026-11-04). F artık G-code'a yazılan 3 ondalık koordinatlardan türetiliyor;
  // kutup yakınında ΔX ~0,01 mm iken eski F kontrolcünün gördüğü süreyi %10'a kadar saptırıyordu.
  // Koordinat satırları ve uzunluk aynı (eski: a0bb5e10 / a487993b), yalnız bazı F basamakları farklı.
  'mixed 3e G94 lnx': ['37ddbbd3', 184406],
  'mixed 4e G93 lnx dur': ['e503c298', 221249],
  'mixed 4e G94 mach3 ters': ['1ebf599d', 221328],
  'big 3e G93 mach3': ['dc54ea8d', 7893]
}

describe('altın çıktı (j=1, hız limiti yok): önceki sürümle bit bit aynı', () => {
  for (const c of GOLDEN_CASES) {
    it(c.name, () => {
      const g = generateGcode(planWinding(c.input, c.m.axisCount), c.input, c.m)
      const got: [string, number] = [fnv1a(g), g.length]
      expect(got).toEqual(GOLDEN[c.name])
    })
  }
})
