/**
 * Makine mühendisi ölçüm betiği (2026-11-05 ilk inceleme). src/ dosyalarını değiştirmez, yalnız çağırır.
 * G-code'u bağımsız okuyucu (gcode-reader.testutil) ile okur, LinuxCNC besleme kuralıyla her G1'in
 * süresini hesaplar (G94: lineer varsa lin/F, yoksa rot/F; G93: 1/F) ve eksen hızlarını, ardışık
 * hareketler arasındaki hız sıçramalarını, uç dönüşlerini, kutup yakını parçaları ve katman geçişlerini ölçer.
 */
import { describe, it } from 'vitest'
import { planWinding, missingFields, patternCandidates } from '../../../src/renderer/src/core/winding'
import { generateGcode } from '../../../src/renderer/src/core/gcode'
import { verifyGcode } from '../../../src/renderer/src/core/verify'
import { peakSpeeds } from '../../../src/renderer/src/core/limits'
import { readGcode, type Row } from '../../../src/renderer/src/core/gcode-reader.testutil'
import type { MachineConfig, WindingInput } from '../../../src/renderer/src/core/types'

const AX = ['x', 'a', 'c', 'y'] as const
type Ax = (typeof AX)[number]

interface Seg {
  line: number
  layer: number
  kind: string
  d: Record<Ax, number>
  T: number // saniye
  v: Record<Ax, number> // birim/s (işaretli)
  f: number | null
}

function segments(rows: Row[], m: MachineConfig): Seg[] {
  const out: Seg[] = []
  let prev = { x: 0, a: 0, c: 0, y: 0 }
  let feed: number | null = null
  for (const r of rows) {
    if (r.f !== null) feed = r.f
    if (r.code === 'G1') {
      const d = { x: r.pos.x - prev.x, a: r.pos.a - prev.a, c: r.pos.c - prev.c, y: m.axisCount === 4 ? r.pos.y - prev.y : 0 }
      const lin = Math.hypot(d.x, d.y)
      const rot = Math.hypot(d.a, d.c)
      let Tm: number
      if (r.inverse) Tm = 1 / feed!
      else if (lin > 1e-9) Tm = lin / feed!
      else Tm = rot / feed!
      const T = Tm * 60
      out.push({ line: r.line, layer: r.layer, kind: r.layerKind, d, T, v: { x: d.x / T, a: d.a / T, c: d.c / T, y: d.y / T }, f: r.f })
    }
    if (r.code === 'G0' || r.code === 'G1') prev = { ...r.pos }
  }
  return out
}

function f2(v: number, n = 1): string {
  return v.toFixed(n)
}

