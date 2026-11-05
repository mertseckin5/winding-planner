# İlk İnceleme — Makine Mühendisi (2026-11-05)

Kapsam: Winding Planner'ın mevcut çekirdeği (`core/winding.ts`, `dome.ts`, `gcode.ts`, `limits.ts`, `verify.ts`, `firstWind.ts`, `simkit.ts`) ve ürettiği G-code'un fiziksel tutarlılığı. `src/` değiştirilmedi. Sonuç: 8 REQ (`requirements.md`), backlog güncellendi.

## 1. Yöntem

- Betik: `docs/engineering/scripts/measure-2026-11-05.mm.test.ts` (yalnız `core/` fonksiyonlarını çağırır).
  Çalıştırma: `npx vitest run --config docs/engineering/scripts/vitest.mm.config.ts --reporter=verbose` (proje vitest ayarı yalnız `src/**` aldığı için ayrı ayar dosyası).
- G-code bağımsız okuyucuyla (`gcode-reader.testutil.ts`) okundu; her G1'in süresi LinuxCNC kuralıyla (G94: lineer varsa lin/F, yoksa rot/F; G93: 1/F) hesaplandı. Eksen hızı v = Δ/T. Ardışık G1'ler arasında |Δv| ve "tahmini ivme" = |Δv| / min(T_önceki, T_sonraki) (hız değişimi kısa komşu harekete sığmalıysa gereken ivme; üst kestirim) ve |Δv| / ortalama T. Uç dönüşünde C için duruştan duruşa üçgen profil ivmesi 4·ΔC/T².
- Senaryolar (bant kalınlığı 0,25 mm ve uç asgari 20° ölçüm için seçildi):
  - **S1** Ø120×800, bant 6 mm, 3000 mm/dk, katmanlar 30° domlu (h = 60) + hoop + 55° düz, 4 eksen, kafa boşluğu 30 mm, LinuxCNC; G93 ve G94.
  - **S2** Ø50×400, bant 6 mm, 3000 mm/dk, 45° domlu (h = 25), 3 eksen, LinuxCNC G94; j = 1 ve en kısa uç dönüşlü j > 1 (j = 3).
  - **S3** S1 + varsayımsal hız limitleri (X 10 000 mm/dk, A/C 10 800 °/dk, Y 3000 mm/dk) — yalnız uzatma davranışını görmek için, makine değeri değil.

## 2. Ölçümler

### S1 (4 eksen)
| Büyüklük | Değer |
|---|---|
| G1 sayısı / süre | 5653 / 116,52 dk (G93 ve G94 aynı, plan oranı 1,00000) |
| Doğrulayıcı | sorun yok |
| X aralığı | −51,96 … 851,96 mm |
| Y aralığı (program) | 60,4 … 91,5 mm (mandrel ekseninden mutlak) |
| C aralığı | −90 … +90° |
| Tepe hız | X 43,3 mm/s, A 95,1 °/s, **C 420,2 °/s** (25 211 °/dk), Y 25,0 mm/s |
| Tepe |Δv| | X 40,6 mm/s, A 79,5 °/s, C 420,2 °/s, Y 24,0 mm/s |
| Tahmini ivme (kısa komşu) | X 67 mm/s², A 86 °/s², **C 4687 °/s²**, Y 61,6 mm/s² |
| K1 (30° domlu) | n = 55, uç dönüşü 104,4° (1,10 s), ΔC = −180°, C ort. 164 °/s; kutupta bant sığmıyor (%174); r0 = 30,12 |
| K2 (hoop 89,1°) | uç dönüşü 20° (0,42 s), **ΔC = −178,2°**, C 420 °/s, üçgen profil 3963 °/s² |
| K3 (55° düz) | n = 37, uç dönüşü 196,1° (4,19 s), ΔC = −110° |
| Geçiş K1→K2 | ΔX +51,96, ΔY +30,6, ΔA 20°, 1,28 s (dom kutbundan gövdeye tek doğrusal G1) |
| Geçiş K2→K3 | ΔC +144,1° 0,43 s'de (337 °/s) |
| Kutup yakını | en küçük ΔX 0,050 mm, parça süresi 0,053 s; G94 F = 113,6, G93 F = 1142,3; Y dom boyunca ±2,1 mm/parça |
| S3 (limitli) | C 180 °/s'ye indirildi, süre +0,02 dk (yalnız hoop dwell ve K2→K3 geçişi uzadı); doğrulayıcı temiz |

### S2 (3 eksen G94)
| Büyüklük | j = 1 | j = 3 |
|---|---|---|
| Uç dönüşü | 183,1° (1,14 s) | 22,0° (0,137 s) |
| Süre | 8,89 dk | 8,25 dk |
| Tepe A | 160,5 °/s (= v/c, c = 17,85) | 160,5 °/s |
| Tepe C | 157,8 °/s | **1311 °/s** (78 683 °/dk) |
| Tepe C |Δv| | 272 °/s | 1425 °/s |
| C tahmini ivme (kısa komşu) | 9986 °/s² | **52 397 °/s²** |
| C üçgen profil (kutup dwell 180°) | 553 °/s² | **38 216 °/s²** |
| Kutup yakını | en küçük ΔX 0,026 mm, F 57,35 (G94), 0,027 s | aynı |
| X aralığı | −17,68 … 417,68 mm | aynı |

