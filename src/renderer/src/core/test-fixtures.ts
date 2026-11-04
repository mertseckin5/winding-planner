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
