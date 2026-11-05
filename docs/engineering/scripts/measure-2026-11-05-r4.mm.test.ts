/**
 * Makine mühendisi ölçüm betiği, 4. tur (REQ-010, REQ-011, S9–S11). src/ dosyalarını değiştirmez, yalnız çağırır.
 * Durağan aralıklar G-code okumasından burada ayrıca bulunur (slip.ts / stationaryRuns kullanılmaz).
 * Çalıştırma: npx vitest run --config docs/engineering/scripts/vitest.mm.config.ts --reporter=verbose measure-2026-11-05-r4
 */
import { describe, it } from 'vitest'
import { planWinding, missingFields } from '../../../src/renderer/src/core/winding'
import { generateGcode } from '../../../src/renderer/src/core/gcode'
import { trialPlan, trialWarnings } from '../../../src/renderer/src/core/trial'
import { readGcode, type Row } from '../../../src/renderer/src/core/gcode-reader.testutil'
import type { MachineConfig, WindingInput, Move, HeadAngleMode } from '../../../src/renderer/src/core/types'

const f = (v: number, n = 2): string => (Number.isFinite(v) ? v.toFixed(n) : String(v))
const RAD = Math.PI / 180
const MU = 0.3

const base: MachineConfig = {
  controller: 'linuxcnc',
  axisCount: 3,
  names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'Y' },
  invert: { carriage: false, mandrel: false, head: false, cross: false },
  feedMode: 'G94',
  zeroAxesAtStart: true,
  pauseBetweenLayers: false,
  headAngleMode: 'fiber'
}
const T1 = { carriage: { min: -60, max: 860 } }
const S1: WindingInput = {
  mandrelDiameter: 120, windLength: 800, bandWidth: 6, bandThickness: 0.25, feedRate: 3000, turnDwellMinDeg: 20, standoff: 30,
  layers: [
    { id: 'l1', kind: 'helical', angleDeg: 30, dome: true, domeHeight: 60 },
    { id: 'l2', kind: 'hoop', angleDeg: null },
    { id: 'l3', kind: 'helical', angleDeg: 55 }
  ]
}
const S3: WindingInput = {
  ...S1,
  layers: [
    { id: 'a', kind: 'helical', angleDeg: 55 },
    { id: 'b', kind: 'helical', angleDeg: 30, dome: true, domeHeight: 60 },
    { id: 'c', kind: 'helical', angleDeg: 40, dome: true, domeHeight: 60 },
    { id: 'd', kind: 'hoop', angleDeg: null },
    { id: 'e', kind: 'helical', angleDeg: 55 }
  ]
}
// SWE'nin rastgele testte bulduğu türler + kıskacın tüm dalları
const S4: WindingInput = { ...S1, layers: [{ id: 'a', kind: 'helical', angleDeg: 55 }, { id: 'b', kind: 'hoop', angleDeg: null }] }
const S5: WindingInput = { ...S1, layers: [{ id: 'a', kind: 'helical', angleDeg: 30 }, { id: 'b', kind: 'helical', angleDeg: 55 }] }
const S6: WindingInput = { ...S1, layers: [{ id: 'a', kind: 'helical', angleDeg: 55 }, { id: 'b', kind: 'helical', angleDeg: 30 }] }
const S7: WindingInput = { ...S1, layers: [{ id: 'a', kind: 'helical', angleDeg: 30 }, { id: 'b', kind: 'helical', angleDeg: 55, dome: true, domeHeight: 60 }] }
const S8: WindingInput = { ...S1, layers: [{ id: 'a', kind: 'helical', angleDeg: 45 }, { id: 'b', kind: 'helical', angleDeg: 45 }] }

const thetaReq = (p1: number, p2: number): number =>
  Math.abs(Math.log(Math.tan((p2 * RAD) / 2)) - Math.log(Math.tan((p1 * RAD) / 2))) / MU / RAD

interface G1 { row: Row; prev: Row; mv: Move; T: number }

function g1s(g: string, m: MachineConfig, moves: Move[]): G1[] {
  const rows = readGcode(g, m)
  const mvs = moves.filter((mv) => mv.kind !== 'position')
  const out: G1[] = []
  let prev: Row | null = null
  let feed: number | null = null
  for (const r of rows) {
    if (r.f !== null) feed = r.f
    if (r.code === 'G1' && prev) {
      const dx = r.pos.x - prev.pos.x, dy = m.axisCount === 4 ? r.pos.y - prev.pos.y : 0
      const lin = Math.hypot(dx, dy), rot = Math.hypot(r.pos.a - prev.pos.a, r.pos.c - prev.pos.c)
      const Tm = r.inverse ? 1 / feed! : lin > 1e-9 ? lin / feed! : rot / feed!
      out.push({ row: r, prev, mv: mvs[out.length], T: Tm * 60 })
    }
    if (r.code === 'G0' || r.code === 'G1') prev = r
  }
  if (out.length !== mvs.length) throw new Error(`G1 ${out.length} ≠ plan ${mvs.length}`)
  return out
}