Desen adayları (S2): j=3 δ=22,0°, j=4 31,5°, j=5 41,0° … (hepsi N=6).

## 3. Bulgular

1. **Kutup ve hoop uç dönüşündeki C çevirmesi fiziksel olarak gereksiz ve bandı büküyor (REQ-003, A1).** C dönüşte −φ yazılıyor; elyafın gerçek yönü 180° − φ. Aynı doğrultu ama göz sürekli döndüğü için dönüş geçişinde serbest bantta 180° bükülme kalır ve uç dönüşü boyunca göz elyafa dik konumdan geçer. Kutupta ve hoop'ta C'nin hiç (veya 1,8°) dönmesi gerekmezken 178–180° dönüyor; tüm C tepe hızları (420, 1311 °/s) ve ivmeleri buradan geliyor. Düzeltme C'nin [0, 180]° aralığında salınması.
2. **G92 Y0 ile mutlak radyal Y çelişkili (REQ-001).** Y değerleri mandrel ekseninden ölçülüyor ama başlangıçta kafa nerede ise Y = 0 yapılıyor. Ayrıca ilk G0 tüm eksenleri birlikte taşıyor (dom başlangıcı X −52 mm, ayna bölgesi) ve elyaf bağlama için duraklama yok.
3. **Domlu katmanda X strok kontrolü isteğe bağlı (REQ-002).** Kafa ayna/punta bölgesine giriyor; strok girilmezse hiçbir kontrol yok.
4. **Serbest elyaf gecikmesi modellenmiyor (REQ-004, A8).** Göz temas noktasının X'inde varsayılıyor; Re = Y ile S1'de 30° gövdede gecikme 117 mm, 55°'de 47,6 mm. Uç dönüşü ve dom girişi bu kadar kayar. Bu, kapsamanın uçlarda kapanmaması demek; şu an en büyük geometri hatası.
5. **Uç dönüşleri sürtünmeyle tutulamaz (REQ-006, A2).** Düz silindirde kaymasız dönüş μ = 0,3 için 55°'de ≥ 45 mm eksenel / 125°, 30°'de ≥ 200 mm / 252° ister; dwell sıfır eksenel uzunlukta döner → pim halkası şart. Dom kutup dwell'i paralel çember üzerinde: k_g/k_n S1 1,74, S2 1,01 (μ ≈ 0,3–0,4'ün çok üstü) → kutup parçası yoksa kayar; uzun dwell (S2 j=1 183°) daha kötü. j > 1 (22°) kutup dwell'ini kısaltır; REQ-003 ile C maliyeti de kalkar.
6. **Dom→gövde geçişi geodezik değil (REQ-007).** S1 K1→K2: elyaf kutuptan ekvatora 20° dönüşle, neredeyse meridyen boyunca çekiliyor.
7. **İvme bilinmiyor (REQ-005, A3).** Hız sıçramaları anlık varsayılıyor; X 40,6 mm/s uçta sıfıra iner. Süre ve elyaf hızı ivmeyle değişir; adımlı motorda ayar yüksekse adım kaybı.
8. **Olumlu:** G93 ve G94 süreleri plana birebir uyuyor (oran 1,00000); kutup yakını F düzeltmesi çalışıyor (0,026 mm ΔX'te bile); A hiç geri gitmiyor; hız limitiyle uzatma C'yi tam limite indiriyor ve doğrulayıcı temiz. Dom üzerinde Y takibi pürüzsüz (parça başına ≤ 2,1 mm, tepe 25 mm/s).
9. **Not (REQ değil):** Kutup parçası en kısa 0,027 s (S2). LinuxCNC'nin dönel eksenli harekette ileri bakışı kısıtlıysa [C, doğrulanmadı] her parçanın sonunda durabilecek hız v ≤ √(2·a·Δ): A için 160 °/s ve Δ = 4,36° → a ≥ 2936 °/s² gerekir. LinuxCNC sim ile ölçülmeli (REQ-005 ek bilgisi).

## 4. Sonuç

Fiziksel olarak tutarlı bulunanlar: süre/F hesabı (iki besleme modu), A birikimli tek yön, geodezik dom yolu (Clairaut; C = φ), Y'nin dom profiline uyması (Y referansı düzeltilirse), hız limitiyle uzatma.
Fiziksel olarak tutarsız bulunanlar: C dönüş sözleşmesi, Y sıfırlama, dom→gövde geçişi, göz = temas noktası varsayımı, sürtünmesiz uç dönüşü. Hiçbiri makinede doğrulanmadı; makine yok.
