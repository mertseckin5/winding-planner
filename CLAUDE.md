# Winding Planner

Karbon fiber / filament winding makinesi için G-code üreten yerel masaüstü uygulaması (Windows). Sunucu veya hesap sistemi yok. Hedef kontrolcüler: **LinuxCNC** ve **Mach3** (kullanıcı ikisi arasında geçiş yapıyor).

## Temel Prensip
- **Gizli varsayılan yok:** Sayısal ölçüler (çap, uzunluk, bant, hız…) kendiliğinden doldurulmaz. Alan boşsa "şu alan eksik" denir, G-code üretilmez (`missingFields`).
- Tek istisna: makine tanımındaki eksen varsayımları (aşağıda), arayüzden değiştirilebilir.

## Kullanıcı Kararları (2026-10-29)
- Eksenler: **3 eksen = X (araba), A (mandrel), C (kafa dönüşü)**; **4 eksen = + Y (radyal çapraz, kafa mesafesi)**. Eksen adları ve yön tersleme ayarlanabilir.
- A ekseni **derece** olarak yazılır (mutlak, birikimli; geri dönmez).
- Kontrolcü: LinuxCNC ve Mach3 çıktısı ayrı (bitiş M2 / M30, `(MSG,…)` yalnız LinuxCNC).
- Besleme: G94 (F, hareketin lineer bileşeninden türetilir) veya G93 (inverse-time). F elyaf boyunca hız (mm/dak) esas alınarak hesaplanır.
- MVP kapsamı: **düz silindirik tüp, helisel + hoop**. Helisel katmana **domlu** seçeneği eklendi (aşağıda). Konik/polar sarım sonraki aşama.

