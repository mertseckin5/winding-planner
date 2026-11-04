import type { MachineConfig } from './types'

export interface FirstWindStep {
  title: string
  items: string[]
}

/**
 * Makine kurulunca ilk sarım için sıralı kontrol listesi (kullanıcı işaretler; ölçüm üretmez, eşik vermez).
 * Adım sırası rakip projenin first_wind_procedure.py adım adlarından uyarlandı (docs/research/flamenet-comparison.md
 * §7.4.10); oradaki rastgele gerilim "ölçümleri" ve sabit eşikler alınmadı. Eksen adları makine ayarından gelir.
 */
export function firstWindSteps(machine: MachineConfig, opts: { hasDome?: boolean } = {}): FirstWindStep[] {
  const { carriage: X, mandrel: A, head: C, cross: Y } = machine.names
  const four = machine.axisCount === 4
  const axes = [X, A, C, ...(four ? [Y] : [])].join(', ')
  const steps: FirstWindStep[] = [
    {
      title: 'Kuru çalıştırma (elyaf yok)',
      items: [
        'Elyaf bağlı değil, mandrel boş veya yüksüz, çalışma bölgesi temiz',
        `"Kuru test" programını çalıştır: ${axes} eksenlerinin yönü ve birimi doğru`,
        `Asıl programı elyafsız, havada baştan sona çalıştır; ${X} strok sınırına yaklaşmıyor`
      ]
    },
    {
      title: `Yalnız mandrel (${A})`,
      items: [
        'Mandrel aynaya/puntaya sıkı bağlı, salgı yok',
        `${A} için 360° komutunda mandrel tam bir tur dönüyor (işaretle kontrol et)`,
        `${A} aynı yönde dönmeye devam ediyor; kontrolcü ${A} değerini 360°'de sarmıyor (rollover kapalı)`
      ]
    },
    {
      title: `Yalnız araba (${X})${four ? ` ve kafa (${C}, ${Y})` : ` ve kafa (${C})`}`,
      items: [
        `${X} kızağı serbest ve yağlı, limit anahtarları çalışıyor`,
        `${C} kafa dönüşü ±90° komutlarında doğru yöne ve açıya gidiyor, kablo/elyaf yolu dolanmıyor`,
        ...(four ? [`${Y} kafa boşluğu: en dış katman yarıçapında kafa mandrel ve uç parçalara çarpmıyor`] : [])
      ]
    },
    {
      title: 'Düşük gerilimle elyaf bağlama',
      items: [
        'Elyaf makaradan doğru yönde açılıyor, kılavuzlar ve payout gözü hizalı',
        'Gerilim düzeni en düşük ayarda; gerilim ölçer varsa sıfırlandı',
        'Elyaf ucu mandrele sağlam bağlandı (bant, uç halkası veya pim)'
      ]
    },
    {
      title: 'Tek devre',
      items: [
        'Programı düşük elyaf hızıyla başlat, ilk devre bitince duraklat (feed hold)',
        'Uç dönüşünde elyaf kaymıyor, bant düz yatıyor',
        'Devre sonunda yeni bant, seçilen desene göre (j) doğru yuvaya düşüyor'
      ]
    },
    {
      title: 'Beş devre',
      items: ['Bantlar arasında boşluk veya istenmeyen bindirme yok', 'Gerilim devreler boyunca kararlı (ölçer varsa kaydet)']
    },
    {
      title: 'Tam helisel katman',
      items: [
        'Katman sonunda yüzey tamamen kaplandı',
        'Katman süresi plandaki süreyle uyumlu (kontrolcü sessizce yavaşlatmıyor)',
        'Uçlarda yığılma ve kayma kabul edilebilir düzeyde'
      ]
    }
  ]
  if (opts.hasDome) {
    steps.push({
      title: 'Dom geçişi',
      items: [
        `Dom üzerinde ${X} negatif değerlere gidiyor; sıfır noktası ve strok buna uygun`,
        'Kutup açıklığına yakın elyaf kaymıyor, kutupta yığılma gözle kontrol edildi',
        ...(four ? [`${Y} dom profilini izliyor, kafa yüzeye yaklaşmıyor (kalınlık birikimi uyarılarına bak)`] : [])
      ]
    })
  }
  steps.push(
    {
      title: 'Program sonu ve elyaf kesme',
      items: [
        `Program ${A} eksenini geri döndürmez; elyaf kesilmeden mandreli ters çevirme (geri sarma) yapma`,
        'Katman arası duraklamalarda (M0) devam etmeden önce elyaf gergin ve yerinde'
      ]
    },
    {
      title: 'Acil durdurma tatbikatı',
      items: [
        'Çalışma sırasında acil durdurmaya bas: tüm eksenler duruyor',
        'Elyaf serbest bırakılabiliyor, operatör yeniden başlatma sırasını biliyor'
      ]
    }
  )
  return steps
}
