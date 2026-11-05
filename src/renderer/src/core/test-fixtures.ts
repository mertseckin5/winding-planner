import type { MachineConfig, WindingInput } from './types'

/** Test ortak örnekleri: 3 eksen LinuxCNC G94 makine ve Ø50 × 500 mm, 45° helisel tek katman. */
export const machine3: MachineConfig = {
  controller: 'linuxcnc',
  axisCount: 3,
  names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'Y' },
  invert: { carriage: false, mandrel: false, head: false, cross: false },
  feedMode: 'G94',
  zeroAxesAtStart: true,
  pauseBetweenLayers: false
}

export const baseInput: WindingInput = {
  mandrelDiameter: 50,
  windLength: 500,
  bandWidth: 6,
  bandThickness: 0.15,
  feedRate: 3000,
  turnDwellMinDeg: 20,
  standoff: 30,
  layers: [{ id: 'l1', kind: 'helical', angleDeg: 45 }]
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

/**
 * Altın çıktı örnekleri (golden.test.ts ve REQ-003 fark testi). C sözleşmesi: machine3'te alan yok = eski kayıt
 * (±φ + "seçilmemiş" uyarısı); diğerleri açık seçim.
 */
export const GOLDEN_CASES: { name: string; input: WindingInput; m: MachineConfig }[] = [
  { name: 'base 3e G94 lnx', input: baseInput, m: machine3 },
  { name: 'base 4e G93 mach3', input: baseInput, m: { ...machine3, axisCount: 4, feedMode: 'G93', controller: 'mach3', headAngleMode: 'fiber' } },
  { name: 'mixed 3e G94 lnx', input: mixed, m: { ...machine3, headAngleMode: 'fiber' } },
  { name: 'mixed 4e G93 lnx dur', input: mixed, m: { ...machine3, axisCount: 4, feedMode: 'G93', pauseBetweenLayers: true, headAngleMode: 'fiber' } },
  {
    name: 'mixed 4e G94 mach3 ters',
    input: mixed,
    m: { ...machine3, axisCount: 4, controller: 'mach3', invert: { carriage: true, mandrel: false, head: true, cross: false }, headAngleMode: 'mirror' }
  },
  { name: 'big 3e G93 mach3', input: big, m: { ...machine3, feedMode: 'G93', controller: 'mach3', headAngleMode: 'fiber' } }
]

/** Tekrarlanabilir rastgele sayı üreteci (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
