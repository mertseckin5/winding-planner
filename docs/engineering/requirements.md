# Gereksinimler (Makine Mühendisi)

Sahibi: makine mühendisi (`winding-mechanical-engineer`). Yazılım mühendisi uygular, durumunu `backlog.md`'de günceller.
Öncelik: **P0** emniyet/hasar, **P1** G-code doğruluğu, **P2** kullanım.
Gizli varsayılan ilkesi her REQ için geçerli: yeni makine/malzeme parametresi kullanıcı girer; boşsa ilgili kontrol yapılmaz (veya REQ'te açıkça "üretim durur" yazıyorsa durur).
Hiçbir REQ'in uygulanması "makinede çalışır" anlamına gelmez; her birinde "makinede doğrulanacak" kısmı ayrıca yazılı.

Ölçümlerin kaynağı: `docs/engineering/reviews/2026-11-05-ilk-inceleme.md` (betik: `docs/engineering/scripts/measure-2026-11-05.mm.test.ts`); tur 2: `reviews/2026-11-05-req001-004-inceleme.md` (betik `measure-2026-11-05-r2.mm.test.ts`, yeni çağrı biçimi `planWinding(input, machine)`); tur 3: `reviews/2026-11-05-req005-009-inceleme.md` (betik `measure-2026-11-05-r3.mm.test.ts`, senaryo S3 = tüm geçiş türleri).
Senaryolar: **S1** Ø120×800, bant 6×0,25 mm, 3000 mm/dk, uç asgari 20°, kafa boşluğu 30 mm, katmanlar 30° domlu (h=60) + hoop + 55° düz, 4 eksen. **S2** Ø50×400, 45° domlu (h=25), 3 eksen, j=1 ve j=3.

---

## REQ-001 — İlk konumlama güvenliği: Y referansı, geri çekilmiş yaklaşım, elyaf bağlama duraklaması (P0)

**Problem (fiziksel).**
1. 4 eksende Y, programda **mandrel ekseninden mutlak radyal uzaklık** olarak yazılıyor (`winding.ts`: Y = katman dış yarıçapı + kafa boşluğu; S1'de 60,4 … 91,5 mm). Ama "başta eksenleri sıfırla" açıkken G-code `G92 X0 A0 C0 Y0` yazıyor: kafa o an nerede duruyorsa Y=0 orası olur. Kafa mandrel ekseninde duramayacağına göre (mandrel orada) Y'nin tüm değerleri bilinmeyen bir miktar kayar. Y yönü mandrele doğru pozitifse kafa mandrele/doma çarpar; değilse kafa yüzeyden çok uzakta kalır ve elyaf yolu planlanandan farklı olur.
2. İlk `G0` tüm eksenleri aynı anda taşır. Domlu katmanda başlangıç X = −h·cosα (S1: −51,96 mm), yani kafa ayna/mandrel ucu bölgesine iniyor; Y aynı anda küçülürken X yanal gidiyor: ayna, punta veya dom ile çarpışma yolu.
3. İlk `G0`'dan hemen sonra `G1` sarımı başlıyor; programda elyafı bağlama anı yok. Kullanıcı elyafı programdan önce bağlarsa G0 hızlı hareketi elyafı çeker/koparır; sonra bağlamak isterse duracak yer yok.

**Gereksinim.**
- (a) 4 eksende `G92` satırı Y'yi **içermez**. Y'nin sıfırı mandrel ekseni olmalı; bu kontrolcüde (LinuxCNC `HOME_OFFSET`/G54, Mach3 ofset) kurulur. Kontrol listesine ve ilk sarım adımlarına madde: "Kafa göz çıkışı mandrel ekseninden ölçülen D mm uzaktayken Y göstergesi D okuyor".
- (b) 4 eksende ilk konumlama üç satırdır: `G0 Y<Ygeri>` (yalnız Y; Ygeri = programdaki en büyük Y, gizli değer değil, programdan türetilir) → `G0 X A C` (Y sabit) → `G0 Y<başlangıç Y>` (yalnız Y).
- (c) İlk konumlamadan sonra, ilk `G1`'den önce `M0` (LinuxCNC'de önce `(MSG,Elyafi bagla, devam icin Cycle Start)`). 3 ve 4 eksende, "katman arası duraklama" ayarından bağımsız.

**Kabul ölçütü (test).**
- 4 eksen, `zeroAxesAtStart=true`: G-code'da `G92` satırı vardır ve Y harfi içermez; 3 eksende değişiklik yok.
- 4 eksen: ilk `G1`'den önceki hareket satırları sırasıyla yalnız-Y G0, Y'siz G0, yalnız-Y G0; ilk satırdaki Y = tüm programdaki azami Y (±0,001). Bağımsız okuyucuyla (`gcode-reader.testutil.ts`) doğrulanır.
- Her iki eksen sayısında ilk `G1`'den önce tam bir `M0` vardır; `invariants.test.ts`'teki "M0 sayısı = katman sınırı" değişmezi "katman sınırı + 1" olarak güncellenir; M0 sonrası A geri gitmez.
- `firstWindSteps` ve `controllerChecklist` 4 eksende Y referans maddesini içerir.

**Dayanak.** `gcode.ts` satır 72–75 (G92'ye cross dahil), `winding.ts` satır 156 (Y mutlak), ölçüm S1 (Y aralığı 60,4–91,5 mm, ilk X −51,96 mm).
**Makinede doğrulanacak.** Y yönünün işareti (mandrele doğru + mı −?), geri çekilme yolu boyunca ayna/punta ile çarpışma olmadığı (havada, elyafsız).

---

## REQ-002 — Domlu katmanda X strok sınırları zorunlu (P0)

**Problem.** Domlu katmanda kafa X = −h·cosα … L + h·cosα arasında gider (S1: −51,96 … 851,96 mm; S2: −17,68 … 417,68 mm). Bu bölgeler mandrel milinin, aynanın ve puntanın olduğu yerdir. Bugün yalnız metin uyarısı var; strok sınırı girilmemişse doğrulayıcı hiçbir şey kontrol etmiyor. Kafa ayna veya puntaya çarparsa göz, kafa ve mandrel hasar görür.

**Gereksinim.** En az bir domlu katman varsa `machine.travel.carriage.min` ve `.max` girilmiş olmalı; değilse `missingFields` "X strok sınırları (domlu katman X'i −h·cosα'ya götürüyor)" der ve G-code üretilmez. Girilmişse mevcut doğrulayıcı kontrolü (hata) yeterli. Domsuz programlarda davranış değişmez (boşsa kontrol yok).

**Kabul ölçütü.** S2 girdisi + travel yok → `missingFields` bu maddeyi içerir. travel {min −10, max 500} → doğrulayıcı "alt strok limitini aşıyor" hatası verir (−17,68 < −10). travel {min −20, max 420} → strok hatası yok. Domsuz S1 varyantında (yalnız hoop+55°) travel boşken G-code üretilir.

**Dayanak.** `winding.ts` satır 405–407 (yalnız uyarı), `verify.ts` satır 182–195 (travel yoksa kontrol yok), ölçüm S1/S2 X aralığı.
**Makinede doğrulanacak.** Strok sınırlarının ayna/punta ve göz geometrisine göre gerçekten güvenli seçildiği (kafanın ön ucu ile gözün X konumu farklı olabilir).

---

## REQ-003 — Kafa (C) açısı bükülmesiz sözleşme: dönüş geçişinde C = 180° − φ (P1)

**Problem.** Bugün C gidişte +φ, dönüşte −φ. Elyafın mandrel üzerindeki yönü uç dönüşü boyunca sürekli değişir: gidişte eksenle φ, uçta 90° (çevresel), dönüşte 180° − φ. −φ ile 180° − φ aynı **doğrultudur** ama kafa sürekli döndürüldüğü için göz bandı bir uçtan diğerine 180° ters çevrilmiş olarak gelir: uç dönüşü boyunca göz elyaf yönüne dik konumdan geçer (bant kenarına yatar, halatlaşır) ve dönüş geçişinin tamamında göz ile mandrel arasındaki serbest bantta yarım tur (180°) bükülme kalır. Bant genişliği daralır, bant düz yatmaz.
Aynı sözleşme gereksiz hızlı C hareketi de üretiyor (aday A1):
- Dom kutbunda C, uç dönüşü sırasında 90° → −90° (180°) çevriliyor. Fiziksel olarak kutupta elyaf yönü değişmez (90° kalır), C'nin dönmesi gerekmez.
- S2 j=3: uç dönüşü 0,137 s'de 180° → C ort. 1311 °/s (78 683 °/dk), duruştan duruşa üçgen profil için C ivmesi 38 216 °/s². Simülasyon kitindeki deneme ivmesi 3600 °/s² ile bu dönüş en az 0,447 s sürer (3,3 kat).
- S1 hoop: 0,424 s'de 178,2° → 420 °/s, 3963 °/s². Bükülmesiz sözleşmede hoop dönüşü 89,1° → 90,9° = 1,8°.
- Düz helisel uçta C −2α yerine +(180° − 2α) döner (55°: 110° yerine 70°; 30°: 60° yerine 120°). Düşük açılarda C daha çok döner ama bant bükülmez.

**Gereksinim.** C = elyafın mandrel eksenine göre yön açısı, sürekli: gidiş geçişi C = φ, dönüş geçişi C = 180° − φ; dom kutup dwell'inde C = 90° sabit; düz uçta dwell sırasında C, φ'den 180° − φ'ye (90°'den geçerek) döner; hoop'ta aynı. C her zaman [0°, 180°] aralığında kalır, birikmez. Katman geçişinde C önceki son değerden yeni başlangıca gider (her iki değer de [0,180]). Kontrol listesine C sıfırı tanımı: "C = 90°: elyaf çevresel, göz yarığı mandrel eksenine paralel; C = 0°: elyaf eksenel".

**Kabul ölçütü.**
- Tüm katman türlerinde, tüm G1'lerde 0 ≤ C ≤ 180 (bağımsız okuyucu).
- Dom kutup dwell satırlarında |ΔC| ≤ 0,001°.
- Düz helisel/hoop dwell satırlarında ΔC = 180° − 2α (±0,01°), işaret gidiş→dönüşte +, dönüş→gidişte −.
- Domlu geçişte Clairaut kontrolü r·sin(C) = c (±%0,5) korunur (sin(180°−φ) = sinφ).
- S2 j=3 (3 eksen G94): G-code okumasından tepe C hızı ≤ 200 °/s (bugün 1311 °/s; dom parçalarındaki doğal C hızı ~114 °/s).
- Altın çıktı özetleri bilinçli olarak güncellenir. Beklenen fark yalnız C sözcükleri ve G94'te lineer bileşeni olmayan satırların (dwell) F'i (F = hypot(ΔA, ΔC)/süre); X, A, Y ve süre değişmez (C limiti girilmemişse).

**Dayanak.** Kendi analizim (bant sürekliliği: göz döndürülünce göz içindeki bant da döner, mandrel tarafındaki uç sabit kalır → aradaki serbest bant göz dönüşü kadar bükülür). `winding.ts` satır 242–246, 291–293, 387–394. Ölçüm S1/S2 uç dönüşü satırları.
**Varsayım (kullanıcıya soru).** C ekseni gözü, gözden mandrele giden serbest elyafa yaklaşık paralel bir eksen etrafında döndürüyor ve C'nin artış yönü elyaf açısının artış yönüyle aynı. Kafa farklı yapıdaysa sözleşme yeniden değerlendirilir.
**Makinede doğrulanacak.** Kuru çalıştırmada (elyaflı, düşük hız) dönüş geçişinde bandın göz ile mandrel arasında düz kaldığı.

---

## REQ-004 — Serbest elyaf boyu ve uç gecikmesi raporu (P1)

**Problem.** Program kafanın (gözün) X'ini elyafın mandrele değdiği noktanın X'ine eşit yazıyor. Gerçekte elyaf, temas noktasından yol teğeti boyunca göze kadar düz gider; göz mandrel ekseninden Re uzaktaysa (4 eksende Re = Y) temas noktası gözün eksenel olarak gerisinde kalır:
  serbest elyaf boyu λ = √(Re² − r²) / sinα, eksenel gecikme g = √(Re² − r²) / tanα.
S1 (Re = Y): 30° gövde λ = 135,1 mm, **g = 117,0 mm**; 55° λ = 83,0 mm, **g = 47,6 mm**; hoop g = 1,1 mm. Kafa x = L'de döndüğünde elyaf x ≈ L − g'de mandrele değiyor: uç dönüşü planlanandan onlarca mm önce başlar, helisel katman uca kadar kapanmaz, dom girişinde yol planlanan geodezikten sapar. Bu, kapsama ve dom yolu doğruluğunu doğrudan bozar.

**Gereksinim (bu turda yalnız hesap ve uyarı; yol düzeltmesi sonraki REQ).**
- Yeni makine parametresi (3 eksen): **göz yarıçapı Re** — mandrel ekseninden göz çıkış noktasına radyal uzaklık (mm). Boşsa 3 eksende hesap yapılmaz. 4 eksende Re = o katmanın Y'si (REQ-001 Y referansı ile).
- Her helisel/hoop katman için `LayerInfo`'ya λ ve g (gövde yarıçapında); domlu katmanda ayrıca kutupta λ_kutup = √(Re_kutup² − c²) (kutupta g = 0).
- Re ≤ r ise (göz sarım yüzeyinin içinde) hata: "göz yarıçapı katman yarıçapından küçük: kafa mandrele çarpar".
- g > 0 olan her helisel katman için uyarı: "Elyaf mandrele kafanın ~g mm gerisinde değiyor; uç dönüşü x≈g / L−g civarında başlar".

**Kabul ölçütü.** S1 4 eksen: katman 1 g = 116,96 ±0,1, λ = 135,06 ±0,1; katman 3 g = 47,60 ±0,1, λ = 82,98 ±0,1; hoop g = 1,06 ±0,05. 3 eksen Re boş → alan yok, uyarı yok. 3 eksen Re = 50, Ø120 → hata.

**Dayanak.** Geometri (kendi türetimim): teğet doğru üzerinde λ kadar ilerleyince çevresel bileşen λ·sinα yüzeyden radyal uzaklaştırır, √(r² + (λ sinα)²) = Re; eksenel bileşen λ·cosα. Araştırma notunda CADWIND'in göz–mandrel girişim kontrolü yaptığı belirtiliyor [B]; ticari araçların göz yolunu temas yolundan ayrı hesapladığı çıkarımdır, kaynakla doğrulanmadı.
**Makinede doğrulanacak.** g'nin ölçümü: düşük hızda tek geçiş, kafa ucu dönerken elyafın değdiği noktanın X'i işaretlenip ölçülür (beklenen L − g).
**Sonraki adım (REQ değil, not).** Göz yolu = temas yolu + teğet·λ (uçta X fazla gitme / overtravel). Önce g raporu doğrulanmalı.

---

## REQ-005 — Eksen ivme limiti girdisi ve doğrulayıcı ivme kontrolü (P1, aday A3)

**Problem.** Plan hız sıçramalarını anlık kabul ediyor. Gerçekte kontrolcü her eksenin `MAX_ACCELERATION` değerine uyar: hareket planlanandan yavaş olur (elyaf hızı ve gerilim değişir, süre uzar). Kontrolcü ivme ayarı motorun gerçek kapasitesinden büyükse adımlı motor adım kaçırır ve eksen konumu programın geri kalanında kayar (X'te ayna/punta çarpışması riski). Ölçülen sıçramalar: S1 X 40,6 mm/s (30° gövde 43,3 mm/s'den uçta 0'a), C 420 °/s (hoop dwell), S2 j=3 C 1425 °/s; komşu hareketin kısa süresine göre tahmini ivme S1 C 4687 °/s², S2 j=3 C 52 397 °/s². Örnek: 43,3 mm/s'den durma mesafesi a = 100 / 500 / 1000 mm/s² için 9,4 / 1,9 / 0,9 mm.

**Gereksinim.**
- Yeni makine parametresi `maxAccel` {X mm/s², A °/s², C °/s², Y mm/s²}; her alan boşsa o eksende kontrol yapılmaz. Birim saniye: LinuxCNC INI `MAX_ACCELERATION` ile aynı (hız limiti dk tabanlı; arayüz birimi açıkça yazar).
- `verify.ts`: her G1 için eksen hızı v = Δ/T (T LinuxCNC kuralıyla), her ardışık G1 çiftinde Δv. Programın ilk G1'i, son G1'i ve her M0'ın iki yanı duruştan/duruşa geçiş sayılır (komşu hız 0). İvmeli eksen için rampa süresi t_r = |Δv|/a. Rapor: (1) t_r > min(T_önceki, T_sonraki) olan geçiş sayısı ve ilk satırı ("bu hızlara bu hareket içinde ulaşılamaz"), (2) eksen başına tepe |Δv|/min(T) değeri, (3) ivme dahil süre için üst sınır: her geçişte tam durma varsayımıyla Σ eksenlerin azamisi (|v_önceki| + |v_sonraki|)/(2a) eklenmiş süre.
- `simkit.ts`: kullanıcı ivme girdiyse INI `MAX_ACCELERATION` (ve `STEPGEN_MAXACCEL`) bu değerden; girmediyse bugünkü "deneme değeri" davranışı.
- Ek bilgi (uyarı değil): her G1'de v²/(2a) > |Δ| olan hareket sayısı ("tek parça ileri bakışta bu hız tutulamaz"; LinuxCNC'nin dönel eksenli harekette ileri bakışı kısıtlı olabilir [C], doğrulanmadı).

**Ek (2026-11-05 tur 2, S3 yanıtı).** Katman geçişi (`transition`) hareketleri de bu kontrole dahildir (komşu hız: önceki katmanın son ve yeni katmanın ilk G1'i). Ölçüm: S1 'fiber' K2→K3 geçişi C 90,9° → 55° (ΔC −35,9°) 0,428 s, 83,9 °/s; programın tepe C'si bu satır.

**Kabul ölçütü.** S1 'fiber', a_C = 3600 °/s²: K2→K3 geçiş satırı rapor (2)'de C için görünür (|Δv| ≥ 83 °/s). S2 j=3, a_C = 3600 °/s²: (1) ≥ 38 geçiş (her kutup dwell'i) raporlanır; REQ-003 uygulandıktan sonra C için tepe |Δv| ≤ 200 °/s (bugün 1425 °/s). Not: kutba yakın dom parçalarında C doğal olarak hızlı değişir (dφ/dr → ∞, S2'de son parça 3,1° / 0,027 s ≈ 115 °/s); REQ-003 sonrası da bayrak kalabilir, bu gerçek bir makine gereksinimidir. S1, tüm ivmeler boş: rapor alanları boş/null, mevcut çıktılar ve altın özetler değişmez. El hesabı testi: tek hareket X 0→100 mm F6000 (100 mm/s), a = 1000 → üst sınır süre = 1 s + 2·(100/2000) s = 1,1 s (±%0,1).

**Dayanak.** Ölçüm S1/S2 (review, "Hız sıçraması" satırları); araştırma notu §3.1 (lookahead [C]); `simkit.ts` satır 15 (deneme ivmeleri).
**Makinede doğrulanacak.** Her eksenin gerçek ivme kapasitesi (adım kaçırmadan) ölçülüp girilmeli; simülasyonda (LinuxCNC sim) ölçülen süre ile üst sınırın karşılaştırılması.

---

## REQ-006 — Uç dönüşü kayma kontrolü: düz silindir ve dom kutbu (P1, aday A2'nin ilk adımı)

**Problem.**
- Düz silindirde araba uçta dururken mandrel döner: elyaf yönü ~sıfır eksenel mesafede φ'den 90°'ye döner. Silindirde yön değiştiren eğrinin jeodezik eğriliği k_g = dφ/ds, normal eğriliği k_n = sin²φ / r. Kaymama koşulu k_g ≤ μ·k_n. En kısa kaymasız dönüş (α → 90°) için integral:
  eksenel uzunluk x_t = (r/μ)·(1/sinα − 1), mandrel dönüşü θ_t = (1/μ)·ln(cot(α/2)).
  r = 61,25, α = 55°, μ = 0,3 → x_t = 45,1 mm, θ_t = 124,7°. r = 60, α = 30° → x_t = 200 mm, θ_t = 251,5°. Mevcut dwell'de x_t = 0: pim halkası / uç tutucu yoksa elyaf uçta kayar (araştırma notu: Cyclone `lockDegrees`, pim halkaları [A]/[C]).
- Dom kutbunda dwell (S1 104°, S2 183°) elyafı kutup açıklığının paralel çemberine (r = c) sardırır. Paralel çember geodezik değil: k_g/k_n = |dr/dz| = (R/h)·√(R² − c²)/c. S1: 1,74; S2: 1,01. Reçineli elyafta μ ≈ 0,3–0,4 [C] olduğuna göre kutup dwell'i kutup parçası (boss) desteği olmadan kayar; dwell ne kadar uzunsa o kadar çok elyaf.

**Gereksinim.**
- Yeni malzeme parametresi **μ (elyaf–mandrel sürtünme katsayısı)**, girdi bölümünde; boşsa sayısal kontrol yapılmaz.
- Düz helisel katman: μ girilmişse x_t ve θ_t hesaplanır, `LayerInfo`'ya yazılır; uyarı "Uç dönüşü sürtünmeyle tutulamaz (gereken ≥ x_t mm eksenel, ≥ θ_t° dönüş); pim halkası/uç tutucu gerekli". μ boşken de sayısız uyarı: "Düz uç dönüşü yalnız pim halkası/uç tutucuyla güvenilir".
- Domlu katman: μ girilmişse kutup paralelinin k_g/k_n oranı hesaplanır; oran > μ ise uyarı "Kutupta δ° dwell kutup parçası desteği olmadan kayar (k_g/k_n = …, μ = …); daha kısa uç dönüşlü desen (j) seç veya kutup parçası kullan".
- Gizli eşik yok: karşılaştırma yalnız kullanıcının μ'süyle.
- (Ek, tur 2) Düz uçtaki katman geçişi (önceki katman x = 0'da biter, yeni katman x = 0'dan başlar, ΔX = 0) fiziksel olarak bir uç dönüşüdür (elyaf 180° − φ₁ → 90° → φ₂). Yeni katman helisel düz ise x_t, θ_t yeni katmanın α'sıyla bu geçiş için de hesaplanır; geçişin ΔA'sı (bugün asgari uç dönüşü) θ_t'den küçükse aynı uyarı geçiş için de verilir.

**Kabul ölçütü.** S1 katman 3 (55°, μ 0,3): K2→K3 geçişinde ΔA = 20° < θ_t = 124,7° → geçiş uyarısı var. Formül testleri: (r 61,25, α 55°, μ 0,3) → x_t 45,07 ±0,05 mm, θ_t 124,68 ±0,05°; (60, 30°, 0,3) → 200,00 mm, 251,52°. S1 katman 1 oranı 1,739 ±0,001, S2 1,010 ±0,001. μ boş → sayısal alanlar null, yalnız metin uyarısı (düz katmanda).

**Dayanak.** Kayma koşulu k_g/k_n ≤ μ (araştırma notu §2.2 [C]); integral ve paralel çember oranı kendi türetimim (dönel yüzeyde paralel için k_g = |dr/dm|/r, k_n = |dz/dm|/r). μ değeri [C], birincil kaynak okunmadı; bu nedenle kullanıcı girer.
**Makinede doğrulanacak.** μ ölçümü (reçineli bant, mandrel yüzeyi/ayırıcı ile; eğik düzlem veya kapstan yöntemi) ve uçta kayma gözlemi.

---

## REQ-007 — Domdan gövdeye katman geçişi geodezik yolu izler (P1)

**Problem.** Domlu katman sol kutup açıklığında biter (S1: X −51,96, Y 60,4). Sonraki hoop katmanı X = 0, Y = 91'den başlar. Bugünkü geçiş tek `G1`: X +52 mm, Y +30,6 mm, A yalnız 20° (asgari uç dönüşü), 1,28 s. Elyaf bu sırada dom üzerinde kutuptan ekvatora neredeyse meridyen boyunca çekilir: kutupta (r = c) yol meridyene paralele yakın gidiyor (φ küçük), Clairaut r·sinφ = c ihlal ediliyor (kutupta φ = 90° olmalı). Bu yol geodezikten çok uzak; elyaf kayar ve kutup bölgesine kontrolsüz yığılır. Ters yönde (gövdeden domlu katmana) de aynı.

**Gereksinim.** Önceki katman domlu ise geçiş önce o katmanın dom yolunu (kutuptan ekvatora, aynı c, 24 parça) izler, sonra gövdede (x = 0 veya L) asgari uç dönüşüyle yeni başlangıca gider. Sonraki katman domlu ise geçiş gövdede ekvatora gelir, sonra yeni katmanın dom yolunu ekvatordan kutba izler. Her iki dom parçası `transition` türündedir (elyaf boyu ve süreye dahil).

**C (tur 2, S3 yanıtı).** Geçişin dom kısmında C = yol açısı φ (Clairaut, 'fiber'de dönüş yönüne göre φ veya 180° − φ). Gövde kısmında (ΔX = 0, uç dönüşü gibi) C önceki son değerden yeni başlangıca **tek yönlü** (monoton) gider ve 'fiber'de 90°'den geçer ya da 90°'de başlar/biter; yön, katmanın kendi dwell'iyle aynıdır (dönüş → gidiş: C azalır). C hızı için ayrı uzatma kuralı yok: kullanıcının C hız limiti girilmişse mevcut `moveMinutes` uzatması, ivme REQ-005 kontrolü yeterli (gizli değer yok).

**Düzeltme (tur 3, S6 yanıtı).** "Geçiş içinde ΔC işareti sabit" ölçütüm fiziksel olarak yanlıştı: dom inişinde Clairaut gereği C 90° → α₁ azalır, gövdede yeni katmanın açısına (ör. hoop 89,1°) yeniden artması zorunludur; bu bir yön dönmesi değil, durağan carriage'da elyaf açısının değişmesidir. Doğru ölçüt: dom kısımlarının her birinde ΔC işareti sabit; gövde kısmı tek G1. Durağan aralıkta (ΔX = 0) C'nin 90°'den geçiş kuralı **REQ-011**'e, gövde kısmının kayma kontrolü **REQ-010**'a taşındı.

**Kabul ölçütü.** Tüm geçişlerde 'fiber' C ∈ [0,180]; geçişin her dom kısmında (iniş ve çıkış ayrı ayrı) ardışık G1'lerde ΔC işareti değişmez; gövde kısmı tek G1 (ΔX = 0). S1: katman 1 → 2 geçişinde dom kısmının her noktasında |r·sin(C) − c₁| ≤ 0,005·c₁ (r 4 eksende Y − yOff'tan; c₁ = 30,12 mm); toplam ΔA = θ_dom(katman 1) + asgari uç dönüşü (±0,01°). Geçiş elyaf boyu = dom yol boyu + gövde kısmı (±%0,1). A hiç azalmaz, ilk G1'den sonra G0 yok (mevcut değişmezler).

**Dayanak.** Ölçüm S1 "Geçiş → K2" satırı; `winding.ts` satır 167–173 (tek doğrusal geçiş). Clairaut: `dome.ts`.
**Makinede doğrulanacak.** Geçişte elyafın domdan kaymadan ekvatora indiği.

---

## REQ-008 — İlk k devre deneme programı (P2, aday A5)

**Problem.** İlk sarımda tam katman (S1'de 116 dk) riskli; ilk sarım adımları "tek devre" ve "beş devre" istiyor ama bunları üreten program yok. Kullanıcı programı elle kesmek zorunda kalır (G93 F, katman başı, bitişte G94 kolayca bozulur).

**Gereksinim.** Seçilen katmanın ilk k devresinden (k kullanıcı girer; boşsa üretilmez) bağımsız program: aynı başlık, aynı F kuralları, REQ-001 başlangıcı, k devre sonunda `G94` + `M2/M30`. Hoop katmanında k = gidiş-dönüş sayısı (1).

**Kabul ölçütü.** S1 katman 3, k = 1: doğrulayıcı hata vermez; G1 sayısı = 4 (2 geçiş + 2 dwell) + başlangıç; son A = başlangıç A + θc (θc = 2πN + 2π·j/n; ±0,01°); süre = tam programdaki aynı devrenin süresi (±%0,1). k > devre sayısı → hata mesajı.

**Dayanak.** `firstWind.ts` "Tek devre", "Beş devre" adımları; araştırma notu §6.4.
**Makinede doğrulanacak.** Tek devrede bandın beklenen yuvaya (j) düştüğü.

**Ek (tur 3, S8 yanıtı, P2).** Ara katman (katman > 1) denemesi önceki katmanların sarılı olduğunu varsayar. Boş mandrelde temas yarıçapı Δr kadar küçük olur ve geçiş dönüşü Δθ ≈ L·tanα·Δr/r² rad kayar. S1 K3 boş mandrelde (r 61,25 yerine 60,25): 800·tan55°·(1/60,25 − 1/61,25) = 0,310 rad = **17,7° / geçiş**; bant açısal genişliği w/(r·cosα) = 9,8°. Yani tek devrede bant ~3,6 bant genişliği kadar yanlış yuvaya düşer; "beklenen yuvaya düştü mü" kontrolü geçersizdir. Ayrıca A fazının tam programla aynı olması ancak mandrel A sıfırı önceki katmanlarınkiyle aynı referansta kurulmuşsa anlamlıdır.
Gereksinim: katman > 1 seçiliyken deneme bölümünde ve G-code başlığında uyarı: "Önceki katmanlar sarılı varsayıldı; boş mandrelde bant yuvası (j) kontrolü geçersiz (bu katmanda ≈ X°/geçiş kayma); A sıfırı önceki sarımla aynı referansta olmalı". X = yukarıdaki formül, Δr = katman yol yarıçapı − (mandrel yarıçapı + bant kalınlığı). Ayrı yarıçap seçeneği istenmez (tam programdan farklı bir program üretir).
Kabul: S1 K3 k=1 başlığında uyarı var ve X = 17,7 ±0,1; K1 denemesinde uyarı yok.

**Düzeltme (tur 4, S9 yanıtı).** Yukarıdaki 17,7°/geçiş ve "yuva kontrolü geçersiz" **yanlıştı** (benim hatam). Program A ve X'i komut eder; silindirde her helis geodeziktir, elyaf komut edilen kinematiği izler: tan α' = (r'/r)·tan α, geçiş dönüşü ΔA = L·tanα/r yarıçaptan bağımsız kalır, temas noktasının açısal konumu A ile belirlenir (göz açısal ofseti acos(r/Y) sabit fark verir, birikmez). Benim formülüm elyafın α'yı koruyup dönüşün yeniden hesaplandığını varsayıyordu; komut edilen A'lı makinede bu olmaz. Ölçüm (`scripts/measure-2026-11-05-r4.mm.test.ts`, S1 K3 boş mandrel r' 60,25): α' 54,56°, bant açısal genişliği 9,785° → 9,839° (+%0,55), yuva aralığı 9,730° (örtüşme 0,056° → 0,109°), göz ofseti +0,84° sabit, uç gecikmesi g 47,6 → 49,0 mm. Yuva (j) kontrolü açısal olarak geçerlidir; değişen elyaf açısı, örtüşme ve uç dönüşünün eksenel yeridir.
Düzeltilmiş kabul: S1 K3 k=1 başlığında uyarı var; uyarı Δr = 1,00 ±0,01 mm ve boş mandrel elyaf açısı 54,56 ±0,01° içerir; "°/geçiş kayma" sayısı yoktur; K1 denemesinde uyarı yok. (ADR-014 uygulaması bunu sağlıyor.)

---

## REQ-009 — 3 eksende göz yarıçapı parçanın dış yüzeyiyle karşılaştırılır (P0, tur 2, S1 yanıtı)

**Problem.** REQ-004 uygulaması Re'yi her katmanın **yol yarıçapıyla** (katman ortası r = r0 + T/2) karşılaştırıyor (REQ metnim de öyleydi; hata benim). 3 eksende göz Re'de sabit kalır, mandrel sarıldıkça büyür; bağlayıcı yüzey son katmanın **dış yüzeyi** R_dış = r0_son + T = `plan.outerDiameter / 2`. Ölçüm (tur 2 betiği): S1 3 eksen, Re = 61,3 mm → `missingFields` boş, ama R_dış = 61,5 mm: göz son katmanın içinde, sarım sırasında göz bandı ve parçayı sıyırır.

**Gereksinim.** 3 eksende Re girilmişse Re > R_dış olmalı (R_dış = tüm katmanlar sarıldıktan sonraki dış yarıçap, silindir gövdede); değilse `missingFields`: "Göz yarıçapı Re=… mm parçanın dış yarıçapından (… mm) büyük olmalı: kafa son katmanda sargıya değer". Gizli pay yok; arayüz katman tablosunda "göz boşluğu Re − R_dış" değerini gösterir, kullanıcı yeterliliğine kendisi karar verir. 4 eksende değişiklik yok (Y = dış yüzey + standoff, standoff ≥ 0 zaten zorunlu).

**Kabul ölçütü.** S1 3 eksen: Re = 61,3 → hata (R_dış 61,5); Re = 61,5 → hata (eşitlik çarpışma sayılır); Re = 61,6 → hata yok, gösterilen boşluk 0,10 ±0,001 mm. Re boş → kontrol yok (bugünkü davranış).

**Dayanak.** Ölçüm `docs/engineering/scripts/measure-2026-11-05-r2.mm.test.ts` ("REQ-002 / REQ-004 kabul durumları"); `winding.ts` `layerRadius` = r0 + lt/2.
**Not.** Re göz **çıkış noktasıdır** (λ, g hesabı bunu ister). Gözün gövdesi/tutucusu çıkış noktasından daha içe uzanabilir; bu kontrol gerekli ama yeterli değildir. Arayüz açıklaması: "Göz gövdesi daha içe uzanıyorsa boşluğu ona göre değerlendir".
**Makinede doğrulanacak.** Re ölçümü (mandrel ekseninden göz çıkışına) ve gözün en iç kenarının son katman çapına mesafesi.

---

## REQ-010 — Durağan aralıkta genel kayma kontrolü: tüm geçiş türleri ve düz uçta tam dönüş (P1, tur 3, S6/S7 yanıtı)

**Problem.**
- REQ-006 geçiş kontrolü yalnız yeni katman düz helisel iken çalışıyor. Ölçüm (tur 3 betiği, μ 0,3): S1 K1→K2 dom→hoop gövde kısmında elyaf yönü 30° → 89,1° değişiyor, kaymasız gereken mandrel dönüşü **248,5°** (eksenel 202,5 mm), geçişte ΔA 20°; kontrol yok. S3 (aşağıda) dom→dom 30° → 140°: 444,5°; dom→hoop 40° → 89,1°: 190,1°. Hepsi kontrolsüz; elyaf dom ekvatorunda / gövde ucunda kayar.
- Düz uç dwell'inin tam dönüşü φ → 90° → 180° − φ iki yarıdan oluşur; gereken dönüş 2·θ_t'dir (55°, μ 0,3: 249,4°). Bugünkü uyarı "gereken ≥ 124,7° dönüş" diyor (yarısı; benim REQ-006 metnimdeki eksiklik). S1 K3 dwell'i 196,1° olduğundan yarı değerle karşılaştırma yanıltıcı olur.
- S1 K2→K3 (hoop 90,9° → 55°) kontrolü yalnız yeni α ile 124,68°; doğru değer 127,7° (S7: hoop tarafındaki yarı da sayılmalı).

**Türetim (kendi; REQ-006 ile aynı kayma koşulu k_g ≤ μ·k_n, silindir).** k_g = dψ/ds, k_n = sin²ψ/r, mandrel dönüşü dθ = sinψ·ds/r ⇒ dθ ≥ dψ/(μ·sinψ) ⇒
θ_req(ψ₁ → ψ₂) = |ln tan(ψ₂/2) − ln tan(ψ₁/2)| / μ (ψ = elyaf yön açısı, 'fiber' C'si, 0 < ψ < 180; ψ monoton ise geçerli, 90°'den geçişte iki yarıyı kendiliğinden toplar).
Eksenel uzunluk x_req = (r/μ)·|1/sinψ₁ − 1/sinψ₂| (90°'den geçmiyorsa), (r/μ)·(1/sinψ₁ + 1/sinψ₂ − 2) (geçiyorsa: ileri taşma + geri).
Kontrol: 1/sin(ψ) ile REQ-006 formülü ψ₁ = α, ψ₂ = 90° için aynen çıkar.

**Gereksinim.**
- **Durağan aralık** = ardışık iki ΔX ≠ 0 G1 arasındaki ΔX = 0 G1 dizisi (düz uç dwell'i, hoop uç dönüşü, geçiş gövde kısmı; önceki katmanın son dwell'i + geçiş gövde kısmı birlikte tek aralıktır). Dom kutup dwell'i hariç (REQ-006 k_g/k_n kontrolü geçerli).
- μ girilmişse her durağan aralık için ψ₁ = aralık başındaki C, ψ₂ = aralık sonundaki C ('mirror' kipinde C < 0 ise ψ = 180° + C), ΔA = aralıktaki A toplamı, r = aralıktaki katman yol yarıçapı. ΔA < θ_req ise uyarı: "Katman k: x = … mm ucunda elyaf yönü ψ₁ → ψ₂ değişiyor; kaymasız için ≥ θ_req° dönüş ve ≥ x_req mm eksenel gerekir, ΔA = …°; pim halkası/uç tutucu gerekli". Aynı katmanın düz dwell'leri aynı değeri verdiğinden katman başına tek uyarı yeter; geçişler ayrı uyarı.
- `LayerInfo.slip` düz katmanda tam dönüş değeri `turnFullDeg` = θ_req(φ, 180° − φ) = 2θ_t ve uyarı metni "gereken ≥ 2θ_t° dönüş (her yarıda θ_t), ≥ x_t mm uç taşması" olur. Geçiş için `transitionTurnDeg` yanına `transitionRequiredDeg` (θ_req) ve `transitionAxial` (x_req); hedef katman türünden bağımsız.
- μ boşsa sayısal alanlar null; G-code değişmez. Gizli eşik yok.

**Kabul ölçütü (μ 0,3).** Formül: θ_req(30, 150) = 503,04 ±0,05 (= 2·251,52); θ_req(55, 90) = 124,68 ±0,05. S1 4 eksen: K1→K2 θ_req 248,5 ±0,1, x_req 202,5 ±0,5, ΔA 20 → uyarı; K2→K3 θ_req 127,7 ±0,1 → uyarı; K3 turnFullDeg 249,37 ±0,05, uyarı metni bu sayıyı içerir. S3 = S1 ölçüleri, katmanlar [55° düz, 30° domlu h60, 40° domlu h60, hoop, 55° düz]: K2→K3 444,5 ±0,2; K3→K4 190,1 ±0,2; K4→K5 127,6 ±0,2; K1→K2 aralığı (önceki son dwell + gövde) ψ₁ = 125°, ψ₂ = 150° → 126,8 ±0,2 ve ΔA = K1 uç dönüşü + 20° (REQ-011 uygulanmadan önce C bu aralıkta monoton değil; bu durumda uyarıya "C bu aralıkta monoton değil, değer alt sınır" eklenir). μ boş → yeni alanlar null.

**Dayanak.** Ölçüm `docs/engineering/scripts/measure-2026-11-05-r3.mm.test.ts` (REQ-006, REQ-007 bölümleri; `thetaReq`, `axialReq` aynı formül). μ değeri [C], kullanıcı girer.
**Makinede doğrulanacak.** μ ölçümü; dom→hoop geçişinde ekvatorda kayma gözlemi (kuru elyafla, düşük hızda).

---

## REQ-011 — Durağan aralıkta C 90°'yi yalnız carriage yön değiştirince ve bir kez geçer (P2, tur 3, S6 ölçümü)

**Problem.** Düz helisel → domlu geçişte (S3 K1→K2, 4 ve 3 eksen) önceki katman son dwell'inde C 125° → 55° döner (elyaf +X'e çevrilir), geçiş gövde kısmında 55° → 150° (yeniden −X; dom çıkışı −X yönünde). Carriage −X'ten gelip −X'e gidiyor, yön değişmiyor; ama C 90°'yi iki kez geçiyor. Fiziksel sonuç: gereksiz 165° C hareketi (gövde kısmı 95°/0,424 s = 224 °/s), bant göz içinde iki kez kenarına dönüyor (REQ-003'ün önlemek istediği durum), kayma kontrolü için aralıkta ψ monoton olmadığından REQ-010 formülü alt sınır olur. Diğer geçiş türlerinde (dom→hoop, dom→dom, dom→düz, hoop→düz, hoop→dom, düz→düz) ölçümde kural sağlanıyor.

**Gereksinim ('fiber' kipi).** Her durağan aralıkta (REQ-010 tanımı; dom kutup dwell'i dahil) C monotondur ve aralık başı/sonu C'si için: carriage yönü (aralıktan önceki ve sonraki ΔX ≠ 0 G1'in ΔX işareti) değişiyorsa (C_baş − 90)·(C_son − 90) ≤ 0, değişmiyorsa ≥ 0. A değerleri ve süre kuralı değişmez (yalnız C). Öneri (yazılım mühendisi seçer): sonraki katman −X yönünde başlıyorsa önceki düz katmanın son dwell'inde C dönüş açısında kalır (ΔC = 0), gövde kısmı 125° → 150° gider; REQ-003 "dwell ΔC = 180° − 2α" ölçütüne bu dwell için istisna yazılır.

**Kabul ölçütü.** Bağımsız G-code okumasıyla, S1, S3 (REQ-010 tanımı) ve `invariants.test.ts` rastgele 'fiber' programlarının tüm durağan aralıklarında kural sağlanır. S3 K1→K2 aralığı C 125° → 150°, gövde kısmı |ΔC|/T ≤ 65 °/s (25°/0,424 s ≈ 59 °/s). Düz → domlu geçiş içermeyen altın örneklerin özetleri değişmez; değişenlerde X/A/Y ve süre birebir aynı (yalnız C ve G94'te lineer bileşensiz satır F'i).

**Dayanak.** Ölçüm tur 3 betiği, REQ-007 bölümü ("S3 K1→K2: C 55,00→150,00, giriş yönü (dwell) …").
**Makinede doğrulanacak.** Kafa kinematiği varsayımı (REQ-003 kullanıcı sorusu) doğrulanınca bu kural anlamlıdır.

**Not (tur 4, S10 yanıtı).** Kural düz → hoop, düz → büyük açılı düz ve düz → domlu (α₂ > α₁) geçişlerini de kapsar (yazılım mühendisinin rastgele testte bulduğu ihlaller; tur 4 ölçümünde S4–S8 ile doğrulandı). C'nin aralık içindeki dağıtımı (kıskaç / A ile orantılı) bu REQ'in kapsamı dışında; kıskaç kabul edildi (ADR-013).

---

## Bu turda REQ'e çevrilmeyen adaylar
Bkz. `backlog.md` (A4, A6, A7, A9, A10 gerekçeleri).
