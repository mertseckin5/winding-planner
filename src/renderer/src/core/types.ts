export type Controller = 'linuxcnc' | 'mach3'
export type FeedMode = 'G94' | 'G93'
export type LayerKind = 'helical' | 'hoop'

/** Makine tanımı: eksen adları, yönleri, denetleyici. Birimler: X mm, A/C derece. */
export interface MachineConfig {
  controller: Controller
  /** 3 = X/A/C, 4 = X/A/C + radyal çapraz eksen (Y) */
  axisCount: 3 | 4
  names: { carriage: string; mandrel: string; head: string; cross: string }
  invert: { carriage: boolean; mandrel: boolean; head: boolean; cross: boolean }
  feedMode: FeedMode
  zeroAxesAtStart: boolean
  /** Katmanlar arasında M0 ile dur (reçine / kontrol için) */
  pauseBetweenLayers: boolean
  /** Kontrolcüdeki eksen azami hızları (X mm/dk, A/C °/dk, Y mm/dk); null = girilmedi, kontrol yapılmaz. Eski kayıtlarda yok olabilir. */
  maxSpeed?: { carriage: number | null; mandrel: number | null; head: number | null; cross: number | null }
  /** Eksen strok sınırları (mm); null = girilmedi. Dönel eksenler sınırsız kabul edilir. Eski kayıtlarda yok olabilir. */
  travel?: { carriage?: TravelLimit; cross?: TravelLimit }
}

export interface TravelLimit {
  min: number | null
  max: number | null
}

export interface Layer {
  id: string
  kind: LayerKind
  /** Yalnız helisel: mandrel eksenine göre sarım açısı (derece) */
  angleDeg: number | null
  /** Yalnız helisel: iki uçta yarım-elips dom üzerinden geodezik sarım (eksik/undefined = false) */
  dome?: boolean
  /** Dom yüksekliği (mm, ekvatordan kutba eksenel); gizli varsayılan yok */
  domeHeight?: number | null
  /**
   * Yalnız helisel: desen atlaması j. Devre dönüşü θc = 2πN + 2π·j/n; gcd(j, n) = 1 ve 1 ≤ j ≤ n−1 olmalı.
   * Yok/null = 1 (komşu bant, önceki davranış).
   */
  patternSkip?: number | null
}

/** null = kullanıcı henüz girmedi; gizli varsayılan yok. */
export interface WindingInput {
  mandrelDiameter: number | null
  windLength: number | null
  bandWidth: number | null
  /** Tek kat bant kalınlığı; her katman gidiş-dönüş 2 kat kalınlık ekler */
  bandThickness: number | null
  /** Elyaf hızı, mm/dak (elyaf boyunca) */
  feedRate: number | null
  /** Uçlarda carriage dururken mandrelin dönmesi gereken asgari açı (derece) */
  turnDwellMinDeg: number | null
  /** 4 eksen: kafa ile sarım yüzeyi arasındaki radyal boşluk (mm) */
  standoff: number | null
  layers: Layer[]
}

/** position = ilk G0 (elyaf bağlanmadan); transition = katmanlar arası G1 geçiş (elyaf bağlı) */
export type MoveKind = 'position' | 'transition' | 'pass' | 'dwell'

export interface Move {
  kind: MoveKind
  layer: number
  /** Mutlak mantıksal eksen değerleri (X mm, A/C derece, Y mm) */
  x: number
  a: number
  c: number
  y: number
  /** Elyaf yolu uzunluğu (mm); position için 0 */
  fiberLength: number
  /** Sarım yarıçapı (mm), önizleme için */
  radius: number
}

export interface LayerInfo {
  index: number
  kind: LayerKind
  angleDeg: number
  radius: number
  bands: number
  circuits: number
  turnDwellDeg: number
  /** Yalnız helisel: kullanılan desen atlaması j (hoop'ta 1) */
  patternSkip: number
  fiberLength: number
  /** Toplam bant genişliği / çevre (1 = tam kapsama, >1 örtüşme) */
  coverage: number
  warnings: string[]
  /** Yalnız domlu helisel katman */
  dome?: {
    height: number
    /** Kutup açıklığı yarıçapı r0 = R·sin(α) (mm) */
    poleRadius: number
    /** Kutup açıklığının eksenel uzaklığı: sol kutup x = −poleOffset, sağ kutup x = L + poleOffset */
    poleOffset: number
    /** Analitik kalınlık örnekleri (dome.domeThickness): z = ekvatordan eksenel uzaklık, r = yarıçap, t = kalınlık (mm) */
    thickness: { z: number; r: number; t: number }[]
    /** Azami kalınlık (kutup açıklığından bir bant genişliği içindeki ortalama, mm) */
    maxThickness: number
    /** Sınırlama yarıçapı c + w: bunun altında kalınlık sabit (ortalama) tutulur */
    capRadius: number
    /**
     * Önceki domlu katmanların bu katmanın dom yolu boyunca birikmiş kalınlığı ile modelin varsaydığı
     * (her önceki katman 2·bant kalınlığı) farkının azamisi (mm). Pozitif = gerçek yüzey modelden dışarıda.
     */
    buildup: number
    /** 4 eksen: etkin kafa boşluğu = kafa boşluğu − buildup (mm); 3 eksende null */
    clearance: number | null
  }
}

export interface WindingPlan {
  moves: Move[]
  layers: LayerInfo[]
  totalFiberLength: number
  /** Elyaf boyu / elyaf hızı (eksen hız limiti hesaba katılmadan); limitli süre: limits.estimateMinutes */
  totalMinutes: number
  /** Planın hesaplandığı elyaf hızı (mm/dk) */
  feedRate: number
  outerDiameter: number
}
