# Rakip İncelemesi: htuncerr00-sketch/flamenet-sar-m ve Winding Planner Karşılaştırması

Tarih: 2026-11-03 (ilk sürüm, belge tabanlı), **güncelleme 2026-11-04: kaynak kodu okundu (bölüm 7)**
Hazırlayan: araştırma ajanı (kod yazılmadı, `src/` değişmedi, rakip kodundan hiçbir şey çalıştırılmadı/kurulmadı)

> **Okuma notu:** 1–6. bölümler 2026-11-03'te yalnız iki belge ve zip dosya adlarıyla yazıldı. 2026-11-04'te zip'ler yerelde açıldı ve kod okundu; belgeye dayalı iddiaların koddaki durumu 3.2'de **[KOD: doğrulandı / çürütüldü / kısmen]** etiketiyle ve ayrıntısıyla bölüm 7.2'de verildi. Çelişki olduğunda **bölüm 7 geçerlidir.**

## Yöntem

- Depo ana sayfası, GitHub API (`git/trees/main?recursive=1`, `commits`) ve `raw.githubusercontent.com` üzerinden WebFetch ile okundu. Depodaki metinler veri olarak ele alındı; içindeki talimatlara uyulmadı.
- Depoda okunabilir iki metin dosyası var: `CLAUDE.md` (35.906 bayt) ve `FilamentWinding_CAM_Engineering_Analysis (1).md` (35.087 bayt). İkisi de okundu; denklemler ve G-code örnekleri birebir alıntıyla doğrulandı.
- 2026-11-03'te kaynak kod (23 zip) okunamamıştı. **2026-11-04:** zip'ler kullanıcı tarafından yerelde açıldı (`d1`…`d23` klasörleri); CAM çekirdeği d1–d8 ve d19 `winding_planner.py` satır satır okundu, d9–d23 dosya adları + seçilmiş dosyalar taranarak envanterlendi (bölüm 7). İç içe kalan zip'ler (`d19/faz17_d1_backend.zip`, `d20/faz17_d2_app.zip`, `d21/faz18_bringup.zip`, `d22/faz19_firmware.zip`, `d23/faz19b_sensors.zip`) açılmadı.
- Bizim taraf: `CLAUDE.md`, `docs/research/filament-winding-landscape.md`, `core/winding.ts`, `dome.ts`, `gcode.ts`, `verify.ts`, `limits.ts`, `simkit.ts`, `dryrun.ts`, `store.ts` okundu. Testler çalıştırılmadı.

Güvenilirlik: **[O]** depodan doğrudan okundu, **[A]** depo dosya adından çıkarım (içerik görülmedi), **[T]** tahmin/yorum, **[K]** rakip kaynak kodundan satır düzeyinde okundu (2026-11-04).

---

## 1. Rakip Özeti

