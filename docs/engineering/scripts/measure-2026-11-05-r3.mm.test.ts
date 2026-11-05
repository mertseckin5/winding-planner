/**
 * Makine mühendisi ölçüm betiği, 3. tur (REQ-005…009 kabul). src/ dosyalarını değiştirmez, yalnız çağırır.
 * G-code bağımsız okuyucuyla okunur; ivme sınırları burada ayrıca (verify.ts'ten bağımsız) hesaplanır.
 * Çalıştırma: npx vitest run --config docs/engineering/scripts/vitest.mm.config.ts --reporter=verbose measure-2026-11-05-r3
 */
import { describe, it } from 'vitest'
import { planWinding, missingFields } from '../../../src/renderer/src/core/winding'
import { generateGcode } from '../../../src/renderer/src/core/gcode'
import { verifyGcode } from '../../../src/renderer/src/core/verify'
import { trialPlan } from '../../../src/renderer/src/core/trial'
import { domeGeodesic } from '../../../src/renderer/src/core/dome'
import { readGcode, type Row } from '../../../src/renderer/src/core/gcode-reader.testutil'
import type { MachineConfig, WindingInput, Move } from '../../../src/renderer/src/core/types'

const f = (v: number, n = 2): string => (Number.isFinite(v) ? v.toFixed(n) : String(v))
const RAD = Math.PI / 180

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
const S2: WindingInput = {
  mandrelDiameter: 50, windLength: 400, bandWidth: 6, bandThickness: 0.25, feedRate: 3000, turnDwellMinDeg: 20, standoff: null,
  layers: [{ id: 'l1', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 25 }]
}
// S3: tüm geçiş türleri (düz→dom, dom→dom, dom→hoop, hoop→düz)
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

interface Seg { row: Row; d: Record<'x' | 'a' | 'c' | 'y', number>; T: number; mv: Move }

function segs(g: string, m: MachineConfig, moves: Move[]): Seg[] {
  const rows = readGcode(g, m)
  const g1 = moves.filter((mv) => mv.kind !== 'position')
  const out: Seg[] = []
  let prev = { x: 0, a: 0, c: 0, y: 0 }
  let feed: number | null = null
  for (const r of rows) {
    if (r.f !== null) feed = r.f
    if (r.code === 'G1') {
      const d = { x: r.pos.x - prev.x, a: r.pos.a - prev.a, c: r.pos.c - prev.c, y: m.axisCount === 4 ? r.pos.y - prev.y : 0 }
      const lin = Math.hypot(d.x, d.y)
      const rot = Math.hypot(d.a, d.c)
      const Tm = r.inverse ? 1 / feed! : lin > 1e-9 ? lin / feed! : rot / feed!
      out.push({ row: r, d, T: Tm * 60, mv: g1[out.length] })
    }
    if (r.code === 'G0' || r.code === 'G1') prev = { ...r.pos }
  }
  if (out.length !== g1.length) throw new Error(`G1 sayısı ${out.length} ≠ plan ${g1.length}`)
  return out
}

/** Bağımsız ivme sınırı hesabı (yalnız ardışık G1; ilk/son duruş). C ekseni. */
function myAccel(ss: Seg[], key: 'c' | 'x' | 'a', a: number): { unreach: number; peakDv: number; peakLine: number; bound: number } {
  let unreach = 0, peakDv = 0, peakLine = 0, extra = 0
  const v = (s: Seg | null): number => (s ? s.d[key] / s.T : 0)
  for (let i = 0; i <= ss.length; i++) {
    const p = i > 0 ? ss[i - 1] : null
    const n = i < ss.length ? ss[i] : null
    const dv = Math.abs(v(n) - v(p))
    const minT = Math.min(p?.T ?? Infinity, n?.T ?? Infinity)
    if (dv / a > minT + 1e-12) unreach++
    if (dv > peakDv) { peakDv = dv; peakLine = (n ?? p)!.row.line }
    extra += (Math.abs(v(p)) + Math.abs(v(n))) / (2 * a)
  }
  return { unreach, peakDv, peakLine, bound: ss.reduce((s, x) => s + x.T, 0) + extra }
}

