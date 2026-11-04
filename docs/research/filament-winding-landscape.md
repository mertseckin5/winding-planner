# Filament Winding Yazılımları ve Yöntemleri: Araştırma Raporu

Tarih: 2026-10-29
Hazırlayan: winding-research ajanı (kod yazılmadı, `src/` değişmedi)
Yöntem: Web araması + kaynak sayfaların okunması (WebFetch). Bazı sayfalar 403/erişilemez döndü; bunlar "erişilemedi" diye işaretli. Mevcut kod (`core/winding.ts`, `gcode.ts`, `dome.ts`, `CLAUDE.md`) okundu ve bulgularla karşılaştırıldı.

Güvenilirlik ölçeği: **[A]** resmî dokümantasyon / resmî depo, **[B]** üretici/satıcı sayfası (pazarlama içerebilir), **[C]** forum / kullanıcı yazısı (tek kişinin deneyimi), **[D]** doğrulanmadı / tahmin.

---

## 0. Kısa Cevaplar (istenen üç soru)

### 0.1 LinuxCNC'de X+A birlikte G94 hareketinde F nasıl yorumlanır?
- XYZ'den biri hareket ediyorsa F, XYZ kartezyen uzayında "birim/dak"tır; ABC/UVW eksenleri başlama ve bitişi koordine olacak şekilde ister istemez yetişir. UVW'den biri hareket ediyorsa F UVW uzayındadır. Hiçbir lineer eksen hareket etmiyorsa hareket saf rotary'dir ve F, ABC "sözde-kartezyen" uzayında rotary birimdedir (derece/dak). Kaynak [A]: https://linuxcnc.org/docs/html/gcode/machining-center.html (bölüm "Feed Rate", 1–3. kurallar; sayfadan birebir okundu).
- Yani **X+A hareketinde F yalnız X'in (ve varsa Y'nin) uzunluğundan hesaplanır, A'nın açısı F'e katılmaz**; A, X ile aynı sürede bitecek hızda döner. Hareket süresi = lineer_mesafe / F. Forumda doğrulayıcı test: `G1 Z10 A100 F100` hareketinde döner eksen F ile sınırlanmadı, yaklaşık 1000 °/sn ile Z hareketiyle birlikte bitti; gerekçe "planlayıcı takım ucunun dönme merkezine uzaklığını bilmez". Kaynak [C]: https://forum.linuxcnc.org/38-general-linuxcnc-questions/32488-feed-rate-priority-on-rotary-and-linear-axis
- Saf rotary hareketinde (`G1 A360 F360` = 1 dakika) F derece/dakikadır. Kaynak [A]: https://linuxcnc.org/docs/stable/html/gcode/g-code.html (G94 bölümü: "degrees per minute, depending upon ... which axis or axes are moving") ve aynı forum konusu [C].
- G93'te (inverse time) "F, hareketin 1/F dakikada tamamlanacağı anlamına gelir"; her G1/G2/G3 satırında F zorunludur; G0 etkilenmez; canned cycle sırasında G93 aktifse hata. Kaynak [A]: https://linuxcnc.org/docs/stable/html/gcode/g-code.html (G93 bölümü). LinuxCNC kılavuzu ayrıca karışık lineer+rotary hareketler için G93'ü önerir (https://linuxcnc.org/docs/stable/html/gcode/overview.html, "Linear and Rotary Axis") [A].
- **Mevcut kodla uyum:** `gcode.ts` G94'te `f = lin/minutes` (lin = hypot(ΔX,ΔY)), lin≈0 ise `rot/minutes` kullanıyor. Bu LinuxCNC kurallarıyla birebir uyumlu: lineer varsa lineer, yoksa rotary (hypot(ΔA,ΔC) = ABC sözde-kartezyen normu).
- **Risk:** Bu modda A'nın hızı F ile *sınırlanmaz*; planlayıcı A'nın `MAX_VELOCITY` değerini aşacaksa bütün hareketi yavaşlatır (bu, forumdaki ve LinuxCNC'nin genel davranışıyla tutarlı, ama aşım davranışının birebir kaynağı bulunamadı [D]). Sonuç: elyaf hızı programlanandan sessizce düşük olabilir. Hoop katmanda (çok tur, kısa X) ve dom kutup yakınında A hızı çok yükselir.

### 0.2 Mach3'te G93 destekli mi?
- **Büyük olasılıkla evet, ama resmî Mach3 kılavuzundan doğrulayamadım.** Dayanaklar:
  - Mach Motion bilgi tabanı Mach3 için G93 formülünü veriyor (lineerde ters besleme = istenen besleme [in/dak] / mesafe [in]; yaylarda G02/G03 için "in/sn" kullanımı; sayfa bunu "Mach3'ün tuhaflığı" diye adlandırıyor; metrik anlatılmıyor) ve G93'ü dönel eksenler için öneriyor. [B] https://machmotion.gitbooks.io/knowledge-base/content/inverse-feed-rate-g93-in-mach3.html
  - Fusion 360 Mach3 post'unun çok eksenli hareketlerde varsayılan olarak ters zaman beslemesi kullandığını (`useInverseTimeFeed = true`) post geliştiricisi söylüyor. [C] https://forums.autodesk.com/t5/hsm-post-processor-forum/mach3-post-processor-with-g93-inverse-time-feed-rate-in-fusion/m-p/9027505 (sayfa 403 verdi; bilgi arama özetinden, doğrudan okunamadı). Aynı başlıkta bir kullanıcı G93 çıktısının bir CAM'den çalışıp diğerinden çalışmadığını bildiriyor, yani F değeri/satır biçimine duyarlı olabilir [C].
  - Mach3 forumunda bir kullanıcı, "saat kadranı" işinde G93 önerisinin sorunu çözdüğünü yazıyor. [C] https://www.machsupport.com/forum/index.php/topic,19321.0.html
- **Resmî Mach3 G-code referansı** (https://machmotion.com/documentation/gcode/Mach3-GCode-Language-Reference.pdf) 403 verdi; G93 satırı birebir okunamadı. Arama özeti bu belgeden G94'te dönel eksen kuralını aktarıyor (aşağıda 0.2.1). **G93'ün tam semantiği (F birimi, G0 etkisi, mod kapatma) Mach3 için doğrulanmadı [D].**
- Pratik: Mach3'te G93 modu iptal etmek için G94 gerekir (genel kural; eng-tips tartışması [C] https://eng-tips.com/threads/inverse-time-feed-rate.200454). Bizim çıktı başta mod satırı yazıyor ve sonunda M30 ile bitiyor; bitişte `G94` yazılmıyor (öneri: yaz).

#### 0.2.1 Mach3'te G94 ile birleşik X+A hareketi LinuxCNC'den FARKLI olabilir
- Mach3 G-code Language Reference'tan aktarılan (ikincil, PDF'e erişilemedi) kural: yalnız dönel eksen hareket ederse F = derece/dak; lineer eksen(ler) ile birlikte dönel hareket varsa F, "programlanmış lineer XYZ(ABC) yolu boyunca uzunluk birimi/dak", dönel eksenin açısal hızı × "Axis Correction Diameter" × π ile birleştirilerek hesaplanır; D = sqrt(dA²+dB²+dC²). [B/D, arama özeti] https://machmotion.com/documentation/gcode/Mach3-GCode-Language-Reference.pdf
- Mach3 forumunda "Config → Toolpath → Axis of Rotation" ve "Use Radius for feed rate" gibi ayarlardan söz ediliyor; hangi sürümde ne yaptığı belirsiz [C/D]: https://www.machsupport.com/forum/index.php/topic,19321.0.html
- **Sonuç:** Mach3'te G94 besleme, Mach3'ün "correction diameter" ayarına bağlıdır; bizim `f = lineer/süre` formülümüz bu ayar 0 değilse süreyi yanlış verir (yüksek olasılıkla daha hızlı/yavaş sarım). Kesin davranış makinede ölçülmeli. **G93, her iki kontrolcüde de süreyi açıkça verdiği için sarımda en güvenli seçenek**; ama Mach3'te G93 doğrulaması da bekliyor.

### 0.3 Uç dönüşü için yaygın yöntem: dwell mi, ayrı profil mi?
- **Silindirik mandrel (dom yok) yazılımlarında: dwell (kafa/araba uçta durur, mandrel belirli bir açıda döner).**
  - Cyclone (açık kaynak): `lockDegrees`, `leadInMM`, `leadOutDegrees` parametreleri (README, ayrıntı belgelenmemiş). [A] https://github.com/reilleya/cyclone
  - AddWind rehberi: "dwell = araba bir z konumunda dururken tam bir mandrel dönüşü"; "bir katmanın sonunda tek dwell, katman içinde dört küçük dwell'den iyidir"; fazla dwell kürlenmiş parçada tümsek ve gerilim yoğunlaşması yapar. [B] https://addwind.addcomposites.com/blog/dome-turnarounds-and-polar-buildup.html
  - Eski bir patent: geleneksel uygulamada domlu mandrelde her strok başında/sonunda çapraz kol ve olası döner göz yardımcı eksen olarak kullanılır; 3 eksenli makinede dwell tek başına yapılır (arama özeti, doğrulanmadı). [C/D] https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4838970
  - Kaymayı önlemek için mandrel uçlarında pim halkaları (pin ring) kullanılır. [C] https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5468329 (arama özeti)
- **Domlu kaplarda: ayrı profil değil, gerçek yol dom üzerinden devam eder ve kutupta döner**; yol kutup açıklığında paralele teğet olur (Clairaut). Bu da bizim `dome.ts` yaklaşımıyla aynı. AddWind sayfası ayrı bir "dönüş profili" prosedürü anlatmıyor [B] (aynı URL).
- Cadfil (ticari), mekanik payout için özel kontrol stratejisini post-processor'da yapılandırdığını bir JEC vaka çalışmasında belirtiyor. [B] https://www.nxtbook.com/newpress/jeccomposites/jcm2206_146/index.php?startid=27 (arama özeti).
- **Çıkarım:** Bizim "araba durur, mandrel döner" yaklaşımı silindirik uçta yaygın pratikle uyumlu, ama kayma kontrolü olmadan yalnızca pim/kilit (lock) olan mandrelde güvenilir [D, çıkarım].

---

## 1. Benzer Yazılımlar

| Yazılım | Tür / lisans | Neler yapıyor | Çıktı / kontrolcü | Bakım durumu | Kaynak (güvenilirlik) |
|---|---|---|---|---|---|
| **FiberPath** (fiberpath/fiberpath) | Açık kaynak, AGPL-3.0, Python 3.11+, masaüstü GUI | Silindirik mandrel; hoop, helisel, skip katmanları; planlama, simülasyon, doğrudan makine akışı (duraklat/devam). Geodezik/konik/özel mandrel "planlanmış ama yok" | Marlin tabanlı donanım; XAB eksen (X araba mm, A mandrel °, B teslim kafası °) | Aktif görünüyor: PyPI 0.11.0, 7 Eyl 2026; depoda 615 commit; yıldız sayısı düşük (5) | https://pypi.org/project/fiberpath/ [A], https://github.com/fiberpath/fiberpath [A] |
| **Cyclone** (reilleya/cyclone) | Açık kaynak, GPL-3.0, Node.js CLI | Yalnız silindirik mandrel; hoop (uçta bitebilen veya gidiş-dönüş) ve helisel (`windAngle`, `patternNumber`, `skipIndex`, `lockDegrees`...); `thickness` parametresi kullanılmıyor; terminal hoop sonrası katman hata veriyor | Marlin; eksenler sabit X araba, Y mandrel, Z kafa (derece) | Sadece kaynak, sürüm yok; son commit tarihi sayfada görünmüyor (27 commit, 3 açık issue) | https://github.com/reilleya/cyclone [A] |
| **CADFIL** (Crescent Consultants, UK) | Ticari | 1983'ten beri; 2 eksen boruya 6 eksen karmaşık parçaya; 3D analiz, kalınlık ve hareket görüntüleme; CAD/FEM'e dışa aktarım; geniş CNC/robot kontrol verisi | Çok kontrolcü (post-processor yapılandırması) | Üçüncü taraf: hâlâ geliştiriliyor, arayüz eski (resmî site cadfil.com açılmadı) | https://compositesworld.com/suppliers/crescent-consultants [B]; https://www.nxtbook.com/newpress/jeccomposites/jcm2206_146/index.php?startid=27 [B]; yorum: addcomposites.com blog [B, rakip pazarlaması] |
| **CADWIND** (MATERIAL SA, Brüksel) | Ticari | CADWIND 2007: animasyonlu sarım simülasyonu, payout eye - mandrel girişim kontrolü; kiralama mümkün | Bilgi bulunamadı | Kaynaklar 2007; güncel durum doğrulanmadı | https://www.compositesworld.com/products/filament-winding-software---712007 [B] |
| **WindingExpert** (Mikrosam) | Ticari | Hoop, helisel, geçiş katmanları; geodezik ve non-geodezik yol; sarım ve desen simülasyonu; kullanıcı komutlu G-code özelleştirme; ISO G-code içe aktarma | Galil, Beckhoff, Siemens, Kuka robot vb. | Güncel durum doğrulanmadı | https://archive.mikrosam.com/windingexpert/ [B] (arşiv alt alanı) |
| **TaniqWind Pro** | Ticari | CNC veya robotik sarım; eksen sayısı/yapılandırması seçilir; post-processor üreteci; simülasyon, çarpışma/erişilebilirlik opsiyonel; Lite/Extended/Full paketleri | Robot + CNC | Güncel | https://composites.taniq.com/filament-winding-software [B]; non-geodezik desteği sayfada geçmiyor |
| **ComposicaD** | Ticari | Pazar karşılaştırmasında "dört liderden biri" olarak geçiyor; özellikleri doğrulanmadı | - | - | https://www.compositesworld.com/products/filament-winding-software [B, kısa] (özellikler **doğrulanmadı**) |
| **AddWind** (Addcomposites) | Ticari, erken erişim ücretsiz | Helisel + hoop; desen/skip/cycle arama, kapsama metrikleri, kalınlık duyarlı laminat, dom birikimi; 4 eksen oynatma (mandrel, araba, payout eye, yaw, bant besleme); G-code çıktısı **yeniden doğrulanma aşamasında**, CCDF/Siemens yol haritasında | Henüz teyitli değil | Aktif (erken erişim) | https://addwind.addcomposites.com/ [B] |

Not: OpenSource tarafında bulabildiğim iki proje (FiberPath, Cyclone) ikisi de **Marlin, silindirik, hoop/helisel**, **LinuxCNC/Mach3 çıktısı vermiyor, dom yok**. Kapsamlı bir arama yapılmadı; GitHub'ın tamamı taranmadı, başka projeler olabilir [D]. LinuxCNC/Mach3 + dom + 4 eksen (Y radyal) kombinasyonunda açık kaynak rakip bulunamadı; Winding Planner bu açıdan boşluk dolduruyor (bulamama kanıt sayılmaz).

---

## 2. Yöntemler

### 2.1 Geodezik yol, Clairaut
- Dönel yüzeyde geodezik: r·sinφ = sabit (φ meridyenle açı). Kutup açıklığı r0 = R·sinα gövde açısından bulunur. Winding Planner `dome.ts` bunu uyguluyor. Kaynak: AddWind rehberi Clairaut'u anıyor ama formülünü vermiyor [B] https://addwind.addcomposites.com/blog/dome-turnarounds-and-polar-buildup.html; ekstra formül kaynağı bu araştırmada okunamadı (KAIST pdf'e erişilemedi). Clairaut genel diferansiyel geometri sonucu, [A-düzeyi bilgi] ama bu rapor için kaynak sayfası okunmadı [D].

### 2.2 Non-geodezik yol ve sürtünme (kayma) sınırı
- Kayma katsayısı = jeodezik eğrilik / normal eğrilik; denge için Kg/Kn ≤ μ. Reçineli elyaf için sürtünme katsayısı çalışmalarda yaklaşık 0.3–0.4 olarak anılıyor. Kaynak [C, arama özeti, birincil makaleler açılmadı]: Çin kaynaklı tor sarımı makalesi https://fhclxb.buaa.edu.cn/article/id/11717; konik domlar için https://www.scientific.net/AMM.281.304 ("sürtünme katsayısının sarım açısı gelişimine büyük etkisi var").
- Optimum dom profil ODE'leri ve sabit kayma katsayısı tasarımı: Composites Part A, DOI 10.1016/j.compositesa.2010.05.015 (arama özeti). [C/D] Denklemler okunmadı.
- Dry fiber winding için yol hesabı derlemesi: https://pure.unileoben.ac.at/portal/en/publications/path-calculation-technology-and-opportunities-in-dry-fiber-winding(e35d5936-852a-4f50-81ec-ce329457f541).html (yönlendirme sonrası sayfa okunmadı) [D].
- AddWind: Kayma görünümünde düşük açılı katmanların dom bölgesinde yüksek kayma verdiğini, sürtünme faktörü düşürülerek yolun ne kadarının uygulanabilir olduğunun görüldüğünü söylüyor; sayısal eşik vermiyor. [B] aynı URL.

### 2.3 İzotensoid dom
- İzotensoid dom: elyaf gerilmesinin tüm lifler boyunca eşit olduğu net teorisine göre tasarlanmış profil; eşitsiz kutup açıklıkları için non-geodezik izotensoid yöntemi literatürde var (Zu ve diğerleri). [C, arama özeti]
- **Mevcut kodda dom yarı-elips (h parametreli); bu izotensoid değildir.** Geodezik yol yarı elips üzerinde geçerli (Clairaut herhangi bir dönel yüzeyde çalışır) ama basınçlı kap optimizasyonu için gerçek izotensoid kontur eksik. İzotensoid kontur denklemleri bu araştırmada kaynaktan okunmadı; uydurulmadı.

### 2.4 Bant genişliği, kalınlık
- Çevresel kapsama: w/cosα; tek katman kalınlığı yaklaşık t_cyl/cosα (dom/kutupta); kutup civarı silindir ortasına göre 2 kat veya daha kalın. [B] https://addwind.addcomposites.com/blog/dome-turnarounds-and-polar-buildup.html
- Tam kaplama için gereken bant sayısı n = πD·cosα / b (patentte aynı bağıntı, uyum kontrolü). [C] https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12450404 (arama özeti). Winding Planner: `bands = ceil(2πr·cosα / w)` aynı.
- Bizim modelde katman = ±α çifti (gidiş + dönüş), her yönün bantları tek başına çevreyi doldurur (n bant, adım 2π/n); bu nedenle katman 2·t kalınlık ekler. Bu yaklaşım tutarlı (kendi analizim, kodun türetimi kontrol edildi).

### 2.5 Faz / pattern (gcd)
- Kaynaklar: patent, tam çevre kapsamı için dolaşım sayısı ile (d) *aralarında asal* olma koşulunu "uniform winding condition" diye veriyor [C] https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12450404 (arama özeti; kullandığı gösterim d = N(P−r) tam anlaşılamadı). AddWind: N (devre), S (skip), cycles; S=1 komşu slot, S=2 bir slot atla; gcd kuralını sayfa açıkça yazmıyor. [B] https://addwind.addcomposites.com/blog/pattern-closure-skip-cycles-coverage.html Cyclone: `patternNumber`, `skipIndex` [A].
- Genel kural (benim bilgim, bu kaynaklardan **doğrulanmadı [D]**): n slot varken her devrede j slot ilerlenirse tüm slotlar ancak gcd(n, j)=1 ise doldurulur. Winding Planner j=1 kullanıyor, gcd = 1 olduğundan her n için kapanır. j>1 (skip) gerekirse (kayma azaltmak için) gcd kontrolü şart olur.
- Zaman ve uç dönüşü: j=1 ile devre dönüşü 2πN + 2π/n; N, uç dönüşü asgariyi sağlayacak şekilde seçiliyor. Bu seçimle uç dönüşü bazen büyür (kod uyarı üretiyor).

### 2.6 Uç dönüşü ve kayma kontrolü
- Bkz. 0.3. Slip patent yöntemi: her noktada uç konumundaki kayma katsayısını maksimum mandrel-elyaf kayma katsayısıyla karşılaştırıyor; dwell açısı girdilerden biri. [C] https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12450404 (arama özeti)

---

## 3. Makine Kontrolü

### 3.1 G93 / G94 / rotary F
Bkz. bölüm 0. Ek bulgular:
- **LinuxCNC planlayıcı: dönel eksen hareketinde ileriye bakış (lookahead) kısıtlı.** LinuxCNC moderatörü (andypugh): planlayıcı yalnız XYZ hareketlerinde yaklaşık 100 segment ileri bakıyor, herhangi bir dönel eksen hareket edince tek segment ileri bakışa düşüyor; Tormach düzeltmiş ama LinuxCNC'ye alınmamış. Yazan kullanıcıda ayarlar sorunu çözmedi. Sürüm belirtilmemiş, tarih yalnız "Dec 6". [C] https://forum.linuxcnc.org/20-g-code/50870-inverse-time-feed-g93-ignored-with-4th-rotary-axis. **Bizim durum için sonuç:** her satırda A hareket eder; çok sayıda küçük segment (dom noktaları) beslemeyi düşürebilir. Güncel LinuxCNC'de düzelip düzelmediği doğrulanmadı [D].
- Tormach personeli (Aralık 2025): saf rotary hareketinde F derece/dak; eş zamanlı harekette lineer besleme kullanılır, rotary yetişir; dönel eksen maksimum hıza ulaşırsa lineer eksenler yavaşlar; "eş zamanlı hareket hızını denetlemek için ters zaman beslemesi gerekir". Başka kullanıcı: binlerce küçük hareket dördüncü ekseni yavaşlatıyor. [C] https://forums.tormach.com/t/rotary-axis-feed-rates/2875 (kontrolcü adı belirtilmemiş)
- RapidRotary (GPL-3.0, LinuxCNC 2.5'te test): G94 → G93 dönüştürücü; rotary hareketler için Z konumunu yarıçap sayıp süre hesaplıyor. [C] https://github.com/sgano/RapidRotary. Bizim yaklaşımımız aynı fikir: süreyi elyaf yol uzunluğundan türetiyoruz (daha doğru, çünkü yarıçap katman/dom boyunca biliniyor).
- G4 dwell (LinuxCNC): P saniye, "tüm eksenler hareketsiz". [A] https://linuxcnc.org/docs/html/gcode/g-code.html (Mach3'te G4 birimi doğrulanmadı [D]).

### 3.2 A ekseni sınırsız dönüş: LinuxCNC INI
- `[AXIS_A] MIN_LIMIT/MAX_LIMIT`: sınırsız dönüşlü dönel eksende limit belirtilmezse -1e99 / 1e99 kullanılır. [A] https://linuxcnc.org/docs/html/config/ini-config.html (okundu). Forum: moderatör "çok büyük sayılar koydum" diyor; 0 geçerli bir limit olduğu için "sıfır = sınırsız" seçeneği yok. [C] https://www.forum.linuxcnc.org/10-advanced-configuration/34908-unlimited-rotary-axis ve https://forum.linuxcnc.org/10-advanced-configuration/40294-rotary-axis-limits (arama özeti).
- `WRAPPED_ROTARY = 1` (`[AXIS_<harf>]`): "0–359.999 derece hareket"; işaret yönü belirler. [A] aynı INI sayfası. Forum: andypugh'a göre `G0 A810` pozitif yönde 2.25 tur yapmalı, ama konuyu açan kullanıcı "davranışta değişiklik yok" bildirdi; çözüm teyitli değil. [C] https://forum.linuxcnc.org/10-advanced-configuration/34908-unlimited-rotary-axis (2018, sürüm belirsiz). **Birikimli A (G90 A7200...) için `WRAPPED_ROTARY` kapalı tutmak ve limitleri büyük bırakmak daha öngörülebilir; ama LinuxCNC'de G90 A720 testi sürümünüzde simülasyonla doğrulanmalı [D].**
- `[TRAJ] ANGULAR_UNITS`: dönel eksen makine birimi (deg/rad/grad). NC kodundaki A/B/C sözcükleri her zaman derecedir; MAX_VELOCITY "makine birimi/saniye" yani ANGULAR_UNITS=deg ise °/sn. [A] aynı sayfa.
- G92 A,B,C ofseti destekler; mevcut kod başta `G92 X0 A0 C0` yazıyor, bu eksenlerin hepsi INI'de tanımlıysa geçerli ("tanımlı tüm eksenler ofsetlenir"). [A] https://linuxcnc.org/docs/stable/html/gcode/coordinates.html ve g-code sayfası.

### 3.3 Mach3: A ekseni
- Config → General Config'de "axis is angular" kutusu; dönel seçenekler yapılandırmaya göre işaretlenmeli; "dönel yazılım limitleri çalışmayabilir (olası hata)"; makine kalibrasyonunda dönel eksen derece cinsinden. [B] https://machmotion.gitbooks.io/knowledge-base/content/mach3-setting-up-a-rotary-axis.html
- **"Rot 360 Rollover"**: işaretliyse A DRO'su 0–360 arasında döner; işaretli değilse toplamalıdır (720 vb. gösterir). **"Ang Short Rot on G0"**: G0'da en kısa yolu seçer (0→359 = -1°). Kullanıcı ayrıca küçük açı azalmasında (A310→A308) neredeyse 358° dönüş gördü, çözüm "Rot 360 Rollover" kutusunu kaldırmak oldu. [C] https://forums.autodesk.com/t5/fusion-manufacture/reset-4th-axis-output-when-reaches-360-360-degrees/td-p/10003893 ve cncdrive/machsupport konuları (arama özeti; doğrudan okunmadı). Resmî belgede "sınırsız dönüş" ayarı bulunamadı [D].
- **Winding Planner için sonuç:** Mach3'te rollover kapalı, "short rot on G0" kapalı olmalı; yoksa birikimli A (örn. A7200) ve başlangıç G0 konumlama beklenmedik yönde/devirde dönebilir. Bu doğrulanmamış ama makinede ilk kuru çalıştırmada kontrol edilecek maddedir.

### 3.4 Kinematik: 3–4+ eksen
- LinuxCNC `trivkins` + `coordinates=` parametresi: eklem numaraları belirtilen harflere sırayla atanır; örn. `coordinates=xac`, `coordinates=xyac`. Dokümanda XAC örneği doğrudan yok, kural çıkarımı. [A] https://linuxcnc.org/docs/html/motion/kinematics.html
- Eksen düzenleri: FiberPath XAB (carriage, mandrel, delivery head), Cyclone XYZ(carriage, mandrel, head) [A]. Winding Planner X-A-C (+Y radyal) benzer; Y radyal 4. eksen ticari sistemlerde (Cadfil 2–6 eksen, AddWind 4 eksen: mandrel, araba, payout eye, yaw) olağan [B].
- Gerilim kontrolü ve kafa (payout eye) hareketi için bu araştırmada güvenilir kaynak bulunamadı [D].

---

## 4. Kuru Çalıştırma, Simülasyon, Güvenlik

- Ticari araçlar: CADWIND 2007 animasyonlu simülasyon, payout eye-mandrel girişim kontrolü [B] (yukarıdaki compositesworld URL); TaniqWind çarpışma/erişilebilirlik kutusu [B]; AddWind 4 eksen oynatma + eksen limit geri bildirimi [B]; FiberPath donanım simülasyonu [A]. Winding Planner'da R3F önizleme var (ayrı agent'ın işi).
- Genel sarım makinesi güvenliği (paket/kağıt sarıcıları): sıkışma/kıstırma noktaları, korumalar, kilitler, acil durdurma konumu bilgisi, uzun saç/gevşek giysi dolanma riski. Kaynaklar kompozit filament winding'e özel değil: https://www.hse.gov.uk/PUBNS/ppis11.pdf [A, başka makine türü], https://www.vectorsolutions.com/courses/paper-machine-winder-safety/ [B]. **Filament winding'e özel kuru çalıştırma/elyaf kopması kaynağı bulunamadı [D].** Aşağıdaki öneriler kendi çıkarımımdır.
- Tipik hata türleri (çıkarım [D]; kaynak yok): eksen yönü/işaret hatası, A birimi (derece vs devir), sıfır noktası/strok aşımı, negatif X (dom), elyaf kopması ve gerilim kaybı, kutup birikimi, uç kayması.

---

## 5. Mevcut Kodda Yanlış/Riskli Bulunan Varsayımlar

1. **Mach3'te G94 F yorumu LinuxCNC ile aynı varsayılıyor (`gcode.ts`: `f = lin/minutes`).** Mach3 referansına göre (ikincil kaynak) birleşik harekette F, rotary bileşeni "Axis Correction Diameter" ile lineere çevirip birleştiriyor. Bu ayar 0 değilse süre hesabı farklı çıkar. Kesin değil; makinede ölçülmeli. Mach3'te G94 yerine G93 önerilir (kendi doğrulaması da bekliyor).
2. **G93'ün Mach3'te desteği ve F biriminin (1/dak) doğrulanmamış olması**; Mach Motion yaylar için in/sn tuhaflığı notu yalnız G02/G03'te; bizim çıktı yalnız G1 kullandığı için etkilenmez, ama doğrulama kuru çalıştırmayla yapılmalı.
3. **A hız/ivme sınırı kontrolü yok.** G94 modunda A, F'e bağlı değil; hoop (çok tur) ve dom kutup bölgesinde A açısal hızı ciddi yükselir; `MAX_VELOCITY` aşılırsa kontrolcü sessizce yavaşlatır ve elyaf hızı programlananın altına düşer. Plan çıktısına "tepe A hızı (°/dak)" ve uyarı eklenmeli.
4. **LinuxCNC lookahead:** forum bilgisine göre dönel eksen içeren harekette ileri bakış kısıtlı olabilir; tek tek küçük G1 segmentleri (dom 24 parça) hızı düşürebilir. Doğrulanmadı [D]; ölçmek gerekir (G64 P ayarı).
5. **Birikimli A ve Mach3 "Rot 360 Rollover / Short Rot on G0":** `position` satırı `G0 A<startA>` birikimli mutlak değer yazıyor; Mach3'te bu ayarlar açıksa yanlış yöne/devire dönebilir. LinuxCNC'de `WRAPPED_ROTARY` açıksa da aynı risk. Dokümana INI/ayar kontrol listesi eklenmeli.
6. **Silindirik uçta dwell ile uç dönüşü** yalnızca pim/kilit olan mandrelde güvenilir (Cyclone `lockDegrees` ve pim halkaları mantığı). Kodda kayma/sürtünme kontrolü yok. `CLAUDE.md` "ayarlanabilir uç profili" maddesi doğru yönde ama net uyarı olmalı.
7. **"İzotensoid dom" değil, yarı-elips dom.** İsim/belgelerde karışıklık olmasın; basınçlı kap için optimum profil değildir. Kutup açıklığında bant sığma uyarısı iyi; ancak düz bandın kıvrımlı yüzeyde (dom) köprülenmesi/kırışması modellenmiyor [D].
8. **Katman radyus modeli:** r = r0 + t (katman orta yarıçapı) gidiş ve dönüş ply'larının aynı yarıçapta olduğunu varsayar; gerçekte ilk ply r0 + t/2, ikincisi r0 + 3t/2 civarı (çıkarım; küçük ikinci derece hata, ince bantta ihmal edilebilir).
9. **Her katmanın başında `G0` ile tüm eksenler aynı anda konumlanıyor:** LinuxCNC G0'da dönel eksen hızı `[TRAJ]` ve eksen sınırlarına bağlı; çarpışma/elyaf gerilmesi açısından G0 sırasında elyaf bağlıysa risk (çıkarım).
10. **Bitişte G94 yazılmıyor** (G93 modunda bırakılan kontrolcü bir sonraki programı yanlış yorumlayabilir; genel pratik, [C] eng-tips).

---

## 6. Winding Planner için Önerilen Sonraki Özellikler

Öncelik sırası: güvenlik/doğruluk > doğrulama araçları > kapsam genişletme. Zorluk: K (kolay, <1 gün), O (orta, 1–3 gün), Z (zor, >3 gün); tahmindir.

1. **Tepe eksen hızı ve süre doğrulaması (A, X, C, Y): plan raporunda ve G-code başlığında; INI/Mach3 limitleriyle karşılaştırma uyarısı.** Gerekçe: bulgu 5.3, elyaf hızı sessizce düşer. Zorluk: K.
2. **Kontrolcü ayar kontrol listesi (arayüzde ve G-code başlık yorumunda):** LinuxCNC (`ANGULAR_UNITS`, `WRAPPED_ROTARY` kapalı, limitler, `trivkins coordinates=`), Mach3 (angular, Rot 360 Rollover kapalı, Short Rot on G0 kapalı, Correction Diameter değeri). Gerekçe: bulgular 5.1, 5.5. Zorluk: K.
3. **Mach3'te varsayılan G93 + program sonunda `G94` ve ilk makine doğrulama testi (kısa test programı: tek ±α geçiş, ölçülen süre).** Gerekçe: 0.2, 5.1, 5.10. Zorluk: K–O (makine erişimi gerekir).
4. **Kuru çalıştırma modu / test programı üretimi:** yavaşlatılmış hız (override), tek devre, A birimi ve yön testi (A10°, X10 mm), kullanıcıya ne bekleneceğini söyleyen yorumlar. Gerekçe: CLAUDE.md zaten gerektiriyor; AddWind/CADWIND simülasyon özellikleri. Zorluk: K.
5. **Katman başına eksen/strok limit denetimi** (X negatif dom aralığı, Y standoff, A sınırsız): zaten kısmen var (dom uyarısı); genelleştirilmiş "limit kontrolü" paneli. Zorluk: K–O.
6. **Uç dönüşü profili ayarlanabilir** (dwell yerine kısa X yavaşlama, lead-in/lead-out derecesi; Cyclone `lockDegrees`/`leadOutDegrees` örneği): ve kayma/pim uyarısı. Gerekçe: 0.3; `CLAUDE.md` açık madde. Zorluk: O.
7. **Skip indeksi (j) ve gcd(n, j)=1 doğrulaması**: farklı kapsama desenleri, uç dönüş açısını azaltma. Gerekçe: 2.5, Cyclone `skipIndex`, AddWind skip arama. Zorluk: O.
8. **Hareket segment sadeleştirme/uyarlanır segmentasyon (dom)**: nokta sayısı ve ardışık G1 sayısını azaltma, G64 P önerisi. Gerekçe: 3.1 lookahead bulgusu (doğrulanmadı). Önce LinuxCNC simülasyonunda ölçüm. Zorluk: O.
9. **Kayma (sürtünme) analizi ekranı:** μ girdisi (varsayılan boş, "gizli varsayılan yok" ilkesine uygun), her yol noktasında Kg/Kn ve "uygulanabilir/kayabilir" renkleri. Non-geodezik yola altyapı. Gerekçe: 2.2. Zorluk: O–Z.
10. **Gerçek izotensoid dom profili** ve dom/silindir kalınlık haritası (t/cosα birikimi). Gerekçe: 2.3, 2.4, basınçlı kap için doğruluk. Zorluk: Z (denklemler ayrıca kaynaktan okunmalı).
11. **Konik/polar sarım ve non-geodezik (sabit kayma katsayılı) yol.** Gerekçe: ticari araçlarda standart (WindingExpert, Cadfil). Zorluk: Z.
12. **G-code içe aktarma/geri yükleme ve simülasyonda payout eye - mandrel çarpışma kontrolü (Y/C geometrisi ile).** Gerekçe: CADWIND/Taniq/AddWind. Zorluk: Z.
13. **Gerilim kontrolü / payout çıkış komutları (M kodları, analog çıkış)**: bu araştırmada kaynak bulunamadı; önce makine ihtiyacı netleşmeli. Zorluk: belirsiz.

---

## 7. Doğrulanamayanlar / Açık Sorular
- Mach3'te G93 resmî dokümantasyonu ve G94'te birleşik rotary+lineer besleme formülü (PDF 403; ikincil aktarım).
- LinuxCNC `WRAPPED_ROTARY` ve G90 çoklu devir davranışı (forum çelişkili, sürüm belirsiz); LinuxCNC lookahead durumu güncel sürümde.
- Geodezik/izotensoid denklem kaynakları (makaleler açılmadı); gcd kuralının birincil kaynağı.
- Filament winding'e özel kuru çalıştırma ve gerilim kontrolü pratikleri.
- CADWIND/ComposicaD güncel özellikleri; WindingExpert eksen sayısı.
- Erişilemeyen sayfalar: forums.autodesk.com (403), forum.cncdrive.com (403), machmotion.com PDF (403), dspace.kaist.ac.kr (DNS), core.ac.uk PDF (403).

## 8. Kaynak Listesi
- https://linuxcnc.org/docs/html/gcode/machining-center.html [A]
- https://linuxcnc.org/docs/stable/html/gcode/g-code.html [A]
- https://linuxcnc.org/docs/stable/html/gcode/overview.html [A]
- https://linuxcnc.org/docs/html/config/ini-config.html [A]
- https://linuxcnc.org/docs/html/motion/kinematics.html [A]
- https://linuxcnc.org/docs/stable/html/gcode/coordinates.html [A]
- https://forum.linuxcnc.org/38-general-linuxcnc-questions/32488-feed-rate-priority-on-rotary-and-linear-axis [C]
- https://forum.linuxcnc.org/20-g-code/50870-inverse-time-feed-g93-ignored-with-4th-rotary-axis [C]
- https://forum.linuxcnc.org/10-advanced-configuration/34908-unlimited-rotary-axis [C]
- https://forums.tormach.com/t/rotary-axis-feed-rates/2875 [C]
- https://github.com/sgano/RapidRotary [C]
- https://machmotion.gitbooks.io/knowledge-base/content/inverse-feed-rate-g93-in-mach3.html [B]
- https://machmotion.gitbooks.io/knowledge-base/content/mach3-setting-up-a-rotary-axis.html [B]
- https://machmotion.com/documentation/gcode/Mach3-GCode-Language-Reference.pdf [B, erişilemedi; arama özeti]
- https://www.machsupport.com/forum/index.php/topic,19321.0.html [C]
- https://forums.autodesk.com/t5/hsm-post-processor-forum/mach3-post-processor-with-g93-inverse-time-feed-rate-in-fusion/m-p/9027505 [C, erişilemedi]
- https://pypi.org/project/fiberpath/ , https://github.com/fiberpath/fiberpath [A]
- https://github.com/reilleya/cyclone [A]
- https://archive.mikrosam.com/windingexpert/ [B]
- https://composites.taniq.com/filament-winding-software [B]
- https://addwind.addcomposites.com/ , /blog/pattern-closure-skip-cycles-coverage.html , /blog/dome-turnarounds-and-polar-buildup.html [B]
- https://www.compositesworld.com/products/filament-winding-software---712007 [B]
- https://compositesworld.com/suppliers/crescent-consultants [B]
- https://addcomposites.com/post/comprehensive-exploration-of-techniques-and-software-applications-in-filament-winding [B, rakip pazarlama]
- https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12450404 [C, patent; arama özeti]
- https://www.hse.gov.uk/PUBNS/ppis11.pdf [A, filament winding dışı]
