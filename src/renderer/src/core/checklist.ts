import type { MachineConfig } from './types'

/**
 * Kontrolcü ayar kontrol listesi (docs/research/filament-winding-landscape.md bölüm 3, 5).
 * Kaynakların bir kısmı forum/ikincil: makinede ilk kuru çalıştırmada doğrulanmalı.
 */
export function controllerChecklist(machine: MachineConfig): string[] {
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
