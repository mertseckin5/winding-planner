import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { motionRows, readGcode } from './gcode-reader.testutil'
import { baseInput, machine3, rng } from './test-fixtures'
import type { MachineConfig, WindingInput } from './types'
import { verifyGcode } from './verify'
import { planWinding } from './winding'

/**
 * Kutup yakınında G94 F: dom parçalarında ΔX 0,01 mm mertebesine iner. LinuxCNC kuralında X hareket ediyorsa
 * F yalnız X/Y bileşenine uygulanır; F, G-code'a yazılan (3 ondalık) koordinatlardan türetilmezse kontrolcünün
 * hesapladığı süre parça başına %10'a kadar sapıyordu (2026-11-04'te bulundu ve düzeltildi).
 * Burada her kutup yakını parçanın süresi G-code'dan bağımsız okunup plan süresiyle (elyaf / elyaf hızı) karşılaştırılır.
 */

function cases(): { name: string; input: WindingInput; m: MachineConfig }[] {
  const rand = rng(808)
  const out: { name: string; input: WindingInput; m: MachineConfig }[] = []
  for (let i = 0; i < 10; i++) {
    const D = 20 + rand() * 250
    const alpha = 8 + rand() * 70
    const input: WindingInput = {
      ...baseInput,
      mandrelDiameter: D,
      windLength: 50 + rand() * 800,
      bandWidth: 2 + rand() * 15,
      feedRate: 300 + rand() * 9000,
      layers: [
        { id: 'd', kind: 'helical', angleDeg: alpha, dome: true, domeHeight: 3 + rand() * D },
        { id: 'e', kind: 'helical', angleDeg: 8 + rand() * 70, dome: true, domeHeight: 3 + rand() * D }
      ]
    }
    const m: MachineConfig = { ...machine3, axisCount: i % 2 === 0 ? 3 : 4, controller: 'linuxcnc', feedMode: 'G94' }
    out.push({ name: `D${D.toFixed(0)} α${alpha.toFixed(1)}° ${m.axisCount}e`, input, m })
  }
  return out
}

describe('kutup yakını G94 F: parça süresi planla %1 içinde, F ≥ 5 anlamlı basamak', () => {
  for (const c of cases()) {
    it(c.name, () => {
      const plan = planWinding(c.input, c.m.axisCount)
      const g = generateGcode(plan, c.input, c.m)
      const rows = motionRows(readGcode(g, c.m))
      expect(rows.length).toBe(plan.moves.length)
      const lines = g.split('\n')
      let near = 0
      for (let k = 1; k < rows.length; k++) {
        const mv = plan.moves[k]
        const info = plan.layers[mv.layer]
        const d = info.dome!
        // kutup yakını: yarıçap kutup açıklığına ekvatordan %15'ten daha yakın (dwell hariç, X değişen parçalar)
        if (mv.kind !== 'pass' || mv.radius > d.poleRadius + 0.15 * (info.radius - d.poleRadius)) continue
        const p = rows[k - 1].pos
        const q = rows[k].pos
        const lin = Math.hypot(q.x - p.x, q.y - p.y)
        const rot = Math.hypot(q.a - p.a, q.c - p.c)
        const f = rows[k].f!
        const t = lin > 1e-9 ? lin / f : rot / f
        const tPlan = mv.fiberLength / c.input.feedRate!
        expect(Math.abs(t / tPlan - 1)).toBeLessThan(0.01)
        const digits = lines[rows[k].line - 1].match(/F([\d.]+)/)![1].replace('.', '').replace(/^0+/, '')
        expect(digits.length).toBeGreaterThanOrEqual(5)
        near++
      }
      expect(near).toBeGreaterThan(8)
      const r = verifyGcode(g, c.m, plan)
      expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
      expect(Math.abs(r.planTimeRatio! - 1)).toBeLessThan(1e-3)
    })
  }
})
