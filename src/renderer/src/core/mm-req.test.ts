import { describe, expect, it } from 'vitest'
import { controllerChecklist } from './checklist'
import { firstWindSteps } from './firstWind'
import { generateGcode } from './gcode'
import { motionRows, readGcode, type Row } from './gcode-reader.testutil'
import { parseProject, serializeProject } from './project'
import { GOLDEN_CASES, machine3 } from './test-fixtures'
import type { HeadAngleMode, Layer, MachineConfig, WindingInput, WindingPlan } from './types'
import { verifyGcode } from './verify'
import { DOME_TRAVEL_FIELD, missingFields, patternCandidates, planWinding } from './winding'

/**
 * Makine mühendisi gereksinimleri REQ-001…004 (docs/engineering/requirements.md) kabul ölçütleri.
 * Değerler üretilen G-code'un bağımsız okuyucuyla (gcode-reader.testutil) geri okunmasıyla veya MM'nin
 * el hesabıyla (requirements.md'deki sayılar) karşılaştırılır.
 */

const RAD = Math.PI / 180
const tokens = (line: string): string[] => line.replace(/\([^)]*\)/g, '').trim().split(/\s+/)
const letters = (line: string): string[] => tokens(line).filter((t) => !/^G\d/.test(t)).map((t) => t[0])

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

function gen(input: WindingInput, m: MachineConfig): { plan: WindingPlan; g: string; rows: Row[] } {
  expect(missingFields(input, m)).toEqual([])
  const plan = planWinding(input, m)
  const g = generateGcode(plan, input, m)
  expect(g).not.toMatch(/NaN|Infinity|undefined/)
  return { plan, g, rows: readGcode(g, m) }
}

