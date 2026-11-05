import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { checkReq011, motionRows, readGcode, stationaryRuns, type Row, type StationaryRun } from './gcode-reader.testutil'
import { undoReq011 } from './plan-undo.testutil'
import { generateSimKit } from './simkit'
import { axialReq, thetaReqDeg } from './slip'
import { GOLDEN_CASES, machine3 } from './test-fixtures'
import { trialPlan, trialWarnings } from './trial'
import type { HeadAngleMode, Layer, MachineConfig, WindingInput, WindingPlan } from './types'
import { verifyGcode } from './verify'
import { missingFields, planWinding } from './winding'

/**
 * Tur 3 kabul testleri (REQ-010, REQ-011, REQ-008 eki, S5). Değerler G-code'dan bağımsız okuyucuyla
 * (gcode-reader.testutil) alınır; kayma integrali burada sayısal (Simpson) hesaplanır, slip.ts'in kapalı
 * formülü tekrarlanmaz. Plan yalnız hareket türü sınıflandırması için kullanılır.
 */

const RAD = Math.PI / 180

const S1: WindingInput = {
  mandrelDiameter: 120,
  windLength: 800,
  bandWidth: 6,
  bandThickness: 0.25,
  feedRate: 3000,
  turnDwellMinDeg: 20,
  standoff: 30,
  layers: [
    { id: 'l1', kind: 'helical', angleDeg: 30, dome: true, domeHeight: 60 },
    { id: 'l2', kind: 'hoop', angleDeg: null },
    { id: 'l3', kind: 'helical', angleDeg: 55 }
  ]
}
/** S3: S1 ölçüleri, tüm geçiş türleri [55° düz, 30° domlu h60, 40° domlu h60, hoop, 55° düz] */
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
const travel = { carriage: { min: -60, max: 860 } }
const m4 = (mode: HeadAngleMode = 'fiber', extra: Partial<MachineConfig> = {}): MachineConfig => ({
  ...machine3,
  axisCount: 4,
  headAngleMode: mode,
  travel,
  ...extra
})
const m3 = (mode: HeadAngleMode = 'fiber', extra: Partial<MachineConfig> = {}): MachineConfig => ({ ...machine3, headAngleMode: mode, travel, ...extra })

/** Kaymasız dönüş ∫ dψ / (μ·sinψ), Simpson (bağımsız sayısal yol), derece */
function thetaNumeric(psi1: number, psi2: number, mu: number): number {
  const a = Math.min(psi1, psi2) * RAD
  const b = Math.max(psi1, psi2) * RAD
  const n = 4000
  const h = (b - a) / n
  let s = 0
  for (let i = 0; i <= n; i++) {
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2
    s += w / Math.sin(a + i * h)
  }
  return ((s * h) / 3 / mu) / RAD
}

interface Run extends StationaryRun {
  layer: number
  transition: boolean
  pole: boolean
}

/** G-code'dan durağan aralıklar; tür/katman plandan (aynı indeks), değerler G-code'dan */
function runs(input: WindingInput, m: MachineConfig): { plan: WindingPlan; g: string; rows: Row[]; list: Run[] } {
  expect(missingFields(input, m)).toEqual([])
  const plan = planWinding(input, m)
  const g = generateGcode(plan, input, m)
  const rows = readGcode(g, m)
  const mr = motionRows(rows)
  expect(mr.length).toBe(plan.moves.length)
  const list = stationaryRuns(rows).map((run) => {
    const idx = run.rows.map((r) => mr.indexOf(r))
    const mv = idx.map((i) => plan.moves[i])
    return {
      ...run,
      layer: mv[mv.length - 1].layer,
      transition: mv.some((x) => x.kind === 'transition'),
      pole: mv.some((x) => x.kind === 'dwell' && !!input.layers[x.layer].dome)
    }
  })
  return { plan, g, rows, list }
}

const transitionRun = (list: Run[], layer: number): Run => {
  const r = list.filter((x) => x.transition && x.layer === layer)
  expect(r.length).toBe(1)
  return r[0]
}

