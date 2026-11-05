import type { WindingInput, WindingPlan } from './types'

/**
 * REQ-011 öncesi kurala geri indirme (altın çıktı kanıtı için): geçişten hemen önceki düz helisel dwell'inde
 * C = gidiş açısı α (REQ-003 kuralı). 'mirror' planlarda REQ-011 uygulanmadığından değişiklik yok.
 */
export function undoReq011(plan: WindingPlan, input: WindingInput): WindingPlan {
  if (plan.headAngleMode !== 'fiber') return plan
  const moves = plan.moves.map((m, i) => {
    const l = input.layers[m.layer]
    const next = plan.moves[i + 1]
    if (m.kind === 'dwell' && next?.kind === 'transition' && l.kind === 'helical' && !l.dome) return { ...m, c: l.angleDeg! }
    return m
  })
  return { ...plan, moves }
}
