import { describe, expect, it } from 'vitest'
import { domeGeodesic } from './dome'
import { generateGcode } from './gcode'
import { motionRows, readGcode, type Row } from './gcode-reader.testutil'
import { undoReq011 } from './plan-undo.testutil'
import { parseProject, serializeProject } from './project'
import { generateSimKit } from './simkit'
import { GOLDEN_CASES, machine3 } from './test-fixtures'
import { trialPlan } from './trial'
import type { HeadAngleMode, MachineConfig, Move, WindingInput, WindingPlan } from './types'
import { verifyGcode } from './verify'
import { missingFields, patternCandidates, planWinding } from './winding'

const RAD = Math.PI / 180

/** S1: Ø120×800, bant 6×0,25, 3000 mm/dk, uç 20°, boşluk 30, 30° domlu (h 60) + hoop + 55° düz */
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
/** S2: Ø50×400, 45° domlu (h 25), 3 eksen */
const S2: WindingInput = {
  mandrelDiameter: 50,
  windLength: 400,
  bandWidth: 6,
  bandThickness: 0.25,
  feedRate: 3000,
  turnDwellMinDeg: 20,
  standoff: null,
  layers: [{ id: 'l1', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 25 }]
}
const S2j3: WindingInput = (() => {
  const c = patternCandidates(S2, 0, 3).find((x) => x.j > 1)!
  return { ...S2, layers: [{ ...S2.layers[0], patternSkip: c.j }] }
})()
const S1travel = { carriage: { min: -60, max: 860 } }
const m4 = (mode: HeadAngleMode = 'fiber', extra: Partial<MachineConfig> = {}): MachineConfig => ({
  ...machine3,
  axisCount: 4,
  headAngleMode: mode,
  travel: S1travel,
  ...extra
})
const m3 = (mode: HeadAngleMode = 'fiber', extra: Partial<MachineConfig> = {}): MachineConfig => ({
  ...machine3,
  headAngleMode: mode,
  travel: { carriage: { min: -20, max: 420 } },
  ...extra
})
const accel = (v: Partial<NonNullable<MachineConfig['maxAccel']>>): MachineConfig['maxAccel'] => ({
  carriage: null,
  mandrel: null,
  head: null,
  cross: null,
  ...v
})

function gen(input: WindingInput, m: MachineConfig): { plan: WindingPlan; g: string; rows: Row[] } {
  expect(missingFields(input, m)).toEqual([])
  const plan = planWinding(input, m)
  const g = generateGcode(plan, input, m)
  expect(g).not.toMatch(/NaN|Infinity|undefined/)
  return { plan, g, rows: readGcode(g, m) }
}

/** G-code satırından LinuxCNC kuralıyla G1 süresi (s); önceki hareket satırının konumuna göre */
function rowSeconds(r: Row, p: Row, feed: number): number {
  const lin = Math.hypot(r.pos.x - p.pos.x, r.pos.y - p.pos.y)
  const rot = Math.hypot(r.pos.a - p.pos.a, r.pos.c - p.pos.c)
  return (r.inverse ? 1 / feed : (lin > 1e-9 ? lin : rot) / feed) * 60
}

/** motionRows ile satırlar, her satırın süresi (s; G0 için 0) */
function timedRows(rows: Row[]): { row: Row; T: number }[] {
  const mr = motionRows(rows)
  let feed = 0
  return mr.map((r, k) => {
    if (r.f !== null) feed = r.f
    return { row: r, T: k === 0 || r.code !== 'G1' ? 0 : rowSeconds(r, mr[k - 1], feed) }
  })
}

/**
 * Makine mühendisi gereksinimleri tur 2: REQ-005…009 (docs/engineering/requirements.md) kabul ölçütleri.
 * Değerler üretilen G-code'un bağımsız okuyucuyla (gcode-reader.testutil) geri okunmasıyla veya MM'nin
 * el hesabıyla (requirements.md'deki sayılar) karşılaştırılır.
 */

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * REQ-007 öncesi geçiş kuralına geri indirme: her geçiş grubu (ardışık 'transition' hareketleri) tek harekete
 * (hedefe doğrusal, ΔA = asgari uç dönüşü, boy hypot(ΔX, ΔY, r_hedef·δmin)) indirgenir, sonraki A'lar kaydırılır.
 */
function collapseTransitions(plan: WindingPlan, dwellMinDeg: number): WindingPlan {
  const out: Move[] = []
  let shift = 0
  for (let i = 0; i < plan.moves.length; i++) {
    const m = plan.moves[i]
    if (m.kind !== 'transition') {
      out.push({ ...m, a: m.a - shift })
      continue
    }
    let j = i
    while (plan.moves[j + 1]?.kind === 'transition') j++
    const prev = out[out.length - 1]
    const target = plan.moves[j]
    const a = prev.a + dwellMinDeg
    shift = target.a - a
    out.push({ ...target, a, fiberLength: Math.hypot(target.x - prev.x, target.y - prev.y, target.radius * (dwellMinDeg * Math.PI / 180)) })
    i = j
  }
  const total = out.reduce((s, m) => s + m.fiberLength, 0)
  return { ...plan, moves: out, totalFiberLength: total, totalMinutes: total / plan.feedRate }
}

