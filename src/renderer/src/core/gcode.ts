import { controllerChecklist } from './checklist'
import { moveMinutes, peakSpeeds, slowdownSummary } from './limits'
import type { MachineConfig, WindingInput, WindingPlan } from './types'

export function fmt(v: number, digits = 3): string {
  const s = v.toFixed(digits)
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s
}

/** G-code'a yazılan eksen değeri (fmt ile aynı 3 ondalık; tersleme büyüklüğü değiştirmez). */
const r3 = (v: number): number => Number(fmt(v))

/** Aşağı yuvarlanmış sabit ondalık (yazılan F gerçek F'ten büyük olmasın). */
function floorFixed(v: number, digits: number): string {
  const k = 10 ** digits
  return (Math.floor(v * k) / k).toFixed(digits)
}

/** F için ondalık sayısı: en az ~5 anlamlı basamak (G93'te uzun hareketlerde F çok küçülür). */
function feedDecimals(f: number): number {
  return Math.min(10, Math.max(1, 4 - Math.floor(Math.log10(f))))
}

/** Parantez içi yorumda parantez, satır sonu ve Türkçe karakter olmasın (kontrolcüler ASCII bekler). */
export function comment(text: string): string {
  const ascii = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/°/g, 'der')
    .replace(/[^\x20-\x7e]/g, '?')
  return `(${ascii.replace(/[()\r\n]/g, ' ')})`
}

/**
 * Planı G-code'a çevirir.
 * G94: F, hareketin lineer bileşeninden (X/Y) türetilir; yalnız döner eksen hareketinde döner vektör (derece/dak).
 * G93: her G1 satırında F = 1 / hareket süresi (dak); tüm eksenler aynı anda biter.
 */
export function generateGcode(plan: WindingPlan, input: WindingInput, machine: MachineConfig): string {
  const { names, invert } = machine
  const sign = (inv: boolean): number => (inv ? -1 : 1)
  const word = (name: string, v: number, inv: boolean): string => `${name}${fmt(v * sign(inv))}`

  const lines: string[] = []
  const lnx = machine.controller === 'linuxcnc'

  lines.push(comment('Filament winding - winding-planner'))
  lines.push(
    comment(
      `Mandrel D=${input.mandrelDiameter} L=${input.windLength} bant=${input.bandWidth}x${input.bandThickness} v=${input.feedRate} mm/dak`
    )
  )
  lines.push(comment(`Kontrolcu=${machine.controller} eksen=${machine.axisCount} besleme=${machine.feedMode}`))
  const slow = slowdownSummary(plan, machine)
  lines.push(comment(`Cikis capi=${fmt(plan.outerDiameter, 2)} elyaf=${fmt(plan.totalFiberLength / 1000, 1)} m sure=${fmt(slow.minutes, 1)} dak`))
  if (slow.slowedMoves > 0) {
    lines.push(
      comment(`Eksen hiz limiti: ${slow.slowedMoves} hareket yavaslatildi, sure +%${fmt((slow.minutes / slow.baseMinutes - 1) * 100, 1)}`)
    )
  }
  const peak = peakSpeeds(plan, input.feedRate!, machine)
  lines.push(
    comment(
      `Tepe hiz: ${names.carriage} ${fmt(peak.carriage, 0)} mm/dak, ${names.mandrel} ${fmt(peak.mandrel, 0)} der/dak, ${names.head} ${fmt(peak.head, 0)} der/dak`
    )
  )
  for (const item of controllerChecklist(machine)) lines.push(comment(`AYAR KONTROL: ${item}`))
  lines.push(machine.controller === 'linuxcnc' ? 'G21 G90 G17 G40 G49' : 'G21 G90 G17 G40 G80')
  lines.push(machine.feedMode)
  if (machine.zeroAxesAtStart) {
    const zeros = [names.carriage, names.mandrel, names.head, ...(machine.axisCount === 4 ? [names.cross] : [])]
    lines.push(`G92 ${zeros.map((n) => `${n}0`).join(' ')}`)
  }

  let prev = { x: 0, a: 0, c: 0, y: 0 }
  let layer = -1

  plan.moves.forEach((m, i) => {
    if (m.layer !== layer) {
      layer = m.layer
      const info = plan.layers[layer]
      lines.push('')
      lines.push(
        comment(
          `Katman ${layer + 1}: ${info.kind === 'hoop' ? 'hoop' : 'helisel'} aci=${fmt(info.angleDeg, 2)} yaricap=${fmt(info.radius, 2)} bant=${info.bands}${info.patternSkip > 1 ? ` j=${info.patternSkip}` : ''}${info.dome ? ` dom=${fmt(info.dome.height, 2)} r0=${fmt(info.dome.poleRadius, 2)}` : ''}`
        )
      )
      if (machine.pauseBetweenLayers && layer > 0) {
        if (lnx) lines.push(`(MSG,Katman ${layer + 1} oncesi duraklama)`)
        lines.push('M0')
      }
    }

    const axes = [
      word(names.carriage, m.x, invert.carriage),
      word(names.mandrel, m.a, invert.mandrel),
      word(names.head, m.c, invert.head)
    ]
    if (machine.axisCount === 4) axes.push(word(names.cross, m.y, invert.cross))

    if (![m.x, m.a, m.c, m.y].every(Number.isFinite)) throw new Error('G-code: eksen değeri sonlu değil')
    // Kontrolcünün göreceği (3 ondalık yuvarlanmış) değerler: kutup yakınında ΔX 0,01 mm mertebesindedir,
    // F planın tam ΔX'inden türetilirse yuvarlama süreyi %10'a kadar saptırır.
    const cur = { x: r3(m.x), a: r3(m.a), c: r3(m.c), y: machine.axisCount === 4 ? r3(m.y) : m.y }
    if (m.kind === 'position') {
      lines.push(`G0 ${axes.join(' ')}`)
    } else {
      // eksen hız limiti girildiyse süre uzar (F düşer); girilmediyse elyaf boyu / elyaf hızı
      const minutes = moveMinutes(prev, { ...m, ...cur }, input.feedRate!, machine)
      const slowed = minutes > m.fiberLength / input.feedRate!
      let f: number
      if (machine.feedMode === 'G93') {
        f = 1 / minutes
      } else {
        // LinuxCNC kuralı: X/Y hareket ediyorsa F lineer bileşene, yoksa döner vektöre uygulanır
        const lin = Math.hypot(cur.x - prev.x, cur.y - prev.y)
        const rot = Math.hypot(cur.a - prev.a, cur.c - prev.c)
        f = lin > 1e-9 ? lin / minutes : rot > 1e-9 ? rot / minutes : Math.hypot(m.a - (plan.moves[i - 1] ?? m).a, m.c - (plan.moves[i - 1] ?? m).c) / minutes
      }
      if (!Number.isFinite(f) || f <= 0) throw new Error('G-code: besleme (F) sonlu pozitif değil')
      // Limitle yavaşlatılan harekette F aşağı yuvarlanır: yazılan F ile eksen hızı limiti aşmaz
      const dec = feedDecimals(f)
      lines.push(`G1 ${axes.join(' ')} F${slowed ? floorFixed(f, dec) : fmt(f, dec)}`)
    }
    prev = { x: cur.x, a: cur.a, c: cur.c, y: cur.y }
  })

  lines.push('')
  lines.push(comment('Bitis'))
  lines.push('G94')
  lines.push(lnx ? 'M2' : 'M30')
  return lines.join('\n') + '\n'
}