// ---------------------------------------------------------------------------------------------
describe('REQ-001 ilk konumlama: Y referansı, geri çekilmiş yaklaşım, elyaf bağlama M0', () => {
  it('REQ-001 4 eksen, zeroAxesAtStart: G92 satırı var ve Y içermez; 3 eksende G92 X A C (değişmedi)', () => {
    const g4 = gen(S1, m4()).g.split('\n').filter((l) => l.startsWith('G92'))
    expect(g4).toEqual(['G92 X0 A0 C0'])
    const named = m4('fiber', { names: { carriage: 'Z', mandrel: 'B', head: 'W', cross: 'V' } })
    expect(gen(S1, named).g.split('\n').filter((l) => l.startsWith('G92'))).toEqual(['G92 Z0 B0 W0'])
    expect(gen(S2, m3()).g.split('\n').filter((l) => l.startsWith('G92'))).toEqual(['G92 X0 A0 C0'])
    // sıfırlama kapalıyken G92 hiç yok
    expect(gen(S1, m4('fiber', { zeroAxesAtStart: false })).g).not.toMatch(/^G92/m)
  })

  const cases4: [string, WindingInput, MachineConfig][] = [
    ['S1 G93', S1, m4('fiber', { feedMode: 'G93' })],
    ['S1 G94 mirror', S1, m4('mirror')],
    ['S1 Y ters, Mach3', S1, m4('fiber', { controller: 'mach3', invert: { carriage: true, mandrel: false, head: true, cross: true } })],
    ['tek düz katman (Y sabit)', { ...S1, layers: [S1.layers[2]] }, m4()]
  ]
  for (const [name, input, m] of cases4) {
    it(`REQ-001 4 eksen ${name}: ilk G1 öncesi yalnız-Y G0, Y'siz G0, yalnız-Y G0; ilk Y = programın azami Y'si`, () => {
      const { g, rows } = gen(input, m)
      const lines = g.split('\n')
      const firstG1 = lines.findIndex((l) => l.startsWith('G1'))
      const before = lines.slice(0, firstG1).filter((l) => /^G[01]\b/.test(l))
      expect(before.length).toBe(3)
      expect(before.every((l) => l.startsWith('G0 '))).toBe(true)
      expect(letters(before[0])).toEqual(['Y'])
      expect(letters(before[1]).sort()).toEqual(['A', 'C', 'X'])
      expect(letters(before[2])).toEqual(['Y'])
      const motion = rows.filter((r) => r.code === 'G0' || r.code === 'G1')
      const maxY = Math.max(...motion.map((r) => r.pos.y))
      expect(Math.abs(motion[0].pos.y - maxY)).toBeLessThanOrEqual(0.001)
      // ikinci satırda Y hâlâ geri çekilmiş; üçüncüde başlangıç Y'si = ilk G1'in başladığı Y
      expect(motion[1].pos.y).toBe(motion[0].pos.y)
      // doğrulayıcı: G92 Y'ye dokunmadığından Y mantıksal aralığı programdakiyle aynı (mutlak)
      const v = verifyGcode(g, m, planWinding(input, m))
      expect(v.issues.filter((i) => i.level === 'error')).toEqual([])
      expect(v.range.cross.max).toBeCloseTo(maxY, 3)
    })
  }

  for (const axisCount of [3, 4] as const) {
    for (const controller of ['linuxcnc', 'mach3'] as const) {
      for (const pause of [false, true]) {
        it(`REQ-001 ${axisCount} eksen ${controller} duraklama=${pause}: ilk G1'den önce tam bir M0, sonra A geri gitmez`, () => {
          const m = axisCount === 4 ? m4('fiber', { controller, pauseBetweenLayers: pause }) : m3('fiber', { controller, pauseBetweenLayers: pause })
          const input = axisCount === 4 ? S1 : { ...S2, layers: [...S2.layers, { id: 'h', kind: 'hoop' as const, angleDeg: null }] }
          const { g, rows } = gen(input, m)
          const lines = g.split('\n')
          const firstG1 = lines.findIndex((l) => l.startsWith('G1'))
          const m0Before = lines.slice(0, firstG1).filter((l) => l === 'M0')
          expect(m0Before.length).toBe(1)
          const m0Line = lines.indexOf('M0')
          // M0 son konumlama G0'ından sonra
          expect(m0Line).toBeGreaterThan(lines.slice(0, firstG1).map((l) => l.startsWith('G0')).lastIndexOf(true))
          if (controller === 'linuxcnc') expect(lines[m0Line - 1]).toBe('(MSG,Elyafi bagla, devam icin Cycle Start)')
          else expect(lines[m0Line - 1]).not.toMatch(/MSG/)
          // toplam M0 = katman sınırı (duraklama açıksa) + 1
          expect(rows.filter((r) => r.code === 'M0').length).toBe((pause ? input.layers.length - 1 : 0) + 1)
          const m0Row = rows.find((r) => r.code === 'M0')!
          for (const r of rows.filter((x) => x.line > m0Row.line && (x.code === 'G0' || x.code === 'G1'))) {
            expect(r.code).toBe('G1')
            expect(r.pos.a).toBeGreaterThanOrEqual(m0Row.pos.a - 1e-3)
          }
        })
      }
    }
  }

  it('REQ-001 firstWindSteps ve controllerChecklist 4 eksende Y referans maddesini içerir, 3 eksende içermez', () => {
    for (const controller of ['linuxcnc', 'mach3'] as const) {
      const m = m4('fiber', { controller, names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'V' } })
      expect(controllerChecklist(m).some((s) => /V sıfırı mandrel ekseni.*mandrel ekseninden ölçülen D mm uzaktayken V göstergesi D okuyor/.test(s))).toBe(true)
      const fw = firstWindSteps(m).flatMap((s) => s.items)
      expect(fw.some((s) => /V sıfırı mandrel ekseni.*D mm uzaktayken V göstergesi D okuyor/.test(s))).toBe(true)
      const m3c = m3('fiber', { controller })
      expect(controllerChecklist(m3c).some((s) => /sıfırı mandrel ekseni/.test(s))).toBe(false)
      expect(firstWindSteps(m3c).flatMap((s) => s.items).some((s) => /sıfırı mandrel ekseni/.test(s))).toBe(false)
    }
    // başlıktaki AYAR KONTROL satırı da (ASCII)
    expect(gen(S1, m4()).g).toMatch(/\(AYAR KONTROL: Y sifiri mandrel ekseni/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-002 domlu katmanda X strok sınırları zorunlu', () => {
  const base3: MachineConfig = { ...machine3, headAngleMode: 'fiber' }

  it('REQ-002 S2 + strok yok → missingFields maddeyi içerir, yalnız alt ya da yalnız üst de yetmez', () => {
    expect(missingFields(S2, base3)).toContain(DOME_TRAVEL_FIELD)
    expect(missingFields(S2, { ...base3, travel: {} })).toContain(DOME_TRAVEL_FIELD)
    expect(missingFields(S2, { ...base3, travel: { carriage: { min: -10, max: null } } })).toContain(DOME_TRAVEL_FIELD)
    expect(missingFields(S2, { ...base3, travel: { carriage: { min: null, max: 500 } } })).toContain(DOME_TRAVEL_FIELD)
    // yalnız Y stroku girilmiş olması yetmez
    expect(missingFields(S2, { ...base3, axisCount: 4, travel: { cross: { min: 0, max: 100 } } })).toContain(DOME_TRAVEL_FIELD)
    expect(DOME_TRAVEL_FIELD).toBe('X strok sınırları (domlu katman X\'i −h·cosα\'ya götürüyor)')
  })

  it('REQ-002 strok {−10, 500} → doğrulayıcı "alt strok limitini aşıyor" (−17,68 < −10)', () => {
    const m = { ...base3, travel: { carriage: { min: -10, max: 500 } } }
    const { plan, g } = gen(S2, m)
    const errs = verifyGcode(g, m, plan).issues.filter((i) => i.level === 'error').map((i) => i.message)
    expect(errs).toEqual(['X ekseni alt strok limitini aşıyor: -17.68 < -10'])
  })

  it('REQ-002 strok {−20, 420} → strok hatası yok', () => {
    const m = { ...base3, travel: { carriage: { min: -20, max: 420 } } }
    const { plan, g } = gen(S2, m)
    const v = verifyGcode(g, m, plan)
    expect(v.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(v.range.carriage.min).toBeCloseTo(-17.678, 2)
    expect(v.range.carriage.max).toBeCloseTo(417.678, 2)
  })

  it('REQ-002 domsuz S1 varyantı (hoop + 55°) strok boşken G-code üretilir', () => {
    const input: WindingInput = { ...S1, layers: [S1.layers[1], S1.layers[2]] }
    const m = { ...m4(), travel: undefined }
    expect(missingFields(input, m)).toEqual([])
    const { plan, g } = gen(input, m)
    expect(verifyGcode(g, m, plan).issues.filter((i) => i.level === 'error')).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-003 C bükülmesiz sözleşme (fiber): dönüşte 180° − φ, kutupta 90° sabit', () => {
  const j3 = (() => {
    const c = patternCandidates(S2, 0, 3).find((x) => x.j > 1)!
    return { ...S2, layers: [{ ...S2.layers[0], patternSkip: c.j }] }
  })()
  const allCases: [string, WindingInput, MachineConfig][] = [
    ['S1 4e G94', S1, m4()],
    ['S1 4e G93 C ters', S1, m4('fiber', { feedMode: 'G93', invert: { carriage: false, mandrel: false, head: true, cross: false } })],
    ['S2 j=1 3e G94', S2, m3()],
    ['S2 j=3 3e G94', j3, m3()],
    ['hoop + 10° + 80° 3e Mach3', { ...S1, layers: [S1.layers[1], { id: 'a', kind: 'helical', angleDeg: 10 }, { id: 'b', kind: 'helical', angleDeg: 80 }] }, m3('fiber', { controller: 'mach3', feedMode: 'G93' })],
    ['1° ve 85° domlu 4e', { ...S1, layers: [{ id: 'a', kind: 'helical', angleDeg: 1, dome: true, domeHeight: 30 }, { id: 'b', kind: 'helical', angleDeg: 85, dome: true, domeHeight: 30 }] }, m4()]
  ]

  /** G-code satırları ile plan hareketleri birebir (motionRows); yalnız sınıflandırma plandan, değerler G-code'dan */
  function classified(input: WindingInput, m: MachineConfig): { plan: WindingPlan; rows: Row[] } {
    const { plan, rows } = gen(input, m)
    const mr = motionRows(rows)
    expect(mr.length).toBe(plan.moves.length)
    return { plan, rows: mr }
  }

  for (const [name, input, m] of allCases) {
    it(`REQ-003 ${name}: tüm G1'lerde 0 ≤ C ≤ 180`, () => {
      const { rows } = classified(input, m)
      const g1 = rows.filter((r) => r.code === 'G1')
      expect(g1.length).toBeGreaterThan(0)
      for (const r of g1) {
        expect(r.pos.c).toBeGreaterThanOrEqual(0)
        expect(r.pos.c).toBeLessThanOrEqual(180)
      }
    })

    it(`REQ-003 ${name}: kutup dwell'inde |ΔC| ≤ 0,001°; düz/hoop dwell'de ΔC = ±(180° − 2α) ±0,01°`, () => {
      const { plan, rows } = classified(input, m)
      const L = input.windLength!
      let checked = 0
      for (let k = 1; k < rows.length; k++) {
        const mv = plan.moves[k]
        if (mv.kind !== 'dwell') continue
        const dC = rows[k].pos.c - rows[k - 1].pos.c
        const layer = input.layers[mv.layer]
        if (layer.kind === 'helical' && layer.dome) {
          expect(Math.abs(dC)).toBeLessThanOrEqual(0.001)
        } else if (plan.moves[k + 1]?.kind === 'transition') {
          // REQ-011 istisnası: düz katmanın son dwell'i geçiş gövde kısmıyla tek durağan aralıktır; C orada
          // [dwell başı, gövde sonu] arasında monoton (mm-req3.test.ts REQ-011). Burada yalnız aralık kontrolü.
          const lo = Math.min(rows[k - 1].pos.c, rows[k + 1].pos.c)
          const hi = Math.max(rows[k - 1].pos.c, rows[k + 1].pos.c)
          expect(rows[k].pos.c).toBeGreaterThanOrEqual(lo - 1e-3)
          expect(rows[k].pos.c).toBeLessThanOrEqual(hi + 1e-3)
        } else {
          // α girdiden: helisel açı; hoop atan(2πr / adım), r = D/2 + t + 2t·katman, adım = L / ceil(L/w)
          const t = input.bandThickness!
          const r = input.mandrelDiameter! / 2 + t + 2 * t * mv.layer
          const alpha = layer.kind === 'helical' ? layer.angleDeg! : Math.atan((2 * Math.PI * r) / (L / Math.ceil(L / input.bandWidth!))) / RAD
          const sign = Math.abs(rows[k].pos.x - L) < 1e-3 ? 1 : -1
          if (sign === -1) expect(Math.abs(rows[k].pos.x)).toBeLessThan(1e-3)
          expect(Math.abs(dC - sign * (180 - 2 * alpha))).toBeLessThanOrEqual(0.01)
        }
        checked++
      }
      expect(checked).toBeGreaterThan(0)
    })
  }

  it('REQ-003 S1 4 eksen: domlu geçişlerde Clairaut r·sin(C) = c (±%0,5), r = Y − (boşluk + t), gidiş ve dönüş', () => {
    const { plan, rows } = classified(S1, m4())
    const t = S1.bandThickness!
    const R = S1.mandrelDiameter! / 2 + t
    const c = R * Math.sin(30 * RAD)
    let fwd = 0
    let back = 0
    for (let k = 1; k < rows.length; k++) {
      if (plan.moves[k].kind !== 'pass' || plan.moves[k].layer !== 0) continue
      const r = rows[k].pos.y - (S1.standoff! + t)
      expect(Math.abs(r * Math.sin(rows[k].pos.c * RAD) - c)).toBeLessThanOrEqual(0.005 * c)
      if (rows[k].pos.c > 90) back++
      else fwd++
    }
    expect(fwd).toBeGreaterThan(100)
    expect(back).toBeGreaterThan(100)
  })

  /** LinuxCNC kuralıyla G1 süresi ve tepe |ΔC|/T (°/s), G-code'dan */
  function peakC(rows: Row[]): number {
    let peak = 0
    let feed = 0
    for (let k = 1; k < rows.length; k++) {
      const r = rows[k]
      if (r.f !== null) feed = r.f
      if (r.code !== 'G1') continue
      const p = rows[k - 1].pos
      const lin = Math.hypot(r.pos.x - p.x, r.pos.y - p.y)
      const rot = Math.hypot(r.pos.a - p.a, r.pos.c - p.c)
      const T = (r.inverse ? 1 / feed : (lin > 1e-9 ? lin : rot) / feed) * 60
      peak = Math.max(peak, Math.abs(r.pos.c - p.c) / T)
    }
    return peak
  }

  it('REQ-003 S2 j=3 (3 eksen G94): G-code okumasından tepe C hızı ≤ 200 °/s (eski ±φ: > 1000 °/s)', () => {
    expect(j3.layers[0].patternSkip).toBe(3)
    const fiber = peakC(motionRows(gen(j3, m3()).rows))
    const mirror = peakC(motionRows(gen(j3, m3('mirror')).rows))
    expect(fiber).toBeLessThanOrEqual(200)
    expect(fiber).toBeGreaterThan(50) // kutba yakın dom parçalarının doğal C hızı (~114 °/s) kalır
    expect(mirror).toBeGreaterThan(1000)
  })

  it('REQ-003 altın fark: fiber ↔ mirror yalnız C sözcükleri, G94 dwell F ve başlıktaki C maddesi; X/A/Y ve süre aynı', () => {
    for (const c of GOLDEN_CASES) {
      const mm = { ...c.m, headAngleMode: 'mirror' as const }
      const mf = { ...c.m, headAngleMode: 'fiber' as const }
      const gm = generateGcode(planWinding(c.input, mm), c.input, mm)
      const gf = generateGcode(planWinding(c.input, mf), c.input, mf)
      const lm = gm.split('\n')
      const lf = gf.split('\n')
      expect(lf.length).toBe(lm.length)
      const rows = readGcode(gf, mf)
      const byLine = new Map(rows.map((r, i) => [r.line, i]))
      const strip = (l: string): string => l.replace(new RegExp(`\\s${c.m.names.head}-?[\\d.]+`), '').replace(/\sF[\d.]+/, '')
      let diffC = 0
      for (let i = 0; i < lm.length; i++) {
        if (lm[i] === lf[i]) continue
        if (lm[i].startsWith('(')) {
          // yalnız C sözleşmesi ve tepe hız (C) başlık satırları değişebilir
          expect(/AYAR KONTROL: C sozlesmesi|^\(Tepe hiz/.test(lm[i])).toBe(true)
          continue
        }
        expect(strip(lm[i])).toBe(strip(lf[i]))
        const fm = /F([\d.]+)/.exec(lm[i])?.[1]
        const ff = /F([\d.]+)/.exec(lf[i])?.[1]
        if (fm !== ff) {
          // F yalnız G94'te lineer bileşeni olmayan satırda değişir (F = hypot(ΔA, ΔC) / süre)
          expect(c.m.feedMode).toBe('G94')
          const k = byLine.get(i + 1)!
          const p = rows.slice(0, k).reverse().find((r) => r.code === 'G0' || r.code === 'G1')!.pos
          expect(Math.hypot(rows[k].pos.x - p.x, rows[k].pos.y - p.y)).toBe(0)
        }
        diffC++
      }
      expect(diffC).toBeGreaterThan(0)
      const tm = verifyGcode(gm, mm).minutes
      const tf = verifyGcode(gf, mf).minutes
      expect(Math.abs(tf / tm - 1)).toBeLessThan(2e-4)
    }
  })

  it('REQ-003 eski kayıt (alan yok): C eski ±φ ile birebir, başlık "SEÇİLMEMİŞ" der; plan/makine uyuşmazlığı hata', () => {
    const legacy: MachineConfig = { ...m4(), headAngleMode: undefined }
    const explicit = m4('mirror')
    const pl = planWinding(S1, legacy)
    expect(pl.headAngleMode).toBe('mirror')
    expect(pl.moves).toEqual(planWinding(S1, explicit).moves)
    const gl = generateGcode(pl, S1, legacy).split('\n')
    const ge = generateGcode(planWinding(S1, explicit), S1, explicit).split('\n')
    const diff = gl.filter((l, i) => l !== ge[i])
    expect(diff.length).toBe(1)
    expect(diff[0]).toMatch(/AYAR KONTROL: C sozlesmesi SECILMEMIS/)
    // φ, ±, − ASCII'ye çevrilir (bilinmeyen karakter '?' olmaz)
    expect(diff[0]).toMatch(/simetrik \+\/-phi kullanildi, gidiste \+phi, donuste -phi/)
    expect(diff[0]).not.toMatch(/\?/)
    expect(controllerChecklist(legacy).some((s) => /SEÇİLMEMİŞ \(eski kayıt\)/.test(s))).toBe(true)
    // fiber planı ±φ makinesiyle (veya tersi) yazılamaz
    expect(() => generateGcode(planWinding(S1, m4()), S1, explicit)).toThrow(/C sözleşmesi/)
    expect(() => generateGcode(planWinding(S1, 4), S1, m4())).toThrow(/C sözleşmesi/)
  })

  it('REQ-003 kontrol listesi C sıfırı tanımını içerir (fiber)', () => {
    const items = controllerChecklist(m3())
    expect(items.some((s) => s.includes('C = 90°: elyaf çevresel, göz yarığı mandrel eksenine paralel; C = 0°: elyaf eksenel'))).toBe(true)
    expect(items.some((s) => s.includes('dönüşte 180° − φ'))).toBe(true)
    expect(gen(S2, m3()).g).toMatch(/\(AYAR KONTROL: C sozlesmesi elyaf yonu 0-180der: gidiste phi, donuste 180der - phi/)
  })

  it('REQ-003 proje dosyası: alan yoksa yok kalır (eski davranış), geçerli değerler gidip gelir, geçersiz reddedilir', () => {
    const legacyFile = JSON.parse(serializeProject(S2, { ...machine3 }))
    const r0 = parseProject(JSON.stringify(legacyFile))
    expect(r0.ok && r0.machine.headAngleMode).toBe(undefined)
    for (const mode of ['fiber', 'mirror'] as const) {
      const r = parseProject(serializeProject(S2, { ...machine3, headAngleMode: mode }))
      expect(r.ok && r.machine.headAngleMode).toBe(mode)
    }
    const bad = parseProject(JSON.stringify({ ...legacyFile, machine: { ...legacyFile.machine, headAngleMode: 'plus' } }))
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toMatch(/machine\.headAngleMode/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('REQ-004 serbest elyaf boyu λ ve uç gecikmesi g', () => {
  it('REQ-004 S1 4 eksen (Re = Y): MM el hesabı değerleri', () => {
    const { plan, rows } = gen(S1, m4())
    const [l1, l2, l3] = plan.layers.map((l) => l.fiberLag!)
    expect(l1.axialLag).toBeGreaterThan(116.96 - 0.1)
    expect(l1.axialLag).toBeLessThan(116.96 + 0.1)
    expect(Math.abs(l1.freeLength - 135.06)).toBeLessThan(0.1)
    expect(Math.abs(l3.axialLag - 47.6)).toBeLessThan(0.1)
    expect(Math.abs(l3.freeLength - 82.98)).toBeLessThan(0.1)
    expect(Math.abs(l2.axialLag - 1.06)).toBeLessThan(0.05)
    expect(l2.poleFreeLength).toBeNull()
    expect(l3.poleFreeLength).toBeNull()
    // kutupta λ = √(Re_kutup² − c²): Re_kutup G-code'dan (ilk G1 öncesi son Y), c = R·sin30°
    const start = motionRows(rows)[0].pos.y
    const c = (60 + 0.25) * 0.5
    expect(Math.abs(l1.poleFreeLength! - Math.sqrt(start * start - c * c))).toBeLessThan(0.01)
    // Re = katmanın gövde Y'si (G-code'daki düz katman Y'si)
    expect(l3.eyeRadius).toBeCloseTo(91.5, 9)
  })

  it('REQ-004 helisel katmanlarda gecikme uyarısı var, hoop katmanda yok', () => {
    const { plan } = gen(S1, m4())
    expect(plan.layers[0].warnings.some((w) => /kafanın ~117\.0 mm gerisinde.*x≈117 \/ 683 mm/.test(w))).toBe(true)
    expect(plan.layers[2].warnings.some((w) => /kafanın ~47\.6 mm gerisinde/.test(w))).toBe(true)
    expect(plan.layers[1].warnings.some((w) => /gerisinde/.test(w))).toBe(false)
  })

  it('REQ-004 3 eksen Re boş → alan yok, uyarı yok, eksik alan yok', () => {
    const m = m3('fiber', { travel: S1travel })
    for (const eyeRadius of [undefined, null]) {
      const mm = { ...m, eyeRadius }
      expect(missingFields(S1, mm)).toEqual([])
      const plan = planWinding(S1, mm)
      for (const l of plan.layers) {
        expect(l.fiberLag).toBeNull()
        expect(l.warnings.some((w) => /gerisinde/.test(w))).toBe(false)
      }
    }
  })

  it('REQ-004 3 eksen Re = 50, Ø120 → hata (kafa mandrele çarpar), G-code üretilmez', () => {
    const m = m3('fiber', { travel: S1travel, eyeRadius: 50 })
    const miss = missingFields(S1, m)
    expect(miss.some((s) => /Göz yarıçapı Re=50 mm katman 1 yarıçapından \(60\.25 mm\) küçük: kafa mandrele çarpar/.test(s))).toBe(true)
    // Re yalnız dış katmanların içinde kalırsa o katman bildirilir
    expect(missingFields(S1, { ...m, eyeRadius: 60.6 }).some((s) => /katman 2 yarıçapından/.test(s))).toBe(true)
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(missingFields(S1, { ...m, eyeRadius: bad })).toContain('Göz yarıçapı Re (> 0 mm)')
    }
    // plan yine de NaN üretmez (gecikme hesaplanmaz)
    const plan = planWinding(S1, m)
    expect(plan.layers.every((l) => l.fiberLag === null)).toBe(true)
  })

  it('REQ-004 3 eksen Re = 100, Ø120 30°: el hesabı g = 138,24, λ = 159,62 (Re sabit, kutupta √(100² − c²))', () => {
    const { plan } = gen(S1, m3('fiber', { travel: S1travel, eyeRadius: 100 }))
    const l1 = plan.layers[0].fiberLag!
    expect(Math.abs(l1.axialLag - 138.24)).toBeLessThan(0.01)
    expect(Math.abs(l1.freeLength - 159.62)).toBeLessThan(0.01)
    expect(Math.abs(l1.poleFreeLength! - 95.354)).toBeLessThan(0.01) // √(10000 − 30,125²) = √9092,48
    expect(l1.eyeRadius).toBe(100)
  })

  it('REQ-004 proje dosyası: eyeRadius doğrulanır (> 0, sonlu, sayı), boş/yok = null/yok', () => {
    const file = JSON.parse(serializeProject(S1, { ...m3(), eyeRadius: 100 }))
    const ok = parseProject(JSON.stringify(file))
    expect(ok.ok && ok.machine.eyeRadius).toBe(100)
    const nul = parseProject(JSON.stringify({ ...file, machine: { ...file.machine, eyeRadius: null } }))
    expect(nul.ok && nul.machine.eyeRadius).toBe(null)
    const { eyeRadius: _drop, ...noEye } = file.machine
    const none = parseProject(JSON.stringify({ ...file, machine: noEye }))
    expect(none.ok && 'eyeRadius' in none.machine).toBe(false)
    for (const bad of ['0', '-1', '"50"', '1e999', 'true']) {
      const text = JSON.stringify(file).replace('"eyeRadius": 100', `"eyeRadius": ${bad}`).replace('"eyeRadius":100', `"eyeRadius":${bad}`)
      const r = parseProject(text)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.error).toMatch(/machine\.eyeRadius/)
    }
  })

  it('REQ-004 saldırgan: 1°/85°, Re çok büyük/çok yakın, uzun parça → sonlu değerler, G-code NaN içermez', () => {
    const layers: Layer[] = [
      { id: 'a', kind: 'helical', angleDeg: 1 },
      { id: 'b', kind: 'helical', angleDeg: 85, dome: true, domeHeight: 10 },
      { id: 'h', kind: 'hoop', angleDeg: null }
    ]
    // REQ-009: Re dış yarıçaptan (61,5 mm) büyük olmalı; en yakın geçerli değer
    for (const eyeRadius of [1e7, 61.5001, 200]) {
      for (const windLength of [50, 50000]) {
        const input = { ...S1, windLength, layers }
        const m = m3('fiber', { travel: { carriage: { min: -1e6, max: 1e6 } }, eyeRadius })
        const { plan } = gen(input, m)
        for (const l of plan.layers) {
          const f = l.fiberLag!
          expect([f.axialLag, f.freeLength, f.poleFreeLength ?? 0].every(Number.isFinite)).toBe(true)
        }
      }
    }
  })
})
