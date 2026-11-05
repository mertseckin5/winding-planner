/**
 * Makine mühendisi ölçüm betiği, 2. tur (REQ-001…004 kabul). src/ dosyalarını değiştirmez, yalnız çağırır.
 * Yeni çağrı biçimi: missingFields/planWinding(input, machine). Her senaryo 'fiber' ve 'mirror' ile.
 * G-code bağımsız okuyucuyla okunur; süre LinuxCNC kuralıyla (G94: lin/F yoksa rot/F; G93: 1/F).
 * Çalıştırma: npx vitest run --config docs/engineering/scripts/vitest.mm.config.ts --reporter=verbose
 */
import { describe, it } from 'vitest'
import { planWinding, missingFields, patternCandidates } from '../../../src/renderer/src/core/winding'
import { generateGcode } from '../../../src/renderer/src/core/gcode'
import { verifyGcode } from '../../../src/renderer/src/core/verify'
import { readGcode, type Row } from '../../../src/renderer/src/core/gcode-reader.testutil'
import type { MachineConfig, WindingInput, HeadAngleMode } from '../../../src/renderer/src/core/types'

const f = (v: number, n = 2): string => v.toFixed(n)

const base: MachineConfig = {
  controller: 'linuxcnc',
  axisCount: 3,
  names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'Y' },
  invert: { carriage: false, mandrel: false, head: false, cross: false },
  feedMode: 'G94',
  zeroAxesAtStart: true,
  pauseBetweenLayers: false
}

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

interface Seg { row: Row; d: Record<'x' | 'a' | 'c' | 'y', number>; T: number }

function segs(rows: Row[], m: MachineConfig): Seg[] {
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
      out.push({ row: r, d, T: Tm * 60 })
    }
    if (r.code === 'G0' || r.code === 'G1') prev = { ...r.pos }
  }
  return out
}

