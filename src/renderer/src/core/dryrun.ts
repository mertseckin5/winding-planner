import { comment as c, fmt } from './gcode'
import type { MachineConfig } from './types'

/**
 * Kuru çalıştırma (elyaf ve mandrel yüküsüz) test programı: eksen yönü, A birimi ve besleme yorumu.
 * G91 artımlı: sıfır noktasına bağlı değil. Her eksen + sonra − yönünde 10 birim gider.
 * G93 seçiliyse birleşik X+A hareketi 30 sn sürmeli (F2 = 0,5 dak).
 */
export function generateDryRun(machine: MachineConfig): string {
  const { names, invert } = machine
  const s = (inv: boolean): number => (inv ? -1 : 1)
  const w = (n: string, v: number, inv: boolean): string => `${n}${fmt(v * s(inv))}`
  const lines: string[] = []

  lines.push(c('Kuru calistirma testi - winding-planner'))
  lines.push(c('Elyaf ve mandrel yuksuz calistir; acil durdurma elinin altinda olsun'))
  lines.push(c(`Her eksen once + sonra - yonunde 10 birim: ${names.carriage} mm, ${names.mandrel}/${names.head} derece`))
  lines.push(c('Yon beklenenle uyusmuyorsa ilgili eksenin ters kutusunu isaretle ve programi yeniden uret'))
  lines.push(c(`${names.mandrel} 10 derece = mandrelde 10/360 tur olmali (birim hatasi testi)`))
  lines.push(machine.controller === 'linuxcnc' ? 'G21 G90 G17 G40 G49' : 'G21 G90 G17 G40 G80')
  lines.push('G94')
  lines.push('G91')

  lines.push(c(`${names.carriage} ekseni (F100 mm/dak, 6 sn)`))
  lines.push(`G1 ${w(names.carriage, 10, invert.carriage)} F100`)
  lines.push(`G1 ${w(names.carriage, -10, invert.carriage)} F100`)
  lines.push(c(`${names.mandrel} ekseni (F600 derece/dak, 1 sn)`))
  lines.push(`G1 ${w(names.mandrel, 10, invert.mandrel)} F600`)
  lines.push(`G1 ${w(names.mandrel, -10, invert.mandrel)} F600`)
  lines.push(c(`${names.head} ekseni (F600 derece/dak, 1 sn)`))
  lines.push(`G1 ${w(names.head, 10, invert.head)} F600`)
  lines.push(`G1 ${w(names.head, -10, invert.head)} F600`)
  if (machine.axisCount === 4) {
    lines.push(c(`${names.cross} ekseni (F100 mm/dak, 6 sn)`))
    lines.push(`G1 ${w(names.cross, 10, invert.cross)} F100`)
    lines.push(`G1 ${w(names.cross, -10, invert.cross)} F100`)
  }

  if (machine.feedMode === 'G93') {
    lines.push(c(`G93 testi: ${names.carriage} ve ${names.mandrel} birlikte, her hareket 30 sn surmeli (kronometre)`))
    lines.push('G93')
    lines.push(`G1 ${w(names.carriage, 10, invert.carriage)} ${w(names.mandrel, 10, invert.mandrel)} F2`)
    lines.push(`G1 ${w(names.carriage, -10, invert.carriage)} ${w(names.mandrel, -10, invert.mandrel)} F2`)
    lines.push('G94')
  } else {
    lines.push(c('G94 birlesik hareket testi yok: bu modda F yorumu kontrolcuye gore degisir, G93 onerilir'))
  }

  lines.push('G90')
  lines.push(c('Bitis'))
  lines.push(machine.controller === 'linuxcnc' ? 'M2' : 'M30')
  return lines.join('\n') + '\n'
}