function report(title: string, input: WindingInput, machine: MachineConfig): void {
  const miss = missingFields(input, machine.axisCount)
  if (miss.length) throw new Error(`${title}: eksik ${miss.join(', ')}`)
  const plan = planWinding(input, machine.axisCount)
  const g = generateGcode(plan, input, machine)
  const ver = verifyGcode(g, machine, plan)
  const rows = readGcode(g, machine)
  const segs = segments(rows, machine)
  const L: string[] = []
  L.push(`\n================ ${title} ================`)
  L.push(`G1 sayısı ${segs.length}, süre ${f2(ver.minutes, 2)} dk, plan oranı ${ver.planTimeRatio?.toFixed(5)}, dış çap ${f2(plan.outerDiameter, 2)} mm`)
  L.push(`Doğrulayıcı: ${ver.issues.map((i) => `[${i.level}] ${i.message}`).join(' | ') || 'sorun yok'}`)
  L.push(`Aralık X ${f2(ver.range.carriage.min, 2)}…${f2(ver.range.carriage.max, 2)}  C ${f2(ver.range.head.min)}…${f2(ver.range.head.max)}  Y ${f2(ver.range.cross.min, 2)}…${f2(ver.range.cross.max, 2)}  A son ${f2(ver.finalPos.mandrel, 0)}°`)
  const pk = peakSpeeds(plan, input.feedRate!)
  L.push(`Tepe hız (limits.peakSpeeds): X ${f2(pk.carriage, 0)} mm/dk, A ${f2(pk.mandrel, 0)} °/dk, C ${f2(pk.head, 0)} °/dk, Y ${f2(pk.cross, 0)} mm/dk`)
  L.push(`Tepe hız (G-code okuma): X ${f2(ver.peak.carriage / 60)} mm/s, A ${f2(ver.peak.mandrel / 60)} °/s, C ${f2(ver.peak.head / 60)} °/s, Y ${f2(ver.peak.cross / 60, 2)} mm/s`)

  // Katman özetleri
  plan.layers.forEach((li) => {
    L.push(
      `  Katman ${li.index + 1} ${li.kind}${li.dome ? ' domlu' : ''} α=${f2(li.angleDeg, 2)} R=${f2(li.radius, 2)} n=${li.bands} j=${li.patternSkip} uç dönüşü=${f2(li.turnDwellDeg, 1)}°${li.dome ? ` r0=${f2(li.dome.poleRadius, 2)} poleX=${f2(li.dome.poleOffset, 2)} tmax=${f2(li.dome.maxThickness, 2)} buildup=${f2(li.dome.buildup, 2)} clearance=${li.dome.clearance?.toFixed(2)}` : ''}`
    )
    for (const w of li.warnings) L.push(`     uyarı: ${w}`)
  })

  // Ardışık hareketler arası hız sıçraması ve tahmini ivme
  // a_kısa = |Δv| / min(T_i-1, T_i): geçiş en kısa komşu harekete sığmalıysa gereken ivme
  // a_ort  = |Δv| / ((T_i-1 + T_i)/2)
  const jump: Record<Ax, { dv: number; aShort: number; aMean: number; line: number }> = {
    x: { dv: 0, aShort: 0, aMean: 0, line: 0 },
    a: { dv: 0, aShort: 0, aMean: 0, line: 0 },
    c: { dv: 0, aShort: 0, aMean: 0, line: 0 },
    y: { dv: 0, aShort: 0, aMean: 0, line: 0 }
  }
  for (let i = 1; i < segs.length; i++) {
    const p = segs[i - 1]
    const s = segs[i]
    for (const k of AX) {
      const dv = Math.abs(s.v[k] - p.v[k])
      const aS = dv / Math.min(p.T, s.T)
      const aM = dv / ((p.T + s.T) / 2)
      if (dv > jump[k].dv) jump[k].dv = dv
      if (aS > jump[k].aShort) jump[k] = { ...jump[k], aShort: aS, line: s.line }
      if (aM > jump[k].aMean) jump[k].aMean = aM
    }
  }
  L.push(
    `Hız sıçraması tepe |Δv|: X ${f2(jump.x.dv)} mm/s, A ${f2(jump.a.dv)} °/s, C ${f2(jump.c.dv)} °/s, Y ${f2(jump.y.dv, 2)} mm/s`
  )
  L.push(
    `Tahmini ivme (|Δv|/kısa komşu süre): X ${f2(jump.x.aShort, 0)} mm/s² (satır ${jump.x.line}), A ${f2(jump.a.aShort, 0)} °/s² (satır ${jump.a.line}), C ${f2(jump.c.aShort, 0)} °/s² (satır ${jump.c.line}), Y ${f2(jump.y.aShort, 1)} mm/s² (satır ${jump.y.line})`
  )
  L.push(
    `Tahmini ivme (|Δv|/ortalama süre): X ${f2(jump.x.aMean, 0)} mm/s², A ${f2(jump.a.aMean, 0)} °/s², C ${f2(jump.c.aMean, 0)} °/s², Y ${f2(jump.y.aMean, 1)} mm/s²`
  )

  // Uç dönüşleri (planda 'dwell'): plan hareketiyle G1 sırası birebir (position hariç)
  const g1Moves = plan.moves.filter((m) => m.kind !== 'position')
  if (g1Moves.length !== segs.length) L.push(`!! plan G1 (${g1Moves.length}) ≠ G-code G1 (${segs.length})`)
  const byLayer = new Map<number, Seg[]>()
  g1Moves.forEach((m, i) => {
    if (m.kind !== 'dwell') return
    const arr = byLayer.get(m.layer) ?? []
    arr.push(segs[i])
    byLayer.set(m.layer, arr)
  })
  for (const [layer, ds] of byLayer) {
    const s = ds[0]
    // C: duruştan duruşa üçgen profil gerekli ivme = 4·ΔC/T²
    const aTri = (4 * Math.abs(s.d.c)) / (s.T * s.T)
    L.push(
      `  Uç dönüşü K${layer + 1}: ΔA=${f2(s.d.a, 1)}°, ΔC=${f2(s.d.c, 1)}°, süre=${f2(s.T, 3)} s, A=${f2(s.v.a, 0)} °/s, C ort=${f2(Math.abs(s.v.c), 0)} °/s, C üçgen profil ivmesi=${f2(aTri, 0)} °/s² (adet ${ds.length})`
    )
  }

  // Katman geçişleri
  g1Moves.forEach((m, i) => {
    if (m.kind !== 'transition') return
    const s = segs[i]
    L.push(
      `  Geçiş → K${m.layer + 1}: ΔX=${f2(s.d.x, 2)} ΔA=${f2(s.d.a, 1)} ΔC=${f2(s.d.c, 1)} ΔY=${f2(s.d.y, 2)}, süre=${f2(s.T, 3)} s, C=${f2(Math.abs(s.v.c), 0)} °/s, X=${f2(Math.abs(s.v.x), 1)} mm/s, F=${s.f}`
    )
  })

  // Kutup yakını: domlu katmanlarda en küçük |ΔX| G1 ve A hızı
  const domeLayers = plan.layers.filter((l) => l.dome).map((l) => l.index)
  for (const li of domeLayers) {
    const ss = segs.filter((s, i) => s.layer === li && g1Moves[i].kind === 'pass')
    const minDx = ss.reduce((b, s) => (Math.abs(s.d.x) > 1e-9 && Math.abs(s.d.x) < Math.abs(b.d.x) ? s : b), ss[0])
    const maxA = ss.reduce((b, s) => (Math.abs(s.v.a) > Math.abs(b.v.a) ? s : b), ss[0])
    const maxC = ss.reduce((b, s) => (Math.abs(s.v.c) > Math.abs(b.v.c) ? s : b), ss[0])
    const maxY = ss.reduce((b, s) => (Math.abs(s.v.y) > Math.abs(b.v.y) ? s : b), ss[0])
    const minT = ss.reduce((b, s) => (s.T < b.T ? s : b), ss[0])
    L.push(
      `  Kutup K${li + 1}: en küçük ΔX=${minDx.d.x.toFixed(3)} mm (satır ${minDx.line}, F=${minDx.f}, süre ${f2(minDx.T, 3)} s); tepe A ${f2(Math.abs(maxA.v.a), 0)} °/s; geçişte tepe C ${f2(Math.abs(maxC.v.c), 0)} °/s; tepe Y ${f2(Math.abs(maxY.v.y), 2)} mm/s; en kısa dom parçası ${f2(minT.T, 4)} s`
    )
    // tek gidiş dom parçalarının dökümü (ilk devre, sağ dom)
    const first = ss.slice(0, 49)
    const dom = first.slice(25, 49)
    L.push(
      '     sağ dom parçaları (ΔX mm / ΔA ° / ΔC ° / ΔY mm / T s): ' +
        dom.map((s) => `${s.d.x.toFixed(3)}/${s.d.a.toFixed(2)}/${s.d.c.toFixed(2)}/${s.d.y.toFixed(3)}/${s.T.toFixed(3)}`).join(' ; ')
    )
  }
  console.log(L.join('\n'))
}