function run(title: string, input: WindingInput, m: MachineConfig): string[] {
  const L: string[] = [`\n======== ${title} (${m.axisCount} eksen, ${m.feedMode}, C=${m.headAngleMode}) ========`]
  const miss = missingFields(input, m)
  if (miss.length) {
    L.push(`missingFields: ${miss.join(' | ')}`)
    return L
  }
  const plan = planWinding(input, m)
  const g = generateGcode(plan, input, m)
  const ver = verifyGcode(g, m, plan)
  const lines = g.split('\n')
  // REQ-001: G92 satırı ve ilk G1'e kadar komut satırları (yorumlar hariç, MSG dahil)
  const firstG1 = lines.findIndex((s) => /^G1\b/.test(s.trim()))
  const g92 = lines.filter((s) => /G92/.test(s.replace(/\([^)]*\)/g, '')))
  L.push(`G92 satırları: ${g92.join(' / ') || 'yok'}`)
  const start = lines
    .slice(0, firstG1 + 1)
    .map((s, i) => [i + 1, s.trim()] as const)
    .filter(([, s]) => s !== '' && (!s.startsWith('(') || s.startsWith('(MSG')))
  L.push('Baştan ilk G1 dahil komut satırları:')
  for (const [n, s] of start) L.push(`  ${n}: ${s}`)
  const adj = lines.filter((s) => /AYAR KONTROL/.test(s))
  L.push(`AYAR KONTROL satırları: ${adj.length}`)
  for (const s of adj) L.push(`  ${s}`)

  const rows = readGcode(g, m)
  const ss = segs(rows, m)
  const yMaxAll = Math.max(...rows.filter((r) => r.code === 'G0' || r.code === 'G1').map((r) => r.pos.y))
  L.push(`Programdaki azami Y (okuyucu) = ${f(yMaxAll, 3)}`)
  const nM0 = rows.filter((r) => r.code === 'M0').length
  const m0BeforeG1 = rows.findIndex((r) => r.code === 'M0') < rows.findIndex((r) => r.code === 'G1')
  L.push(`M0 sayısı ${nM0}, ilk G1'den önce M0: ${m0BeforeG1}`)

  // C aralığı (G1)
  const cs = ss.map((s) => s.row.pos.c)
  L.push(`C aralığı (G1) ${f(Math.min(...cs), 3)} … ${f(Math.max(...cs), 3)}`)
  L.push(`Doğrulayıcı: ${ver.issues.map((i) => `[${i.level}] ${i.message}`).join(' | ') || 'sorun yok'}; süre ${f(ver.minutes)} dk, oran ${ver.planTimeRatio?.toFixed(5)}`)

  // plan G1 hareketleri ile eşle
  const g1 = plan.moves.filter((mv) => mv.kind !== 'position')
  if (g1.length !== ss.length) L.push(`!! plan G1 ${g1.length} ≠ G-code G1 ${ss.length}`)
  let peakC = { v: 0, line: 0, kind: '' }
  ss.forEach((s, i) => {
    const v = Math.abs(s.d.c) / s.T
    if (v > peakC.v) peakC = { v, line: s.row.line, kind: g1[i].kind }
  })
  L.push(`Tepe C hızı (G-code) ${f(peakC.v, 1)} °/s, satır ${peakC.line}, hareket türü ${peakC.kind}`)

  plan.layers.forEach((li) => {
    const idx = g1.map((mv, i) => [mv, i] as const).filter(([mv]) => mv.layer === li.index)
    const dw = idx.filter(([mv]) => mv.kind === 'dwell').map(([, i]) => ss[i])
    const dcs = dw.map((s) => s.d.c)
    const uniq = [...new Set(dcs.map((v) => v.toFixed(3)))]
    const pass = idx.filter(([mv]) => mv.kind === 'pass').map(([, i]) => ss[i])
    const pk = Math.max(...pass.map((s) => Math.abs(s.d.c) / s.T))
    const pkDw = Math.max(...dw.map((s) => Math.abs(s.d.c) / s.T))
    L.push(
      `  K${li.index + 1} ${li.kind}${li.dome ? ' domlu' : ''} α=${f(li.angleDeg)} n=${li.bands} j=${li.patternSkip} δ=${f(li.turnDwellDeg, 1)}°: dwell ${dw.length} adet, ΔC değerleri {${uniq.join(', ')}}; beklenen düz 180−2α=${f(180 - 2 * li.angleDeg, 3)}; dwell tepe C ${f(pkDw, 1)} °/s; geçiş(pass) tepe C ${f(pk, 1)} °/s`
    )
    if (li.dome) {
      // Clairaut: r·sin(C) = c, r plan yarıçapından (G-code C'si ile)
      const c = li.dome.poleRadius
      let worst = 0
      idx.forEach(([mv, i]) => {
        if (mv.kind !== 'pass') return
        const e = Math.abs(mv.radius * Math.sin(ss[i].row.pos.c * (Math.PI / 180)) - c) / c
        if (e > worst) worst = e
      })
      L.push(`     Clairaut en kötü |r·sinC − c|/c = ${(worst * 100).toFixed(3)} % (c=${f(c, 3)})`)
    }
    const lag = li.fiberLag
    L.push(
      lag
        ? `     fiberLag Re=${f(lag.eyeRadius, 3)} λ=${f(lag.freeLength, 3)} g=${f(lag.axialLag, 3)} λ_kutup=${lag.poleFreeLength === null ? 'null' : f(lag.poleFreeLength, 3)}`
        : '     fiberLag null'
    )
    for (const w of li.warnings) L.push(`     uyarı: ${w}`)
  })
  // Katman geçişleri
  g1.forEach((mv, i) => {
    if (mv.kind !== 'transition') return
    const s = ss[i]
    L.push(
      `  Geçiş → K${mv.layer + 1} (satır ${s.row.line}): C ${f(s.row.pos.c - s.d.c, 2)} → ${f(s.row.pos.c, 2)} (ΔC ${f(s.d.c, 1)}), ΔX ${f(s.d.x)} ΔY ${f(s.d.y)} ΔA ${f(s.d.a, 1)}, T ${f(s.T, 3)} s, C ${f(Math.abs(s.d.c) / s.T, 1)} °/s`
    )
  })
  return L
}

const modes: HeadAngleMode[] = ['fiber', 'mirror']