function run(title: string, input: WindingInput, m: MachineConfig): string[] {
  const L: string[] = [`\n==== ${title} (${m.axisCount} eksen, ${m.feedMode}, ${m.headAngleMode}) ====`]
  const miss = missingFields(input, m)
  if (miss.length) return [...L, `missing: ${miss.join(' | ')}`]
  const plan = planWinding({ ...input, friction: MU }, m)
  const g = generateGcode(plan, input, m)
  const gNoMu = generateGcode(planWinding(input, m), input, m)
  L.push(`G-code μ'lü = μ'süz: ${g === gNoMu}`)
  const ss = g1s(g, m, plan.moves)
  const mode = m.headAngleMode as HeadAngleMode
  const psi = (c: number): number => (mode === 'mirror' && c < 0 ? 180 + c : c)
  const moving = (s: G1): boolean => Math.abs(s.row.pos.x - s.prev.pos.x) >= 5e-4
  let viol = 0
  let i = 0
  while (i < ss.length) {
    if (moving(ss[i])) { i++; continue }
    const a = i
    while (i < ss.length && !moving(ss[i])) i++
    const b = i - 1
    if (a === 0 || i >= ss.length) continue
    const span = ss.slice(a, b + 1)
    const before = ss[a - 1], after = ss[i]
    const dirIn = Math.sign(before.row.pos.x - before.prev.pos.x), dirOut = Math.sign(after.row.pos.x - after.prev.pos.x)
    const cs = [span[0].prev.pos.c, ...span.map((s) => s.row.pos.c)].map(psi) // REQ-011 ψ uzayında (fiber: ψ = C)
    let up = false, down = false
    for (let k = 1; k < cs.length; k++) { if (cs[k] > cs[k - 1] + 2e-3) up = true; if (cs[k] < cs[k - 1] - 2e-3) down = true }
    const mono = !(up && down)
    const c0 = cs[0], c1 = cs[cs.length - 1]
    const prod = (c0 - 90) * (c1 - 90)
    const ruleOk = mono && (dirIn !== dirOut ? prod <= 1e-3 : prod >= -1e-3)
    if (!ruleOk) viol++
    const kinds = span.map((s) => s.mv.kind).join('+')
    const isPole = span.some((s) => s.mv.kind === 'dwell' && input.layers[s.mv.layer].dome)
    const isTr = span.some((s) => s.mv.kind === 'transition')
    const isHoop = input.layers[span[span.length - 1].mv.layer].kind === 'hoop' && !isTr
    // her aralık türünden ilk örneği ve tüm geçişleri yaz
    const dA = span[span.length - 1].row.pos.a - span[0].prev.pos.a
    const Ttot = span.reduce((s, x) => s + x.T, 0)
    const req = thetaReq(c0, c1)
    const cRates = span.map((s) => f(Math.abs(s.row.pos.c - s.prev.pos.c) / s.T, 1)).join('/')
    const prop = Math.abs(c1 - c0) / Ttot
    const key = isTr ? 'tr' : isPole ? 'pole' : isHoop ? 'hoop' : 'flat'
    const print = isTr || !ruleOk || !printed.has(`${key}${span[span.length - 1].mv.layer}`)
    printed.add(`${key}${span[span.length - 1].mv.layer}`)
    if (print) {
      const lay = span[span.length - 1].mv.layer
      const sl = plan.layers[lay].slip
      L.push(`  [${key}] K${lay + 1} satır ${span[0].row.line}…${span[span.length - 1].row.line} (${kinds}) yön ${dirIn}→${dirOut}; ψ ${cs.map((c) => f(c, 2)).join('→')}; mono ${mono}; kural ${ruleOk ? 'OK' : 'İHLAL'}`)
      L.push(`      ψ ${f(c0, 2)}→${f(c1, 2)}: θ_req ${f(req, 2)}°, ΔA ${f(dA, 2)}° → ${isPole ? 'kutup (REQ-006)' : dA < req || !mono ? 'UYARI beklenir' : 'uyarı yok beklenir'}; T ${f(Ttot, 3)} s, C hızı parça ${cRates} °/s, A ile orantılı dağıtımda ${f(prop, 1)} °/s`)
      if (isTr) L.push(`      plan slip: transitionTurnDeg ${f(sl?.transitionTurnDeg ?? NaN, 2)}, transitionRequiredDeg ${f(sl?.transitionRequiredDeg ?? NaN, 2)}, transitionAxial ${f(sl?.transitionAxial ?? NaN, 1)}`)
      if (isHoop || key === 'flat') L.push(`      plan slip.turnFullDeg ${f(sl?.turnFullDeg ?? NaN, 2)}`)
    }
  }
  L.push(`  REQ-011 ihlal sayısı: ${viol}`)
  for (const li of plan.layers) {
    const w = li.warnings.filter((x) => /geçişi|uç dönüşü:|tutulamaz/.test(x))
    if (w.length) L.push(`  K${li.index + 1} uyarı: ${w.join(' || ')}`)
  }
  return L
}
const printed = new Set<string>()