/** Kaymasız yön değişimi için asgari mandrel dönüşü (silindir): θ = |ln tan(ψ2/2) − ln tan(ψ1/2)| / μ (ψ 'fiber' C'si) */
const thetaReq = (psi1: number, psi2: number, mu: number): number =>
  Math.abs(Math.log(Math.tan((psi2 * RAD) / 2)) - Math.log(Math.tan((psi1 * RAD) / 2))) / mu / RAD
const axialReq = (psi1: number, psi2: number, r: number, mu: number): number => {
  // x = (r/μ)|1/sinψ| farkı, 90°'den geçiyorsa iki yarı ayrı (ileri + geri)
  const g = (p: number): number => 1 / Math.sin(p * RAD)
  if ((psi1 - 90) * (psi2 - 90) < 0) return (r / mu) * (g(psi1) - 1 + g(psi2) - 1)
  return (r / mu) * Math.abs(g(psi1) - g(psi2))
}

function transitions(title: string, input: WindingInput, m: MachineConfig, mu = 0.3): string[] {
  const L: string[] = [`\n==== REQ-007 geçişler: ${title} (${m.axisCount} eksen, ${m.feedMode}) ====`]
  const miss = missingFields(input, m)
  if (miss.length) return [...L, `missing: ${miss.join(' | ')}`]
  const plan = planWinding({ ...input, friction: mu }, m)
  const g = generateGcode(plan, input, m)
  const ss = segs(g, m, plan.moves)
  const gl = g.split('\n')
  const ver = verifyGcode(g, m, plan)
  L.push(`doğrulayıcı: ${ver.issues.map((i) => `[${i.level}] ${i.message}`).join(' | ') || 'sorun yok'}`)
  // A azalmaz, G1 sonrası G0 yok
  const rows = readGcode(g, m)
  const i1 = rows.findIndex((r) => r.code === 'G1')
  const g0After = rows.slice(i1).filter((r) => r.code === 'G0').length
  let aDec = 0
  for (let i = 1; i < ss.length; i++) if (ss[i].d.a < -1e-9) aDec++
  L.push(`A azalan G1 ${aDec}, ilk G1 sonrası G0 ${g0After}; C aralığı ${f(Math.min(...ss.map((s) => s.row.pos.c)), 3)}…${f(Math.max(...ss.map((s) => s.row.pos.c)), 3)}`)
  let r0 = input.mandrelDiameter! / 2
  const lt = 2 * input.bandThickness!
  const yOffs: number[] = []
  const radii: number[] = []
  for (let k = 0; k < input.layers.length; k++) {
    radii.push(r0 + lt / 2)
    yOffs.push(r0 + lt + (input.standoff ?? 0) - (r0 + lt / 2))
    r0 += lt
  }
  for (let k = 1; k < input.layers.length; k++) {
    const grp = ss.filter((s) => s.mv.layer === k && s.mv.kind === 'transition')
    const prevLast = ss[ss.indexOf(grp[0]) - 1]
    const next = ss[ss.indexOf(grp[grp.length - 1]) + 1]
    const pl = input.layers[k - 1], nl = input.layers[k]
    L.push(`-- K${k}→K${k + 1} (${pl.kind}${pl.dome ? ' dom' : ''} ${pl.angleDeg ?? 'hoop'} → ${nl.kind}${nl.dome ? ' dom' : ''} ${nl.angleDeg ?? 'hoop'}): ${grp.length} G1, satır ${grp[0].row.line}…${grp[grp.length - 1].row.line}`)
    L.push(`   önceki son G1: X${f(prevLast.row.pos.x, 3)} A${f(prevLast.row.pos.a, 3)} C${f(prevLast.row.pos.c, 3)} Y${f(prevLast.row.pos.y, 3)} (ΔX ${f(prevLast.d.x, 3)})`)
    // parçalara ayır: ΔX = 0 olan gövde hareketi
    const bodyIdx = grp.findIndex((s) => Math.abs(s.d.x) < 1e-6 && Math.abs(s.row.pos.x) < 1e-6)
    const parts = { down: grp.slice(0, bodyIdx), body: grp[bodyIdx], up: grp.slice(bodyIdx + 1) }
    const sgn = (arr: Seg[]): string => [...new Set(arr.map((s) => Math.sign(Math.round(s.d.c * 1e6))))].join(',')
    const cl = (arr: Seg[], c: number, lay: number): number =>
      Math.max(0, ...arr.map((s) => {
        const r = m.axisCount === 4 ? s.row.pos.y - yOffs[lay] : s.mv.radius
        return Math.abs(r * Math.sin(s.row.pos.c * RAD) - c) / c
      }))
    let sumA = 0, sumF = 0
    for (const s of grp) { sumA += s.d.a; sumF += s.mv.fiberLength }
    let expA = 20, expF = 0
    if (parts.down.length) {
      const R = radii[k - 1], c = R * Math.sin(pl.angleDeg! * RAD), dp = domeGeodesic(R, pl.domeHeight!, c)
      expA += dp.theta / RAD; expF += dp.length
      L.push(`   dom inişi ${parts.down.length} G1: C ${f(parts.down[0].row.pos.c - parts.down[0].d.c, 2)}→${f(parts.down[parts.down.length - 1].row.pos.c, 2)}, ΔC işaretleri {${sgn(parts.down)}}, ΔX işaretleri {${[...new Set(parts.down.map((s) => Math.sign(Math.round(s.d.x * 1e6))))].join(',')}}, Clairaut en kötü ${f(cl(parts.down, c, k - 1) * 100, 3)}% (c=${f(c, 3)}), θ_dom ${f(dp.theta / RAD, 3)}°, yol ${f(dp.length, 3)} mm`)
    }
    const b = parts.body
    const c1 = b.row.pos.c - b.d.c, c2 = b.row.pos.c
    // gelen eksenel yön: gövde öncesi hareketin ΔX işareti; giden: gövde sonrası hareketin ΔX işareti
    const before = parts.down.length ? parts.down[parts.down.length - 1] : prevLast
    const after = parts.up.length ? parts.up[0] : next
    const dirIn = Math.sign(Math.round(before.d.x * 1e6)), dirOut = Math.sign(Math.round(after.d.x * 1e6))
    const cross90 = (c1 - 90) * (c2 - 90) < 0
    const bodyR = b.mv.radius
    const segLen = Math.hypot(b.d.x, b.d.y, bodyR * 20 * RAD)
    expF += segLen
    L.push(`   gövde: X${f(b.row.pos.x, 3)} ΔX ${f(b.d.x, 3)} ΔY ${f(b.d.y, 3)} ΔA ${f(b.d.a, 3)} C ${f(c1, 2)}→${f(c2, 2)} (ΔC ${f(b.d.c, 2)}), T ${f(b.T, 3)} s, C ${f(Math.abs(b.d.c) / b.T, 1)} °/s; giriş yönü ${dirIn} çıkış yönü ${dirOut}, 90° geçişi ${cross90} → tutarlı: ${cross90 === (dirIn !== dirOut && dirIn !== 0 && dirOut !== 0)}`)
    L.push(`   gövde kayma (μ ${mu}): gereken θ ${f(thetaReq(c1, c2, mu), 1)}° (x ${f(axialReq(c1, c2, bodyR, mu), 1)} mm) vs ΔA ${f(b.d.a, 1)}°; plan slip.transitionTurnDeg=${plan.layers[k].slip?.transitionTurnDeg ?? 'null'}, θ_t(yeni α)=${plan.layers[k].slip?.turnRotationDeg !== null && plan.layers[k].slip?.turnRotationDeg !== undefined ? f(plan.layers[k].slip!.turnRotationDeg!, 2) : 'null'}`)
    if (parts.up.length) {
      const R = radii[k], c = R * Math.sin(nl.angleDeg! * RAD), dp = domeGeodesic(R, nl.domeHeight!, c)
      expA += dp.theta / RAD; expF += dp.length
      const upNoLast = parts.up.slice(0, -1)
      L.push(`   dom çıkışı ${parts.up.length} G1: C ${f(c2, 2)}→${f(parts.up[parts.up.length - 1].row.pos.c, 2)}, ΔC işaretleri {${sgn(parts.up)}}, Clairaut en kötü (son nokta hariç) ${f(cl(upNoLast, c, k) * 100, 3)}%, son nokta ${f(cl(parts.up.slice(-1), c, k) * 100, 3)}% (c=${f(c, 3)}), θ_dom ${f(dp.theta / RAD, 3)}°`)
      const last = parts.up[parts.up.length - 1], pen = parts.up[parts.up.length - 2]
      L.push(`   dom çıkışı son 2 G1: ${gl[pen.row.line - 1].trim()} | ${gl[last.row.line - 1].trim()} (son parça ΔC ${f(last.d.c, 3)}, T ${f(last.T, 4)} s)`)
    }
    L.push(`   toplam ΔA ${f(sumA, 3)}° beklenen ${f(expA, 3)}° (fark ${f(sumA - expA, 4)}); elyaf ${f(sumF, 3)} beklenen ${f(expF, 3)} (fark %${f(((sumF - expF) / expF) * 100, 4)})`)
    L.push(`   sonraki G1: ${gl[next.row.line - 1].trim()} (tür ${next.mv.kind})`)
  }
  return L
}

