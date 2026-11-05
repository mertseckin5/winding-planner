# Tasarım Kararları (Yazılım Mühendisi)

Biçim: bağlam, karar, alternatifler, sonuç, ilgili REQ. Gereksinimler: `requirements.md`. Kabul testleri: `src/renderer/src/core/mm-req.test.ts` (test adları REQ numarasını içerir), `src/renderer/src/store.test.ts`.
Hiçbir karar makinede doğrulanmadı (makine yok); "hesap ve biçim olarak doğrulandı" anlamındadır.

---

## ADR-001 — İlk konumlama: G92'de Y yok, üç satırlı 4 eksen yaklaşımı, ilk G1 öncesi M0 (2026-11-05)
**İlgili:** REQ-001

**Bağlam.** 4 eksende Y mandrel ekseninden mutlak radyal uzaklık; `G92 … Y0` bu referansı bilinmeyen miktarda kaydırıyordu. İlk `G0` tüm eksenleri birlikte taşıyordu; elyaf bağlama anı yoktu.

**Karar.**
- `gcode.ts`: `G92` yalnız X/A/C'yi sıfırlar (3 ve 4 eksen). Y'nin sıfırı kontrolcüde kurulur; kontrol listesine ve ilk sarım adımlarına "Y sıfırı mandrel ekseni: … D mm uzaktayken Y göstergesi D okuyor" maddesi eklendi (G-code başlığında da `AYAR KONTROL`).
- 4 eksende plandaki tek `position` hareketi G-code'da üç satır yazılır: `G0 Y<Ygeri>` → `G0 X A C` → `G0 Y<başlangıç>`. Ygeri = plandaki tüm hareketlerin en büyük mantıksal Y'si (programdan türetilir, gizli değer yok; tersleme `word()` ile uygulanır).
- Konumlamadan sonra her zaman `M0`; LinuxCNC'de önce `(MSG,Elyafi bagla, devam icin Cycle Start)`, Mach3'te aynı metin düz yorum (MSG yalnız LinuxCNC). "Katman arası duraklama" ayarından bağımsız.

**Alternatifler.** (a) Üç ayrı `Move` türü (`retract`/`approach`) eklemek: `Move[]` her harekette tüm eksenleri taşıdığından "yalnız Y" satırı yine G-code katmanında ayrıştırılmak zorundaydı; limits/verify/önizleme tarafında anlamsız sıfır süreli hareketler doğardı. Reddedildi. (b) G92'yi tamamen kaldırmak: X/A/C için kullanıcının mevcut iş akışını bozar. Reddedildi.

**Sonuç.** Altın çıktılar değişti (ADR-005). `invariants.test.ts`: "M0 sayısı = katman sınırı + 1", ilk G1'den önce 3 (4 eksen) / 1 (3 eksen) G0. Test okuyucularına modal eksen takibi ve `motionRows` (baştaki G0'ları plandaki tek `position` ile eşler) eklendi. Y tüm program boyunca sabitse (tek düz katman) ilk ve üçüncü satır aynı Y'yi yazar; zararsız. 3 eksende ilk G0 X/A/C'yi birlikte taşımaya devam eder (REQ yalnız 4 ekseni istiyor; bkz. MM sorusu S2).

---

## ADR-002 — Makineye bağlı eksik alan kuralları: `missingFields(input, machine)` (2026-11-05)
**İlgili:** REQ-002, REQ-004

**Bağlam.** `missingFields(input, axisCount)` yalnız geometriyi görüyordu; REQ-002 strok sınırlarını (makine) ve REQ-004 göz yarıçapını (makine) istiyor. Fonksiyon ~30 yerde (testler, desen adayları, MM ölçüm betiği) eksen sayısıyla çağrılıyor.