describe('MM ölçüm 2026-11-05 tur 2', () => {
  it('S1 4 eksen G93/G94, fiber/mirror', () => {
    const out: string[] = []
    for (const hm of modes)
      for (const fm of ['G93', 'G94'] as const)
        out.push(...run('S1', S1, { ...base, axisCount: 4, feedMode: fm, headAngleMode: hm, travel: { carriage: { min: -60, max: 860 } } }))
    // Y tersleme ile ilk satırlar
    out.push(...run('S1 Y ters', S1, { ...base, axisCount: 4, feedMode: 'G93', headAngleMode: 'fiber', invert: { ...base.invert, cross: true }, travel: { carriage: { min: -60, max: 860 } } }))
    console.log(out.join('\n'))
  })

  it('S2 3 eksen j=1 ve j>1, fiber/mirror', () => {
    const cands = patternCandidates(S2, 0, 3)
    const jBest = cands.find((c) => c.j > 1)!.j
    const out: string[] = [`S2 en kısa uç dönüşlü j>1: j=${jBest}`]
    for (const hm of modes) {
      const m: MachineConfig = { ...base, headAngleMode: hm, travel: { carriage: { min: -20, max: 420 } } }
      out.push(...run('S2 j=1', S2, m))
      out.push(...run(`S2 j=${jBest}`, { ...S2, layers: [{ ...S2.layers[0], patternSkip: jBest }] }, m))
      out.push(...run(`S2 j=${jBest} Re=80`, { ...S2, layers: [{ ...S2.layers[0], patternSkip: jBest }] }, { ...m, eyeRadius: 80 }))
    }
    console.log(out.join('\n'))
  })

  it('REQ-002 / REQ-004 kabul durumları', () => {
    const out: string[] = []
    out.push(`S2 travel yok: ${missingFields(S2, { ...base, headAngleMode: 'fiber' }).join(' | ')}`)
    out.push(`S2 travel min yalnız: ${missingFields(S2, { ...base, headAngleMode: 'fiber', travel: { carriage: { min: -20, max: null } } }).join(' | ')}`)
    for (const t of [{ min: -10, max: 500 }, { min: -20, max: 420 }, { min: -20, max: 410 }]) {
      const m: MachineConfig = { ...base, headAngleMode: 'fiber', travel: { carriage: t } }
      const p = planWinding(S2, m)
      const v = verifyGcode(generateGcode(p, S2, m), m, p)
      out.push(`S2 travel ${t.min}/${t.max}: ${v.issues.filter((i) => /strok/.test(i.message)).map((i) => `[${i.level}] ${i.message}`).join(' | ') || 'strok sorunu yok'}`)
    }
    const flat: WindingInput = { ...S1, layers: S1.layers.slice(1) }
    const m4: MachineConfig = { ...base, axisCount: 4, headAngleMode: 'fiber' }
    out.push(`S1 domsuz travel yok: missing=[${missingFields(flat, m4).join(' | ')}]`)
    try {
      generateGcode(planWinding(flat, m4), flat, m4)
      out.push('S1 domsuz: G-code üretildi')
    } catch (e) {
      out.push(`S1 domsuz: hata ${(e as Error).message}`)
    }
    // REQ-004 3 eksen Re
    const s1_3 = { ...S1, standoff: null }
    const m3 = { ...base, headAngleMode: 'fiber' as const, travel: { carriage: { min: -60, max: 860 } } }
    out.push(`S1 3 eksen Re=50: ${missingFields(s1_3, { ...m3, eyeRadius: 50 }).join(' | ')}`)
    out.push(`S1 3 eksen Re=60.5 (katman1 r=60.25, dış 60.5): [${missingFields(s1_3, { ...m3, eyeRadius: 60.5 }).join(' | ')}]`)
    out.push(`S1 3 eksen Re=61.0 (son katman r=60.25+1=61.25, dış yüzey 61.5): [${missingFields(s1_3, { ...m3, eyeRadius: 61.0 }).join(' | ')}]`)
    out.push(`S1 3 eksen Re=61.3 (son katman orta 61.25 < Re < dış 61.5): [${missingFields(s1_3, { ...m3, eyeRadius: 61.3 }).join(' | ')}]`)
    const p3 = planWinding(s1_3, m3)
    out.push(`S1 3 eksen Re boş: fiberLag ${p3.layers.map((l) => (l.fiberLag ? 'var' : 'null')).join(',')}; Elyaf uyarısı sayısı ${p3.layers.flatMap((l) => l.warnings).filter((w) => /gerisinde/.test(w)).length}`)
    // eski çağrı biçimi (eksen sayısı) hâlâ ölçülebilir mi
    const pOld = planWinding(S1, 4)
    out.push(`Eski çağrı planWinding(S1, 4): headAngleMode=${pOld.headAngleMode}`)
    // fiber vs mirror: X/A/Y aynı mı
    const mf: MachineConfig = { ...base, axisCount: 4, feedMode: 'G93', headAngleMode: 'fiber', travel: { carriage: { min: -60, max: 860 } } }
    const mm: MachineConfig = { ...mf, headAngleMode: 'mirror' }
    const rf = readGcode(generateGcode(planWinding(S1, mf), S1, mf), mf)
    const rm = readGcode(generateGcode(planWinding(S1, mm), S1, mm), mm)
    let dXAY = 0
    let nC = 0
    rf.forEach((r, i) => {
      const q = rm[i]
      dXAY = Math.max(dXAY, Math.abs(r.pos.x - q.pos.x), Math.abs(r.pos.a - q.pos.a), Math.abs(r.pos.y - q.pos.y))
      if (Math.abs(r.pos.c - q.pos.c) > 1e-6) nC++
    })
    out.push(`S1 G93 fiber vs mirror: satır ${rf.length}/${rm.length}, azami |ΔX,ΔA,ΔY| ${dXAY}, C farklı satır ${nC}`)
    console.log(out.join('\n'))
  })
})