describe('REQ-007 altın çıktı farkı', () => {
  /** golden.test.ts'teki önceki (REQ-007 öncesi) özetler */
  const BEFORE: Record<string, [string, number]> = {
    'mixed 3e G94 lnx': ['e6a4dec5', 184389],
    'mixed 4e G93 lnx dur': ['1a50ddd3', 221429],
    'mixed 4e G94 mach3 ters': ['d8c647fb', 221725]
  }
  for (const c of GOLDEN_CASES.filter((g) => BEFORE[g.name])) {
    it(`REQ-007 ${c.name}: geçişler eski tek-hareket kuralına indirilince eski altın özet birebir çıkar`, () => {
      // REQ-011 (tur 3) dwell C kıstırması da geri alınır (yalnız 'fiber')
      const plan = collapseTransitions(undoReq011(planWinding(c.input, c.m), c.input), c.input.turnDwellMinDeg!)
      const g = generateGcode(plan, c.input, c.m)
      expect([fnv1a(g), g.length]).toEqual(BEFORE[c.name])
    })
  }
})

// ---------------------------------------------------------------------------------------------
describe('REQ-009 3 eksende göz yarıçapı parçanın dış yarıçapıyla karşılaştırılır', () => {
  // S1 dış yarıçap el hesabı: 120/2 + 3 katman × 2 × 0,25 = 61,5 mm
  const R_OUT = 61.5
  const m = (eyeRadius: number | null | undefined): MachineConfig => m3('fiber', { travel: S1travel, eyeRadius })

  it('REQ-009 S1 3 eksen: Re = 61,3 → hata (R_dış 61,5); Re = 61,5 → hata (eşitlik çarpışma)', () => {
    for (const re of [61.3, 61.5]) {
      const miss = missingFields(S1, m(re))
      expect(miss).toContain(`Göz yarıçapı Re=${re} mm parçanın dış yarıçapından (61.50 mm) büyük olmalı: kafa son katmanda sargıya değer`)
    }
  })

  it('REQ-009 S1 3 eksen: Re = 61,6 → hata yok, gösterilen göz boşluğu 0,10 ±0,001 mm', () => {
    const { plan } = gen(S1, m(61.6))
    expect(Math.abs(plan.eyeClearance! - 0.1)).toBeLessThanOrEqual(0.001)
    expect(plan.outerDiameter / 2).toBeCloseTo(R_OUT, 12)
    // katman başına: Re − katman dış yüzeyi (60,5 / 61 / 61,5)
    const per = plan.layers.map((l) => l.eyeClearance!)
    expect(per.map((v) => Number(v.toFixed(6)))).toEqual([1.1, 0.6, 0.1])
  })

  it('REQ-009 Re boş → kontrol yok, boşluk null; 4 eksende değişiklik yok (Re girilmiş olsa bile)', () => {
    for (const re of [null, undefined]) {
      expect(missingFields(S1, m(re))).toEqual([])
      const p = planWinding(S1, m(re))
      expect(p.eyeClearance).toBeNull()
      expect(p.layers.every((l) => l.eyeClearance === null)).toBe(true)
    }
    const p4 = gen(S1, m4('fiber', { eyeRadius: 10 })).plan
    expect(p4.eyeClearance).toBeNull()
    expect(p4.layers.every((l) => l.eyeClearance === null)).toBe(true)
  })

  it('REQ-009 REQ-004 mesajı (Re katman yolu içinde) önceliklidir, ikisi birden yazılmaz', () => {
    const miss = missingFields(S1, m(60.6))
    expect(miss.filter((s) => /Göz yarıçapı/.test(s)).length).toBe(1)
    expect(miss.some((s) => /katman 2 yarıçapından/.test(s))).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-005 eksen ivme limiti ve doğrulayıcı ivme kontrolü', () => {
  it('REQ-005 el hesabı: X 0→100 mm F6000 (100 mm/s), a = 1000 → süre üst sınırı 1 + 2·(100/2000) = 1,1 s', () => {
    const m: MachineConfig = { ...machine3, maxAccel: accel({ carriage: 1000 }) }
    const r = verifyGcode('G21 G90 G94\nG1 X100 F6000\nM2\n', m)
    expect(Math.abs((r.accel!.boundMinutes * 60) / 1.1 - 1)).toBeLessThan(0.001)
    expect(r.minutes * 60).toBeCloseTo(1, 9)
    expect(r.accel!.unreachable).toBe(0)
    expect(r.accel!.peak.carriage!.deltaV).toBeCloseTo(100, 9)
    expect(r.accel!.peak.carriage!.demand).toBeCloseTo(100, 9) // 100 mm/s / 1 s
    expect(r.accel!.shortMoves).toBe(0)
    // a = 10: rampa 10 s > 1 s → iki sınır (başlangıç ve bitiş) ulaşılamaz; v²/2a = 500 > 100 → kısa hareket
    const slow = verifyGcode('G21 G90 G94\nG1 X100 F6000\nM2\n', { ...m, maxAccel: accel({ carriage: 10 }) })
    expect(slow.accel!.unreachable).toBe(2)
    expect(slow.accel!.firstUnreachableLine).toBe(2)
    expect(slow.accel!.shortMoves).toBe(1)
    expect(slow.issues.some((i) => i.level === 'warning' && /İvme: 2 hareket sınırında/.test(i.message))).toBe(true)
  })

  it('REQ-005 M0 iki yanı duruş sayılır; tam durma varsayımı Δv = 0 sınırda da süre ekler', () => {
    const m: MachineConfig = { ...machine3, maxAccel: accel({ carriage: 1000 }) }
    const withStop = verifyGcode('G21 G90 G94\nG1 X100 F6000\nM0\nG1 X200 F6000\nM2\n', m)
    expect(withStop.accel!.boundMinutes * 60).toBeCloseTo(2.2, 9) // 2 s + 4 × 0,05 s
    expect(withStop.accel!.events.length).toBe(4)
    // M0 yok: ortadaki sınırda Δv = 0 (olay değil) ama üst sınır yine (100 + 100)/2000 = 0,1 s ekler
    const noStop = verifyGcode('G21 G90 G94\nG1 X100 F6000\nG1 X200 F6000\nM2\n', m)
    expect(noStop.accel!.boundMinutes * 60).toBeCloseTo(2.2, 9)
    expect(noStop.accel!.events.length).toBe(2)
  })

  it('REQ-005 S1 fiber, a_C = 3600: K2→K3 geçiş satırı C için raporda, |Δv| ≥ 83 °/s (G-code okumasıyla aynı)', () => {
    const m = m4('fiber', { maxAccel: accel({ head: 3600 }) })
    const { plan, g, rows } = gen(S1, m)
    const r = verifyGcode(g, m, plan)
    const tr = timedRows(rows)
    // K3'ün ilk G1'i = K2→K3 geçişi (plan sınıflandırması; değerler G-code'dan)
    const k = plan.moves.findIndex((mv) => mv.layer === 2)
    expect(plan.moves[k].kind).toBe('transition')
    const row = tr[k].row
    const vC = Math.abs(row.pos.c - tr[k - 1].row.pos.c) / tr[k].T
    expect(vC).toBeGreaterThanOrEqual(83)
    const ev = r.accel!.events.filter((e) => e.axis === 'head' && e.line === row.line)
    expect(ev.length).toBe(1)
    expect(ev[0].deltaV).toBeGreaterThanOrEqual(83)
    expect(Math.abs(ev[0].deltaV - vC)).toBeLessThan(1e-6) // önceki hoop geçişinde C sabit (v_C = 0)
    expect(r.accel!.peak.head!.demand).toBeGreaterThanOrEqual(ev[0].demand)
    // ivme yalnız C'de girildi: diğer eksenlerde rapor yok
    expect(Object.keys(r.accel!.peak)).toEqual(['head'])
  })

  it('REQ-005 S2 j=3, a_C = 3600: ≥ 38 ulaşılamaz geçiş (kutup dwell çevresi); fiber C tepe |Δv| ≤ 200 °/s, mirror > 1000', () => {
    expect(S2j3.layers[0].patternSkip).toBe(3)
    const mf = m3('fiber', { maxAccel: accel({ head: 3600 }) })
    const { plan, g } = gen(S2j3, mf)
    const r = verifyGcode(g, mf, plan)
    expect(r.accel!.unreachable).toBeGreaterThanOrEqual(38)
    expect(r.accel!.peak.head!.deltaV).toBeLessThanOrEqual(200)
    expect(r.accel!.firstUnreachableLine).not.toBeNull()
    const mm = m3('mirror', { maxAccel: accel({ head: 3600 }) })
    const gm = gen(S2j3, mm)
    expect(verifyGcode(gm.g, mm, gm.plan).accel!.peak.head!.deltaV).toBeGreaterThan(1000)
  })

  it('REQ-005 S1 tüm ivmeler boş: rapor null; ivme G-code\'u değiştirmez (altın özetler aynı kalır)', () => {
    for (const ma of [undefined, accel({})]) {
      const m = m4('fiber', { maxAccel: ma })
      const { plan, g } = gen(S1, m)
      expect(verifyGcode(g, m, plan).accel).toBeNull()
      const withAcc = m4('fiber', { maxAccel: accel({ carriage: 500, mandrel: 3600, head: 3600, cross: 500 }) })
      expect(generateGcode(planWinding(S1, withAcc), S1, withAcc)).toBe(g)
    }
    // 3 eksende Y ivmesi girilse de etkin değil
    const r3 = verifyGcode(gen(S2, m3()).g, m3('fiber', { maxAccel: accel({ cross: 100 }) }))
    expect(r3.accel).toBeNull()
  })

  it('REQ-005 saldırgan: aşırı küçük ivme (1e-6) ve büyük (1e7) sonlu rapor üretir', () => {
    for (const a of [1e-6, 1e7]) {
      const m = m4('fiber', { feedMode: 'G93', maxAccel: accel({ carriage: a, mandrel: a, head: a, cross: a }) })
      const { plan, g } = gen(S1, m)
      const r = verifyGcode(g, m, plan).accel!
      expect(Number.isFinite(r.boundMinutes)).toBe(true)
      for (const p of Object.values(r.peak)) expect([p!.demand, p!.deltaV].every(Number.isFinite)).toBe(true)
    }
  })

  it('REQ-005 sim kiti: girilen ivme MAX_ACCELERATION ve STEPGEN_MAXACCEL olur; girilmeyen deneme değeri kalır', () => {
    const kit = generateSimKit(m4('fiber', { maxAccel: accel({ carriage: 500, head: 7200 }) }))
    const section = (name: string): string => kit.ini.split(/\n(?=\[)/).find((s) => s.startsWith(`[${name}]`))!
    expect(section('AXIS_X')).toMatch(/MAX_ACCELERATION = 500\b/)
    expect(section('JOINT_0')).toMatch(/MAX_ACCELERATION = 500\b/)
    expect(section('JOINT_0')).toMatch(/STEPGEN_MAXACCEL = 500\b/)
    expect(section('AXIS_C')).toMatch(/MAX_ACCELERATION = 7200\b/)
    expect(section('AXIS_A')).toMatch(/MAX_ACCELERATION = 3600\b/) // deneme değeri
    expect(kit.ini.match(/STEPGEN_MAXACCEL/g)!.length).toBe(2)
    expect(kit.readme).not.toMatch(/- X ivme/)
    expect(kit.readme).not.toMatch(/- C ivme/)
    expect(kit.readme).toMatch(/- A ivme: simulasyon deneme degeri/)
    expect(kit.readme).toMatch(/- Y ivme: simulasyon deneme degeri/)
  })

  it('REQ-005 proje dosyası: maxAccel gidip gelir, geçersiz değer alan yoluyla reddedilir, yoksa yok kalır', () => {
    const m = m4('fiber', { maxAccel: accel({ carriage: 500, head: 3600 }) })
    const r = parseProject(serializeProject(S1, m))
    expect(r.ok && r.machine.maxAccel).toEqual(accel({ carriage: 500, head: 3600 }))
    const none = parseProject(serializeProject(S1, m4()))
    expect(none.ok && 'maxAccel' in none.machine).toBe(false)
    const file = JSON.parse(serializeProject(S1, m))
    for (const bad of [0, -1, 'x', true]) {
      const bf = parseProject(JSON.stringify({ ...file, machine: { ...file.machine, maxAccel: { ...file.machine.maxAccel, head: bad } } }))
      expect(bf.ok).toBe(false)
      expect(!bf.ok && bf.error).toMatch(/machine\.maxAccel\.head/)
    }
    expect(parseProject(serializeProject(S1, m).replace('"head": 3600', '"head": 1e999')).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-006 uç dönüşü kayma kontrolü (μ)', () => {
  const flat = (D: number, alpha: number, mu: number | null): WindingInput => ({
    ...S1,
    mandrelDiameter: D,
    friction: mu,
    layers: [{ id: 'a', kind: 'helical', angleDeg: alpha }]
  })

  it('REQ-006 formül: (r 61,25, 55°, μ 0,3) → x_t 45,07, θ_t 124,68; (60, 30°, 0,3) → 200,00 mm, 251,52°', () => {
    // r = katman yol yarıçapı: S1 katman 3 (61,25) ve tek katman D = 119,5 (59,75 + 0,25 = 60)
    const s1 = planWinding({ ...S1, friction: 0.3 }, m4()).layers[2]
    expect(s1.radius).toBeCloseTo(61.25, 12)
    expect(Math.abs(s1.slip!.turnAxial! - 45.07)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(s1.slip!.turnRotationDeg! - 124.68)).toBeLessThanOrEqual(0.05)
    const l = planWinding(flat(119.5, 30, 0.3), m4()).layers[0]
    expect(l.radius).toBeCloseTo(60, 12)
    expect(Math.abs(l.slip!.turnAxial! - 200)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(l.slip!.turnRotationDeg! - 251.52)).toBeLessThanOrEqual(0.05)
    // REQ-010 ile metin düzeltildi: tam uç dönüşü 2θ_t (her yarıda θ_t), x_t uç taşması
    expect(l.warnings.some((w) => w.startsWith('Uç dönüşü sürtünmeyle tutulamaz (gereken ≥ 503.0° dönüş (her yarıda 251.5°), ≥ 200.0 mm uç taşması, μ=0.3;'))).toBe(true)
  })

  it('REQ-006 → REQ-010 S1 K2→K3 (55°, μ 0,3): geçişte G-code ΔA = 20° < θ_req 127,7° (iki yarı) → geçiş uyarısı', () => {
    const m = m4()
    const input = { ...S1, friction: 0.3 }
    const { plan, rows } = gen(input, m)
    const mr = motionRows(rows)
    const k = plan.moves.findIndex((mv) => mv.layer === 2)
    expect(mr[k].pos.x - mr[k - 1].pos.x).toBe(0) // düz uç (ΔX = 0)
    expect(mr[k].pos.a - mr[k - 1].pos.a).toBeCloseTo(20, 2)
    const l3 = plan.layers[2]
    expect(l3.slip!.transitionTurnDeg).toBeCloseTo(20, 9)
    expect(l3.warnings.some((w) => /^Katman 2→3 geçişi: .*≥ 127\.7° dönüş.*ΔA = 20\.0°/.test(w))).toBe(true)
    // asgari uç dönüşü θ_req'ten büyükse geçiş uyarısı yok (katmanın kendi uç uyarısı kalır)
    const big = planWinding({ ...input, turnDwellMinDeg: 130 }, m).layers[2]
    expect(big.warnings.some((w) => /^Katman 2→3 geçişi/.test(w))).toBe(false)
    expect(big.warnings.some((w) => /Uç dönüşü sürtünmeyle tutulamaz/.test(w))).toBe(true)
  })

  it('REQ-006 dom kutbu k_g/k_n: S1 katman 1 = 1,739, S2 = 1,010 (±0,001); oran > μ ise uyarı', () => {
    const s1 = planWinding({ ...S1, friction: 0.3 }, m4()).layers[0]
    expect(Math.abs(s1.slip!.poleRatio! - 1.739)).toBeLessThanOrEqual(0.001)
    expect(s1.slip!.turnAxial).toBeNull()
    expect(
      s1.warnings.some((w) => w.startsWith(`Kutupta ${s1.turnDwellDeg.toFixed(1)}° dwell kutup parçası desteği olmadan kayar (k_g/k_n = 1.739, μ = 0.3)`))
    ).toBe(true)
    const s2 = planWinding({ ...S2, friction: 0.3 }, m3()).layers[0]
    expect(Math.abs(s2.slip!.poleRatio! - 1.01)).toBeLessThanOrEqual(0.001)
    // μ = 1,2 > 1,01 → S2'de kayma uyarısı yok, S1'de (1,739) var
    expect(planWinding({ ...S2, friction: 1.2 }, m3()).layers[0].warnings.some((w) => /kayar/.test(w))).toBe(false)
    expect(planWinding({ ...S1, friction: 1.2 }, m4()).layers[0].warnings.some((w) => /kayar/.test(w))).toBe(true)
  })

  it('REQ-006 μ boş → sayısal alanlar null, yalnız düz katmanda metin uyarısı', () => {
    for (const friction of [null, undefined]) {
      const p = planWinding({ ...S1, friction }, m4())
      expect(p.layers.every((l) => l.slip === null)).toBe(true)
      const txt = (i: number): boolean => p.layers[i].warnings.some((w) => /Düz uç dönüşü yalnız pim halkası\/uç tutucuyla güvenilir/.test(w))
      expect([txt(0), txt(1), txt(2)]).toEqual([false, false, true])
      expect(p.layers.some((l) => l.warnings.some((w) => /sürtünmeyle tutulamaz|kayar/.test(w)))).toBe(false)
    }
  })

  it('REQ-006 μ geçersiz (0, negatif, NaN, Infinity) → eksik alan; proje dosyası doğrular', () => {
    for (const bad of [0, -0.3, NaN, Infinity]) expect(missingFields({ ...S1, friction: bad }, m4())).toContain('Sürtünme katsayısı μ (> 0)')
    expect(missingFields({ ...S1, friction: 0.35 }, m4())).toEqual([])
    const r = parseProject(serializeProject({ ...S1, friction: 0.35 }, m4()))
    expect(r.ok && r.input.friction).toBe(0.35)
    const none = parseProject(serializeProject(S1, m4()))
    expect(none.ok && 'friction' in none.input).toBe(false)
    const file = JSON.parse(serializeProject({ ...S1, friction: 0.35 }, m4()))
    for (const bad of [0, -1, '0.3']) {
      const b = parseProject(JSON.stringify({ ...file, input: { ...file.input, friction: bad } }))
      expect(!b.ok && b.error).toMatch(/input\.friction/)
    }
  })

  it('REQ-006 saldırgan: 1° ve 85° düz, μ 1e-6 / 1e6 → sonlu değerler', () => {
    for (const alpha of [1, 85]) {
      for (const mu of [1e-6, 1e6]) {
        const l = planWinding(flat(120, alpha, mu), m4()).layers[0]
        expect([l.slip!.turnAxial!, l.slip!.turnRotationDeg!].every(Number.isFinite)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-007 dom ↔ gövde katman geçişi dom geodeziğini izler', () => {
  /** Plan sınıflandırmasıyla G-code satırları; yalnız tür/katman plandan, değerler G-code'dan */
  function classified(input: WindingInput, m: MachineConfig): { plan: WindingPlan; tr: { row: Row; T: number }[] } {
    const { plan, rows } = gen(input, m)
    const tr = timedRows(rows)
    expect(tr.length).toBe(plan.moves.length)
    return { plan, tr }
  }
  /** Katman k'nin geçiş satır indisleri (plan.moves ile aynı indis) */
  const transitionIdx = (plan: WindingPlan, layer: number): number[] =>
    plan.moves.flatMap((mv, i) => (mv.kind === 'transition' && mv.layer === layer ? [i] : []))
  /** G-code'dan katmanın kendi dom dönüşü: katman başından ilk X = 0 satırına (sol dom gidiş) ΔA */
  const ownDomeTurn = (plan: WindingPlan, tr: { row: Row }[], layer: number): number => {
    const firstPass = plan.moves.findIndex((mv) => mv.layer === layer && mv.kind === 'pass')
    const k = tr.findIndex((t, i) => i >= firstPass && Math.abs(t.row.pos.x) < 5e-4)
    return tr[k].row.pos.a - tr[firstPass - 1].row.pos.a
  }

  for (const feedMode of ['G93', 'G94'] as const) {
    it(`REQ-007 S1 4 eksen ${feedMode}: K1→K2 dom kısmında r·sin(C) = c₁ (±%0,5), ΔA = θ_dom + 20° (±0,01°), elyaf boyu = dom + gövde (±%0,1)`, () => {
      const m = m4('fiber', { feedMode })
      const { plan, tr } = classified(S1, m)
      const idx = transitionIdx(plan, 1)
      expect(idx.length).toBe(25) // 24 dom parçası + gövde
      const t = S1.bandThickness!
      const c1 = (60 + t) * Math.sin(30 * RAD) // 30,125 mm
      for (const i of idx.slice(0, -1)) {
        const r = tr[i].row.pos.y - (S1.standoff! + t)
        expect(Math.abs(r * Math.sin(tr[i].row.pos.c * RAD) - c1)).toBeLessThanOrEqual(0.005 * c1)
      }
      // dom kısmı ekvatorda (X = 0) biter, gövde kısmında ΔX = 0
      expect(tr[idx[23]].row.pos.x).toBe(0)
      expect(tr[idx[24]].row.pos.x).toBe(0)
      const prev = tr[idx[0] - 1].row
      const last = tr[idx[24]].row
      const thetaDom = ownDomeTurn(plan, tr, 0)
      expect(thetaDom).toBeGreaterThan(30)
      expect(Math.abs(last.pos.a - prev.pos.a - (thetaDom + 20))).toBeLessThanOrEqual(0.01)
      // elyaf boyu G-code süresinden (hız limiti yok: süre × elyaf hızı), dom yol boyu dome.ts geodeziğinden
      const fiber = idx.reduce((s, i) => s + (tr[i].T / 60) * S1.feedRate!, 0)
      const domeLen = domeGeodesic(60 + t, 60, c1).length
      const dy = last.pos.y - tr[idx[23]].row.pos.y
      const bodyLen = Math.hypot(dy, (60 + 3 * t) * 20 * RAD)
      expect(Math.abs(fiber / (domeLen + bodyLen) - 1)).toBeLessThanOrEqual(0.001)
      expect(verifyGcode(generateGcode(plan, S1, m), m, plan).issues.filter((i) => i.level === 'error')).toEqual([])
    })
  }

  /** gövde → domlu: mixed (45° domlu h40, hoop, 30°, 20° domlu h15) ve dom → dom */
  const mixed: WindingInput = {
    ...S1,
    mandrelDiameter: 50,
    windLength: 500,
    bandThickness: 0.15,
    layers: [
      { id: 'd', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40 },
      { id: 'h', kind: 'hoop', angleDeg: null },
      { id: 'a', kind: 'helical', angleDeg: 30 },
      { id: 'e', kind: 'helical', angleDeg: 20, dome: true, domeHeight: 15 },
      { id: 'f', kind: 'helical', angleDeg: 60, dome: true, domeHeight: 15 }
    ]
  }
  const mixedTravel = { carriage: { min: -40, max: 540 } }

  for (const axisCount of [3, 4] as const) {
    it(`REQ-007 ${axisCount} eksen: gövde→dom ve dom→dom geçişleri; fiber C ∈ [0,180], dom kısımlarında ΔC işareti sabit, A azalmaz`, () => {
      const m = axisCount === 4 ? m4('fiber', { travel: mixedTravel }) : m3('fiber', { travel: mixedTravel })
      const { plan, tr } = classified(mixed, m)
      const t = mixed.bandThickness!
      for (let layer = 1; layer < mixed.layers.length; layer++) {
        const idx = transitionIdx(plan, layer)
        const prevDomed = !!mixed.layers[layer - 1].dome
        const domed = !!mixed.layers[layer].dome
        expect(idx.length).toBe((prevDomed ? 24 : 0) + 1 + (domed ? 24 : 0))
        for (const i of idx) {
          expect(tr[i].row.pos.c).toBeGreaterThanOrEqual(0)
          expect(tr[i].row.pos.c).toBeLessThanOrEqual(180)
          expect(tr[i].row.pos.a).toBeGreaterThanOrEqual(tr[i - 1].row.pos.a)
        }
        const parts = [prevDomed ? idx.slice(0, 24) : [], domed ? idx.slice(-24) : []]
        for (const part of parts) {
          const signs = part.map((i) => Math.sign(tr[i].row.pos.c - tr[i - 1].row.pos.c)).filter((s) => s !== 0)
          expect(new Set(signs).size).toBeLessThanOrEqual(1)
        }
        // gövde kısmı: ΔX = 0, ΔA = 20°
        const b = idx[prevDomed ? 24 : 0]
        expect(tr[b].row.pos.x).toBe(0)
        expect(tr[b].row.pos.x - tr[b - 1].row.pos.x).toBe(0)
        expect(tr[b].row.pos.a - tr[b - 1].row.pos.a).toBeCloseTo(20, 2)
        // toplam ΔA = [θ_dom(önceki)] + 20° + [θ_dom(yeni)], dom dönüşleri G-code'daki kendi geçişlerinden
        const expected = (prevDomed ? ownDomeTurn(plan, tr, layer - 1) : 0) + 20 + (domed ? ownDomeTurn(plan, tr, layer) : 0)
        expect(Math.abs(tr[idx[idx.length - 1]].row.pos.a - tr[idx[0] - 1].row.pos.a - expected)).toBeLessThanOrEqual(0.01)
        if (domed) {
          // çıkış kutupta, katman başında biter: X = −h·cosα, C = 90
          const end = tr[idx[idx.length - 1]].row.pos
          const l = mixed.layers[layer]
          expect(end.x).toBeCloseTo(-l.domeHeight! * Math.cos(l.angleDeg! * RAD), 2)
          expect(end.c).toBe(90)
          if (axisCount === 4) {
            const c = plan.layers[layer].dome!.poleRadius
            for (const i of idx.slice(-24)) {
              const r = tr[i].row.pos.y - (mixed.standoff! + t)
              expect(Math.abs(r * Math.sin(tr[i].row.pos.c * RAD) - c)).toBeLessThanOrEqual(0.005 * c)
            }
          }
        }
      }
      expect(verifyGcode(generateGcode(plan, mixed, m), m, plan).issues.filter((i) => i.level === 'error')).toEqual([])
    })
  }

  it('REQ-007 mirror: geçiş dom kısmında |C| = φ (Clairaut korunur), doğrulayıcı temiz', () => {
    const m = m4('mirror', { travel: mixedTravel })
    const { plan, tr } = classified(mixed, m)
    const t = mixed.bandThickness!
    for (const layer of [1, 3, 4]) {
      const idx = transitionIdx(plan, layer)
      const prevC = plan.layers[layer - 1].dome?.poleRadius
      const c = plan.layers[layer].dome?.poleRadius
      for (const i of idx.filter((_, n) => n < idx.length - 1)) {
        const r = tr[i].row.pos.y - (mixed.standoff! + t)
        const sinC = Math.abs(Math.sin(tr[i].row.pos.c * RAD))
        const ok = [prevC, c].some((cc) => cc !== undefined && Math.abs(r * sinC - cc) <= 0.005 * cc)
        // gövde satırı (ΔX = 0) hedefin açısını taşır; dom satırlarından biri olmalı
        if (Math.abs(tr[i].row.pos.x - tr[i - 1].row.pos.x) > 0) expect(ok).toBe(true)
      }
    }
    expect(verifyGcode(generateGcode(plan, mixed, m), m, plan).issues.filter((i) => i.level === 'error')).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-008 ilk k devre deneme programı', () => {
  function trial(input: WindingInput, m: MachineConfig, layer: number, k: number): { full: ReturnType<typeof gen>; plan: WindingPlan; g: string; rows: Row[] } {
    const full = gen(input, m)
    const plan = trialPlan(full.plan, input, layer, k)
    const g = generateGcode(plan, input, m, { title: `DENEME: katman ${layer + 1} ilk ${k} devre` })
    expect(g).not.toMatch(/NaN|Infinity|undefined/)
    return { full, plan, g, rows: readGcode(g, m) }
  }

  for (const feedMode of ['G94', 'G93'] as const) {
    it(`REQ-008 S1 katman 3, k = 1 (${feedMode}): doğrulayıcı temiz, 4 G1, son A = başlangıç + θc, süre tam programdaki devreyle aynı`, () => {
      const m = m4('fiber', { feedMode })
      const { full, plan, g, rows } = trial(S1, m, 2, 1)
      expect(verifyGcode(g, m, plan).issues.filter((i) => i.level === 'error')).toEqual([])
      const g1 = rows.filter((r) => r.code === 'G1')
      expect(g1.length).toBe(4)
      // θc = 2πN + 2π·j/n el hesabı: n = ceil(2π·61,25·cos55°/6) = 37, geçiş dönüşü 800·tan55°/61,25 = 1068,76°,
      // en küçük N: 360N + 360/37 ≥ 2·1068,76 + 2·20 → N = 7 → θc = 2520 + 9,7297 = 2529,7297°
      const startA = motionRows(rows)[0].pos.a
      expect(Math.abs(g1[3].pos.a - startA - 2529.7297)).toBeLessThanOrEqual(0.01)
      // başlangıç fazı tam programla aynı (A, 360°'nin katı kadar kaydırıldı)
      const tf = timedRows(full.rows)
      const k0 = full.plan.moves.findIndex((mv) => mv.layer === 2 && mv.kind === 'pass')
      const fullStart = tf[k0 - 1].row.pos.a
      expect(startA).toBeGreaterThanOrEqual(0)
      expect(startA).toBeLessThan(360)
      expect(Math.abs((((fullStart - startA) % 360) + 360) % 360)).toBeLessThan(0.002)
      // süre: tam programdaki aynı 4 G1 (G-code okumasıyla)
      const fullT = tf.slice(k0, k0 + 4).reduce((s, x) => s + x.T, 0)
      const trialT = timedRows(rows).reduce((s, x) => s + x.T, 0)
      expect(Math.abs(trialT / fullT - 1)).toBeLessThanOrEqual(0.001)
      // başlık, REQ-001 başlangıcı (Y geri, X/A/C, Y; elyaf bağla M0), bitiş G94 + M2
      const lines = g.split('\n')
      expect(lines[1]).toBe('(DENEME: katman 3 ilk 1 devre)')
      const firstG1 = lines.findIndex((l) => l.startsWith('G1'))
      expect(lines.slice(0, firstG1).filter((l) => l.startsWith('G0')).length).toBe(3)
      expect(lines.slice(0, firstG1).filter((l) => l === 'M0').length).toBe(1)
      expect(lines.slice(-4)).toEqual(['(Bitis)', 'G94', 'M2', ''])
    })
  }

  it('REQ-008 k > devre sayısı → hata; k geçersiz → hata; hoop k = 1 (gidiş-dönüş, 3 G1)', () => {
    const m = m4()
    const { plan } = gen(S1, m)
    expect(() => trialPlan(plan, S1, 2, 38)).toThrow(/katman 3'de 37 devre var, k=38 fazla/)
    for (const k of [0, -1, 1.5, NaN]) expect(() => trialPlan(plan, S1, 2, k)).toThrow(/k 1 veya daha büyük tam sayı/)
    expect(() => trialPlan(plan, S1, 5, 1)).toThrow(/katman 6 yok/)
    expect(() => trialPlan(plan, S1, 1, 2)).toThrow(/1 devre var/)
    const hoop = trial(S1, m, 1, 1)
    expect(hoop.rows.filter((r) => r.code === 'G1').length).toBe(3)
    expect(verifyGcode(hoop.g, m, hoop.plan).issues.filter((i) => i.level === 'error')).toEqual([])
    // tam katman = tüm devreler: son A tam programdaki katman sonu ile aynı faz
    const all = trial(S1, m, 2, 37)
    expect(all.rows.filter((r) => r.code === 'G1').length).toBe(4 * 37)
  })

  it('REQ-008 domlu katman (S2, 3 eksen) k = 2 ve katman arası duraklama açıkken tek M0; Mach3 M30', () => {
    const m = m3('fiber', { pauseBetweenLayers: true, controller: 'mach3', feedMode: 'G93' })
    const input: WindingInput = { ...S2, layers: [{ id: 'h', kind: 'hoop', angleDeg: null }, S2.layers[0]] }
    const { plan, g, rows } = trial(input, m, 1, 2)
    expect(verifyGcode(g, m, plan).issues.filter((i) => i.level === 'error')).toEqual([])
    // devre = 2 × (2·24 + 1) geçiş + 2 dwell = 100 G1
    expect(rows.filter((r) => r.code === 'G1').length).toBe(200)
    expect(rows.filter((r) => r.code === 'M0').length).toBe(1)
    expect(motionRows(rows)[0].pos.x).toBeCloseTo(-25.25 * 0 - 25 * Math.cos(45 * RAD), 2)
    expect(g.trimEnd().endsWith('M30')).toBe(true)
  })
})