**Karar.** İkinci parametre `PlanTarget = 3 | 4 | Pick<MachineConfig, 'axisCount' | 'headAngleMode' | 'eyeRadius' | 'travel'>`. Makine verilirse:
- En az bir domlu katman varsa `travel.carriage.min` ve `.max` sonlu olmalı; değilse `X strok sınırları (domlu katman X'i −h·cosα'ya götürüyor)` (sabit `DOME_TRAVEL_FIELD`). Domsuz programda kural yok. Girilmişse doğrulayıcının mevcut strok hatası yeterli.
- 3 eksende `eyeRadius` girilmişse > 0 ve her katman yarıçapından büyük olmalı; değilse "Göz yarıçapı Re=… mm katman k yarıçapından (… mm) küçük: kafa mandrele çarpar". Boşsa kontrol yok.
Eksen sayısı verilirse yalnız geometri denetlenir (eski davranış). Uygulama (`App.tsx`) her zaman makineyi verir; arayüzde strok bölümü başlığı domlu katman varken "domlu katmanda X zorunlu" der ve uyarı metni gösterir.

**Alternatifler.** Zorunlu üçüncü parametre (tüm çağrıları değiştirir, MM betiğini de; betik silinmemeli/bozulmamalı). Ayrı `machineMissingFields` fonksiyonu (ana oturum "missingFields aynı kuralı uygulasın" dedi). Reddedildi.

**Sonuç / risk.** Sayı ile çağıran yeni bir üretim kodu kuralı atlar; şu an yalnız `patternCandidates` (desen listesi stroka bağlı olmamalı) ve testler böyle çağırıyor.

---

## ADR-003 — Kafa (C) açısı sözleşmesi seçilebilir; yeni projede 'fiber' (2026-11-05)
**İlgili:** REQ-003

**Bağlam.** MM: C gidişte +φ, dönüşte −φ sözleşmesi göz bandını uç dönüşünde 180° çevirir ve kutupta/hoop'ta gereksiz 178–180° C hareketi üretir (S2 j=3 tepe C 1311 °/s). Önerilen: C = elyaf yön açısı, sürekli, [0°, 180°]. Ancak doğru sözleşme kafa kinematiğine bağlı (C hangi eksen etrafında döner, C = 0 ne demek) ve kullanıcı bunu henüz yanıtlamadı.

**Karar.**
- `MachineConfig.headAngleMode?: 'fiber' | 'mirror'`. `'fiber'`: gidiş φ, dönüş 180° − φ, dom kutup dwell'i 90° → 90°, düz/hoop uçta φ ↔ 180° − φ. `'mirror'`: eski ±φ, birebir eski sayılar.
- Uygulama: `winding.ts` `Ctx.back(φ)` dönüş açısını üretir (fiber `180 − φ`, mirror `−φ`); başka hesap değişmedi. Plan kullandığı sözleşmeyi `WindingPlan.headAngleMode`'da taşır; `generateGcode` makine ayarıyla uyuşmazsa hata atar (başlıktaki açıklama ile yazılan C ayrışamaz).
- **Yeni projelerde başlangıç seçimi `'fiber'`.** Gerekçe: (1) elyafın mandrel üzerindeki yönü fiziksel olarak sürekli φ → 90° → 180° − φ'dir; C ekseni elyafa yaklaşık paralel bir eksen etrafında dönen her kafada (MM varsayımı) bant bükülmez; (2) C hızı/ivmesi büyük ölçüde düşer (G-code'dan okunan S2 j=3 tepe C 1311 → ≤ 200 °/s, testte ölçülüyor; S1 başlık tepe C 25 211 → 5 035 °/dk); (3) iki sözleşmenin C aralığı aynı genişlikte (180°), ek strok istemez; (4) kafa farklı yapıdaysa kullanıcı tek seçimle eski davranışa döner. Risk: kafa kinematiği bu varsayıma uymuyorsa 'fiber' de yanlıştır; bu yüzden seçim arayüzde, kontrol listesinde ve ilk sarım adımlarında açıkça yazılı ve "makinede doğrulanmadı".
- **Eski veri:** alan yoksa (eski proje dosyası, eski persist kaydı) davranış değişmez (`resolveHeadMode` → `'mirror'`) ve kullanıcı uyarılır: arayüzde seçim kutusu "Seçilmedi (eski kayıt: ±φ)" gösterir + turuncu uyarı; G-code başlığı `AYAR KONTROL: C sozlesmesi SECILMEMIS (eski kayit)…`. zustand persist makine nesnesini sığ birleştirmeyle bütün olarak geri yüklediği için eski kayıtta alan yok kalır (`store.test.ts` ile kanıtlandı); yeni kurulumda store `'fiber'` başlatır. `project.ts` alanı yalnız varsa okur (`fiber`/`mirror` dışı reddedilir); dosya sürümü 1 kaldı (alan isteğe bağlı).
- Kontrol listesine (iki kontrolcü, başlıkta da) C sözleşmesi ve C sıfırı tanımı eklendi: "C = 90°: elyaf çevresel, göz yarığı mandrel eksenine paralel; C = 0°: elyaf eksenel". G-code yorumlarında φ → `phi`, ± → `+/-`, − → `-` (önceden `?` oluyordu).