## Sarım Modeli (src/renderer/src/core)
- `winding.ts` — yol planı. Açı α mandrel eksenine göre. Tek geçişte mandrel dönüşü Δθ = L·tanα / r.
- Bant sayısı n = ceil(2πr·cosα / w). Devre (gidiş+dönüş) dönüşü θc = 2πN + 2π·j/n; uç dönüşü δ = (θc − 2Δθ)/2, asgari `turnDwellMinDeg` altına inmez (N artar).
- **Desen atlaması j** (`Layer.patternSkip`, yok/null = 1 = önceki davranış birebir): gcd(j, n) = 1 ve 1 ≤ j ≤ n−1 zorunlu, değilse `missingFields` hata verir (n `layerBands` ile geometriden). Düz ve domlu helisel. `patternCandidates(input, i, axisCount)` → {j, nTurns, dwellDeg}, uç dönüşü küçükten büyüğe; arayüzde katman satırında seçim (ilk 60 aday + seçili). Otomatik seçim/puan yok. j>1 ise G-code katman yorumunda `j=` yazılır.
- Mandrel hep aynı yönde döner, carriage yön değiştirir → ±α. **C sözleşmesi seçilebilir** (`MachineConfig.headAngleMode`, REQ-003, `docs/engineering/decisions.md` ADR-003): `'fiber'` (yeni projede başlangıç) C = elyaf yön açısı [0,180]: gidiş φ, dönüş 180° − φ, dom kutbunda 90° sabit; `'mirror'` eski +φ/−φ. Alan yoksa (eski kayıt/persist) `'mirror'` ve arayüz + G-code başlığı "seçilmemiş" uyarır. Uygulama `Ctx.back(φ)`; plan sözleşmeyi `WindingPlan.headAngleMode`'da taşır, `generateGcode` makineyle uyuşmazsa hata atar. Kafa kinematiği kullanıcıya soruldu, yanıt yok.
- `missingFields(input, target)` / `planWinding(input, target)`: target eksen sayısı (eski biçim: yalnız geometri, C ±φ, Re yok; testler ve `patternCandidates`) veya makine (uygulama). Makineyle: domlu katmanda X strok min/max zorunlu (REQ-002), 3 eksende girilmiş göz yarıçapı Re > her katman yarıçapı (REQ-004).
- **İlk konumlama (REQ-001):** G92 yalnız X/A/C (Y mandrel ekseninden mutlak, sıfırı kontrolcüde). 4 eksende `G0 Y<en büyük Y>` → `G0 X A C` → `G0 Y<başlangıç>`; sonra her zaman `M0` (LinuxCNC'de önce MSG "Elyafi bagla").
- **Serbest elyaf (REQ-004):** `LayerInfo.fiberLag` λ = √(Re² − r²)/sinα, g = √(Re² − r²)/tanα, domlu katmanda kutup λ; 4 eksende Re = gövde Y'si, 3 eksende `machine.eyeRadius` (boş = hesap yok). Yalnız rapor/uyarı, yol düzeltilmedi.
- Hoop: adım = L / ceil(L/w), gidiş-dönüş. Her katman 2·bandThickness yarıçap ekler (gidiş-dönüş 2 kat).
- 4 eksen: Y = katman dış yarıçapı + `standoff` (katman başında sabit).
- `gcode.ts` — post-processor. `types.ts` — tipler.
- **Domlu helisel katman** (`dome.ts` + `winding.ts: domedHelicalLayer`): silindir gövde x∈[0,L] + iki uçta yarım-elips dom (r = R·cos u, z = h·sin u; dom yüksekliği h kullanıcı girdisi, gizli varsayılan yok, ≤0 ise `missingFields`). Geodezik Clairaut: r·sinφ = c = R·sin(α) (R = katman yarıçapı = dom ekvator yarıçapı); kutup açıklığı r0 = c, eksenel konumu x = −h·cosα ve L + h·cosα (**X negatif olur**, uyarı verilir). Dom dönüşü θ_dom = ∫ tanφ·dm/r sayısal (Gauss–Legendre, u=u0·sinψ ile uç tekilliği giderilmiş); dom 24 parçaya bölünür, her parça ayrık G1. Kutup→kutup geçiş dönüşü passRot = 2·θ_dom + L·tanα/R.
- **Domlu faz kuralı:** helisel ile aynı: n = ceil(2πR·cosα / w), devre (gidiş+dönüş) dönüşü 2πN + 2π/n, uç dönüşü (kutup açıklığında dwell) δ = (θc − 2·passRot)/2 ≥ turnDwellMinDeg olan en küçük N. Devre başlangıçları (sol kutup açıklığından çıkış) çevreyi n eşit parçaya böler. Dönüş yolu gidişin aynasıdır (x → L − x, C = 180° − φ 'fiber' / −φ 'mirror'). Gidişte C = φ (kutupta 90°; dwell'de 'fiber' C sabit, 'mirror' ±90 çevrilir). 4 eksen: Y = yol yarıçapı + (bandThickness + standoff), dom profiline uyar. Kutup açıklığına bant sığmazsa (bands·w > 2π·r0) uyarı.
- Önizleme: mandrel silueti domlu katman varsa dom dahil (en yüksek h), yol segment içinde yarıçap interpolasyonlu.

## Araştırma Bulgularından Uygulananlar (2026-10-29, docs/research/filament-winding-landscape.md)
- `limits.ts` — plan hareketlerinden eksen başına **tepe hız** (süre = elyaf boyu / elyaf hızı). Kontrolcü eksen limitini aşınca sessizce yavaşlatır; kullanıcı `maxSpeed` girerse (boş = kontrol yok, gizli varsayılan yok) aşım uyarısı ve "elyaf hızı ~%X'e düşer" mesajı çıkar. Uç dönüşündeki C çevirmesi ve A dwell'i tepeyi belirler.
- `checklist.ts` — kontrolcü ayar kontrol listesi (LinuxCNC: ANGULAR_UNITS, WRAPPED_ROTARY kapalı, MAX_VELOCITY, trivkins coordinates; Mach3: angular, Rot 360 Rollover ve Short Rot on G0 kapalı, Axis Correction Diameter). Arayüzde ve G-code başlığında. Kaynakların bir kısmı forum/ikincil, makinede doğrulanmadı.
- `dryrun.ts` — "Kuru test" programı: G91 artımlı, her eksen +10/−10, G93 seçiliyse X+A birlikte F2 (30 sn). Eksen yönü, A birimi ve besleme yorumu için.
- G-code **G94 ile biter** (G93'te bırakılmasın). G-code yorumları ASCII'ye çevrilir (`°` → `der`, Türkçe karakter sadeleşir; `comment()` testle korunuyor).
- Kontrolcü Mach3 seçilince besleme modu **G93 önerilir** (araştırma: Mach3'te G94 birleşik hareket F yorumu belirsiz); aşağıdan G94'e dönülebilir.
- Henüz yapılmadı (araştırma önerileri): ayarlanabilir uç profili, dom segment sadeleştirme, izotensoid dom, konik/polar, çarpışma simülasyonu, 2B kapsama haritası. (Kayma kontrolü, ivme raporu ve ilk k devre programı tur 2'de eklendi: REQ-006/005/008; ivme süreye/F'e işlemez.)

## Rakip Karşılaştırması ve Düzeltilen Hatalar (2026-11-03, docs/research/flamenet-comparison.md)
- Rakip (htuncerr00-sketch/flamenet-sar-m): kodu zip içinde, okunamadı; yalnız iki belgesi incelendi (denklem hataları raporda).
- **H1 düzeltildi:** ilk katmandan sonra katman başı G0 değil, `transition` hareketi (G1): A asgari uç dönüşü kadar döner, X/C/Y yeni başlangıca gider; elyaf boyu ve süreye dahil. Doğrulayıcı program ortasındaki G0 için uyarır.
- **H2 düzeltildi:** F ondalık sayısı değere göre (en az ~5 anlamlı basamak); G93 uzun hoop geçişinde F artık 0'a yuvarlanmaz, süre hatası %0,1 altı.
- **H5:** Mach3 + G94 birleşik harekette doğrulayıcı "süre LinuxCNC kuralıyla hesaplandı" uyarısı verir.
- **H6 düzeltildi:** hoop gidiş +açı, uçta asgari uç dönüşü, dönüş −açı (helisel ile aynı C sözleşmesi).
- **H4:** `missingFields`'teki hiç tetiklenmeyen dom kontrolü silindi.
- **H3 kısmen (2026-11-04):** kalınlık hesaplanıp gösteriliyor ve 4 eksende negatif boşluk uyarısı var (aşağıda), ama yol/Y hâlâ birikime göre **kaydırılmıyor**.
- Geçiş hareketinde C büyük açı döner (ör. −87,9° → 30°) ve kısa sürede: tepe C hızını belirler. Limit girilirse uyarı çıkar; ileride geçiş süresi C limitine göre uzatılabilir.
- `regression.test.ts` bu hataların geri gelmesini engeller.

## Rakip Kodu Eylem Listesinden Uygulananlar (2026-11-04, flamenet-comparison.md §7.7)
- **Değişmez testleri** (`invariants.test.ts`, G-code bağımsız okuyucu `gcode-reader.testutil.ts`): rastgele domlu/düz/hoop/karışık, 3/4 eksen, G93/G94, iki kontrolcü, M0 açık/kapalı, eksen tersleme: A hiç azalmaz; ilk G1'den sonra G0 yok; hoop geçişinde ΔA/ΔX = 360°/adım; katman yarıçapı 2 kat → ΔA/ΔX yarı; M1 yok; M0 sayısı = katman sınırı ve M0 sonrası A geri gitmez. Hata bulmadı.
- **Altın çıktı** (`golden.test.ts`): 6 örnek G-code'un FNV-1a özeti. j yok/1 ve hız limiti yokken çıktı değişmemeli. Tek bilinçli değişiklik: G94 + dom F düzeltmesi (aşağıda).
- **Hız limitine göre süre uzatma:** `limits.moveMinutes` = max(elyaf/elyaf hızı, |Δeksen|/limit) (yalnız girilmiş, etkin eksen limitleri). `gcode.ts` F'i, `slowdownSummary`/`estimateMinutes`/`peakSpeeds(plan, feed, machine)` ve `verify.ts` plan süresi aynı kuralı kullanır (`WindingPlan.feedRate` eklendi). Yavaşlatılan harekette limit **yazılan (3 ondalık) koordinatlarla** uygulanır ve F **aşağı** yuvarlanır → doğrulayıcının okuduğu hız limiti aşmaz. Başlıkta "Eksen hiz limiti: N hareket yavaslatildi, sure +%X", arayüzde aynı özet. Limit boşsa çıktı birebir aynı. `speedWarnings` ve doğrulayıcı yalnız 1e-9 göreli kayan nokta payı tanır.
- **G94 kutup yakını F düzeltmesi (bulunan hata):** dom kutbuna yakın parçalarda ΔX ~0,01 mm; F planın tam ΔX'inden türetildiği için kontrolcünün gördüğü (3 ondalık) ΔX ile süre parça başına %8–12 sapıyordu (toplam süre %1 içinde kaldığı için doğrulayıcı yakalamıyordu). Artık G94'te lin/rot yazılan koordinatlardan hesaplanır. `pole-feed.test.ts` her kutup yakını parçayı ayrı kontrol eder (%1, F ≥ 5 anlamlı basamak); eski formülle 3/10 durum düşüyor (mutasyonla doğrulandı).
- **Dom kalınlığı (H3):** `dome.domeThickness`: t(r) = T·R·cosα/√(r²−c²), T = 2·bant kalınlığı, c = R·sinα; silindirde T. Tekillik: c ≤ r < c+w aralığında formülün bu aralıktaki **ortalaması** (acosh((c+w)/c)/w) sabit tutulur; r < c → 0. `LayerInfo.dome`: `thickness` örnekleri, `maxThickness`, `capRadius`, `buildup` (önceki domlu katmanların bu katmanın dom yolu boyunca kalınlığı − modelin varsaydığı T·önceki katman sayısı, azami), `clearance` (4 eksen: standoff − buildup). Negatifse uyarı. Gizli eşik yok. Sınırlar: katmanlar aynı mutlak yarıçapta karşılaştırılır (yarıçap kayması ihmal), bant içi dağılım/reçine akışı yok, sınırlama yarıçapla ölçülür (R−c ≈ w olan domlarda domun çoğu sabit değerde görünür). Test: hacim korunumu G-code'dan bağımsız (Y'den r, C'den φ, 2n geçiş × w/cosφ × t / 2πr).
- **İlk sarım adımları** (`firstWind.ts`): rakibin 10 adım adı veri olarak uyarlandı (rastgele gerilim ölçümleri ve sabit eşikler alınmadı); eksen adları makineden, Y adımı yalnız 4 eksende, dom adımı yalnız domlu katman varsa. Arayüzde açılır bölüm, işaretler kaydedilmez.
- **Proje dosyası** (`project.ts`): `serializeProject` (format + version 1 + input + machine), `parseProject` güvenilmez veri doğrulaması: boyut ≤ 1 MB, katman ≤ 200, tip/aralık (≤ 1e7), sonlu olmayan sayı reddi (`1e999`), bilinmeyen alanlar atılır, geçersiz/yinelenen katman kimliği yeniden adlandırılır, eksen adı tek büyük harf, F/G/M/N olamaz, etkin eksen adları farklı olmalı (arayüz bunu zorlamıyor, dosya zorluyor), eksik sayısal ölçü null (gizli varsayılan yok). Store `loadProject` tamamen değiştirir (birleştirmez). Hata mesajları Türkçe ve alan yolunu içerir.
- Toplam 465 test (15 dosya).

## Makine Mühendisi Gereksinimleri (2026-11-05, docs/engineering/)
- REQ-001…004 MM onaylandı. Kabul testleri `mm-req.test.ts` (adlar REQ numaralı), `store.test.ts` (persist). Altın çıktılar bilerek güncellendi (ADR-005).
- **Tur 2 (REQ-009, 005, 006, 007, 008) uygulandı, MM onayı bekliyor** (ADR-006…011, testler `mm-req2.test.ts`):
  - REQ-009: 3 eksende Re > dış yarıçap (`plan.outerDiameter/2`, eşitlik hata); `plan.eyeClearance`, `LayerInfo.eyeClearance`.
  - REQ-005: `machine.maxAccel` **/s²** (INI ile aynı; hız /dk). Yalnız `verify.ts` raporu (`report.accel`: ulaşılamaz sınır, tepe Δv ve Δv/minT, olay listesi, tam durmalı süre üst sınırı) ve sim kiti (`MAX_ACCELERATION`, `STEPGEN_MAXACCEL`). G-code/plan süresi ivmeyi kullanmaz.
  - REQ-006: `input.friction` μ; `LayerInfo.slip` (düz x_t, θ_t; dom k_g/k_n; düz uç geçişi ΔA). μ boş → yalnız düz katmanda metin uyarısı.
  - REQ-007: geçiş = [önceki domun inişi (gidiş, C = φ)] + gövde x = 0 (asgari uç dönüşü) + [yeni domun çıkışı (dönüş açısı)], hepsi `transition`, yeni katmana ait. Katman başı A'sı θ_dom kadar kayar.
  - REQ-008: `trial.ts` `trialPlan` ilk k devre; `generateGcode(…, { title })`. Seçim store'da, proje dosyasında değil.
- Toplam 541 test (18 dosya).
- **Tur 3 (REQ-010, REQ-011, REQ-008 eki, S5) uygulandı, MM onayı bekliyor** (ADR-012…015, testler `mm-req3.test.ts`):
  - REQ-010: `core/slip.ts` θ_req = |ln tan(ψ₂/2) − ln tan(ψ₁/2)|/μ ve **durağan aralık** (ardışık ΔX ≠ 0 hareketler arasındaki ΔX = 0 dizisi; önceki düz son dwell + geçiş gövdesi tek aralık; dom kutup dwell'i hariç). `slip.turnFullDeg` (düz 2θ_t, hoop kendi dönüşü), `transitionTurnDeg/RequiredDeg/Axial` her hedef türünde. ΔA < θ_req veya aralık monoton değilse uyarı. G-code değişmez.
  - REQ-011 ('fiber'): önceki düz katmanın son dwell sonu C'si [dwell başı, gövde sonu] aralığına kıstırılır (düz→domlu, düz→hoop, düz→büyük açılı düz düzeldi). REQ-003 dwell ΔC ölçütünün tek istisnası bu dwell.
  - REQ-008 ek: `trialWarnings` (katman > 1), `generateGcode(…, { notes })` başlıkta `(UYARI: …)`. MM'nin faz kayması sayısı yazılmadı (ADR-014, soru S9).
  - S5: sim kiti README'de STEPGEN_MAXACCEL notu (oran uygulanmaz).
- Toplam 561 test (19 dosya).

## Paketleme (2026-11-05)
- `npm run build:win` → `dist/winding-planner-<sürüm>-setup.exe` (NSIS, productName "Winding Planner", imzasız, kullanıcı başına, kurulum dizini seçilebilir, masaüstü + başlat menüsü kısayolu). README'de SmartScreen notu. 0.1.0: 120,9 MB.
- Renderer paketleri (react, three, drei, lucide…) **devDependencies**'te: Vite renderer'ı paketliyor, electron-builder yalnız `dependencies`i asar'a koyar. `dependencies`'te yalnız ana süreç/preload'un çalışma anında `require` ettikleri (`@electron-toolkit/utils`, `/preload`). Taşımadan önce asar 161 MB, kurulum 143,8 MB idi.
- Kurulum denemesi: `setup.exe /S /D=<dizin>`, kaldırma `"Uninstall winding-planner.exe" /S _?=<dizin>` (kaldırıcı kendini silmez). Kurulum `%LOCALAPPDATA%\winding-planner-updater\installer.exe` bırakır, kaldırma silmez: elle sil. userData = `%APPDATA%\winding-planner` (package.json `name`; dev ile ortak dizin, origin farklı olduğundan localStorage ayrı).

## Teknoloji Yığını
Electron + electron-vite, React 19 + TypeScript, Tailwind v4, React Three Fiber (önizleme), Zustand, Vitest. CNC Planner ile aynı yığın (`C:\Users\user\cnc-planner`).

## Komutlar
- `npm run dev` — geliştirme
- `npm test` — vitest (çekirdek hesaplar + G-code)
- `npm run typecheck`, `npm run build`, `npm run build:win`

## Kurallar
- Çekirdek (`core/`) saf TypeScript, UI'dan bağımsız; her değişiklikte testi güncelle.
- Üretilen G-code'a güvenmeden önce **makinede havada (elyaf/mandrel olmadan) kuru çalıştırma** yap; eksen yönü ve A birimi kontrol edilmeli.
- Dersler ve makine doğrulama notları bu dosyaya eklenir.

## Dersler
- VS Code terminalinde `ELECTRON_RUN_AS_NODE=1` ayarlı olabilir; Electron'u düz Node gibi çalıştırır (`app.isPackaged` hatası). Çalıştırmadan önce `env -u ELECTRON_RUN_AS_NODE`.
- Test `parse` yardımcıları 3 eksende Y'yi bulamaz (0 döndürmeli); domlu yolda dönüş geçişinde C negatiftir, Clairaut kontrolünde |C| kullan.
- `react` ve `react-dom` package.json'a açıkça eklenmeli (build "react-dom/client çözülemedi" der).

- Kapsamlı test dosyalarının rolü: `mm-req*.test.ts` MM kabul testleri (tur 1–3), `winding.test.ts` temel, `attack.test.ts` rastgele girdi + G-code geri okuma, `dome.test.ts` dom, `research-features.test.ts` hız/kontrol listesi/kuru test, `invariants.test.ts` değişmezler + saldırgan girdiler, `golden.test.ts` bit bit çıktı, `pattern.test.ts` j, `speedlimit.test.ts`, `thickness.test.ts`, `pole-feed.test.ts`, `firstWind.test.ts`, `project.test.ts`.
- **Toplam süre testi parça hatalarını gizler:** G94'te kutup yakını parçalar %10 sapıyordu ama toplam süre oranı %1 içindeydi. Kısa hareketler için parça başına kontrol yaz. F'i her zaman kontrolcünün göreceği yuvarlanmış koordinatlardan türet.
- Limitle uzatılan harekette |Δ|/(|Δ|/limit) kayan noktada limiti 1 ulp aşabilir: katı `>` karşılaştırmaları (uyarılar) 1e-9 göreli pay ister; F'i aşağı yuvarla.
- Git Bash'te `sed`/`node -e` ile `\n` içeren değiştirme kaçışı bozuluyor (satır kırıyor); dosya düzenlemede Edit aracı kullan. Vitest'te `console.log` çıktısı `--reporter=verbose` ile görünür.
- CDP ile Electron sürerken "Kaydet/indir" düğmeleri yerel kaydetme diyaloğu açar: betikte `URL.createObjectURL` ve `HTMLAnchorElement.prototype.click` yakalanıp blob okunur; dosya açma `DOM.setFileInputFiles` ile. Örnek: scratchpad `drive-new.mjs`.
- Konsolda `THREE.Clock deprecated` uyarısı R3F kaynaklı (bizim kod değil).
- G-code test okuyucuları **modal** olmalı: 4 eksende ilk konumlama yalnız-Y / Y'siz G0 satırlarıdır; satırda olmayan eksen önceki değerini korur. Plan hareketleriyle satır eşlemek için `gcode-reader.testutil.motionRows` (baştaki G0'ları tek `position`a indirger).
- G-code yorumunda Unicode simge `?` olur: `comment()` φ → phi, α → alfa, ± → +/-, − → - çevirir; yeni simge eklenirse oraya da ekle.
- zustand persist varsayılanı `window.localStorage`: node testinde `vi.stubGlobal('window', { localStorage })` + `vi.resetModules()` ile hidrasyon denenir. Persist sığ birleştirir: kayıtlı `machine` nesnesi bütün olarak gelir, yeni alanlar eski kayıtta yok kalır (bilerek kullanıldı, ADR-003).
- `electron-vite dev --remoteDebuggingPort 9222` ile Electron CDP'den sürülür; kapatmak için CDP `Browser.close` (süreç öldürme izni yok).
- **Altın çıktı bilinçli değişince kanıtla:** yeni planı eski kurala geri indiren dönüşüm (ör. `mm-req2.test.ts` `collapseTransitions`) eski özeti bit bit veriyorsa fark yalnız o değişikliktendir. A birikimli olduğundan bir katmana eklenen dönüş sonraki tüm A'ları kaydırır; satır satır fark okunmaz.
- Bash aracında uzun Python heredoc'u (`<<'EOF'`) bazen "unexpected EOF" ile bozuluyor; betiği scratchpad'e Write ile yazıp `python dosya.py` çalıştır.
- Arayüzde G-code metin kutusu 200 000 karakterde kısaltılır; CDP betiğinde uzun programın sonunu textarea'dan okuma.
- **MM ölçümünde görünmeyen ihlali rastgele değişmez testi bulur:** REQ-011 yalnız düz→domlu için raporlanmıştı; kural `invariants.test.ts`'e eklenip düzeltme kapatılınca (mutasyon) düz→hoop ve düz→düz ihlalleri de çıktı. Yeni fiziksel kuralı önce rastgele programlara ekle, sonra düzelt.
- `readGcode` satırları yorum satırlarını da (`code: 'other'`, konum kopyası) içerir; satır sayarken `code === 'G1'` süz.
- Test dosyasından `export` edip başka testte import etme (testler iki kez kaydolur); ortak yardımcılar `*.testutil.ts`'te.
- Deneme/uyarı metinlerinde `≈` vardı, G-code'da `?` oldu: `comment()` artık `≈` → `~`.

## Donanım Durumu (2026-10-29)
- Kullanıcının **şu an fiziksel makinesi yok** (makine yapılacak). "Makinede doğrula" maddeleri bu yüzden açık kalır; kuru test programı makine kurulunca kullanılacak.
- Donanımsız doğrulama yolu: (1) üretilen G-code'u bağımsız okuyan simülatör/doğrulayıcı (süre, eksen limitleri, hız), (2) LinuxCNC simülasyon yapılandırması (sim, donanımsız) ile G93/G94 ve A davranışı denemesi. Mach3 için donanımsız doğrulama imkânı araştırılmadı.
- Hiçbir G-code çıktısı "makinede çalışır" diye sunulmaz; yalnız "hesap ve biçim olarak doğrulandı" denir.
- `verify.ts` — **G-code doğrulayıcı**: üretilen metni plandan bağımsız okur (modal G90/G91, G92 ofseti, G93/G94, eksen adı ve tersleme), her G1 için LinuxCNC kurallarıyla süre/hız hesaplar, eksen aralığı, biçim hataları (tanımsız eksen, F yok, G93'te satırda F yok, G20, ASCII dışı, M2 yok), strok ve hız limiti (`machine.travel`, `machine.maxSpeed`), plana göre süre (±%1) ve son konum karşılaştırması. Arayüzde plan panelinde gösterilir. İlk çalıştırmada `dryrun.ts`'te iç içe parantezli yorum hatası yakaladı (artık ortak `comment()` kullanılıyor).
- `simkit.ts` — **LinuxCNC simülasyon kiti** (INI + HAL + README): trivkins `coordinates` standart X Y Z A B C sırasında, dönel eksenlerde limit yok, kullanıcı limitleri INI'ye geçer (hız /60), girilmeyen alanlar README'de "deneme değeri" diye listelenir. **LinuxCNC kurulu olmayan ortamda yazıldı, çalıştırılmadı**; yalnız yapısı testlendi. İlk gerçek denemede düzeltme gerekebilir.

## Bilinen Sınırlar / Yapılacaklar
- Uç dönüşü şimdilik "carriage durur, mandrel döner" (dwell); gerçek makinede elyaf kayması için ayarlanabilir uç profili eklenebilir.
- Mach3'te G93 ve A ekseninin dönüş modu (rotary, wrap) makinede doğrulanmadı.
- Konik ve polar sarım yok.
- Domlu sarım gerçek makinede doğrulanmadı. Model sürtünmesiz geodezik; kutup yığılması, kafanın dom yüzeyine teğetliği (C = φ, Y takibi), negatif X stroku ve kutuba yakın G94 F (lineer bileşen küçükken F çok düşer) kuru çalıştırmada kontrol edilmeli.
- Farklı katmanlarda farklı dom yüksekliği girilirse önizleme mandrel silueti en yükseği gösterir.
- j>1 desenlerde uç dönüşü kısalabilir (ör. Ø50 45° domlu: j=17 → 22,8°); eski ±φ sözleşmesinde kutupta C ±90° çevrilmesi daha kısa sürede olur, C tepe hızı çok yükselir (76 000 °/dk görüldü). 'fiber' sözleşmesinde kutupta C dönmez (S2 j=3 tepe C ≤ 200 °/s). Katman geçişinde C yine büyük dönebilir. Makinede doğrulanmadı.
- Hız limitine göre uzatma ivmeyi hesaba katmaz (yalnız hız); ivme yalnız doğrulayıcıda üst sınır olarak raporlanır (REQ-005), gerçek süre daha uzun olabilir.
- REQ-007 geçişinde dom inişinde C 90 → α₁ azalır, gövdede yeni başlangıca artar (S1 K1→K2: 90 → 30 → 89,1); MM S6 yanıtıyla fiziksel olarak doğru (Clairaut), ölçüt düzeltildi.
- Kayma kontrolü (REQ-006/010) yalnız uyarır; kayma sınırlı uç profili yok. Pim halkası/uç tutucu kararı kullanıcıda.
- Dom kalınlığı Y'yi kaydırmaz; yalnız gösterir ve 4 eksende negatif boşlukta uyarır.