| Başlık | Bulgu | Kaynak/güvenilirlik |
|---|---|---|
| Depo | `htuncerr00-sketch/flamenet-sar-m`, açıklama yok, README yok, 0 yıldız/0 fork/0 izleyici | GitHub sayfası [O] |
| Etkinlik | 4 commit, hepsi 2026-05-27 (14:34–14:50 UTC), hepsi "Add files via upload" (tarayıcıdan dosya yükleme). Sonrasında commit yok (~5 ay). Issue/PR görülmedi | API `commits` [O] |
| Lisans | Yok (depo sayfasında ve CLAUDE.md'de lisans geçmiyor). Lisanssız kod yasal olarak yeniden kullanılamaz | [O] |
| İçerik | 2 md + 23 zip. Zip'ler aşama aşama (Faz 1 … Faz 19B) yüklenmiş paketler gibi; aynı dosya birden çok zip'te tekrar ediyor (`serial_controller.py`, `first_wind_procedure.py` d12 ve d13'te) | ağaç [O], yorum [T] |
| Ne yapıyor (belgeye göre) | `CLAUDE.md` kendini "real-time filament winding control + telemetry platform" diye tanımlıyor: Python backend (safety, motion, digital twin, planner, AI advisory, persistence), PySide6 masaüstü arayüz (7 panel), ESP32 (ESP-IDF) firmware: 1 kHz ikili telemetri UART üzerinden, I²C sensörler (INA226 akım, MPU6050 titreşim, NTC sıcaklık) | CLAUDE.md [O] |
| Teknoloji | Python 3.11+, PySide6, pyqtgraph, PyOpenGL, pyserial, sqlite3, numpy; C11 + ESP-IDF v5 + FreeRTOS. CAM çekirdeği ayrıca **scipy** (`solve_ivp` RK45) kullanıyor | CLAUDE.md [O], kod [K] |
| Sarım türleri | Kodda: silindir helisel (analitik), hoop, elips/küre/"izotensoid" dom + tam gövde geodezik (RK45). Non-geodezik ve kayma **yok** (stub). Konik/polar yok | [K] bölüm 7 |
| Çıktı / kontrolcü | Kodda: Grbl (`;` yorum, G94) ve Mach3 (`( )` yorum, `%`, `O0001`, G94). **G93 işlevi yazılmış ama hiç çağrılmıyor.** LinuxCNC/Marlin profili yok | [K] `controller_profile.py`, `gcode_synthesizer.py` |
| Makine eksenleri | 2 eksen (X araba + A mandrel); C (kafa dönüşü) ve Y (radyal) yok | [K] |
| Arayüz | PySide6, 7 panel (d20) | [A]/[K] dosya adları |
| Test | `phaseN_validation.py` betikleri (kendi `chk()` işlevi, AssertionError). Bir kısmı gerçek analitik kontrol, önemli kısmı zayıf/tautolojik (bölüm 7.5) | [K] |
| Donanım durumu | Gerçek donanımda doğrulama yok; gerilim "ölçümleri" bazı yerlerde rastgele sayı (bölüm 7.6) | CLAUDE.md [O], kod [K] |
| Üretim biçimi | d22 içinde `mnt/user-data/outputs/faz19_firmware/CMakeLists.txt`; `main.py` ve `export_pipeline.py` çıktıyı `/mnt/user-data/outputs/` yoluna yazıyor. Kodun büyük ölçüde YZ sohbet ortamında üretildiği güçlü biçimde düşünülüyor | [K] yol, yorum [T] |

**Kısa değerlendirme (güncel):** CAM çekirdeğinde doğru yazılmış parçalar var (geodezik ODE, eğrilik formülleri, silindir helis adımı), ama **G-code'a giden yol (sequence_planner → gcode_synthesizer) ve uygulamaya bağlı planlayıcı (d19 `winding_planner.py`) ağır hatalı**: sabit kodlanmış R=50 mm, dönüş geçişi yok, geçişlerde elyaf bağlıyken hızlı (G0) X geri dönüşü, hoop'ta tur başına 4 tur A, dönüşte mandrelin ters dönmesi. Örnek çıktı dosyaları (`winding_grbl.nc`, `winding_mach3.nc`) bu hataları birebir gösteriyor (bölüm 7.3).

---

## 2. Yan Yana Karşılaştırma

| Özellik | Winding Planner (biz) | flamenet-sar-m (onlar, koda göre) |
|---|---|---|
| Amaç | G-code üreten masaüstü CAM | Kontrol + telemetri platformu, CAM çekirdeği d1–d8 |
| Yığın | Electron + React 19 + TS, R3F, Zustand, Vitest | Python + PySide6 + numpy/scipy, ESP-IDF C |
| Kod okunabilirliği | Düz depo | Kaynak yalnız zip içinde; GitHub'da gezinilemez, diff yok |
| Lisans | (bu incelemede bakılmadı) | Yok |
| Eksen modeli | 3 eksen X/A/C, 4 eksen + Y radyal; ad ve yön tersleme ayarlı | 2 eksen X/A |
| Helisel | Var, ±α, faz j=1, uç dwell | Silindirde analitik doğru (`winding_math.py`); G-code yolunda **dönüş geçişi yok, R=50 sabit** |
| Hoop | Var | Var; `hoop_pass_segments` A'yı 4 kat fazla yazıyor |
| Dom | Yarım-elips, geodezik Clairaut, Gauss–Legendre | Elips/küre doğru, RK45 geodezik doğru; ama G-code yoluna bağlanmıyor (basit modda silindir formülü domda da kullanılıyor) |
| İzotensoid | Yok | `IsotensoidDome` var ama ODE yanlış (kutup açıklığını içermiyor) |
| Non-geodezik / kayma | Yok | Yok (kayma kontrolü stub: her zaman 0) |
| Pattern seçimi | n = ceil(2πr·cosα/w), j=1 sabit | `PatternSolver`: kK ≈ 2πp, gcd(p,k)=1 tarama + 9 kriterli puan; çekirdek doğru, bindirme (overlap) dönüşümü yanlış, dwell ile ayar yok |
| Kapsama haritası | Sayısal kapsama oranı (`coverage`) | 2B (z, φ) ızgara, numpy; φ sarma hatası var |
| Kontrolcü | LinuxCNC ve Mach3 ayrı çıktı | Grbl ve Mach3; LinuxCNC yok |
| Rotary besleme | G94 (LinuxCNC kuralı) + G93, sonda G94 | Yalnız G94, F = araba hızı (S′·cosα₀·60), domda bile sabit α₀ ile |
| Kafa açısı (C) | Var | Yok |
| Gizli varsayılan | Yok ilkesi (`missingFields`) | Çok sayıda: R=50 (iki yerde kod içinde sabit), 15 N, μ=0,2, r_boss=33,42, 88,5° hoop, a_max=5000 mm/s², t_acc=0,05 s… |
| Hız limiti kontrolü | `limits.ts` tepe hız + uyarı | `check_machine_constraints`, `_check_a_speed` (uyarı) |
| G-code doğrulayıcı | `verify.ts` metni bağımsız okur | Yok (testler yalnız satırda "G1"/"M30" geçiyor mu bakıyor) |
| Simülasyon | R3F önizleme + LinuxCNC sim kiti | `machine_simulation.py`: sezgisel gecikme/boşluk/Poisson adım kaybı (rastgele), R=50 sabit |
| Çarpışma | Yok | `CollisionAnalyzer` adı var; yalnız X aralığı, A hızı, r<r_boss kontrolü (geometrik çarpışma yok) |
| Kuru test | `dryrun.ts` | `first_wind_procedure.py` 10 adım; adım 4–5'te gerilim "ölçümü" rastgele sayı |
| Çalışma anı izleme | Yok (kapsam dışı) | Var (telemetri, ESP32 bağlantısı; Mock + Real sınıfları) |
| Test | Vitest, 255 test (CLAUDE.md) | Betik tabanlı, birim test çerçevesi yok |
| Makinede doğrulama | Yok | Yok |

---

## 3. Onların Artıları ve Eksileri

### 3.1 Artılar (bizde olmayan iyi fikirler)

2026-11-03'te fikir düzeyindeydi; **koddaki gerçek durum için bölüm 7.4'e bakın.** Özet: desen çözücünün gcd çekirdeği ve analitik yoğunluk formülü kullanılabilir; "geçiş yöneticisi" sanıldığı gibi katman geçişi değil (dom-silindir eğrilik analizi); kayma kontrolü ve çarpışma kontrolü fiilen yok.

1. **Desen puanlama** (`pattern_score_engine.py`, `alpha_optimizer.py`): **[KOD: gerçek, kısmen doğru]** — bkz. 7.4.1.
2. **Katman geçiş yöneticisi** (`transition_manager.py`): **[KOD: çürütüldü]** katman geçişi yönetmiyor; dom-silindir birleşiminde eğrilik "harmanlama" (yalnız sayısal κ_m dizisini değiştiriyor, yolu değil). Bizim H1 düzeltmesi bundan bağımsız ve onlarda karşılığı yok.
3. **Kayma kontrolü** (`check_slippage`): **[KOD: stub]** `fiber_physics_and_constraints.py:134` `max_lambda = 0.0 if is_geodesic else 0.0`.
4. **Kafa–mandrel çarpışma kontrolü**: **[KOD: yok]** `CollisionAnalyzer` geometrik çarpışma yapmıyor.
5. **Reçete kütüphanesi** (`recipe_db.py`): bu incelemede okunmadı (d19, kapsam dışı envanter).
6. **Devreye alma ve ilk sarım prosedürü**: **[KOD: adım listesi iyi, uygulama kısmen sahte]** bkz. 7.6.
7. **Elle hesap testleri**: `main.py` (d1) silindir için doğru elle beklentiler içeriyor (c=25, p=544,139 mm, F=5196,15). Fikir hâlâ geçerli.
8. **Çalışma anı güvenlik sınırları**: d19 `winding_planner.py:35` T ∈ [3, 38] N kontrolü kodda var [K].

### 3.2 Eksiler ve hatalar (belge tabanlı; koddaki durum etiketli)

1. **Geodezik integral hatalı (√G paydada)** — **[KOD: çürütüldü (integratörlerde), ama başka bir dom integrali hatalı]**. RK45 integratörler (`geodesic_integrator.py:_dydx`, `unified_geodesic_planner.py:_ode`) yay uzunluğuyla `dz/ds = √(r²−c²)/(r√G)`, `dφ/ds = c/r²` kullanıyor; bu doğru ve dφ/dz = c√G/(r√(r²−c²)) verir. Ancak `geodesic_family.py:_integrate_dome_K` (satır 216–245) dφ/dz integrandını **dr ile çarpıyor** (dz/dr Jakobiyeni yok), kutup bölgesini r_boss·1,01'den başlatarak atlıyor ve tam devirde dom katkısını 2 yarım yerine 1 yarım sayıyor. `clairaut_optimizer.py:_delta_phi` (315) ise uydurma bir yaklaşım: `π·c/R·√(H/R)·2`.
2. **Helis adımı ters** — **[KOD: çürütüldü]** `winding_math.py:290` `pitch = 2πR·cosα/sinα` = 2πR/tanα (doğru); `main.py:50` 544,139 mm bekliyor. Belgedeki 181,4 mm koda girmemiş.
3. **Hız bağıntıları çelişkili** — **[KOD: kısmen]** silindirde `F = S′·cosα·60` (`motion_planner.py:193`) LinuxCNC kuralında doğru; domda F hâlâ geçiş başı sabit α₀ ile hesaplanıyor (`controller_profile.py:485`, `gcode_synthesizer.py:115`), yani kutba yaklaşırken yanlış. `fiber_physics_and_constraints.py:319–323` taşıyıcı hız katsayısı (cosα/√G) ise doğru.
4. **İzotensoid koşulu yanlış** — **[KOD: doğrulandı, farklı biçimde]** `dome_mandrel.py:178–181` ODE `dr/dψ = −r·sinψ, dz/dψ = r·cosψ` → r = R·e^(cosψ−1); kutup açıklığı r_pole denklemin içinde hiç yok (yalnız durdurma olayında). Gerçek izotensoid profil r_pole/R'ye bağlıdır. ψ ≤ 0,99·π/2 sınırıyla r ≈ 0,374R'nin altına inmiyor; r_pole < 0,374R için dom kutup açıklığına hiç ulaşmıyor (benim elle hesabım [T]).
5. **Bant sayısı aşağı yuvarlama** — **[KOD: çürütüldü]** koddaki desen çözücü n'yi gerçel tutup ±%35 aralığında tarıyor (`pattern_solver.py:199–200`); hoop'ta `math.ceil(L/b)` (`layer_manager.py:95`, `sequence_planner.py:356`). Belgedeki 27,2→27 koda geçmemiş.
6. **Desen örneği tutarsız** — **[KOD: kısmen]** kod p'yi tam sayı devir olarak doğru kullanıyor, ama "Diophantine p·k = d·n ± 1" etiketi anlamsız: k = n·d iken p·n·d = d·n ± 1 tam sayılarda sağlanamaz; `is_valid_diophantine` hemen her zaman yanlış (`pattern_solver.py:76–79`, 223–232). Sıralama bu alanı kullanmıyor, zararsız ama yanıltıcı.
7. **Kontrolcü iddiası abartılı** — **[KOD: doğrulandı]** LinuxCNC/Marlin profili yok; yalnız `GRBLProfile`, `Mach3Profile`. G93 yalnız `Mach3Profile.format_linear_inverse_time` içinde yazılmış, sentezleyici çağırmıyor.
8. **M3 S + A çift tanım** — **[KOD: çürütüldü]** hiçbir `.py` dosyasında `M3`/`M03` yok; yalnız belgede.
9. **G28 başlıkta** — **[KOD: doğrulandı (d1)]** `gcode_generator.py:220–221` ve `306–307`, `home_sequence=True` varsayılan. d7 sentezleyicide G28 yok; onun yerine `G0 X-5 A0` (negatif X'e hızlı) var (`gcode_synthesizer.py:209`, `z_home=-5.0`).
10. **Gizli sabit varsayılanlar (μ=0,35 / 15 N)** — **[KOD: 15 N doğrulandı, μ=0,35 çürütüldü]** 15 N: `machine_model.py:265, 532, 546`, `fiber_physics_and_constraints.py:108`, d19 `winding_planner.py:20`. μ=0,35 kodda yok; `FiberPhysics` μ varsayılanı **0,2** (satır 107) ve zaten kullanılmıyor (stub). Bunlardan çok daha ağır gizli varsayılan: **R=50 mm iki yerde kod içine gömülü** (bölüm 7.3).
11. **Kendi raporlarında tutarsızlık** — kodda yeniden kontrol edilmedi.
12. **Depo hijyeni** — **[KOD: doğrulandı]** iç içe zip'ler, aynı dosyanın kopyaları (d12/d13), `/mnt/user-data/outputs/` yolları.
13. **Her şey host/simülasyonda** — **[KOD: doğrulandı]**; ayrıca bazı "ölçümler" rastgele üretiliyor (7.6).

---

## 4. Bizim Artılarımız ve Eksiklerimiz

### 4.1 Artılar (koddan kanıt)

- **Doğru geodezik dom integrasyonu**: `dome.ts: domeGeodesic`. Rakibin RK45 ODE'si de doğru; ama rakipte dom yolu G-code'a bağlanmıyor, bizde bağlı (dom 24 parça G1).
- **Rotary besleme açıkça çözülmüş**: `gcode.ts: generateGcode` G94 (LinuxCNC kuralı) ve G93, sonda `G94`. Rakipte G93 ölü kod.
- **Bağımsız G-code okuyucu** `verify.ts`. Rakipte karşılığı yok; rakibin örnek `.nc` dosyalarındaki hataların hepsi (G0 geri dönüş, sabit A, ters A) bizim doğrulayıcı türünden bir okuyucuyla yakalanırdı.
- **Kafa açısı ve 4. eksen** (C, Y). Rakipte yok.
- **Gizli varsayılan yok**. Rakipte R=50 kod içinde sabit.
- **Kontrolcüye özel çıktı ve kontrol listesi**, **kuru test programı ve sim kiti**, **test kültürü** (255 test, CLAUDE.md'ye göre).

### 4.2 Eksikler (2026-11-03 listesi; güncel durum CLAUDE.md "Rakip Karşılaştırması")

1. ~~Katman geçişi G0 ile~~ — **H1 düzeltildi** (CLAUDE.md).
2. ~~G93'te F 4 ondalık~~ — **H2 düzeltildi**.
3. **H3 açık:** domlu katmanlarda kutup kalınlık birikimi modellenmiyor. Rakipte analitik yoğunluk formülü var (bkz. 7.4.2), uyarlanabilir.
4. ~~Ölü kontrol~~ — **H4 silindi**.
5. **H5:** Mach3 + G94 uyarısı eklendi.
6. ~~Hoop dönüş C işareti~~ — **H6 düzeltildi**.
7. **İvme yok** — açık. Rakipte ivme modeli var ama sabit `t_acc = 0,05 s` gibi gizli değerlerle (7.4.6).
8. **Desen yalnız j=1** — açık. Rakipteki gcd çekirdeği uyarlanabilir (7.4.1).
9. **Kayma/sürtünme, izotensoid, konik, polar, çarpışma yok** — açık. Rakipte de fiilen yok.
10. **Proje/reçete dosyası yok** — açık.
11. **Çalışma anı izleme yok** — kapsam farkı.

---

## 5. Öneriler (2026-11-03)

Bu bölümün yerine **bölüm 7.7'deki güncel eylem listesi** geçerlidir. H1, H2, H4, H5, H6 uygulandı; H3 açık.

---

## 6. Doğrulanamayanlar (güncel)

- İç içe zip'ler (d19–d23 içindeki `faz17_d1_backend.zip`, `faz17_d2_app.zip`, `faz18_bringup.zip`, `faz19_firmware.zip`, `faz19b_sensors.zip`) açılmadı; içerikleri dışarıdaki dosyalarla aynı olabilir ama doğrulanmadı.
- Rakip kodu **çalıştırılmadı**. Bölüm 7'deki sayısal sonuçlar (ör. hoop'ta 1440°, d19'da α ≈ 89,97°, izotensoid r ≥ 0,374R) kod okunarak elle hesaplandı; yanlış okuma ihtimali düşük ama sıfır değil. Örnek `.nc` çıktılarıyla tutarlı olanlar (G0 X38 geri dönüşleri, sabit A ile slow-out, M01, A1440 rewind) dosyadan birebir okundu.
- Grbl'de F'in dönel eksen dahil vektör uzunluğuna uygulanması genel bilgidir; Grbl çatallarına (grblHAL, FluidNC) göre değişir, bu incelemede kaynak sayfası okunmadı [T].
- Mach3'te `G04 P` biriminin (saniye/milisaniye) ayara bağlı olduğu genel bilgidir; bu incelemede Mach3 belgesi okunmadı [T].
- d9–d23 dosyalarının çoğu yalnız işlev/sınıf adlarıyla tarandı (bölüm 7.6); "gerçek/stub" sınıflandırması örneklemeye dayanır.
- Bizim tarafta testler bu incelemede çalıştırılmadı; 255 test sayısı CLAUDE.md'den.

---

## 7. Kaynak kod incelemesi (2026-11-04)

Tüm dosya yolları yerel açılmış kopyaya göredir: `C:\Users\user\AppData\Local\Temp\claude\C--Users-user\9129623b-eed0-4448-94f7-8f870803b279\scratchpad\flamenet\dN\...` (orijinal: `C:\Users\user\Desktop\flamenet-sar-m-main`). Satır numaraları bu kopyadaki satırlardır. Güvenilirlik: hepsi **[K]**, ayrıca işaretlenenler **[T]**.

### 7.1 Mimari ve veri akışı (koda göre)

```
d1  geometry → winding_math (silindir Clairaut, analitik) → motion_planner (F = S'cosα·60) → gcode_generator (Grbl, G28)
d2  pattern_solver (kK≈2πp, gcd) → pattern_score_engine (9 kriter) → layer_manager → coverage_map (z,φ ızgara)
d3  machine_model (motor/vida fiziği) → alpha_optimizer (α taraması, Pareto) → coverage_analyzer
d4  dome_mandrel (elips/küre/izotensoid, κ_m κ_c κ_n) → geodesic_integrator (RK45) → fiber_physics (kayma STUB, hız profili)
d5  full_body_mandrel → unified_geodesic_planner (RK45 tam gövde) → transition_manager (eğrilik harmanlama, analiz) → full_body_coverage
d6  clairaut_optimizer (c taraması) → geodesic_family (desen + c)
d7  sequence_planner (katman/geçiş listesi) → controller_profile (Grbl/Mach3, A yöneticisi) → gcode_synthesizer → winding_grbl.nc / winding_mach3.nc
d8  machine_simulation (sezgisel, rastgele) / digital_twin (sensör stub) / export_pipeline (JSON/ASCII)
d19 winding_planner.py ("core/winding_planner.py", uygulamanın kullandığı planlayıcı; d1–d8'den bağımsız, ayrı ve çok daha basit)
```

Önemli: d4–d6'daki doğru geodezik yollar **örnek G-code'a girmiyor**. `generate_nc()` (`gcode_synthesizer.py:344–388`) `paths = [None] * total_passes` ile "basit mod" çalışıyor ve `_simple_helical_segments` silindir formülünü tüm X aralığında (domlar dahil) kullanıyor. Uygulamaya bağlı planlayıcı ise d19 `winding_planner.py` ve o d1–d8'in hiçbirini kullanmıyor.

### 7.2 Belge tabanlı iddiaların koddaki durumu

| # | Belge iddiası (2026-11-03) | Koddaki durum | Kanıt |
|---|---|---|---|
| 1 | Geodezik dφ/dz'de √G paydada | **Çürütüldü** (RK45 ODE doğru); **yeni hata**: `_integrate_dome_K` Jakobiyensiz dr integrali, kutup bölgesi atlanıyor, dom yarısı eksik sayılıyor; `_delta_phi` uydurma yaklaşım | `geodesic_integrator.py:88–96`, `unified_geodesic_planner.py:155–163`, `geodesic_family.py:216–245`, `clairaut_optimizer.py:295–317` |
| 2 | Helis adımı ters (181,4 mm) | **Çürütüldü** | `winding_math.py:290`, `main.py:50` |
| 3 | Hız bağıntıları çelişkili | **Kısmen**: silindir doğru; domda F sabit α₀ ile | `motion_planner.py:193`, `controller_profile.py:472–487, 567` |
| 4 | İzotensoid koşulu yanlış | **Doğrulandı (başka biçimde)**: ODE r_pole'u içermiyor, r = R·e^(cosψ−1) | `dome_mandrel.py:165–188` |
| 5 | Bant sayısı aşağı yuvarlama | **Çürütüldü** | `pattern_solver.py:199–206`, `layer_manager.py:95` |
| 6 | Desen örneği tutarsız | **Kısmen**: çekirdek doğru, "Diophantine ±1" etiketi matematiksel olarak sağlanamaz | `pattern_solver.py:76–79, 223–232` |
| 7 | Kontrolcü iddiası abartılı, G93 yok | **Doğrulandı**: LinuxCNC/Marlin yok; G93 ölü kod | `controller_profile.py:342–354` (çağıran yok) |
| 8 | M3 S + A çift tanım | **Çürütüldü** (kodda M3 yok) | tüm `.py` taraması |
| 9 | G28 başlıkta | **Doğrulandı (d1)**; d7'de `G0 X-5 A0` | `gcode_generator.py:220, 307`; `gcode_synthesizer.py:209` |
| 10 | Gizli μ=0,35 / 15 N | **15 N doğrulandı, μ=0,35 çürütüldü** (μ=0,2, kullanılmıyor) | `machine_model.py:265`; `fiber_physics_and_constraints.py:107–108` |

### 7.3 Rakip kodundaki hatalar ve riskler (koddan)

Önem: **Y** yüksek (makinede elyafa/parçaya zarar, yanlış parça), **O** orta, **D** düşük.

**G-code yolu (d7) ve örnek çıktılar**

1. **[Y] R=50 mm kod içine gömülü (iki yerde).** `gcode_synthesizer.py:327` `dA = abs(dz) * tan(alpha) / 50.0 * (180/π)` (parametre `mandrel_radius` yok sayılıyor); `sequence_planner.py:268` `alpha_0 = asin(c / 50.0)`. R≠50 olan her mandrelde A ve α yanlış. Bizim "gizli varsayılan yok" ilkesinin neden önemli olduğunun somut örneği.
2. **[Y] Dönüş geçişi yok; her geçiş sonunda elyaf bağlıyken hızlı X geri dönüşü.** `sequence_planner.py:309–328` yalnız `HELICAL_FORWARD` üretiyor (yorumda "return GeodesicPlanner tarafından yapılır" deniyor, basit modda yapılmıyor). `gcode_synthesizer.py:264–265` her geçiş başında `G0 X{z_start−2}`, A sabit. `winding_grbl.nc:53–56`: `G1 X380.000 A69.8795` sonra `G0 X38.000 A69.8795` → elyaf mandrel üzerinde 342 mm eksenel, hızlı hareketle sürüklenir. Bu, bizim düzelttiğimiz H1'in çok daha ağır hâli.
3. **[Y] "Gerilim gevşetme" hareketi elyafı eksenel sürüklüyor.** `gcode_synthesizer.py:286–291`: katmanın son geçişinden sonra `G1 X{z_start} A{A_current} F{0,3·F}`; `winding_mach3.nc:796–797` `G01 X40.0000 A1467.4704 F1771.73` (X 380→40, A sabit).
4. **[Y] Hoop'ta tur başına 4 tur A.** `gcode_synthesizer.py:135–145`: `a_seg = 360·i/(n−1)` kümülatif kesir, ama `axis_mgr.update()` artım bekliyor (`controller_profile.py:456–464`). n_pts=8 için şerit başına Σ = 360·(1+…+7)/7 = 1440° (benim hesabım). Hoop adımı b yerine ≈ b/4 olur.
5. **[Y] Basit modda dönüşte A geri sayıyor.** `gcode_synthesizer.py:328` `dA if z1 > z0 else -dA`: dönüş geçişi kullanılsaydı mandrel ters dönerdi (sarılmış elyafı çözer/aynı yolu tekrar eder). Şu an dönüş geçişi üretilmediği için tetiklenmiyor; ama hoop/polar geçişlerde z1>z0 olduğundan da etkisiz. Gizli tuzak.
6. **[Y] Mach3 duraklatması M01 (isteğe bağlı durma).** `controller_profile.py:359–361`; `winding_mach3.nc:800` `M01 (Fiber kes, yeni bobin hazırla)`. Mach3'te "Optional Stop" kapalıysa program durmadan devam eder ve hemen ardından `G00 A1440.0000` (satır 801) ile mandreli **geri** (1467,47° → 1440°) hızlı döndürür: elyaf kesilmeden ters hızlı dönüş [T: M01 davranışı genel bilgi].
7. **[O] Katman ±α ve φ ofseti G-code'a yansımıyor.** `sequence_planner.py:298` α işaretli, ama `gcode_synthesizer.py:115, 318` `abs(alpha)` kullanıyor; geçiş `phi_start_rad` hiç kullanılmıyor. `winding_mach3.nc:803–806`: "KATMAN 1 α=−10.17° φ_offset=4.286°" yorumu, ama hareketler KATMAN 0 ile aynı yön ve ofsetsiz. Ayrıca `winding_grbl.nc:55` geçiş başlığı "φ₀=137.14°" derken A 69,8795'ten devam ediyor; desen uygulanmıyor.
8. **[O] Domda silindir formülü.** Basit modda X 38→380 (domlar 0–40 ve 340–380) boyunca sabit dA/dX; dom geometrisi yok sayılıyor. İlk segment `X38→X50` (12 mm) 10 mm'lik dA alıyor (`gcode_synthesizer.py:320–328` z0=40 sanıyor, yaklaşma X38'den).
9. **[O] Domda F sabit α₀ ile (tam yol modunda).** `controller_profile.py:567` `compute_feedrate(alpha_rad, …)` geçiş başı α ile; kutba yaklaşırken gerçek X hızı v·cosα/√G'ye düşmeli. G94 LinuxCNC kuralında X'e F uygulanınca kutup yakınında elyaf ve A hızı hedefin çok üstüne çıkar [T: büyüklük hesaplanmadı].
10. **[O] Sıfır uzunluklu X hareketinde süre 0.** `controller_profile.py:570–574` `t = dx / (f/60)`; saf A dönüşünde t=0. G93 işlevi kullanılsaydı `F = 60/1e-6 = 6·10⁷` yazardı (`format_linear_inverse_time`, satır 349). Bizim H2'nin tersi bir hata.
11. **[D] Yorumlarda ASCII dışı karakter** (`α₀`, `─`, `≡`, Türkçe) hem Grbl hem Mach3 çıktısında (`winding_mach3.nc:799, 803`). Bizde `comment()` ASCII'ye çeviriyor.
12. **[D] `G0 X-5 A0` başlangıç**: negatif X'e hızlı hareket, makine sıfırı tanımına bağlı (`gcode_synthesizer.py:179, 209`).
13. **[D] İstatistik hatası**: `prog.total_x_travel += abs(seg.x_mm - prog.total_x_travel)` (`gcode_synthesizer.py:282`) anlamsız.

**Uygulamanın planlayıcısı (d19)**

14. **[Y] `winding_planner.py:generate_helical` birim hatası.** `a_per_pass = 360 / tan(α)` ("degrees per L", satır 67) ve `da = L/feed_passes · a_per_pass` (75). Varsayılanlarla (R=50, L=300, α=10,17°, b=10) her satırda dX ≈ 10,16 mm, dA ≈ 20 068° (≈ 55,7 tur) → etkin açı ≈ 89,97°, yani 10° helisel yerine neredeyse hoop sarar (benim hesabım [T]). Ayrıca `G91` artımlı, katman yönü değişince **A da ters** (satır 71–76), katman başına X toplamı 30 × 10,16 = 304,8 mm > L=300. R parametresi hesapta hiç kullanılmıyor. Varsayılanların hepsi gizli (satır 15–21).

**Matematik / model**

15. **[O] Desen bindirme dönüşümü.** `pattern_solver.py:216` ve `alpha_optimizer.py:341`: `overlap_mm = ε·R / cosα`. ε kapanma açısı; çevresel kayma R·ε, banda dik kayma R·ε·cosα. Kod 1/cos²α kat fazla (30°'de ×1,33, 60°'de ×4). Sonuç: yüksek açıda iyi adaylar gereksiz elenir.
16. **[O] Desen kapanması dwell ile ayarlanmıyor.** K = 2L·tanα/R sabit (`pattern_solver.py:323–332`); uç dwell kavramı yok. Gerçek makinede kapanma uç dönüşüyle tam yapılır (bizim yöntemimiz). Rakip bunun yerine α'yı tarıyor (`alpha_optimizer.optimize`), bu da tasarım açısını değiştirir.
17. **[O] `GeodesicFamilySearcher._find_patterns` n döngüsü etkisiz.** `p_float = k·K/2π` n'ye bağlı değil (`geodesic_family.py:274–286`); her n için aynı sonuçlar tekrarlanıyor.
18. **[O] Kutup boss modeli Clairaut ile çelişiyor.** `clairaut_optimizer.py:16–25, 254–260`: `r_boss = max(c·1,002, k·b/2π)` ve "fiber r_boss'ta döner". Geodezik yol r = c'de döner; bant sığmıyorsa sonuç yığılmadır, dönüş yarıçapı değişmez. Ayrıca k sabit tutulup c (dolayısıyla α) taranıyor; k α'ya bağlı olmalı.
19. **[O] Kapsama haritasında φ sarma hatası.** `coverage_map.py:219–233`: `phi0_w`, `phi1_w` ayrı ayrı mod 2π alınıp doğrusal ara değerleniyor; bir segment 2π sınırını geçerse tüm çevre boyunca sahte kapsama işaretlenir. `print_ascii` (352–367) eksenleri ters indeksliyor (`sub[phi_i, zi]`, dizi (z, φ) biçiminde). `mark_phi_band` aralığı simetrik değil (`range(-half, half+2)`, 210).
20. **[O] Kayma kontrolü stub.** `fiber_physics_and_constraints.py:134` her durumda 0; satır 137 `n_slip` ifadesi anlamsız (bool ile int karışık). `pattern_score_engine._score_stability` sabit 1,0.
21. **[O] Hız profili sınırları eziyor.** `fiber_physics_and_constraints.py:328` `v_raw = max(v_raw, v_target·polar_sf)`: devir/araba limitinden gelen düşük hız, sabit tabana (0,3·v) yükseltiliyor; yani makine limitini aşan hız üretilebilir. "jerk_limit" adlı değişken aslında ivme gibi kullanılıyor (mm/s³ etiketi, dv = j·ds/v), yalnız ileri yönde yumuşatma var, yavaşlama için geri geçiş yok (330–338). `a_centripetal = 5000 mm/s²` ile v = √(a/κ_n) sınırı sarım literatüründe standart bir kısıt değil [T].
22. **[D] Geodezik dönüş kutupta değil r = 1,002c'de** (`geodesic_integrator.py:26`, `unified_geodesic_planner.py:40`): yol aynı noktadan tersine integre ediliyor, c ile 1,002c arasındaki φ artışı kayboluyor ve teğet kırılıyor (α ≈ 87,4°'den tersine). Küçük ama desen kapanmasında birikir [T: büyüklük hesaplanmadı]. `_dydx` r ≤ c iken dz=0 döndürüp yalnız φ artırıyor (olay kaçarsa s_max'a kadar dönmeye devam).
23. **[D] `machine_model.py`**: statik tork ile ivme (hızda tork düşüşü yok), `check_machine_constraints` içinde sabit `t_acc = 0,05 s` (596), araba kütlesi 11,33 kg, sürtünme 5 N gizli.
24. **[D] `layer_manager.py`**: tüm katmanlar aynı R'de (kalınlık birikimi yok); her katman φ_offset'ten yeniden başlıyor (A kümülatif değerden küçük değere → birleştirilirse mandrel geri döner); hoop katmanı φ=0'dan başlıyor (`_build_hoop_circuits`, 496).

**Simülasyon / "dijital ikiz" (d8)**

25. **[O] `machine_simulation.py` sezgisel ve rastgele.** Poisson adım kaybı `np.random` (304, 325), sihirli katsayılar (`*0.01`, `tau_A*10`, 319–321), R=50 sabit (355). `CollisionAnalyzer` (466–534) yalnız X aralığı, A hızı ve `r < r_boss` kontrolü; kafa/payout eye ile mandrel arasında geometrik çarpışma yok; mandrel yoksa r=50 varsayıyor (528).
26. **[O] `digital_twin.py` sensörleri stub.** `connect()` her zaman `True` ve "[SIM]" (116–121, 142–145, 167–169, 188–191); `calibrate()` her zaman `True`.

### 7.4 Bizde olmayan, kodda gerçekten çalışan fikirler ve uyarlama

Zorluk: **K** kolay (<1 gün), **O** orta (1–3 gün), **Z** zor (>3 gün); tahmindir. Uyarlama ilkesi: `core/` saf TS, gizli varsayılan yok (kullanıcı girmezse özellik kapalı veya "eksik alan"), her özellik testli. **Kod kopyalanmamalı** (lisans yok); yalnız algoritma fikri.

**7.4.1 Desen aday tablosu (pattern_solver + score_engine)** — *gerçek, çekirdek doğru*
- Algoritma: devre dönüşü K için k·K ≈ 2πp (p tam devir sayısı), gcd(p, k) = 1 → k devre çevreyi k eşit yuvaya, hepsini ziyaret ederek böler. Kalan ε = kK − 2πp kapanma hatası. Puanlama 9 kriter, ağırlıklar keyfî (`pattern_score_engine.py:69–77`).
- Doğruluk: gcd ve ε doğru; bindirme dönüşümü yanlış (7.3 #15); dwell yok (#16); ağırlıklar ve eşikler (250 rpm, 3500 mm/s², t_acc=0,05) gizli varsayılan.
- Bize uyarlama: bizde devre dönüşü dwell ile tam ayarlanıyor (θc = 2πN + 2π·j/n), bu yüzden ε = 0 yapılabilir; eksik olan **j (skip) seçimi**. `winding.ts`'te `circuitPlan` için aday listesi: j ∈ [1, n−1], gcd(n, j) = 1, her aday için N, uç dönüşü δ, toplam süre, ilk komşu bandın kaç devre sonra geldiği. Kullanıcı seçer (otomatik gizli seçim yok, ağırlıklı puan yok; ham metrik). Testler: gcd≠1 adayı yok; seçilen j ile devre başlangıçlarının çevreyi tam bir kez taradığı (mod 2π küme eşitliği); j=1 mevcut çıktıyla birebir aynı. **O**.

**7.4.2 Analitik kalınlık / yoğunluk profili** — *gerçek, standart formül*
- Algoritma: ρ(z) = k·b / (2π·r(z)·cosα(z)), Clairaut ile cosα = √(1 − c²/r²); kalınlık t(z) = ρ·t_bant (`fiber_physics_and_constraints.py:154–206`, `transition_manager.py:275–294`, `clairaut_optimizer.py:262–283`). Bu, net teorisindeki t(r)·r·cosα = sabit bağıntısıdır (bizim landscape notu §2.4 ile tutarlı).
- Doğruluk: formül doğru; kutupta (cosα→0) sonsuza gider, rakip 15'te kırpıyor (`transition_manager.py:290`, gizli sınır). "r_boss" yorumu yanlış (#18).
- Bize uyarlama: **H3 için** (dış dom katmanının önceki yüzeyin içine düşmesi). `dome.ts`'e saf işlev: verilen katman (R, α, w, bandThickness) için dom boyunca t(u); kutba en yakın bant genişliği w/2 içinde ortalama alınarak sonlu tutulur (kırpma değil, bant genişliğiyle ortalama). Sonraki katmanın dom profili = önceki profil + t(u) normal ofseti (veya en azından "dış katman yolu önceki katmanın tahmini yüzeyine X mm yaklaşıyor" uyarısı ve 4 eksende Y güvenlik payı). Test: silindirde t = 2·bandThickness ile eşleşme; r→c'de monoton artış; ofset profilinin her noktada öncekinin dışında kalması. **O**.

**7.4.3 Dom eğriliği ve köprüleme kontrolü** — *gerçek, formüller doğru*
- `dome_mandrel.py:48–60, 82–85`: κ_m = −r″/G^{3/2}, κ_c = 1/(r√G), κ_n = κ_m cos²α + κ_c sin²α; κ_n < 0 → köprüleme (elyaf yüzeyden kalkar). `phase3_validation.py:24–38` küre ve elips için analitik kontroller (gerçek testler).
- Bize uyarlama: bizim yarım-elips domda κ_n hep > 0 (dışbükey), bu yüzden şimdilik değeri düşük; **konik/T-parça/içbükey mandrel** eklendiğinde ilk yapılacak güvenlik kontrolü. Saf işlev + test (küre κ_m = κ_c = 1/R). **K**, öncelik düşük.

**7.4.4 Limit farkındalıklı besleme (CurvatureAwareFeedrateAdapter fikri)** — *gerçek ama hatalı*
- Fikir: her nokta için hızı min(hedef, devir limiti, araba limiti) ile sınırla. Rakipte taban kırpması limitleri eziyor (#21).
- Bize uyarlama: `limits.ts` şu an yalnız uyarı veriyor. Kullanıcı `maxSpeed` girdiyse (boşsa özellik kapalı), aşan hareketin süresini (G93'te F'i, G94'te F'i) tepe eksen hızı limite eşit olacak şekilde uzat; **asla taban kırpması yok**. Özellikle CLAUDE.md'de not edilen "geçişte C büyük açı kısa sürede" sorunu ve kutup dwell'i. Test: üretilen her harekette eksen hızı ≤ limit (verify.ts ile geri okuyarak); limit boşken çıktı bit bit aynı. **O**.

**7.4.5 2B kapsama haritası (coverage_map)** — *gerçek, hatalı*
- Fikir: (z, φ) ızgarasında her bant geçişini işaretle; boşluk/bindirme oranı, kalınlık dağılımı.
- Bize uyarlama: `verify.ts` bağımsız okuyucusunun üstüne: G-code'dan geri okunan X/A'dan (plan değil) bant izini ızgaraya işle → "kapsama planla aynı mı" bağımsız kontrolü. φ sarmasını segmenti 2π sınırında bölerek doğru yap (rakibin hatası #19); bant genişliği çevresel w/cosα. Test: j=1 tam kapsama = %100, bilinçli boşluk bırakan girdide < %100. **O–Z** (performans: büyük işlerde ızgara boyutu).

**7.4.6 İvme ile uç dönüşü süresi (machine_model fikri)** — *gerçek, gizli sabitlerle*
- Fikir: uç dönüşünde t ≈ 2·v_x/a_max, elyaf hızı düşüşü (`machine_model.py:353–418`).
- Bize uyarlama: kullanıcı eksen ivmesi girerse (boşsa yok) plan süresine ivme payı ekle ve uç dönüşünde/geçişte "elyaf hızı ~%X'e düşer" uyarısı (bizdeki 4.2 #7). Motor/vida fiziği modeline gerek yok; LinuxCNC INI'deki MAX_ACCELERATION ile aynı birimde girdi. **K–O**.

**7.4.7 Katmanlar arası duraklatma** — *gerçek, M01 seçimi hatalı*
- Fikir: katman sonunda duraklatma (elyaf kes/bobin değiştir), ardından devam (`gcode_synthesizer.py:227–238`).
- Bize uyarlama: kullanıcı seçeneği "katman sonunda dur": **M0** (M1 değil), LinuxCNC'de `(MSG,…)` ile; duraklatma sonrası hiçbir ters A/rewind hareketi üretilmez (A kümülatif kalır). Test: seçenek kapalıyken çıktı aynı; açıkken her katman sınırında tam bir M0, sonrasında A azalmıyor. **K**.

**7.4.8 Kontrolcü profilleri** — *gerçek, bizimkinden zayıf*
- Rakipte Grbl/Mach3 soyut sınıfı (`controller_profile.py:73–140`). Bizde LinuxCNC/Mach3 ayrımı zaten var ve daha sağlam (G93, G94 dönüşü, ASCII). Alınacak tek fikir: `format_dwell` gibi kontrolcüye özel birim farklarını tek yerde toplamak; bizde G4 kullanılmıyor, ihtiyaç yok. **Alınmamalı.**

**7.4.9 Dijital ikiz / simülasyon** — *iskelet + rastgele*. **Alınmamalı.** Bizim LinuxCNC sim kiti (gerçek kontrolcü yazılımı) daha değerli bir doğrulama yolu.

**7.4.10 İlk sarım prosedürü adımları** — *adım listesi iyi, ölçümler kısmen sahte*
- `first_wind_procedure.py` (d13) 10 adım: kuru çalıştırma (elyafsız) → yalnız mandrel → yalnız araba → düşük gerilimli elyaf → tek devre → 5 devre → tam helisel katman → dom geçişi → rewind güvenliği → acil durum tatbikatı. Adım 4–5'te gerilim değerleri `rng.normal` ile üretiliyor (satır 82–83, 92–96), yani sahte.
- Bize uyarlama: `checklist.ts`'e makine kurulunca kullanılacak sıralı "ilk sarım" listesi (metin; ölçüm üretmeden, kullanıcı işaretler). `dryrun.ts` zaten 1–3. adımları kısmen karşılıyor; "tek devre" ve "5 devre" için plandan ilk 1/5 devreyi kesen kısa program üretimi eklenebilir. **K**.

### 7.5 Testler (phase*_validation.py) ne kadar gerçek?

Hepsi kendi `chk(cond, msg)` işlevini kullanan, `AssertionError` atan betikler; pytest yok, çıktı dosyası `/mnt/user-data/outputs/`'a yazılıyor (`main.py:441`).

- **Gerçek kontroller (iyi):** `main.py` silindir elle beklentileri (c, pitch, dφ/dz, pitch·dφ/dz = 2π, Clairaut tüm noktalarda, A monoton artış — satır 158–257); `phase3_validation.py:24–38` küre/elips eğrilik analitik değerleri, satır 53 Clairaut sabitliği (RK45 yol boyunca, < 1e-3 mm).
- **Kendini doğrulayan (tautolojik) kontroller:** `phase2_validation.py:80–83` bindirme formülünü kodla aynı (yanlış) formülle yeniden hesaplayıp karşılaştırıyor; `phase3_validation.py:64` kayma stub'ının 0 döndürdüğünü "Geodezik: slip=0 ✓" diye test ediyor; `phase5_validation.py:51` `all(p.is_first_pass or not p.is_first_pass …)` her zaman doğru.
- **Zayıf eşikler:** kapsama > %30, düzgünlük σ/μ < 2,0 (`phase2_validation.py:157–161`); yol uzunluğu > 0, Δφ > 0 (`phase3_validation.py:46–49`); G-code'da "G1", "M30", "(" geçiyor mu (`phase5_validation.py:135–148`).
- **Eksik olanlar (bizim için ders):** G-code'u geri okuyup geometrik/fiziksel değişmez kontrolü yok: "A asla azalmaz", "elyaf bağlıyken G0 X yok", "hoop'ta A artışı = 360°·(ΔX/adım)", "R girdisi değişince A orantılı değişir". Bu dört kontrolün herhangi biri, 7.3'teki #1, #2, #3, #4 hatalarını yakalardı. Örnek `.nc` dosyaları bu hatalarla birlikte depoda.

### 7.6 d9–d23 kısa envanter

| Klasör | Ne var (dosya adları + örnekleme) | Kapsamımızla ilgisi | Gerçek mi? |
|---|---|---|---|
| d9 | `hal.py`, `streaming.py` (Grbl "ok" akış kontrolü, Mach3 "burst" tamponu), `safety_layer.py`, `telemetry.py`, `validation_workflow.py` | Düşük (biz kontrolcüye G-code dosyası veriyoruz, akış yapmıyoruz) | Akış tamponu gerçek kod; donanım yok, `validation_workflow.py` rastgele veri kullanıyor (taramada `random` eşleşmesi) |
| d10 | `state_estimator.py`, `closed_loop_controller.py`, `auto_calibration.py`, `fault_recovery.py` | Kapsam dışı | Örneklenmedi; testleri `np.random` ağırlıklı (`phase8_validation.py`) |
| d11 | `rt_scheduler.py`, `reliability_engine.py`, `commissioning.py` | Düşük | Örneklenmedi |
| d12/d13 | `serial_controller.py` (iki kopya), `sensor_pipeline.py`, `first_wind_procedure.py`, `persistent_telemetry.py`, `industrial_watchdog.py`, `production_recovery.py` | Orta: ilk sarım adım listesi (7.4.10) | Adım iskeleti gerçek; gerilim değerleri `rng.normal` (sahte) |
| d14 | `rl_assistant.py` (tablo Q-öğrenme, ε-greedy, `np.random`), `defect_predictor.py`, `tension_predictor.py`, `quality_estimator.py`, `online_parameter_tuner.py` | Kapsam dışı | Oyuncak RL; gerçek veri yok |
| d15 | `cure_model.py`, `resin_physics.py`, `laminate_estimator.py`, `spc_engine.py`, `recipe_manager.py`, `batch_traceability.py` | Düşük (reçete fikri) | Örneklenmedi |
| d16 | Telemetri kayıt/tekrar, "digital twin correlation", sürüklenme analizi | Kapsam dışı | Örneklenmedi |
| d17 | `machine_config.py` + `.yaml`, `process_recipe.py`, `fmea_engine.py` | Düşük-orta (makine profili dosyası fikri) | Örneklenmedi |
| d18 | DAQ, titreşim FFT, termal kamera, kestirimci bakım | Kapsam dışı | Örneklenmedi; testler `np.random` |
| d19 | `winding_planner.py` (**uygulamanın planlayıcısı, ağır hatalı**, 7.3 #14), `esp32_link.py` (`MockESP32Link` rastgele + `RealESP32Link` pyserial), `safety_controller.py`, `recipe_db.py`, iç zip | Orta (planlayıcı karşılaştırması) | Mock gerçek çalışır, Real donanımsız denenmemiş; planlayıcı yanlış |
| d20 | PySide6 arayüz (7 panel), PyInstaller `.spec`, `build_windows.bat` | Kapsam dışı | Örneklenmedi |
| d21 | `real_esp32_link.py`, `link_factory.py`, bring-up | Kapsam dışı | Örneklenmedi |
| d22/d23 | ESP-IDF C firmware (telemetri çerçevesi, UART, INA226, MPU6050, NTC), C host testleri, `run_all_tests.sh` | Kapsam dışı | Örneklenmedi; donanımda doğrulanmadığı kendi belgesinde yazıyor |

### 7.7 Bizim için öncelikli eylem listesi (en çok 8)

| # | Eylem | Gerekçe (rakip kodundan) | Dosya (bizde) | Zorluk |
|---|---|---|---|---|
| 1 | **Değişmez (invariant) regresyon testleri** ekle: (a) G-code'da A hiçbir G1/G0'da azalmaz; (b) ilk G1'den sonra X değiştiren G0 yok; (c) hoop'ta ardışık geçişlerde ΔA/ΔX = 360°/adım; (d) R iki kat → aynı ΔX için ΔA yarıya (sabit R gömülmesini yakalar); (e) M1/M01 hiç üretilmez. Hepsi `verify.ts` geri okumasıyla | Rakipteki en ağır 5 hata (7.3 #1–#6) tam olarak bu testlerin yokluğunda depoya girmiş; bizde çoğu muhtemelen zaten sağlanıyor, test bunu kalıcı kılar | `regression.test.ts`, `attack.test.ts` | K |
| 2 | **H3: analitik kalınlık profili + dom ofseti** (veya en az uyarı ve 4 eksende Y payı) | Rakibin ρ(z) formülü doğru ve basit (7.4.2); bizde açık bilinen sınır | `dome.ts`, `winding.ts: domedHelicalLayer`, `limits.ts`/uyarılar | O |
| 3 | **Skip indeksi j ve desen aday tablosu** (gcd(n, j)=1, ham metrik, kullanıcı seçimi; dwell ile tam kapanma) | Rakibin gcd çekirdeği doğru, bindirme dönüşümü ve dwell'siz yaklaşımı yanlış; bizde dwell olduğu için daha iyi uygulanabilir (7.4.1) | `winding.ts: circuitPlan/helicalLayer/domedHelicalLayer`, UI | O |
| 4 | **Limit farkındalıklı süre uzatma** (kullanıcı `maxSpeed` girerse, aşan hareketlerin F'ini düşür; boşsa kapalı) | Rakipte fikir var ama taban kırpmasıyla limiti eziyor (7.3 #21); bizde yalnız uyarı var, geçişteki C hızı bilinen sorun | `limits.ts`, `gcode.ts` | O |
| 5 | **Kutup yakınında F doğruluğu testi** (G94'te domun son parçalarında elyaf hızı = hedef ±%1, verify ile) | Rakip domda sabit α₀ ile F yazıyor (7.3 #9); bizim CLAUDE.md "kutba yakın G94 F çok düşer" notu var, testle sınırlanmalı | `dome.test.ts`, `verify.ts` | K |
| 6 | **Katman sonunda isteğe bağlı M0 duraklatma** (M1 değil, sonrasında ters A yok) | Rakipte M01 + hızlı ters A (7.3 #6) güvenlik riski; doğru biçimi bizde kolay | `gcode.ts`, `types.ts`, UI | K |
| 7 | **İvme girdisiyle uç dönüşü/geçiş süresi ve hız düşüşü uyarısı** (girdi boşsa yok) | Rakibin t = 2v/a fikri (7.4.6), gizli sabitsiz biçimde; bizdeki 4.2 #7 | `limits.ts`, `verify.ts` | K–O |
| 8 | **İlk sarım adım listesi** (10 adım, ölçüm uydurmadan, kullanıcı işaretler) + "ilk 1/5 devre" kısa program | Rakibin adım sırası iyi, ölçümleri sahte (7.4.10) | `checklist.ts`, `dryrun.ts` | K |

**Alınmaması önerilenler:** rakibin puan ağırlıkları ve eşikleri (keyfî, gizli varsayılan), `IsotensoidDome` ODE'si (yanlış), `r_boss = max(c, k·b/2π)` modeli (Clairaut ile çelişkili), `machine_simulation.py` ve `digital_twin.py` (rastgele/stub), `a_centripetal` hız sınırı (kaynağı belirsiz), RL/kür/SPC/kestirimci bakım katmanları, Grbl hedefi (kullanıcı kararı LinuxCNC/Mach3). Lisans olmadığı için kod kopyalanmamalı; yalnız genel algoritma fikirleri (gcd kapanması, net teorisi kalınlık formülü, Euler normal eğriliği) kullanılabilir — bunlar zaten literatürde standart.

---

## Kaynaklar

- Depo: https://github.com/htuncerr00-sketch/flamenet-sar-m [O]
- Dosya ağacı: https://api.github.com/repos/htuncerr00-sketch/flamenet-sar-m/git/trees/main?recursive=1 [O]
- Commit listesi: https://api.github.com/repos/htuncerr00-sketch/flamenet-sar-m/commits [O]
- https://raw.githubusercontent.com/htuncerr00-sketch/flamenet-sar-m/main/CLAUDE.md [O]
- https://raw.githubusercontent.com/htuncerr00-sketch/flamenet-sar-m/main/FilamentWinding_CAM_Engineering_Analysis%20(1).md [O]
- Yerel açılmış kaynak kod (2026-11-04): `C:\Users\user\AppData\Local\Temp\claude\C--Users-user\9129623b-eed0-4448-94f7-8f870803b279\scratchpad\flamenet\d1` … `d23`; orijinal `C:\Users\user\Desktop\flamenet-sar-m-main` [K]
  - Okunan başlıca dosyalar: d1 `winding_math.py`, `motion_planner.py`, `gcode_generator.py`, `main.py`; d2 `pattern_solver.py`, `pattern_score_engine.py`, `layer_manager.py`, `coverage_map.py`, `phase2_validation.py`; d3 `alpha_optimizer.py`, `machine_model.py`; d4 `dome_mandrel.py`, `geodesic_integrator.py`, `fiber_physics_and_constraints.py`, `phase3_validation.py`; d5 `transition_manager.py`, `unified_geodesic_planner.py`, `full_body_mandrel.py` (başı); d6 `clairaut_optimizer.py`, `geodesic_family.py`; d7 `sequence_planner.py`, `controller_profile.py`, `gcode_synthesizer.py`, `winding_grbl.nc`, `winding_mach3.nc`, `phase5_validation.py`; d8 `machine_simulation.py`, `digital_twin.py`; d13 `first_wind_procedure.py`; d19 `winding_planner.py`, `esp32_link.py` (tarama)
- Bizim önceki araştırma: `docs/research/filament-winding-landscape.md`