// ---------------------------------------------------------------------------------------------
describe('REQ-010 durağan aralıkta genel kayma kontrolü', () => {
  it('REQ-010 formül: θ_req(30,150) = 503,04; θ_req(55,90) = 124,68 (μ 0,3); sayısal integralle aynı', () => {
    expect(Math.abs(thetaReqDeg(30, 150, 0.3) - 503.04)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(thetaReqDeg(55, 90, 0.3) - 124.68)).toBeLessThanOrEqual(0.05)
    for (const [p1, p2, mu] of [
      [30, 150, 0.3],
      [55, 90, 0.3],
      [125, 150, 0.3],
      [1, 179, 0.05],
      [89.1, 90.9, 0.4],
      [140, 30, 1]
    ]) {
      // Simpson 4000 aralık: uç tekilliğine yakın (1°) göreli 1e-7 mertebesi
      expect(Math.abs(thetaReqDeg(p1, p2, mu) / thetaNumeric(p1, p2, mu) - 1)).toBeLessThan(1e-6)
      expect(thetaReqDeg(p1, p2, mu)).toBeCloseTo(thetaReqDeg(p2, p1, mu), 9)
    }
    // tam düz uç dönüşü = 2θ_t (REQ-006 yarı formülü (1/μ)·ln cot(α/2))
    for (const a of [5, 30, 55, 85]) {
      expect(thetaReqDeg(a, 180 - a, 0.3)).toBeCloseTo((2 * Math.log(1 / Math.tan((a * RAD) / 2))) / 0.3 / RAD, 9)
    }
    // x_req: 90°'den geçmeyen fark; geçen ileri + geri; ψ₂ = 90 için REQ-006 x_t
    expect(axialReq(55, 90, 61.25, 0.3)).toBeCloseTo((61.25 / 0.3) * (1 / Math.sin(55 * RAD) - 1), 9)
    expect(axialReq(55, 125, 61.25, 0.3)).toBeCloseTo(2 * axialReq(55, 90, 61.25, 0.3), 9)
  })

  it('REQ-010 S1 4 eksen (μ 0,3): K1→K2 θ_req 248,5 / x_req 202,5 / ΔA 20 → uyarı; K2→K3 127,7 → uyarı; K3 turnFullDeg 249,37', () => {
    const { plan, list } = runs({ ...S1, friction: 0.3 }, m4())
    const k12 = transitionRun(list, 1)
    const psi = (r: Run): [number, number] => [r.c[0], r.c[r.c.length - 1]]
    // G-code'dan: dom inişi sonu C 30, hoop başı ~89,1
    expect(psi(k12)[0]).toBeCloseTo(30, 3)
    expect(Math.abs(thetaNumeric(...psi(k12), 0.3) - 248.5)).toBeLessThanOrEqual(0.1)
    const l2 = plan.layers[1]
    expect(Math.abs(l2.slip!.transitionRequiredDeg! - 248.5)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(l2.slip!.transitionAxial! - 202.5)).toBeLessThanOrEqual(0.5)
    // x_req bağımsız: r = hoop katman yarıçapı (D/2 + t + 2t), x = (r/μ)|1/sin30 − 1/sinψ₂|
    const rHoop = 60 + 0.25 + 0.5
    expect(l2.slip!.transitionAxial!).toBeCloseTo((rHoop / 0.3) * (1 / Math.sin(30 * RAD) - 1 / Math.sin(psi(k12)[1] * RAD)), 2)
    expect(k12.turn).toBeCloseTo(20, 2)
    expect(l2.slip!.transitionTurnDeg).toBeCloseTo(20, 9)
    expect(l2.warnings.some((w) => /^Katman 1→2 geçişi: x = 0\.0 mm ucunda elyaf yönü 30\.0° → 89\.1° .*≥ 248\.5° dönüş ve ≥ 202\.5 mm eksenel.*ΔA = 20\.0°/.test(w))).toBe(true)

    const k23 = transitionRun(list, 2)
    expect(Math.abs(thetaNumeric(...psi(k23), 0.3) - 127.7)).toBeLessThanOrEqual(0.1)
    const l3 = plan.layers[2]
    expect(Math.abs(l3.slip!.transitionRequiredDeg! - 127.7)).toBeLessThanOrEqual(0.1)
    expect(l3.warnings.some((w) => /^Katman 2→3 geçişi: .*≥ 127\.7° dönüş/.test(w))).toBe(true)

    expect(Math.abs(l3.slip!.turnFullDeg! - 249.37)).toBeLessThanOrEqual(0.05)
    expect(l3.warnings.some((w) => w.includes('≥ 249.4° dönüş (her yarıda 124.7°)'))).toBe(true)
  })

  const s3cases: [string, MachineConfig][] = [
    ['4 eksen G93', m4('fiber', { feedMode: 'G93' })],
    ['3 eksen G94', m3()]
  ]
  for (const [name, m] of s3cases) {
    it(`REQ-010 S3 ${name}: K1→K2 126,8 (125→150, ΔA = K1 dwell + 20), K2→K3 444,5, K3→K4 190,1, K4→K5 127,6`, () => {
      const input = { ...S3, friction: 0.3, standoff: m.axisCount === 4 ? 30 : null }
      const { plan, list } = runs(input, m)
      const exp = [126.8, 444.5, 190.1, 127.6]
      for (let k = 1; k <= 4; k++) {
        const run = transitionRun(list, k)
        const num = thetaNumeric(run.c[0], run.c[run.c.length - 1], 0.3)
        expect(Math.abs(num - exp[k - 1])).toBeLessThanOrEqual(0.2)
        const s = plan.layers[k].slip!
        expect(Math.abs(s.transitionRequiredDeg! - exp[k - 1])).toBeLessThanOrEqual(0.2)
        expect(s.transitionTurnDeg!).toBeCloseTo(run.turn, 2)
        // uyarı ⇔ ΔA < θ_req: K1→K2'de ΔA = 178,4 + 20 > 126,8 → uyarı yok; diğerleri ΔA 20 → uyarı
        expect(plan.layers[k].warnings.some((w) => w.startsWith(`Katman ${k}→${k + 1} geçişi:`))).toBe(k > 1)
        // REQ-011 sonrası tüm aralıklar monoton: "alt sınır" notu yok
        expect(plan.layers[k].warnings.some((w) => /monoton değil/.test(w))).toBe(false)
      }
      const k12 = transitionRun(list, 1)
      expect(k12.c[0]).toBeCloseTo(125, 3)
      expect(k12.c[k12.c.length - 1]).toBeCloseTo(150, 3)
      expect(k12.turn).toBeCloseTo(plan.layers[0].turnDwellDeg + 20, 2)
      expect(k12.rows.length).toBe(2) // K1 son dwell + gövde
    })
  }

  it("REQ-010 'mirror' S3 K1→K2: aralıkta C monoton değil → ΔA ≥ θ_req olsa da uyarı, 'değer alt sınır' notuyla", () => {
    const { plan, list } = runs({ ...S3, friction: 0.3 }, m4('mirror'))
    const run = transitionRun(list, 1)
    // ψ = 180 + C (C < 0): 125 → 55 → 150
    const psi = run.c.map((c) => (c < 0 ? 180 + c : c))
    expect(psi.map((p) => Math.round(p))).toEqual([125, 55, 150])
    expect(plan.layers[1].slip!.transitionRequiredDeg!).toBeCloseTo(thetaNumeric(125, 150, 0.3), 3)
    expect(plan.layers[1].warnings.some((w) => /^Katman 1→2 geçişi: .*\(C bu aralıkta monoton değil, değer alt sınır\)/.test(w))).toBe(true)
  })

  it('REQ-010 G-code okumasıyla her durağan aralık: θ_req (sayısal) ve ΔA plan alanlarıyla aynı; uyarı ⇔ ΔA < θ_req', () => {
    const extra: WindingInput = {
      ...S1,
      layers: [
        { id: 'a', kind: 'helical', angleDeg: 30 },
        { id: 'b', kind: 'helical', angleDeg: 55 },
        { id: 'c', kind: 'hoop', angleDeg: null },
        { id: 'd', kind: 'hoop', angleDeg: null },
        { id: 'e', kind: 'helical', angleDeg: 10 },
        { id: 'f', kind: 'helical', angleDeg: 80, dome: true, domeHeight: 40 },
        { id: 'g', kind: 'helical', angleDeg: 20 }
      ]
    }
    for (const [input, m] of [
      [{ ...S3, friction: 0.3 }, m4()],
      [{ ...extra, friction: 0.35 }, m4('fiber', { feedMode: 'G93' })],
      [{ ...extra, friction: 0.35, standoff: null }, m3('fiber', { controller: 'mach3' })],
      [{ ...extra, friction: 1.5 }, m4('mirror')]
    ] as [WindingInput, MachineConfig][]) {
      const { plan, list } = runs(input, m)
      const mu = input.friction!
      const mode = m.headAngleMode!
      const psi = (c: number): number => (mode === 'mirror' && c < 0 ? 180 + c : c)
      let tr = 0
      let own = 0
      for (const run of list) {
        if (run.pole) continue
        const num = thetaNumeric(psi(run.c[0]), psi(run.c[run.c.length - 1]), mu)
        const info = plan.layers[run.layer]
        if (run.transition) {
          tr++
          expect(info.slip!.transitionRequiredDeg!).toBeCloseTo(num, 1)
          expect(info.slip!.transitionTurnDeg!).toBeCloseTo(run.turn, 2)
          const warned = info.warnings.some((w) => w.startsWith(`Katman ${run.layer}→${run.layer + 1} geçişi:`))
          const p = run.c.map(psi)
          const mono = p.every((v, i) => i === 0 || v >= p[i - 1] - 2e-3) || p.every((v, i) => i === 0 || v <= p[i - 1] + 2e-3)
          if (Math.abs(run.turn - num) > 0.05) expect(warned).toBe(run.turn < num || !mono)
        } else {
          own++
          expect(info.slip!.turnFullDeg!).toBeCloseTo(num, 1)
          if (info.kind === 'hoop' && Math.abs(run.turn - num) > 0.05) {
            expect(info.warnings.some((w) => w.startsWith(`Katman ${run.layer + 1} uç dönüşü:`))).toBe(run.turn < num)
          }
        }
      }
      expect(tr).toBe(input.layers.length - 1)
      expect(own).toBeGreaterThan(0)
    }
  })

  it('REQ-010 μ boş → yeni alanlar null; μ girilince G-code değişmez', () => {
    for (const input of [S1, S3]) {
      const m = m4()
      const none = planWinding(input, m)
      expect(none.layers.every((l) => l.slip === null)).toBe(true)
      const withMu = planWinding({ ...input, friction: 0.3 }, m)
      expect(generateGcode(withMu, input, m)).toBe(generateGcode(none, input, m))
      expect(withMu.layers[0].slip!.transitionRequiredDeg).toBeNull()
      expect(withMu.layers[0].slip!.transitionTurnDeg).toBeNull()
    }
  })

  it('REQ-010 saldırgan: 1°/85° düz + domlu + hoop, μ 1e-6 / 1e6 → sonlu alanlar, metinde NaN/Infinity yok', () => {
    for (const mu of [1e-6, 1e6]) {
      const input: WindingInput = {
        ...S1,
        friction: mu,
        layers: [
          { id: 'a', kind: 'helical', angleDeg: 1 },
          { id: 'b', kind: 'helical', angleDeg: 85 },
          { id: 'c', kind: 'hoop', angleDeg: null },
          { id: 'd', kind: 'helical', angleDeg: 1, dome: true, domeHeight: 30 },
          { id: 'e', kind: 'helical', angleDeg: 85, dome: true, domeHeight: 30 },
          { id: 'f', kind: 'helical', angleDeg: 1 }
        ]
      }
      const plan = planWinding(input, m4())
      for (const l of plan.layers) {
        const s = l.slip!
        for (const v of [s.turnAxial, s.turnRotationDeg, s.turnFullDeg, s.poleRatio, s.transitionTurnDeg, s.transitionRequiredDeg, s.transitionAxial]) {
          if (v !== null) expect(Number.isFinite(v)).toBe(true)
        }
        for (const w of l.warnings) expect(w).not.toMatch(/NaN|Infinity/)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
describe("REQ-011 durağan aralıkta C monoton, 90°'yi yalnız carriage yön değiştirince geçer ('fiber')", () => {
  const flatPairs: Layer[][] = [
    [
      { id: 'a', kind: 'helical', angleDeg: 30 },
      { id: 'b', kind: 'helical', angleDeg: 55 }
    ],
    [
      { id: 'a', kind: 'helical', angleDeg: 55 },
      { id: 'b', kind: 'helical', angleDeg: 30 }
    ],
    [
      { id: 'a', kind: 'helical', angleDeg: 30 },
      { id: 'b', kind: 'hoop', angleDeg: null },
      { id: 'c', kind: 'helical', angleDeg: 20, dome: true, domeHeight: 40 },
      { id: 'd', kind: 'helical', angleDeg: 70 },
      { id: 'e', kind: 'helical', angleDeg: 60, dome: true, domeHeight: 40 }
    ]
  ]
  const cases: [string, WindingInput, MachineConfig][] = [
    ['S1 4e G94', S1, m4()],
    ['S3 4e G93', S3, m4('fiber', { feedMode: 'G93' })],
    ['S3 3e G94', { ...S3, standoff: null }, m3()],
    ['S3 4e C ters Mach3', S3, m4('fiber', { controller: 'mach3', invert: { carriage: true, mandrel: false, head: true, cross: false } })],
    ...flatPairs.map((layers, i): [string, WindingInput, MachineConfig] => [`düz/hoop/dom karışık #${i + 1}`, { ...S1, layers }, m4()])
  ]
  for (const [name, input, m] of cases) {
    it(`REQ-011 ${name}: tüm durağan aralıklarda kural sağlanır (G-code okuması)`, () => {
      const { list } = runs(input, m)
      expect(checkReq011(list)).toBeGreaterThan(input.layers.length - 1)
    })
  }

  it('REQ-011 S3 K1→K2: aralık C 125° → 125° (dwell) → 150° (gövde), gövde |ΔC|/T ≤ 65 °/s', () => {
    const m = m4('fiber', { feedMode: 'G93' })
    const { list } = runs(S3, m)
    const run = transitionRun(list, 1)
    expect(run.c.map((c) => Number(c.toFixed(3)))).toEqual([125, 125, 150])
    const body = run.rows[1]
    const T = 60 / body.f! // G93: F = 1/dk
    expect(Math.abs(run.c[2] - run.c[1]) / T).toBeLessThanOrEqual(65)
  })

  it('REQ-011 altın çıktı: dwell C geri alınınca (REQ-003 kuralı) tur 2 özetleri bit bit; X/A/Y ve süre birebir aynı', () => {
    // golden.test.ts tur 2 özetleri (REQ-011 öncesi). Yalnız düz → domlu geçişi olan 'fiber' örnekler değişti.
    const BEFORE: Record<string, [string, number]> = {
      'mixed 3e G94 lnx': ['ed905760', 186293],
      'mixed 4e G93 lnx dur': ['2d616a0f', 223715]
    }
    const fnv = (s: string): string => {
      let h = 0x811c9dc5
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h.toString(16).padStart(8, '0')
    }
    for (const c of GOLDEN_CASES.filter((x) => BEFORE[x.name])) {
      const plan = planWinding(c.input, c.m)
      const old = generateGcode(undoReq011(plan, c.input), c.input, c.m)
      expect([fnv(old), old.length]).toEqual(BEFORE[c.name])
      const now = readGcode(generateGcode(plan, c.input, c.m), c.m)
      const was = readGcode(old, c.m)
      expect(now.length).toBe(was.length)
      let diffC = 0
      for (let i = 0; i < now.length; i++) {
        expect([now[i].pos.x, now[i].pos.a, now[i].pos.y]).toEqual([was[i].pos.x, was[i].pos.a, was[i].pos.y])
        if (now[i].code === 'G1' && now[i].pos.c !== was[i].pos.c) diffC++
        // G93'te F = 1/süre: süre birebir aynı
        if (c.m.feedMode === 'G93') expect(now[i].f).toBe(was[i].f)
      }
      expect(diffC).toBe(1) // yalnız 30° düz → 20° domlu geçişinden önceki dwell
    }
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-008 ek (S8): ara katman denemesi uyarısı', () => {
  it('REQ-008 S1 K3 k=1: başlıkta ve listede uyarı; boş mandrel elyaf açısı G-code ΔA/ΔX ile aynı; K1 denemesinde uyarı yok', () => {
    const m = m4()
    const plan = planWinding(S1, m)
    const notes = trialWarnings(plan, S1, 2, 4)
    expect(notes.length).toBe(2)
    expect(notes[0]).toMatch(/^Önceki 2 katman sarılı varsayıldı \(temas yarıçapı 61\.25 mm\)\. Boş mandrelde temas yarıçapı 1\.00 mm küçük/)
    expect(notes[1]).toMatch(/A sıfırı önceki sarımla aynı referansta/)
    const tp = trialPlan(plan, S1, 2, 1)
    const g = generateGcode(tp, S1, m, { title: 'DENEME: katman 3 ilk 1 devre', notes })
    const head = g.split('\n').slice(0, 4)
    expect(head[2]).toMatch(/^\(UYARI: Onceki 2 katman sarili varsayildi/)
    expect(g).not.toMatch(/[^\x00-\x7e]/)
    // simge '?' olmamalı (≈ → ~, ° → der)
    expect(head[2]).toMatch(/elyaf acisi ~ [\d.]+der olur/)
    expect(head[2]).not.toMatch(/\?/)
    expect(verifyGcode(g, m, tp).issues.filter((i) => i.level === 'error')).toEqual([])
    // bağımsız: ilk gidiş geçişi G-code'dan ΔX, ΔA; boş mandrel r' = D/2 + t ⇒ tan α' = r'·ΔA/ΔX
    const mr = motionRows(readGcode(g, m))
    const dX = mr[1].pos.x - mr[0].pos.x
    const dA = (mr[1].pos.a - mr[0].pos.a) * RAD
    const alphaEmpty = Math.atan((60.25 * dA) / dX) / RAD
    const shown = Number(/elyaf açısı ≈ ([\d.]+)°/.exec(notes[0])![1])
    expect(Math.abs(shown - alphaEmpty)).toBeLessThanOrEqual(0.01)
    expect(notes[0]).toMatch(/planlanan 55\.00°/)
    expect(notes[0]).toMatch(/kafa boşluğu 1\.00 mm büyür/)
    // 3 eksende boşluk cümlesi yok; K1 denemesi uyarısız
    expect(trialWarnings(planWinding({ ...S1, standoff: null }, m3()), S1, 2, 3)[0]).not.toMatch(/kafa boşluğu/)
    expect(trialWarnings(plan, S1, 0, 4)).toEqual([])
    // notes verilmezse G-code eskisi gibi (UYARI satırı yok)
    expect(generateGcode(tp, S1, m, { title: 'x' })).not.toMatch(/UYARI/)
  })

  it('REQ-008 hoop ara katman (S1 K2): açı hoop formülüyle, sonlu', () => {
    const plan = planWinding(S1, m4())
    const n = trialWarnings(plan, S1, 1, 4)
    const pitch = 800 / Math.ceil(800 / 6)
    const expected = Math.atan((2 * Math.PI * 60.25) / pitch) / RAD
    expect(Number(/elyaf açısı ≈ ([\d.]+)°/.exec(n[0])![1])).toBeCloseTo(expected, 2)
  })
})

// ---------------------------------------------------------------------------------------------
describe('S5 sim kiti STEPGEN_MAXACCEL notu', () => {
  it('S5 README: following error, ~%25, makinede doğrulanmadı; INI oranı uygulamaz (girilen değer aynen)', () => {
    const kit = generateSimKit({ ...m4(), maxAccel: { carriage: 500, mandrel: null, head: null, cross: null } })
    expect(kit.readme).toMatch(/following error/)
    expect(kit.readme).toMatch(/%25/)
    expect(kit.readme).toMatch(/MAKINEDE DOGRULANMADI/)
    expect(kit.readme).toMatch(/UYGULAMAZ/)
    expect(kit.ini).toMatch(/STEPGEN_MAXACCEL = 500\b/)
    expect(kit.readme).not.toMatch(/[^\x00-\x7e]/)
  })
})