**Alternatifler.** (a) Yalnız yeni sözleşme (kullanıcı kinematiği yanıtlamadan geri dönüşsüz). (b) Plan hep 'fiber', G-code'da çevirme: limits/verify/son konum karşılaştırması plan C'sini kullandığından çift kaynak doğar. (c) Eski kayıtları sessizce 'fiber'e taşımak: kayıtlı bir programın çıktısı habersiz değişir. Hepsi reddedildi.

**Sonuç.** Bilinen kalan: katmanlar arası geçişte C yine büyük dönebilir (ör. 150° → 55°); geçiş yolu REQ-007'de ele alınacak. Eski uygulama sürümü yeni dosyayı açarsa alanı tanımaz ve ±φ yazar (uyarısız); tek yönlü uyumluluk.

---

## ADR-004 — Serbest elyaf λ ve uç gecikmesi g (yalnız rapor) (2026-11-05)
**İlgili:** REQ-004

**Karar.** `MachineConfig.eyeRadius?: number | null` (3 eksen, mm; boş = hesap yok). 4 eksende Re = katmanın gövde Y'si (REQ-001 ile Y mutlak). `planWinding(input, machine)` her katman için `LayerInfo.fiberLag = { eyeRadius, freeLength λ = √(Re² − r²)/sinα, axialLag g = √(Re² − r²)/tanα, poleFreeLength }` (r = katman yol yarıçapı, α = helisel açı veya hoop açısı); domlu katmanda kutupta λ = √(Re_kutup² − c²) (4 eksende Re_kutup = kutup Y'si, 3 eksende Re). Re ≤ r ise `fiberLag = null` (eksik alan zaten üretimi durdurur, NaN yok). Uyarı yalnız helisel katmanlarda (REQ metni "her helisel katman"): "Elyaf mandrele kafanın ~g mm gerisinde değiyor; uç dönüşü x≈g / L−g mm civarında başlar (… göz yolu düzeltilmedi)". Arayüz katman satırında λ, g, Re ve kutup λ'sını gösterir; 3 eksende Makine bölümünde "Göz yarıçapı Re (boş = hesap yok)" alanı. G-code değişmez.

