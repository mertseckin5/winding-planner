# Ortak İş Listesi (Backlog)

Durumlar: `açık` → `tasarım` → `uygulandı` → `MM onayı bekliyor` → `MM onaylandı` / `MM reddetti`.
"MM onaylandı" durumunu yalnız makine mühendisi verir. Makine onayı "fiziksel olarak tutarlı" demektir; makinede doğrulama ayrı kalır (kullanıcının makinesi yok).

## Gereksinimler (2026-11-05, makine mühendisi ilk inceleme)
Ayrıntı ve kabul ölçütleri: `requirements.md`. Ölçümler: `reviews/2026-11-05-ilk-inceleme.md`. Sıra = öncelik sırası.

| REQ | Öncelik | Konu | Aday | Durum |
|---|---|---|---|---|
| REQ-001 | P0 | İlk konumlama: 4 eksende G92'de Y yok (Y mandrel ekseninden mutlak), Y geri çekilmiş üç adımlı yaklaşım, ilk G1 öncesi M0 "elyafı bağla" | yeni | **MM onaylandı** (2026-11-05): fiziksel olarak tutarlı; makinede doğrulanacak: Y işaret yönü, Y sıfırının mandrel eksenine kurulması, Ygeri'de (S1 91,5 mm) X'in −h·cosα'ya giderken ayna/punta çeneleriyle çarpışmaması (havada, elyafsız) |
| REQ-002 | P0 | Domlu katman varsa X strok sınırları zorunlu (yoksa üretim durur) | yeni | **MM onaylandı** (2026-11-05): fiziksel olarak tutarlı; makinede doğrulanacak: girilen strok sınırlarının göz ve kafa gövdesinin ayna/puntaya en yakın noktasına göre seçildiği |
| REQ-003 | P1 | C bükülmesiz sözleşme: dönüşte C = 180° − φ, kutupta C sabit 90°, C ∈ [0,180] | A1 | **MM onaylandı** (2026-11-05, 'fiber' kipi): fiziksel olarak tutarlı (bant sürekliliği varsayımı altında); makinede doğrulanacak: kafa kinematiğinin varsayıma uyduğu (kullanıcı sorusu açık), kuru elyaflı geçişte bandın düz kaldığı. 'mirror' kipi yalnız eski kayıt uyumu; MM önermez |
| REQ-004 | P1 | Serbest elyaf boyu λ ve uç gecikmesi g raporu; 3 eksen için göz yarıçapı Re parametresi | A8 | **MM onaylandı** (2026-11-05): λ/g değerleri el hesabıyla birebir; çarpışma kontrolündeki yarıçap REQ metnimdeki hatadan dolayı katman ortası → REQ-009 ile düzeltilecek. Makinede doğrulanacak: g ölçümü (uçta temas X'i ≈ L − g) |
| REQ-005 | P1 | Eksen ivme limiti parametresi, doğrulayıcı ivme kontrolü ve ivme dahil süre üst sınırı, sim kitine aktarım (tur 2: geçişler dahil) | A3 | **MM onaylandı** (2026-11-05, tur 3): bağımsız sınır hesabım ulaşılamaz sayı, tepe Δv ve üst sınırla birebir (S2 76/76, S1 K2→K3 satır 5555 Δv 83,92); el hesabı 1,100 s; ivme boşken accel null ve G-code aynı. Makinede doğrulanacak: eksen başına adım kaçırmayan ivme ölçümü; LinuxCNC sim süresi ile üst sınırın karşılaştırılması |
| REQ-006 | P1 | Uç dönüşü kayma kontrolü: μ parametresi, düz silindirde x_t/θ_t, dom kutbunda k_g/k_n (tur 2: düz uç katman geçişi dahil) | A2 (ilk adım) | **MM onaylandı** (2026-11-05, tur 3): tüm sayılar el hesabıyla birebir (45,075 / 124,683 / 1,739 / 1,010). Metindeki "gereken θ_t dönüş" tam uç dönüşünün yarısıdır (benim REQ metnim) ve geçiş kontrolü yalnız düz hedefte → **REQ-010** ile genişletilir. Makinede doğrulanacak: μ ölçümü |
| REQ-007 | P1 | Dom↔gövde katman geçişi dom geodeziğini izler (tur 2: geçişte C monoton) | yeni | **MM onaylandı** (2026-11-05, tur 3, ölçüt S6 yanıtıyla düzeltildi): G-code okumasıyla dom iniş/çıkışlarında Clairaut sapması ≤ %0,002, ΔA = θ_dom + 20° (±0,001°), elyaf boyu ±%0,0001, her dom kısmında ΔC işareti sabit, A azalmıyor, G0 yok (S1, S3; 3 ve 4 eksen; G93/G94). Gövde kısmı kayması → REQ-010; düz→domlu geçişte C'nin 90°'yi iki kez geçmesi → REQ-011. Makinede doğrulanacak: elyafın domdan kaymadan ekvatora indiği |
| REQ-008 | P2 | Seçilen katmanın ilk k devresi deneme programı | A5 | **MM onaylandı** (2026-11-05, tur 3): K3 k=1 4 G1, ΔA 2529,730 = tam program, süre farkı < %0,0001, konum farkı 2e-11, baş üç G0 + MSG + M0, son G94 + M2; domlu/hoop/S2 j=3 k=2 aynı. Ek (S8, P2): ara katman denemesi uyarısı `requirements.md` REQ-008 "Ek (tur 3)" → **açık** |
| REQ-009 | P0 | 3 eksende Re parçanın dış yarıçapıyla (outerDiameter/2) karşılaştırılır; göz boşluğu gösterilir | S1 yanıtı | **MM onaylandı** (2026-11-05, tur 3): 61,3 ve 61,5 → hata, 61,6 → boşluk 0,100 (katman 1,100/0,600/0,100), boş → kontrol yok, 4 eksende Re yok sayılıyor. Makinede doğrulanacak: Re ölçümü ve göz gövdesinin en iç kenarı |
| REQ-010 | P1 | Durağan aralıkta (ΔX = 0) genel kayma kontrolü: tüm geçiş türleri, iki yarı (θ_req = \|ln tan(ψ₂/2) − ln tan(ψ₁/2)\|/μ), düz uçta tam dönüş 2θ_t | S6, S7 | **MM onayı bekliyor** (ADR-012) |
| REQ-011 | P2 | Durağan aralıkta C monoton; 90°'yi yalnız carriage yön değiştirince ve bir kez geçer (düz→domlu geçişte bugün iki kez) | S6 ölçümü | **MM onayı bekliyor** (ADR-013; düz→hoop ve düz→büyük açılı düz de düzeltildi) |
| REQ-008 ek | P2 | Ara katman deneme uyarısı (S8) | S8 | **MM onayı bekliyor, MM'ye soru S9** (ADR-014: uyarı var, "≈ X°/geçiş kayma" sayısı yazılmadı) |
| S5 | P2 | Sim kiti README STEPGEN_MAXACCEL notu | S5 | **MM onayı bekliyor** |

Önerilen uygulama sırası (tur 2): REQ-009 (küçük, P0), REQ-005, REQ-006, REQ-007, REQ-008.
Önerilen uygulama sırası (tur 3): REQ-011 (C yolu; REQ-010'un S3 K1→K2 değerini kesinleştirir), REQ-010, REQ-008 ek uyarısı, S5 README notu.

### MM yanıtları (2026-11-05, tur 2; ölçüm `reviews/2026-11-05-req001-004-inceleme.md`)
- **S1:** Dış yüzey esas. 3 eksende Re sabit, bağlayıcı yüzey son katmanın dış yarıçapı R_dış = `plan.outerDiameter/2`. Ölçüm: S1 3 eksen Re = 61,3 kabul ediliyor, R_dış = 61,5 (göz sargının içinde). Gizli pay eklenmesin; boşluk gösterilsin. → **REQ-009**.
- **S2:** 3 eksende ek sıra gerekmiyor. Y olmadığı için kafa radyal olarak hep Re'de; G0 sırası radyal çarpışmayı değiştirmez. Eksenel çarpışmayı REQ-002 (zorunlu strok) karşılıyor. C'nin G0 sırasında dönmesi elyaf bağlanmadan önce olduğundan zararsız. Makinede doğrulanacak: Re'deki gözün X = −h·cosα'da ayna çenelerine radyal olarak değmediği (ayna çene yarıçapı > Re ise strok min daha büyük seçilmeli).
- **S3:** Geçiş fiziksel olarak bir uç dönüşüdür (dönüş 180° − φ₁ → 90° → gidiş φ₂). Katmanlar dönüşle bittiği ve gidişle başladığı için C zaten monoton azalıyor; büyük ΔC (ör. 10°'lik katmanlarda 160°) fiziksel olarak doğru elyaf dönüşüdür. **C hızına göre ayrı uzatma kuralı yok**: kullanıcı C hız limiti girerse mevcut `moveMinutes` uzatması geçişleri de kapsıyor (kodda doğrulandı); ivme REQ-005'te (geçişler dahil edildi), kayma REQ-006'da (geçiş için θ_t eklendi), dom kısmı ve monotonluk REQ-007'de. Ölçüm: S1 'fiber' K2→K3 90,9° → 55°, 0,428 s, 83,9 °/s (programın tepe C'si); 'mirror'da aynı geçiş 144,1°, 336,9 °/s.
- **S4:** Uygun. Hoop'ta g = 1,06 mm, bant genişliğinin (6 mm) altında; uç dönüşü konumunu fark edilir bozmaz. Gösterim yeterli; uyarı gerekmez.

### Yazılım mühendisi notu (2026-11-05, REQ-001…004 uygulandı)
Kabul testleri `src/renderer/src/core/mm-req.test.ts` (43 test, adları REQ numarasıyla) ve `src/renderer/src/store.test.ts` (2). Tüm testler 510/510. Ölçülen: S2 j=3 tepe C (G-code okuması) 'fiber' ≤ 200 °/s, eski ±φ > 1000 °/s; S1 λ/g değerleri MM el hesabıyla ±0,1 içinde; S1 'fiber' C aralığı 30…150°. MM ölçüm betiği eski çağrı biçimiyle (eksen sayısı) çalışmaya devam ediyor; yeni C sözleşmesini ölçmek için `planWinding(input, machine)` ve `headAngleMode: 'fiber'` verilmeli.

**MM'ye sorular:**
- **S1 (REQ-004):** "Re ≤ r ise hata" kontrolünde r = katman yol yarıçapı (katman ortası) kullanıldı, REQ metni gibi. Kafa çarpışması için dış yüzey (r + t) veya ek pay mı esas alınmalı?
- **S2 (REQ-001):** 3 eksende Y olmadığı için ilk G0 X/A/C'yi birlikte taşıyor; domlu başlangıçta X = −h·cosα (ayna bölgesi). 3 eksende de "önce C/A, sonra X" gibi bir sıra gerekli mi?
- **S3 (REQ-003):** Katman geçişinde C, önceki katmanın son değerinden yenisinin başlangıcına tek G1'de (asgari uç dönüşü süresinde) gider; [0,180] içinde kalır ama fark açılar arasında büyük olabilir (ör. hoop sonu 90,9° → 55° katman başı; 10° katman sonu → 80° katman başı 70°). REQ-007 ile birlikte mi ele alınmalı, yoksa geçiş süresi C hızına göre mi uzatılmalı?
- **S4 (REQ-004):** Gecikme uyarısı yalnız helisel katmanlarda (metin "her helisel katman"); hoop'ta g ≈ 1 mm, yalnız gösteriliyor, uyarı yok. Uygun mu?

**Kullanıcıya açık soru (REQ-003):** Kafanın C ekseni hangi eksen etrafında dönüyor ve C = 0 fiziksel olarak ne demek? Cevaba göre başlangıç sözleşmesi ('fiber' / ±φ) yeniden değerlendirilecek.

### Yazılım mühendisi notu (2026-11-05, tur 2: REQ-009, 005, 006, 007, 008 uygulandı)
Kabul testleri `src/renderer/src/core/mm-req2.test.ts` (30 test, adları REQ numaralı) ve `store.test.ts` (+1). Tüm testler 541/541; MM betikleri (`docs/engineering/scripts`, 6 test) yeşil. Kararlar ADR-006…011.
Ölçülen (G-code okumasıyla): S1 3 eksen Re 61,3 / 61,5 → hata, 61,6 → boşluk 0,100 mm. S1 a_C 3600: K2→K3 C Δv 83,92 °/s (raporda), tepe C Δv 140,2 °/s (K1→K2 gövde kısmı, yeni), tepe C talebi 1566 °/s² (kutup yakını dom), ulaşılamaz sınır 0, ivmeli süre üst sınırı 119,4 dk (süre 116,5). S2 j=3 a_C 3600: ulaşılamaz 76 sınır (38 dwell × 2), tepe C Δv 113,9 °/s. μ 0,3: S1 K3 x_t 45,07 mm θ_t 124,68°, K1 k_g/k_n 1,739, S2 1,010. REQ-007 S1 K1→K2: 24 dom + 1 gövde, Clairaut sapması ≤ %0,5, ΔA = θ_dom + 20° (±0,01°), elyaf boyu dom + gövde (±%0,1). REQ-008 S1 K3 k=1: 4 G1, ΔA 2529,73°, süre tam programla ±%0,1.
Altın çıktı: üç "mixed" örnek değişti (yalnız REQ-007); geri indirme testiyle eski özetler bit bit çıkıyor.

**MM'ye sorular (tur 2):**
- **S5 (REQ-005):** Sim kitinde `STEPGEN_MAXACCEL` = girilen ivme yazıldı (REQ "bu değerden"). Gerçek step/dir yapılandırmasında genelde `MAX_ACCELERATION`'dan biraz büyük seçilir; ayrı bir oran mı istenir, yoksa yalnız not yeterli mi?
- **S6 (REQ-007):** Kabul ölçütündeki "geçiş içindeki ardışık G1'lerde ΔC işareti değişmez" dom kısmı olan geçişlerde sağlanamıyor: dom inişi gidiş yönündedir (C 90° → α₁ azalır), sonra gövde kısmı yeni katman başına gider (S1 hoop: 30° → 89,1° artar; elyaf yön değiştirmez, 90°'den geçmez). Gövde → dom geçişinde gövde kısmı C'yi dönüş açısına (180° − α₂) çıkarır, dom çıkışı 90°'ye indirir. Uygulanan: dom kısımlarında monoton, gövde kısmı tek hareket. Ölçütün dom kısmı + gövde kısmı ayrı ayrı olarak düzeltilmesi mi, yoksa geçiş yolunun başka kurulması mı (ör. gövdede elyafın yön değiştirmeden bir miktar helis devam etmesi) isteniyor? Ayrıca K1→K2 gövde kısmı (30° → 89,1°, ΔX = 0, ΔA 20°) bir düz uç olayıdır ama REQ-006 geçiş kontrolü yalnız yeni katman düz helisel iken tanımlı; hoop'a geçişte de kontrol edilsin mi?
- **S7 (REQ-006):** Düz uç geçişinde θ_t yalnız yeni katmanın α'sıyla hesaplanıyor (REQ metni). Önceki katman dönüş yönünde biterse (hoop 90,9°) fiziksel dönüş 180° − φ₁ → 90° → φ₂; ilk yarı için θ_t(φ₁) de eklenmeli mi?
- **S8 (REQ-008):** Ara katman denemesi mandrelde önceki katmanların sarılı olduğunu varsayar (Y, yarıçap). Boş mandrelde ara katman denemesi için ayrı uyarı/yarıçap seçeneği gerekli mi?

### MM yanıtları (2026-11-05, tur 3; ölçüm `reviews/2026-11-05-req005-009-inceleme.md`, betik `scripts/measure-2026-11-05-r3.mm.test.ts`)
- **S5:** Ayrı oran parametresi istenmez; not yeterli. Sim HAL'inde stepgen olmadığı için değer simde etkisiz. README notu güçlendirilsin (P2, onayı engellemez): "Gerçek step/dir makinede STEPGEN_MAXACCEL, MAX_ACCELERATION'dan küçük veya eşit olursa following error görülebilir; LinuxCNC örnek INI yorumları ve stepconf çıktısı ~%25 büyük kullanır, backlash kompanzasyonunda ~2 kat [C, forum + örnek INI; makinede doğrulanmadı]". Oranı yazılım kendisi uygulamasın (gizli değer olur).
- **S6:** Ölçüt yanlıştı, düzeltildi (REQ-007 "Düzeltme (tur 3)"): dom kısımlarında ayrı ayrı ΔC işareti sabit; gövde kısmı tek G1. Dom inişinde C'nin azalıp gövdede yeniden artması Clairaut gereği zorunludur, yön dönmesi değildir. Geçiş yolunu "gövdede helis devamı" ile kurmak şimdi istenmez: bu, kayma sınırlı uç profili (A2) işidir ve μ ölçümü + göz gecikmesi düzeltmesi olmadan anlamsız. Gövde kısmının kayma kontrolü (hoop'a geçiş dahil, tüm türler) → **REQ-010**. Ölçümde ayrıca düz→domlu geçişte C'nin 90°'yi iki kez geçtiği bulundu (125 → 55 → 150, carriage yön değiştirmiyor) → **REQ-011**.
- **S7:** Evet, iki yarı da sayılmalı. REQ-010'daki θ_req(ψ₁ → ψ₂) formülü bunu kendiliğinden yapar (S1 K2→K3: 127,7°, yalnız yeni α ile 124,68°). Aynı nedenle düz dwell'in tam dönüşü 2θ_t'dir (55°: 249,4°); bugünkü metin yarısını yazıyor.
- **S8:** Ayrı yarıçap seçeneği istenmez; uyarı gerekli (REQ-008 "Ek (tur 3)"): S1 K3 boş mandrelde 17,7°/geçiş faz kayması, bant açısal genişliği 9,8°: yuva kontrolü geçersiz.

### Yazılım mühendisi notu (2026-11-05, tur 3: REQ-010, REQ-011, REQ-008 eki, S5 uygulandı)
Kabul testleri `src/renderer/src/core/mm-req3.test.ts` (20 test, adları REQ numaralı); `invariants.test.ts` 80 rastgele programın 'fiber' olanlarına REQ-011 kuralı eklendi (G-code okumasıyla, `gcode-reader.testutil.stationaryRuns/checkReq011`). Tüm testler 561/561; MM betikleri 11/11. Kayma integrali testte Simpson ile ayrıca hesaplanıyor (slip.ts'in kapalı formülü tekrarlanmıyor).
Ölçülen (μ 0,3, G-code okumasıyla): S1 K1→K2 θ_req 248,5°, x_req 202,5 mm, ΔA 20 → uyarı; K2→K3 127,7° → uyarı; K3 turnFullDeg 249,37°. S3: K1→K2 126,8° (C 125 → 125 → 150; ΔA 198,4° > θ_req → **uyarı yok**), K2→K3 444,5°, K3→K4 190,1°, K4→K5 127,6° (hepsi uyarı). S3 K1→K2 gövde C hızı 25°/0,424 s ≈ 59 °/s.
Mutasyon: REQ-011 kıskacı kapatılınca 27 test düşüyor; rastgele programlarda **düz → hoop** ve **düz → büyük açılı düz** geçişleri de kuralı ihlal ediyordu (ölçümde görünmemişti), aynı kıskaçla düzeldi.
Altın çıktı: iki 'fiber' "mixed" örnek değişti (düz 30° → domlu 20° geçişinden önceki tek dwell satırının C'si 30 → 150); geri alma testiyle tur 2 özetleri bit bit.
REQ-006 uyarı metni düzeltildi (2θ_t, her yarıda θ_t). Monoton olmayan aralıkta ('mirror') ΔA ≥ θ_req olsa da uyarı verilir (değer alt sınır).

**MM'ye sorular (tur 3):**
- **S9 (REQ-008 ek):** "Boş mandrelde ≈ L·tanα·Δr/r² faz kayması / geçiş" (S1 K3 17,7°) program A'yı komut ettiği için bu modelde oluşmuyor: temas noktasının açısal konumu A ile belirlenir (göz ofseti acos(r/Re) sabit), değişen elyaf açısıdır (55° → ~54,6°) ve bant açısal genişliği (~%0,6). Uyarı genel metinle uygulandı (Δr, α', kafa boşluğu, A sıfırı); 17,7° yazılmadı. Kaymayı hangi mekanizmayla öngörüyorsunuz (ör. elyafın geodezik α'yı koruyup temas noktasının kayması)? Ayrıntı ADR-014.
- **S10 (REQ-011):** Önerinizden farklı olarak kıskaç seçildi (ADR-013): düz → hoop / büyük açılı düz geçişinde C'nin tamamını önceki katmanın dwell'i döner, gövde ΔC 0. Uygun mu, yoksa C'nin aralıkta A ile orantılı dağıtılması mı istenir?
- **S11 (REQ-010):** Hoop'un kendi uç dönüşü (89,1° → 90,9°) θ_req ≈ 5,9° (μ 0,3); ΔA 20° ile uyarı çıkmıyor. Silindir formülünün bu küçük açı farkında anlamlı olduğunu onaylıyor musunuz?

## Başlangıç adayları (2026-11-05) — makine mühendisi kararı

| # | Aday | Kaynak | Durum |
|---|---|---|---|
| A1 | C limiti girilmese bile kısa uç dönüşünde C tepe hızının aşırı yükselmesi (76 000 °/dk görüldü) | Bilinen Sınırlar | **REQ-003'e çevrildi.** Kök neden limit değil C sözleşmesi: kutupta/hoop'ta gereksiz 180° çevirme. Ölçüm: S2 j=3 1311 °/s, S1 hoop 420 °/s. |
| A2 | Ayarlanabilir uç dönüşü profili (dwell yerine kayma sınırlı geçiş) | Bilinen Sınırlar | **REQ-006'ya çevrildi (yalnız kontrol/uyarı).** Profil üretimi μ ölçülüp REQ-004 (göz gecikmesi) doğrulanmadan anlamsız: gecikme g (47–117 mm) profil uzunluğuyla aynı mertebede. Profil sonraki tur. |
| A3 | İvme girdisi: süre tahmini ve hız uzatması ivmeyi bilmiyor | Bilinen Sınırlar | **REQ-005'e çevrildi.** |
| A4 | Birikmiş kalınlığa göre yol ve Y (4 eksen) kaydırma | Bilinen Sınırlar | **Ertelendi.** Ölçülen senaryoda (tek domlu katman) buildup 0; Y kayması dom kalınlığı uyarısıyla izleniyor. Göz gecikmesi (REQ-004) ve Y referansı (REQ-001) çok daha büyük hata. Çok domlu katman senaryosu ölçülünce yeniden değerlendirilecek. |
| A5 | "İlk 1/5 devre" kısa deneme programı | Önceki rapor | **REQ-008'e çevrildi** (k devre, k kullanıcıdan). |
| A6 | Konik mandrel sarımı | Bilinen Sınırlar | **Ertelendi (kapsam).** Silindir/dom fiziği (REQ-003…007) düzelmeden yeni geometri eklemek hatayı çoğaltır. |
| A7 | Polar sarım | Bilinen Sınırlar | **Ertelendi (kapsam).** Polar sarım kafanın kutbun ötesine geçmesini ve mandrelin yavaş dönmesini ister; X strok ve ayna çarpışması (REQ-002) ve göz geometrisi (REQ-004) önce gerekli. |
| A8 | Kutup yakınında kafa (C/Y) teğetliği ve serbest elyaf boyu | Bilinen Sınırlar | **REQ-004'e çevrildi** (önce hesap ve rapor; göz yolu düzeltmesi sonraki tur). |
| A9 | Katmanlarda farklı dom yüksekliği | Bilinen Sınırlar | **Özellik olarak reddedildi.** Dom fiziksel bir mandrel parçasıdır; tek mandrelde katman başına farklı h fiziksel karşılığı yok (sonraki katmanlar önceki katmanın dom yüzeyine sarılır). Öneri (sonraki tur): farklı h girilirse uyarı. |
| A10 | Windows kurulum dosyası + README (paketleme) | Kullanıcı isteği | **MM görüşü yok** (makine fiziğiyle ilgisiz; yazılım mühendisinin kararı). **Uygulandı** (2026-11-05, ADR-015): `dist/winding-planner-0.1.0-setup.exe`, README.md. |

## Makine kurulmadan önce yazılım tarafında kalan en önemli 3 iş (MM, 2026-11-05 tur 3)
REQ-010, REQ-011 ve REQ-008 ekinden sonra, öncelik sırasıyla. Hiçbiri henüz REQ değil; sırası gelince REQ yazılacak.
1. **LinuxCNC sim kitini gerçek LinuxCNC'de (sanal makine / Linux PC, donanımsız) çalıştırmak** (P1). Bugün kit hiç çalıştırılmadı. Ölçülecek: S1/S2 G93 ve G94 programlarının sim süresi ↔ `verify` süresi ve REQ-005 üst sınırı; A ekseninin birikimli derece davranışı (WRAPPED_ROTARY kapalı); G93'te F yorumu; M0/MSG. Makine olmadan doğrulanabilecek tek gerçek kontrolcü davranışı budur; sonuç süre tahminini ve ivme raporunu kalibre eder.
2. **Göz yolu düzeltmesi (REQ-004 sonraki adım), isteğe bağlı kip** (P1). En büyük kalan geometrik hata: temas noktası kafanın g = 47–117 mm gerisinde (S1), helisel katman uca kadar kapanmıyor, dom girişi geodezikten sapıyor. Göz yolu = temas yolu + teğet·λ (uçta X taşması, dom üzerinde Y/C teğetliği); yeni X taşmaları REQ-002 strok kontrolüne girer. Başlangıçta kapalı; makinede g ölçülüp (REQ-004 "makinede doğrulanacak") doğrulanınca açılır.
3. **Kayma sınırlı uç dönüşü profili (A2 ikinci adımı), isteğe bağlı kip** (P1). REQ-006/010 yalnız uyarıyor; pim halkası olmayan makinede düz uç ve geçişler (S1 K1→K2: 248,5° / 202,5 mm gerekiyor) kayar. Profil: durağan aralık yerine x_req taşmalı, k_g = μ·k_n sınırında açı değişimi; 2'ye bağlı (taşma göz gecikmesiyle aynı mertebe). μ eğik düzlemle makinesiz ölçülebilir.
Kullanıcıdan beklenen (yazılım işi değil ama 2 ve 3'ü belirler): kafa C kinematiği (REQ-003 sorusu) ve uçlarda pim halkası kullanılıp kullanılmayacağı.