describe('MM ölçüm 2026-11-05 tur 3', () => {
  it('REQ-009', () => {
    const out: string[] = ['==== REQ-009 ====']
    const s = { ...S1, standoff: null }
    for (const re of [61.0, 61.3, 61.5, 61.6, null]) {
      const m: MachineConfig = { ...base, eyeRadius: re, travel: T1 }
      const miss = missingFields(s, m)
      const p = miss.length ? null : planWinding(s, m)
      out.push(`Re=${re}: missing=[${miss.join(' | ')}] plan.eyeClearance=${p?.eyeClearance ?? '-'} katman=${p?.layers.map((l) => l.eyeClearance?.toFixed(3) ?? 'null').join(',') ?? '-'} outerD/2=${p ? f(p.outerDiameter / 2, 3) : '-'}`)
    }
    // 4 eksende Re alanı yok sayılmalı
    out.push(`4 eksen + eyeRadius 10: missing=[${missingFields(S1, { ...base, axisCount: 4, eyeRadius: 10, travel: T1 }).join(' | ')}]`)
    console.log(out.join('\n'))
  })

  it('REQ-005', () => {
    const out: string[] = ['==== REQ-005 ====']
    const cases: [string, WindingInput, MachineConfig][] = [
      ['S1 4ex G94', S1, { ...base, axisCount: 4, travel: T1 }],
      ['S1 4ex G93', S1, { ...base, axisCount: 4, feedMode: 'G93', travel: T1 }],
      ['S1 3ex G94', { ...S1, standoff: null }, { ...base, travel: T1 }],
      ['S2 j=1', S2, { ...base, travel: { carriage: { min: -20, max: 420 } } }],
      ['S2 j=3', { ...S2, layers: [{ ...S2.layers[0], patternSkip: 3 }] }, { ...base, travel: { carriage: { min: -20, max: 420 } } }]
    ]
    for (const [t, inp, m0] of cases) {
      const none = verifyGcode(generateGcode(planWinding(inp, m0), inp, m0), m0, planWinding(inp, m0))
      const m: MachineConfig = { ...m0, maxAccel: { carriage: null, mandrel: null, head: 3600, cross: null } }
      const plan = planWinding(inp, m)
      const g = generateGcode(plan, inp, m)
      const gNo = generateGcode(planWinding(inp, m0), inp, m0)
      const v = verifyGcode(g, m, plan)
      const ss = segs(g, m, plan.moves)
      const mine = myAccel(ss, 'c', 3600)
      const ac = v.accel!
      const pk = ac.peak.head!
      // K2→K3 / geçiş olayları
      const trLines = ss.filter((s) => s.mv.kind === 'transition').map((s) => s.row.line)
      const trEv = ac.events.filter((e) => e.axis === 'head' && trLines.includes(e.line))
      const trMax = trEv.reduce((a, e) => (e.deltaV > a.deltaV ? e : a), { deltaV: 0, line: 0 } as { deltaV: number; line: number })
      out.push(`${t}: ivme yok → accel=${none.accel}; G-code ivmeyle aynı: ${g === gNo}`)
      out.push(`   a_C 3600: ulaşılamaz ${ac.unreachable} (benim ${mine.unreach}), ilk satır ${ac.firstUnreachableLine}; tepe Δv ${f(pk.deltaV, 2)} °/s satır ${pk.deltaVLine} (benim ${f(mine.peakDv, 2)} satır ${mine.peakLine}); tepe talep ${f(pk.demand, 0)} °/s² satır ${pk.demandLine}`)
      out.push(`   süre ${f(v.minutes, 3)} dk, üst sınır ${f(ac.boundMinutes, 3)} dk (benim yalnız C ile ${f(mine.bound / 60, 3)}); kısa hareket ${ac.shortMoves}; geçiş satırlarında en büyük C Δv ${f(trMax.deltaV, 2)} satır ${trMax.line}`)
      const trAll = ac.events.filter((e) => e.axis === 'head' && (trLines.includes(e.line) || trLines.includes(e.line - 1)))
      out.push(`   geçiş satırı ve sonrası C olayları: ${trAll.map((e) => `satır ${e.line} Δv ${f(e.deltaV, 2)} minT ${f(e.minT, 3)} ${e.unreachable ? 'ULAŞILAMAZ' : ''}`).join('; ')}`)
      out.push(`   uyarı: ${v.issues.filter((i) => /İvme/.test(i.message)).map((i) => i.message).join(' | ') || 'yok'}`)
    }
    // el hesabı: X 0→100 F6000, a = 1000 → 1,1 s
    const m: MachineConfig = { ...base, maxAccel: { carriage: 1000, mandrel: null, head: null, cross: null } }
    const g = ['G21', 'G90', 'G94', 'G1 X100 F6000', 'M2'].join('\n')
    const v = verifyGcode(g, m)
    out.push(`El hesabı X100 F6000 a1000: süre ${f(v.minutes * 60, 4)} s, üst sınır ${f(v.accel!.boundMinutes * 60, 4)} s (beklenen 1,1)`)
    // tüm eksenlerle S1 4 eksen: hangi eksen ulaşılamaz?
    const m4: MachineConfig = { ...base, axisCount: 4, travel: T1, maxAccel: { carriage: 500, mandrel: 3600, head: 3600, cross: 500 } }
    const p4 = planWinding(S1, m4)
    const v4 = verifyGcode(generateGcode(p4, S1, m4), m4, p4)
    const ac4 = v4.accel!
    const byAx: Record<string, number> = {}
    for (const e of ac4.events) if (e.unreachable) byAx[e.axis] = (byAx[e.axis] ?? 0) + 1
    out.push(`S1 4ex X500 A3600 C3600 Y500 (deneme değerleri, makine değil): ulaşılamaz ${ac4.unreachable} ${JSON.stringify(byAx)}, üst sınır ${f(ac4.boundMinutes, 2)} / ${f(v4.minutes, 2)} dk, tepe ${Object.entries(ac4.peak).map(([k, p]) => `${k} Δv ${f(p!.deltaV, 1)} talep ${f(p!.demand, 0)}`).join('; ')}`)
    console.log(out.join('\n'))
  })

  it('REQ-006', () => {
    const out: string[] = ['==== REQ-006 ====']
    for (const [t, inp, m] of [
      ['S1 4ex', S1, { ...base, axisCount: 4, travel: T1 }],
      ['S2 3ex', S2, { ...base, travel: { carriage: { min: -20, max: 420 } } }]
    ] as [string, WindingInput, MachineConfig][]) {
      for (const mu of [0.3, null]) {
        const p = planWinding({ ...inp, friction: mu }, m)
        out.push(`${t} μ=${mu}:`)
        for (const l of p.layers) out.push(`   K${l.index + 1}: slip=${JSON.stringify(l.slip)}; uyarılar: ${l.warnings.filter((w) => /kay|tutul|pim/.test(w)).join(' || ')}`)
      }
    }
    out.push(`missing μ=0: [${missingFields({ ...S1, friction: 0 }, { ...base, axisCount: 4, travel: T1 }).join(' | ')}]`)
    out.push(`El: θ_t(55)=${f(Math.log(1 / Math.tan(27.5 * RAD)) / 0.3 / RAD, 3)}, x_t(61.25,55)=${f((61.25 / 0.3) * (1 / Math.sin(55 * RAD) - 1), 3)}, θ_t(30)=${f(Math.log(1 / Math.tan(15 * RAD)) / 0.3 / RAD, 3)}, x_t(60,30)=${f((60 / 0.3) * (1), 3)}`)
    out.push(`Tam düz uç dönüşü φ→180−φ (55°): ${f(thetaReq(55, 125, 0.3), 2)}° = 2·θ_t; K2→K3 (90.9→55): ${f(thetaReq(90.9, 55, 0.3), 2)}°`)
    console.log(out.join('\n'))
  })

  it('REQ-007', () => {
    const out: string[] = []
    out.push(...transitions('S1', S1, { ...base, axisCount: 4, travel: T1 }))
    out.push(...transitions('S1', { ...S1, standoff: null }, { ...base, travel: T1 }))
    out.push(...transitions('S3', S3, { ...base, axisCount: 4, feedMode: 'G93', travel: T1 }))
    out.push(...transitions('S3', { ...S3, standoff: null }, { ...base, travel: T1 }))
    // S1 K1→K2 geçiş satırlarını aynen yaz
    const m: MachineConfig = { ...base, axisCount: 4, travel: T1 }
    const plan = planWinding(S1, m)
    const g = generateGcode(plan, S1, m)
    const ss = segs(g, m, plan.moves)
    const grp = ss.filter((s) => s.mv.layer === 1 && s.mv.kind === 'transition')
    const lines = g.split('\n')
    out.push('\nS1 4ex G94 K1→K2 geçiş G-code (önceki 2 satır + grup + sonraki 1):')
    for (let n = grp[0].row.line - 4; n <= grp[grp.length - 1].row.line + 1; n++) out.push(`  ${n}: ${lines[n - 1]}`)
    console.log(out.join('\n'))
  })

  it('REQ-008', () => {
    const out: string[] = ['==== REQ-008 ====']
    const cases: [string, WindingInput, MachineConfig, number, number][] = [
      ['S1 4ex G94 K3 k=1', S1, { ...base, axisCount: 4, travel: T1 }, 2, 1],
      ['S1 4ex G93 K1 dom k=1', S1, { ...base, axisCount: 4, feedMode: 'G93', travel: T1 }, 0, 1],
      ['S1 4ex G94 K2 hoop k=1', S1, { ...base, axisCount: 4, travel: T1 }, 1, 1],
      ['S2 3ex j=3 k=2', { ...S2, layers: [{ ...S2.layers[0], patternSkip: 3 }] }, { ...base, travel: { carriage: { min: -20, max: 420 } } }, 0, 2]
    ]
    for (const [t, inp, m, li, k] of cases) {
      const plan = planWinding(inp, m)
      const full = generateGcode(plan, inp, m)
      const fs = segs(full, m, plan.moves)
      const tp = trialPlan(plan, inp, li, k)
      const g = generateGcode(tp, inp, m, { title: `DENEME: katman ${li + 1} ilk ${k} devre` })
      const v = verifyGcode(g, m, tp)
      const ts = segs(g, m, tp.moves)
      const info = plan.layers[li]
      // tam programdaki aynı hareketler
      const fPass = fs.findIndex((s) => s.mv.layer === li && s.mv.kind === 'pass')
      const fSame = fs.slice(fPass, fPass + ts.length)
      const tFull = fSame.reduce((s, x) => s + x.T, 0)
      const tTrial = ts.reduce((s, x) => s + x.T, 0)
      const dA = ts[ts.length - 1].row.pos.a - (ts[0].row.pos.a - ts[0].d.a)
      const dAfull = fSame[fSame.length - 1].row.pos.a - (fSame[0].row.pos.a - fSame[0].d.a)
      const kinds = ts.map((s) => s.mv.kind[0]).join('')
      // faz: deneme başı A mod 360 = tam program başı A mod 360
      const a0t = ts[0].row.pos.a - ts[0].d.a, a0f = fSame[0].row.pos.a - fSame[0].d.a
      let maxDiff = 0
      ts.forEach((s, i) => {
        const q = fSame[i].row.pos
        maxDiff = Math.max(maxDiff, Math.abs(s.row.pos.x - q.x), Math.abs(s.row.pos.c - q.c), Math.abs(s.row.pos.y - q.y), Math.abs((s.row.pos.a - a0t) - (q.a - a0f)))
      })
      out.push(`\n${t}: devre ${info.circuits}, G1 ${ts.length} (${kinds}), ΔA ${f(dA, 3)} (tam program ${f(dAfull, 3)}), süre ${f(tTrial, 3)} s / tam ${f(tFull, 3)} s (%${f(((tTrial - tFull) / tFull) * 100, 4)}); başlangıç A ${f(a0t, 3)} vs ${f(a0f, 3)} (mod360 ${f(a0t % 360, 3)} / ${f(a0f % 360, 3)}); azami konum farkı ${maxDiff.toExponential(2)}`)
      out.push(`   doğrulayıcı: ${v.issues.map((i) => `[${i.level}] ${i.message}`).join(' | ') || 'sorun yok'}; oran ${v.planTimeRatio?.toFixed(5)}`)
      const ls = g.split('\n')
      const firstG1 = ls.findIndex((s) => /^G1\b/.test(s.trim()))
      out.push('   baş (yorum dışı + MSG/DENEME, ilk G1 dahil):')
      ls.slice(0, firstG1 + 2).forEach((s, i) => {
        const x = s.trim()
        if (x && (!x.startsWith('(') || /MSG|DENEME|Katman/.test(x))) out.push(`     ${i + 1}: ${x}`)
      })
      out.push('   son 5 satır:')
      ls.filter((s) => s.trim()).slice(-5).forEach((s) => out.push(`     ${s.trim()}`))
    }
    // hatalar
    const plan = planWinding(S1, { ...base, axisCount: 4, travel: T1 })
    for (const [li, k] of [[2, 999], [2, 0], [2, 1.5], [1, 2], [7, 1]] as const) {
      try { trialPlan(plan, S1, li, k); out.push(`k=${k} K${li + 1}: hata yok`) } catch (e) { out.push(`k=${k} K${li + 1}: ${(e as Error).message}`) }
    }
    // son devre: k = circuits
    const c3 = plan.layers[2].circuits
    const tp = trialPlan(plan, S1, 2, c3)
    out.push(`K3 k=${c3} (tüm devreler): G1 ${tp.moves.length - 1}, tam katman G1 ${plan.moves.filter((mv) => mv.layer === 2 && mv.kind !== 'transition').length}`)
    console.log(out.join('\n'))
  })
})