**Sonuç.** Yol düzeltmesi yok (REQ'e göre sonraki tur). Çarpışma kontrolü REQ metnindeki gibi yol yarıçapı r ile yapılır (bkz. MM sorusu S1).

---

## ADR-005 — Altın çıktıların bilinçli güncellenmesi (2026-11-05)
**İlgili:** REQ-001, REQ-003

Eski kodun 6 altın çıktısı kaydedilip yeni kodla satır satır karşılaştırıldı. Eski sözleşmeyle (alan yok/'mirror') fark yalnız: başlıkta C sözleşmesi (ve 4 eksende Y sıfırı) `AYAR KONTROL` satırları, 4 eksende `G92 X0 A0 C0` (Y yok), 4 eksende ilk G0'ın üç satıra bölünmesi, ilk G1 öncesi elyaf bağlama mesajı + `M0`. 'fiber' seçili örneklerde ek olarak C sözcükleri, G94'te lineer bileşeni olmayan satırların F'i (F = hypot(ΔA, ΔC)/süre, süre aynı) ve başlıktaki tepe C hızı değişti; X/A/Y ve toplam süre aynı. Bu son iddia `mm-req.test.ts` "REQ-003 altın fark" testiyle her altın örnek için iki sözleşme arasında kanıtlanıyor. Yeni özetler `golden.test.ts`'te, eskileri yorumda. Altın örneklerden biri bilerek eski kayıt (alan yok), biri açık 'mirror', dördü 'fiber'.

---

## ADR-006 — Göz yarıçapı dış yarıçapla karşılaştırılır; göz boşluğu gösterilir (2026-11-05, tur 2)
**İlgili:** REQ-009

**Karar.** `missingFields(input, machine)` 3 eksende girilmiş Re için önce REQ-004 kuralı (Re ≤ bir katmanın yol yarıçapı → "kafa mandrele çarpar"), o yoksa REQ-009: Re ≤ R_dış (= `plan.outerDiameter/2`, planla aynı toplama sırası; eşitlik de hata) → "Göz yarıçapı Re=… mm parçanın dış yarıçapından (… mm) büyük olmalı: kafa son katmanda sargıya değer". İki mesaj birlikte yazılmaz (aynı nedenin iki ifadesi olmasın). Gizli pay yok. `WindingPlan.eyeClearance` = Re − R_dış ve `LayerInfo.eyeClearance` = Re − katman dış yüzeyi (yalnız 3 eksen + Re girilmiş; aksi null). Arayüz plan panelinde ve her katman satırında gösterir; açıklama "göz gövdesi daha içe uzanıyorsa ona göre değerlendir". 4 eksende değişiklik yok.

**Alternatif.** Yalnız REQ-009 mesajı (REQ-004 mesajı gereksiz): Re mandrelin içindeyse "mandrele çarpar" daha açıklayıcı; korundu.

---

## ADR-007 — İvme limiti: saniye tabanlı birim, yalnız doğrulayıcı raporu (2026-11-05, tur 2)
**İlgili:** REQ-005

**Bağlam.** Hız limiti `maxSpeed` dakika tabanlı (mm/dk, °/dk; F ile aynı). İvme kontrolcüde (LinuxCNC INI `MAX_ACCELERATION`) saniye tabanlı. Tek birim seçmek ya INI'den kopyalanan değeri ya da F ile hız karşılaştırmasını karıştırır.

**Karar.**
- `MachineConfig.maxAccel?: { carriage, mandrel, head, cross: number | null }`, **mm/s² ve °/s²** (INI ile aynı; kullanıcı INI'den aynen kopyalar). Arayüzde ayrı bölüm "Eksen ivme limitleri (saniye tabanlı…)", birim etiketleri `mm/s²`/`°/s²`, hız bölümü başlığı "dakika tabanlı", altında "Dikkat birim: hız /dk, ivme /s²" notu. Alan yoksa/boşsa o eksende kontrol yok. Proje dosyası alanı yalnız varsa okur (> 0, sonlu).
- `verify.ts` G-code'dan (plana bakmadan) her G1 için T (LinuxCNC kuralı) ve eksen hızı v = Δ/T; her sınırda (ardışık G1; ilk/son G1, her M0/M2 ve G0 yanı duruş, komşu hız 0) ivmeli eksen için Δv, min(T) (duruş tarafı sayılmaz), t_r = Δv/a. `VerifyReport.accel`: (1) `unreachable` (t_r > min T olan sınır sayısı) + `firstUnreachableLine`, (2) `peak` eksen başına tepe Δv/min T ve tepe Δv (satırlarıyla) + `events` (Δv > 0 olan her sınır × eksen; MM ölçütü "geçiş satırı raporda görünür" için), (3) `boundMinutes` = süre + Σ_sınır max_eksen (|v₁| + |v₂|)/(2a) (Δv = 0 sınır da dahil: tam durma varsayımı), ek bilgi `shortMoves` (v²/2a > |Δ|). `unreachable > 0` ise doğrulayıcı uyarısı. Hiç ivme girilmemişse `accel = null`.
- G-code, plan süresi ve hız uzatması ivmeyi **kullanmaz** (altın özetler değişmez; testle kanıtlı). Sim kiti: girilen değer `MAX_ACCELERATION` (AXIS ve JOINT) ve JOINT'te `STEPGEN_MAXACCEL`; girilmeyen eksen eski deneme değeri, README'de listelenir.

**Alternatifler.** (a) Dakika tabanlı ivme (mm/dk²): INI değerinin 3600 ile çarpılması gerekir, hata kaynağı. (b) İvmeyi süre uzatmaya katmak: trapez profil + ileri bakış modeli gerekir, LinuxCNC davranışı makinede doğrulanmadan uydurma olur. Reddedildi; yalnız üst sınır.

**Sonuç / sınır.** Üst sınır kaba (her sınırda tam durma); gerçek LinuxCNC (blending) daha kısa sürer. `STEPGEN_MAXACCEL = MAX_ACCELERATION` yazılması bilinçli (REQ "bu değerden"); gerçek step/dir makinede genelde biraz büyük seçildiği README'de not edildi (MM'ye soru). Not: REQ-007 sonrası S1'in tepe C hız sıçraması artık K1→K2 geçişinin gövde kısmında (C 30° → 89,1°, 140 °/s); K2→K3 (83,9 °/s) raporda `events` içinde görünür.

---

## ADR-008 — Kayma kontrolü: μ girdi bölümünde, LayerInfo.slip (2026-11-05, tur 2)
**İlgili:** REQ-006

**Karar.** `WindingInput.friction?: number | null` (malzeme parametresi, "Mandrel ve bant" bölümünde). Boş = sayısal kontrol yok; girildiyse > 0 ve sonlu olmalı, değilse `missingFields` "Sürtünme katsayısı μ (> 0)". `LayerInfo.slip` (μ girilmiş helisel katmanda; aksi null): düzde x_t = (r/μ)(1/sinα − 1), θ_t = (1/μ)·ln(cot(α/2)) (r = katman yol yarıçapı) ve uyarı "Uç dönüşü sürtünmeyle tutulamaz…" (dwell'in eksenel uzunluğu 0 olduğundan μ girilince düz katmanda her zaman); domluda k_g/k_n = (R/h)·√(R² − c²)/c, oran > μ ise "Kutupta δ° dwell … kayar". μ boşken yalnız düz helisel katmanda metin uyarısı "Düz uç dönüşü yalnız pim halkası/uç tutucuyla güvenilir". Hoop katmanda kontrol yok (REQ kapsamı helisel). Geçiş eki: yeni katman düz helisel ve geçişin gövde kısmı ΔX = 0 ise `slip.transitionTurnDeg` = geçiş ΔA (asgari uç dönüşü); < θ_t(yeni α) ise geçiş uyarısı. G-code değişmez.

**Sınır.** Geçişte REQ metnine uyarak yalnız yeni katmanın α'sı kullanıldı. Önceki katman dönüş yönünde bitiyorsa (hoop, 180° − φ₁) fiziksel dönüş 180° − φ₁ → 90° → φ₂ olup ilk yarısı için de θ_t(φ₁) gerekebilir (MM'ye soru).

---

## ADR-009 — Proje ve store'a eklenen alanlar (2026-11-05, tur 2)
**İlgili:** REQ-005, REQ-006, REQ-008

`friction` (input) ve `maxAccel` (makine) proje dosyasında isteğe bağlı: yoksa nesneye eklenmez (eski dosya birebir), varsa doğrulanır (sayı, sonlu, > 0, ≤ 1e7; hata mesajı alan yolunu içerir). Dosya sürümü 1 kaldı. Store: `input.friction = null`, `machine.maxAccel` yok (maxSpeed gibi). Eski persist kaydında ikisi de yok kalır → kontrol yok.

---

## ADR-010 — Dom ↔ gövde katman geçişi dom geodeziğini izler (2026-11-05, tur 2)
**İlgili:** REQ-007

**Karar.** `planWinding` katman geçişi (index > 0) artık bir hareket grubu, hepsi `transition` ve yeni katmana ait (katman yorumu ve katman arası M0'dan sonra):
1. Önceki katman domluysa: onun **gidiş geçişinin ilk dom kısmı** (sol kutup → sol ekvator, aynı 24 parça, aynı c, C = φ; 'mirror'da da +φ, gidiş yönü), A += θ_dom(önceki). Y (4 eksen) önceki katmanın dom Y'si.
2. Gövde kısmı (x = 0, ΔX = 0): A += asgari uç dönüşü; elyaf boyu hypot(ΔX, ΔY, r_yeni·δmin) (önceki kural). Hedef düzse katman başı; domluysa yeni katmanın sol ekvatoru, C = dönüş açısı (180° − α₂ 'fiber' / −α₂ 'mirror'), Y = gövde Y'si.
3. Yeni katman domluysa: yeni katmanın **dönüş geçişinin son dom kısmı** (ekvator → sol kutup, C = dönüş açısı), A += θ_dom(yeni); son nokta katman başı (kutup, C = 90°).
Düz → düz geçişler birebir eski (tek gövde hareketi, aynı sayılar). Dom yolu `domeGeodesic` bir kez hesaplanıp katmana verilir. Bu, katman başı A'sını θ_dom kadar kaydırır; sonraki tüm A değerleri değişir.

**Altın çıktı.** Yalnız domlu katman içeren üç "mixed" örnek değişti. `mm-req2.test.ts` "REQ-007 altın çıktı farkı": yeni planın geçiş grupları eski tek-hareket kuralına indirilip sonraki A'lar kaydırılınca **eski özetler bit bit** çıkıyor; yani fark yalnız geçiş geometrisi (+ başlıktaki elyaf/süre/tepe hız).

**MM kabul ölçütüyle çelişki (MM'ye soru).** "Geçiş içindeki ardışık G1'lerde ΔC işareti değişmez" dom kısmı olan geçişlerde fiziksel olarak sağlanamıyor: S1 K1→K2'de dom inişi C'yi 90° → 30° azaltır (gidiş, Clairaut), gövde kısmında yeni hoop başı 89,1° olduğundan C 30° → 89,1° artar (elyaf +X yönünde kalır, yön dönmez, 90°'den geçmez). Gövde → dom geçişinde de gövde kısmı C'yi dönüş açısına (> 90°) çıkarır, dom çıkışı 90°'ye indirir. Uygulanan: dom kısımlarında ΔC işareti sabit (testli), gövde kısmı tek hareket. S1 K1→K2 gövde kısmı (ΔC 59,1° / 0,42 s ≈ 140 °/s) programın tepe C hızı oldu; ayrıca bu gövde kısmı yön değiştirmeyen ama 30° → 89° dönen bir düz uç olayıdır (REQ-006 kontrolü yeni katman hoop olduğu için uygulanmıyor). 'mirror'da dom çıkışının son parçasında C −φ'den +90°'ye atlar (eski sözleşmenin kutup çevirmesi gibi; 'mirror' önerilmiyor).

---

## ADR-011 — İlk k devre deneme programı (2026-11-05, tur 2)
**İlgili:** REQ-008

**Karar.** `core/trial.ts` `trialPlan(plan, input, katman, k)`: tam planın aynı hareketlerinden ayrı plan; başlangıç = katmanın ilk geçişinden önceki konum (domlu: kutup; geçiş grubunun son noktası), `position` olur → `generateGcode` REQ-001 başlangıcını (4 eksende üç G0, elyaf bağla M0) ve aynı F kurallarını uygular; bitiş G94 + M2/M30. Devre = iki dwell (helisel/domlu); hoop'ta tek gidiş-dönüş (k = 1). k tam sayı ≥ 1 ve ≤ katman devre sayısı, aksi Türkçe hata. A, katman başı değerinin 360°'nin katı kadar kaydırılır: faz tam programla aynı, mandrel deneme başında boşa onlarca tur dönmez. `generateGcode(…, { title })` başlığa `(DENEME: katman N ilk k devre)` yazar; katman arası M0 koşulu "katman 0 değil" yerine "programın ilk hareketi değil" oldu (tam programda eşdeğer, altın özetler aynı).
- Seçim (katman, k) store'da `trial` (persist) ama **proje dosyasına yazılmaz**: reçete değil, tek seferlik işlem; açılan proje deneme programını kendiliğinden tetiklemesin. Arayüz "Deneme programı (ilk k devre)" bölümü: katman seçimi, k, özet (G1 sayısı, süre, elyaf, doğrulama), indirme düğmesi.

**Sınır.** Deneme ara katmandan başlıyorsa mandrelde önceki katmanların sarılı olduğu varsayılır (Y/yarıçap o katmanınki); boş mandrelde ara katman denemesi kafa boşluğunu artırır, temas yolu farklı olur.

---

## ADR-012 — Durağan aralıkta genel kayma kontrolü (2026-11-05, tur 3)
**İlgili:** REQ-010 (REQ-006 metin düzeltmesi)

**Karar.**
- Yeni saf modül `core/slip.ts`: `thetaReqDeg(ψ₁, ψ₂, μ)` = |ln tan(ψ₂/2) − ln tan(ψ₁/2)|/μ, `axialReq` (90°'den geçerse ileri + geri), `fiberAngle` ('mirror'da C < 0 → 180° + C), `stationaryIntervals(moves, kip)`: ardışık iki ΔX ≠ 0 hareket arasındaki ΔX = 0 dizileri (önceki düz katmanın son dwell'i + geçiş gövdesi tek aralık; program başı/sonu sayılmaz). Aralık: ψ başı/sonu, ΔA toplamı, monotonluk.
- `planWinding` hareketler bittikten sonra (μ girildiyse) tüm aralıkları tarar; dom kutup dwell'i içeren aralık atlanır (REQ-006 k_g/k_n). r = aralığın son hareketinin yarıçapı (geçişte yeni katman; MM'nin 202,5 mm'si bununla çıkıyor). Geçiş aralığı → yeni katmanın `slip.transitionTurnDeg` (aralık ΔA, önceki dwell dahil), `transitionRequiredDeg`, `transitionAxial`; hedef türünden bağımsız (hoop ve domlu katmanda da `slip` artık var). ΔA < θ_req **veya aralık monoton değilse** (θ_req alt sınır, kaymasızlığı kanıtlamaz; yalnız 'mirror'da olur) "Katman k→k+1 geçişi: …" uyarısı; monoton değilse "(C bu aralıkta monoton değil, değer alt sınır)". Hoop'un kendi uç dönüşü: `turnFullDeg` = θ_req (S1 ~5,9°), ΔA < θ_req ise katman başına tek uyarı.
- Düz helisel: `turnFullDeg` = θ_req(α, 180° − α) = 2θ_t; REQ-006 uyarısı (her zaman, çünkü dwell eksenel 0 < x_t) yeni metin: "gereken ≥ 2θ_t° dönüş (her yarıda θ_t°), ≥ x_t mm uç taşması, μ=…; uç dönüşü ΔA …°, eksenel 0". Eski REQ-006 geçiş uyarısı (yalnız yeni α) kaldırıldı; yerine genel geçiş uyarısı.
- G-code değişmez (testle: μ'lü ve μ'süz çıktı birebir).

**Alternatifler.** Monoton olmayan aralıkta parça parça θ toplamı (gerçek C yolu üzerinden): daha sıkı ama REQ metni uç değerleri istiyor ve REQ-011 sonrası 'fiber'de hiç olmuyor; reddedildi, yalnız uyarı koşuluna eklendi.

**Sınır.** Silindir formülü; dom ekvatorundaki gövde kısmında dom eğriliği ihmal. Hoop'un düşük θ_req'i (5,9°) yalnız silindir modeli; makinede doğrulanmadı.

---

## ADR-013 — Durağan aralıkta C monotonluğu: son dwell C'si kıstırılır (2026-11-05, tur 3)
**İlgili:** REQ-011, REQ-003 (istisna)

**Bağlam.** MM ölçümü yalnız düz → domlu geçişi gösterdi (125 → 55 → 150). Rastgele değişmez testine kuralı ekleyip kıskacı kapattığımda (mutasyon) **düz → hoop** (150 → 30 → 89,1) ve **düz → daha büyük açılı düz** (150 → 30 → 55) geçişlerinin de monoton olmadığı çıktı (27 test düştü). Kök neden aynı: önceki düz katmanın son dwell'i C'yi her zaman gidiş açısına (α₁) çeviriyor, ardından gövde kısmı yeni başlangıca gidiyor.

**Karar ('fiber').** Önceki katman düz helisel ise son dwell sonu C'si [dwell başı C (180° − α₁), gövde sonu C] aralığına kıstırılır (`clamp`). Sonuçlar: düz → küçük/eşit açılı düz: değişmez (zaten monoton); düz → domlu (gövde sonu 180° − α₂ ≥ 180° − α₁ ise): dwell'de C değişmez, gövde 125° → 150° (MM önerisi); düz → domlu, α₂ > α₁: dwell 180° − α₁ → 180° − α₂, gövde ΔC 0; düz → hoop / büyük açılı düz: C'nin hepsini dwell döner (150° → 89,1°), gövde ΔC 0. A, X, Y, elyaf boyu ve süre değişmez (C hız limiti girilmemişse). 'mirror' değişmez.
REQ-003 ölçütüne istisna: geçişten hemen önceki düz dwell'de ΔC = 180° − 2α aranmaz; yerine C'nin komşu satırlar arasında kaldığı kontrol edilir (`mm-req.test.ts`).

**Alternatifler.** (a) MM önerisi her durumda (dwell ΔC = 0, hepsini 20°'lik gövde döner): düz → hoop'ta gövde 60,9°'yi 0,42 s'de döner (~145 °/s) ve düz → düz altın çıktıları gereksiz değişirdi. (b) C'yi aralık boyunca A ile doğrusal dağıtmak: C hızı en düşük olur ama düz → düz dahil her geçişi değiştirir; gizli bir dağıtım modeli olur. Kıskaç en az değişiklik; fizik (μ'ye bağlı gerçek yön değişimi) bilinmediği için seçim kinematik.

**Altın çıktı.** Yalnız düz → domlu geçişi olan iki 'fiber' "mixed" örnek değişti (önceki ed905760/186293, 2d616a0f/223715). `mm-req3.test.ts` dwell C'si geri alınınca bu özetler bit bit çıkıyor; G-code'da yalnız bir G1 satırının C'si farklı, X/A/Y ve G93 F aynı.

---

## ADR-014 — Ara katman deneme uyarısı; MM faz kayması tahminine itiraz (2026-11-05, tur 3)
**İlgili:** REQ-008 ek (S8)

**Karar.** `trial.trialWarnings(plan, input, katman, eksen)` katman > 1 için iki madde döndürür: (1) önceki katmanlar sarılı varsayıldı; boş mandrelde temas yarıçapı Δr = r − (D/2 + t) küçük; aynı X/A ile gövde elyaf açısı tan α' = (r'/r)·tan α (hoop: 2πr'/adım), 4 eksende kafa boşluğu Δr büyür; deneme katmanı birebir temsil etmez. (2) A sıfırı önceki sarımla aynı referansta olmalı. Arayüz deneme bölümünde (sarı liste) ve G-code başlığında `(UYARI: …)` (`generateGcode` `opts.notes`). `comment()` `≈` → `~`.

**MM ölçütünden sapma (MM'ye soru).** REQ "bu katmanda ≈ X°/geçiş kayma, X = L·tanα·(1/r' − 1/r)" (S1 K3: 17,7°) istiyor. Bu, geçiş dönüşü elyaf açısı sabit tutulup r' için **yeniden hesaplansaydı** ne kadar değişeceği. Ama program A'yı ve X'i komut eder: silindirde temas noktasının açısal konumu θ = A (göz açısal ofseti acos(r/Re) sabit, kümülatif değil), yani bandın düştüğü açısal yuva r'den bağımsızdır; değişen elyaf açısıdır (55° → ~54,6°) ve bant açısal genişliği (~%0,6). Bu modelde "bant yanlış yuvaya düşer, kontrol geçersiz" sonucu çıkmıyor; yuva kontrolü açısal olarak anlamlı kalır, örtüşme/açı farklıdır. Sayıyı uydurmamak için X yazılmadı; uyarı genel tutuldu. MM'nin modelini (ör. elyafın geodezik olarak α'yı koruyup temas noktasının kayması) yanlış anlıyor olabilirim; yanıta göre metin değiştirilir. Makinede doğrulanmadı.

---

## ADR-015 — Windows paketleme (2026-11-05, tur 3)
**İlgili:** backlog A10 (MM görüşü yok)

**Karar.** electron-builder NSIS, `productName: Winding Planner`, `oneClick: false` + `allowToChangeInstallationDirectory: true`, masaüstü ve başlat menüsü kısayolu. İmzasız (SmartScreen "Ek bilgi → Yine de çalıştır"; README'de). Çıktı `dist/` (`.gitignore`'da). Renderer paketleri `devDependencies`'e taşındı (Vite paketliyor; electron-builder yalnız `dependencies`i asar'a koyar): asar 161 MB → 3,1 MB, kurulum 143,8 → 120,9 MB. `dependencies`'te yalnız `@electron-toolkit/utils` ve `/preload` (ana süreç/preload çalışma anında `require`). Kurulum `/S /D=<dizin>` ile geçici dizinde denendi, kurulu uygulama CDP ile açılıp kapatıldı, sessiz kaldırıldı.
