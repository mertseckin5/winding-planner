import type { MachineConfig } from './types'

/** REQ-003: C açı sözleşmesi maddesi (G-code başlığında da yazılır). Kafa kinematiği makinede doğrulanmadı. */
export function headConventionItem(machine: MachineConfig): string {
  const C = machine.names.head
  const zero = `${C} = 90°: elyaf çevresel, göz yarığı mandrel eksenine paralel; ${C} = 0°: elyaf eksenel`
  if (machine.headAngleMode === 'fiber') {
    return `${C} sözleşmesi elyaf yönü 0–180°: gidişte φ, dönüşte 180° − φ, dom kutbunda 90° sabit (${zero})`
  }
  const mirror = `gidişte +φ, dönüşte −φ, uç dönüşünde kafa 2φ (kutupta 180°) çevrilir (${C} = 0°: elyaf eksenel)`
  if (machine.headAngleMode === 'mirror') return `${C} sözleşmesi simetrik ±φ: ${mirror}`
  return `${C} sözleşmesi SEÇİLMEMİŞ (eski kayıt): eski simetrik ±φ kullanıldı, ${mirror}; Makine bölümünden seç`
}

/** REQ-001: 4 eksende Y mandrel ekseninden mutlak; sıfırı kontrolcüde kurulur. */
export function crossReferenceItem(machine: MachineConfig): string {
  const Y = machine.names.cross
  return `${Y} sıfırı mandrel ekseni: kafa göz çıkışı mandrel ekseninden ölçülen D mm uzaktayken ${Y} göstergesi D okuyor (program G92 ile ${Y}'yi sıfırlamaz; LinuxCNC HOME_OFFSET/G54, Mach3 ofset)`
}

/**
 * Kontrolcü ayar kontrol listesi (docs/research/filament-winding-landscape.md bölüm 3, 5).
 * Kaynakların bir kısmı forum/ikincil: makinede ilk kuru çalıştırmada doğrulanmalı.
 */
export function controllerChecklist(machine: MachineConfig): string[] {
  const common = [headConventionItem(machine), ...(machine.axisCount === 4 ? [crossReferenceItem(machine)] : [])]
  return [...controllerItems(machine), ...common]
}

function controllerItems(machine: MachineConfig): string[] {
  const { names, axisCount, controller } = machine
  if (controller === 'linuxcnc') {
    // trivkins coordinates= harfleri standart X Y Z A B C sırasında yazılır
    const order = 'XYZABCUVW'
    const coords = [names.carriage, names.mandrel, names.head, ...(axisCount === 4 ? [names.cross] : [])]
      .sort((p, q) => order.indexOf(p) - order.indexOf(q))
      .join('')
      .toLowerCase()
    return [
      `[TRAJ] ANGULAR_UNITS = deg; ${names.mandrel} ve ${names.head} dönel eksen (açı derece)`,
      `[AXIS_${names.mandrel}] WRAPPED_ROTARY kapalı, MIN/MAX_LIMIT geniş (birikimli ${names.mandrel} on binlerce derece olur)`,
      `[AXIS_${names.mandrel}] MAX_VELOCITY (°/sn) tepe ${names.mandrel} hızının üstünde olmalı (aşılırsa elyaf hızı sessizce düşer)`,
      `Kinematik: trivkins coordinates=${coords}`,
      'Dönel eksen hareketinde ileri bakış kısıtlı olabilir; küçük segmentlerde (dom) hız düşerse G64 P ayarını dene (doğrulanmadı)'
    ]
  }
  return [
    `Mach3: ${names.mandrel} ve ${names.head} eksenleri "angular", birim başına adım derece için kalibre`,
    'Rot 360 Rollover kapalı, Ang Short Rot on G0 kapalı (açıksa birikimli A yanlış yönde/devirde dönebilir)',
    'Axis Correction Diameter değerini kontrol et; G94 birleşik harekette F yorumu etkilenebilir',
    'Birleşik harekette G93 (inverse-time) önerilir; Mach3 G93 desteği resmî kaynakla doğrulanamadı, makinede test et'
  ]
}