describe('MM ölçüm 2026-11-05 tur 4', () => {
  it('REQ-010 / REQ-011', () => {
    const out: string[] = []
    const cases: [string, WindingInput][] = [['S1', S1], ['S3', S3], ['S4 düz55→hoop', S4], ['S5 düz30→düz55', S5], ['S6 düz55→düz30', S6], ['S7 düz30→dom55', S7], ['S8 düz45→düz45', S8]]
    for (const [t, inp] of cases) {
      for (const mode of ['fiber', 'mirror'] as const) {
        for (const ax of [4, 3] as const) {
          printed.clear()
          const m: MachineConfig = { ...base, axisCount: ax, headAngleMode: mode, feedMode: ax === 4 ? 'G93' : 'G94', travel: T1 }
          out.push(...run(t, ax === 3 ? { ...inp, standoff: null } : inp, m))
        }
      }
    }
    out.push(`\nEl: θ_req(30,150)=${f(thetaReq(30, 150), 3)} θ_req(55,90)=${f(thetaReq(55, 90), 3)} θ_req(89.1,90.9)=${f(thetaReq(89.1, 90.9), 3)}`)
    console.log(out.join('\n'))
  })

  it('S9 / S11 hesapları', () => {
    const out: string[] = ['==== S9 / S11 ====']
    const m: MachineConfig = { ...base, axisCount: 4, travel: T1 }
    const plan = planWinding(S1, m)
    const k3 = plan.layers[2]
    const r = k3.radius, rE = S1.mandrelDiameter! / 2 + S1.bandThickness!, a = 55 * RAD, L = S1.windLength!, w = S1.bandWidth!
    const dth = L * Math.tan(a) / r / RAD
    const ae = Math.atan((rE / r) * Math.tan(a))
    const n = Math.ceil((2 * Math.PI * r * Math.cos(a)) / w)
    const bwPlan = w / (r * Math.cos(a)) / RAD, bwEmpty = w / (rE * Math.cos(ae)) / RAD
    const Y = 61.5 + 30
    out.push(`K3 r ${f(r, 3)}, boş ${f(rE, 3)}; komut geçiş ΔA ${f(dth, 3)}° (r'den bağımsız komut); eski iddia L·tanα·(1/r'−1/r) = ${f(L * Math.tan(a) * (1 / rE - 1 / r) / RAD, 2)}°`)
    out.push(`  α' boş ${f(ae / RAD, 3)}°; n ${n}, yuva aralığı ${f(360 / n, 3)}°; bant açısal genişliği planlı ${f(bwPlan, 3)}° boş ${f(bwEmpty, 3)}° (fark %${f((bwEmpty / bwPlan - 1) * 100, 2)}); örtüşme planlı ${f(bwPlan - 360 / n, 3)}° boş ${f(bwEmpty - 360 / n, 3)}°`)
    out.push(`  göz açısal ofseti acos(r/Y): planlı ${f(Math.acos(r / Y) / RAD, 3)}° boş ${f(Math.acos(rE / Y) / RAD, 3)}° (sabit fark ${f((Math.acos(rE / Y) - Math.acos(r / Y)) / RAD, 3)}°, birikmez); g planlı ${f(Math.sqrt(Y * Y - r * r) / Math.tan(a), 2)} boş ${f(Math.sqrt(Y * Y - rE * rE) / Math.tan(ae), 2)} mm`)
    const tp = trialPlan(plan, S1, 2, 1)
    const gt = generateGcode(tp, S1, m, { title: 'DENEME', notes: trialWarnings(plan, S1, 2, 4) })
    out.push(`  K3 deneme başlığı UYARI satırları: ${gt.split('\n').filter((s) => /UYARI/.test(s)).join(' | ')}`)
    out.push(`  K1 trialWarnings: ${JSON.stringify(trialWarnings(plan, S1, 0, 4))}`)
    // S11 hoop
    const k2 = plan.layers[1]
    const step = L / Math.ceil(L / w)
    const ah = Math.atan((2 * Math.PI * k2.radius) / step) / RAD
    out.push(`  S11 hoop K2 r ${f(k2.radius, 3)} adım ${f(step, 4)} α_h ${f(ah, 3)}°; θ_req(α_h,180−α_h) ${f(thetaReq(ah, 180 - ah), 3)}°; x_req ${f((k2.radius / MU) * 2 * (1 / Math.sin(ah * RAD) - 1), 4)} mm; plan turnFullDeg ${f(k2.slip?.turnFullDeg ?? NaN, 3)}`)
    // küçük açı yaklaşımı: θ ≈ 2ε/(μ) (ε = 90 − α_h rad)
    const eps = (90 - ah) * RAD
    out.push(`  yaklaşık 2ε/μ = ${f((2 * eps) / MU / RAD, 3)}°`)
    console.log(out.join('\n'))
  })
})
