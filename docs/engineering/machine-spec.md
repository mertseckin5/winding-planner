# Makine Tanımı (Hedef / Varsayım Tablosu)

Güncelleme: 2026-11-05, makine mühendisi. Kullanıcının fiziksel makinesi **yok**; aşağıdaki değerlerin hiçbiri kullanıcıdan gelmedi.
"bilinmiyor" = kullanıcı vermedi, uydurulmadı. "tahmin" = dayanağıyla verilmiş yön gösterici değer, makine değeri değil; yazılıma girilmez.

## 1. Eksenler

| Eksen | Görev | Birim | Yön (+) | Strok | Azami hız | Azami ivme | Tahrik / redüktör | Not |
|---|---|---|---|---|---|---|---|---|
| X (araba) | Kafayı mandrel boyunca taşır | mm | bilinmiyor | bilinmiyor (domlu katmanda −h·cosα … L + h·cosα gerekir) | bilinmiyor | bilinmiyor | bilinmiyor | REQ-002: dom varsa strok girilmeli |
| A (mandrel) | Mandreli döndürür, hep aynı yönde | ° (birikimli) | bilinmiyor | sınırsız (WRAPPED_ROTARY kapalı, rollover kapalı) | bilinmiyor | bilinmiyor | bilinmiyor | |
| C (kafa dönüşü) | Göz yönünü elyaf açısına çevirir | ° | bilinmiyor | REQ-003 sonrası 0…180° yeter (bugün −90…+90) | bilinmiyor | bilinmiyor | bilinmiyor | Dönme ekseninin yönü bilinmiyor (REQ-003 varsayımı) |
| Y (çapraz, isteğe bağlı) | Gözün mandrel eksenine radyal uzaklığı | mm, **sıfırı mandrel ekseni** | bilinmiyor | bilinmiyor (S1 örneğinde 60–92 mm kullanıldı) | bilinmiyor | bilinmiyor | bilinmiyor | REQ-001: G92 ile sıfırlanmamalı |

Kontrolcü: LinuxCNC veya Mach3 (kullanıcı ikisi arasında). Sürüm: bilinmiyor. Motor türü (adımlı/servo, kapalı çevrim): bilinmiyor.

## 2. Mandrel ve kafa geometrisi

| Büyüklük | Değer | Not |
|---|---|---|
| Mandrel çap aralığı | bilinmiyor | Örnek senaryolar Ø50 ve Ø120 (kullanıcı görevinden) |
| Mandrel boy aralığı | bilinmiyor | Örnek 400 ve 800 mm |
| Mandrel bağlama (ayna/punta), uç parçaların X konumu | bilinmiyor | Dom ucu X negatif bölgeye girer |
| Mandrel kütlesi / ataleti | bilinmiyor | |
| Uç pim halkası / uç tutucu | bilinmiyor | Düz silindir helisel uç dönüşü için gerekli (REQ-006) |
| Kutup parçası (boss) | bilinmiyor | Domlu kutup dwell'i için (REQ-006) |
| **Göz yarıçapı Re** (3 eksen: mandrel ekseninden göz çıkışına) | bilinmiyor | Yeni parametre, REQ-004 |
| Göz türü (yarık, makara, tarak), bant genişliği kapasitesi | bilinmiyor | |
| Göz–C ekseni ilişkisi (C ekseni serbest elyafa paralel mi, radyal mı) | bilinmiyor | REQ-003 varsayımı |
| Kafanın en dış noktası ile göz arası X mesafesi | bilinmiyor | Strok güvenliği için |

## 3. Elyaf ve reçine

| Büyüklük | Değer | Not |
|---|---|---|
| Elyaf / tow (ör. 12K, 24K) | bilinmiyor | Örneklerde bant 6 mm × 0,25 mm (ölçüm için seçildi, makine değeri değil) |
| Elyaf gerilimi (N) ve gerilim düzeni | bilinmiyor | Mandrel torkunu belirler (aşağıda) |
| Reçine banyosu türü (tambur/daldırma), göze uzaklığı | bilinmiyor | Banyo–göz arası elyaf yolu gerilim ve C bükülmesini etkiler |
| Elyaf–mandrel sürtünme katsayısı μ | bilinmiyor | Yeni parametre, REQ-006. Literatür 0,3–0,4 [C, arama özeti] — ölçülmeli |
| Elyaf hızı hedefi | bilinmiyor | Örnekte 3000 mm/dk |

## 4. Emniyet

| Madde | Durum |
|---|---|
| Acil durdurma (tüm eksen + gerilim serbest bırakma) | bilinmiyor |
| Limit anahtarları (X her iki uç, Y iç uç) | bilinmiyor |
| Mandrel dönme bölgesi koruması / kilit | bilinmiyor |
| Referanslama (home) sırası, Y'nin mandrel eksenine referansı | bilinmiyor (REQ-001) |

## 5. Motor seçimi için yön gösterici hesaplar (tahmin, makine değeri değil)

Hepsi örnek senaryo ölçümlerinden (review 2026-11-05) ve açıkça seçilmiş varsayımlardan; kullanıcı kendi değerleriyle yeniden hesaplamalı.

- **Gereken eksen hızları (örnekler, 3000 mm/dk elyaf hızında):** X 43,3 mm/s (2598 mm/dk, 30° gövde), A 95 °/s (Ø120 30° dom kutbu) – 160 °/s (Ø50 45° dom kutbu, = v/c), Y 25 mm/s (Ø120 dom), C ~115 °/s (dom kutbu yakını, REQ-003 sonrası; bugün dwell'de 420–1311 °/s). Elyaf hızıyla orantılı ölçeklenir.
- **Mandrel torku (tahmin):** T ≈ F_gerilim·r + J·ε. Örnek: Ø120 alüminyum boru, et 5 mm, 1 m (varsayım) → kütle ≈ 4,9 kg, J ≈ 0,016 kg·m²; ε = 180 °/s² (ölçülen A ivmesi mertebesi) → J·ε ≈ 0,05 N·m. Gerilim 30 N (varsayım, gerilim bilinmiyor) → F·r = 1,8 N·m. **Tork gerilimle belirlenir, atalet ihmal edilebilir** (bu örnekte). Redüktör oranı A için gereken 160 °/s ≈ 27 dev/dk ve tork için seçilmeli.
- **X durma mesafesi:** 43,3 mm/s'den a = 100 / 500 / 1000 mm/s² ile 9,4 / 1,9 / 0,9 mm. Uç dönüşünde bu mesafe kadar X ucu "yuvarlanır".
- **C (REQ-003 öncesi):** 180° kutup çevirmesi 0,137 s'de (Ø50 j=3) duruştan duruşa 38 216 °/s² ister; küçük adımlı motorla gerçekçi değil. REQ-003 bu ihtiyacı kaldırır.
