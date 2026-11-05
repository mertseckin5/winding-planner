export type Controller = 'linuxcnc' | 'mach3'
export type FeedMode = 'G94' | 'G93'
export type LayerKind = 'helical' | 'hoop'

/**
 * Kafa (C) açısı yazım sözleşmesi (REQ-003, docs/engineering/decisions.md ADR-003):
 * - 'fiber': C = elyafın mandrel eksenine göre yön açısı, sürekli, [0°, 180°]. Gidiş φ, dönüş 180° − φ,
 *   dom kutbunda 90° sabit (C = 0 elyaf eksenel, C = 90 elyaf çevresel). Göz bandı bükmez.
 * - 'mirror': eski simetrik ±φ (gidiş +φ, dönüş −φ, kutupta ±90° çevrilir).
 * Alan yoksa (eski kayıt) 'mirror' davranışı korunur ve arayüz/G-code başlığı uyarır.
 */
export type HeadAngleMode = 'fiber' | 'mirror'

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
  /** C yazım sözleşmesi; yok = eski kayıt (±φ, uyarılı). Yeni projelerde store 'fiber' başlatır. */
  headAngleMode?: HeadAngleMode
  /**
   * 3 eksen: göz yarıçapı Re, mandrel ekseninden göz çıkış noktasına radyal uzaklık (mm); null/yok = girilmedi,
   * serbest elyaf/gecikme hesabı yapılmaz (REQ-004). 4 eksende kullanılmaz (Re = katmanın Y'si).
   */
  eyeRadius?: number | null
  /**
   * REQ-005: eksen ivme limitleri, saniye tabanlı (X/Y mm/s², A/C °/s²; LinuxCNC INI MAX_ACCELERATION ile aynı birim).
   * Hız limiti (maxSpeed) dakika tabanlıdır. null/yok = girilmedi, o eksende ivme kontrolü yapılmaz.
   */
  maxAccel?: { carriage: number | null; mandrel: number | null; head: number | null; cross: number | null }
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
  /** REQ-006: elyaf–mandrel sürtünme katsayısı μ (birimsiz); null/yok = girilmedi, sayısal kayma kontrolü yapılmaz */
  friction?: number | null
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
  /**
   * REQ-004: göz ile temas noktası arasındaki serbest elyaf (gövde yarıçapında). Re girilmemişse (3 eksen) veya
   * Re ≤ r ise null. λ = √(Re² − r²)/sinα, g = √(Re² − r²)/tanα.
   */
  fiberLag: {
    /** Kullanılan göz yarıçapı Re (4 eksen: katmanın Y'si) */
    eyeRadius: number
    /** Serbest elyaf boyu λ (mm) */
    freeLength: number
    /** Eksenel gecikme g (mm): temas noktası kafanın bu kadar gerisinde */
    axialLag: number
    /** Domlu katman: kutupta λ = √(Re_kutup² − c²) (kutupta g = 0); diğerlerinde null */
    poleFreeLength: number | null
  } | null
  /** REQ-009 (3 eksen, Re girildiyse): göz boşluğu Re − bu katmanın dış yüzey yarıçapı (mm); diğer durumlarda null */
  eyeClearance: number | null
  /**
   * REQ-006/REQ-010 kayma kontrolü (μ girildiyse her katman; μ boşsa null). Kaymama koşulu k_g ≤ μ·k_n.
   * Düz: yarım uç dönüşü (α → 90°) x_t = (r/μ)(1/sinα − 1), θ_t = (1/μ)·ln(cot(α/2)); tam dönüş 2θ_t.
   * Domlu: kutup paralelinin k_g/k_n = (R/h)·√(R² − c²)/c.
   * Durağan aralık (ΔX = 0) genel: θ_req = |ln tan(ψ₂/2) − ln tan(ψ₁/2)|/μ (slip.ts).
   */
  slip: {
    friction: number
    /** Düz helisel: yarım uç dönüşünün eksenel uzunluğu x_t (mm, uç taşması); diğerlerinde null */
    turnAxial: number | null
    /** Düz helisel: yarım uç dönüşü θ_t (derece); diğerlerinde null */
    turnRotationDeg: number | null
    /** Düz helisel: tam uç dönüşü φ → 180° − φ için gereken 2θ_t; hoop: kendi uç dönüşünün θ_req'i; domluda null */
    turnFullDeg: number | null
    /** Domlu: kutup paraleli k_g/k_n; diğerlerinde null */
    poleRatio: number | null
    /**
     * Önceki katmandan geçişin durağan aralığındaki mandrel dönüşü ΔA (derece; önceki düz katmanın son dwell'i dahil);
     * ilk katmanda null. Hedef katman türünden bağımsız (REQ-010).
     */
    transitionTurnDeg: number | null
    /** Geçiş aralığı için θ_req (derece); ilk katmanda null */
    transitionRequiredDeg: number | null
    /** Geçiş aralığı için x_req (mm, yeni katman yarıçapıyla); ilk katmanda null */
    transitionAxial: number | null
  } | null
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
  /** REQ-009 (3 eksen, Re girildiyse): göz boşluğu Re − outerDiameter/2 (mm); diğer durumlarda null */
  eyeClearance: number | null
  /** Planın C değerlerini yazdığı sözleşme; generateGcode makineninkiyle aynı olmasını şart koşar */
  headAngleMode: HeadAngleMode
}