const base3: MachineConfig = {
  controller: 'linuxcnc',
  axisCount: 3,
  names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'Y' },
  invert: { carriage: false, mandrel: false, head: false, cross: false },
  feedMode: 'G94',
  zeroAxesAtStart: true,
  pauseBetweenLayers: true
}

describe('MM ölçüm 2026-11-05', () => {
  it('S1: Ø120×800, 6 mm, 3000 mm/dk, 30° domlu + hoop + 55°, 4 eksen G93 ve G94', () => {
    const input: WindingInput = {
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
    report('S1a 4 eksen G93', input, { ...base3, axisCount: 4, feedMode: 'G93' })
    report('S1b 4 eksen G94', input, { ...base3, axisCount: 4, feedMode: 'G94' })
  })

  it('S2: Ø50×400, 45° domlu, j=1 ve en kısa uç dönüşlü j>1, 3 eksen G94', () => {
    const input: WindingInput = {
      mandrelDiameter: 50,
      windLength: 400,
      bandWidth: 6,
      bandThickness: 0.25,
      feedRate: 3000,
      turnDwellMinDeg: 20,
      standoff: null,
      layers: [{ id: 'l1', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 25 }]
    }
    const cands = patternCandidates(input, 0, 3)
    console.log('S2 desen adayları (ilk 8): ' + cands.slice(0, 8).map((c) => `j=${c.j} N=${c.nTurns} δ=${c.dwellDeg.toFixed(1)}°`).join(', '))
    const jBest = cands.find((c) => c.j > 1)!.j
    report('S2a j=1', input, base3)
    report(`S2b j=${jBest}`, { ...input, layers: [{ ...input.layers[0], patternSkip: jBest }] }, base3)
  })

  it('S3: S1 + varsayımsal eksen limitleri (yalnız davranış görmek için; makine değeri DEĞİL)', () => {
    const input: WindingInput = {
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
    const m: MachineConfig = {
      ...base3,
      axisCount: 4,
      feedMode: 'G93',
      maxSpeed: { carriage: 10000, mandrel: 10800, head: 10800, cross: 3000 }
    }
    report('S3 4 eksen G93, limit X 10000 mm/dk, A/C 10800 °/dk, Y 3000 mm/dk', input, m)
  })
})
