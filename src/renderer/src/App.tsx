import { Copy, Download, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { controllerChecklist } from './core/checklist'
import { generateDryRun } from './core/dryrun'
import { firstWindSteps } from './core/firstWind'
import { generateGcode } from './core/gcode'
import { generateSimKit } from './core/simkit'
import { MAX_PROJECT_BYTES, parseProject, serializeProject } from './core/project'
import { hasAnySpeedLimit, peakSpeeds, slowdownSummary, speedWarnings } from './core/limits'
import { verifyGcode } from './core/verify'
import { missingFields, patternCandidates, planWinding, type PatternCandidate } from './core/winding'
import { useStore } from './store'
import { Preview } from './ui/Preview'

/** Boş metin → null; virgül ondalık ayırıcı; sayı değilse undefined (girdi yok sayılır). */
function parseDecimal(raw: string): number | null | undefined {
  const t = raw.replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

const BTN = 'flex items-center gap-1 rounded bg-raised px-2 py-1 hover:bg-accent-soft'

function SelectField({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: string | number
  onChange: (v: string) => void
  options: { value: string | number; label: string }[]
}): React.JSX.Element {
  return (
    <label className="flex items-center justify-between py-1">
      <span className="text-ink-2">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function download(text: string, name: string): void {
  const blob = new Blob([text], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function NumField({
  label,
  unit,
  value,
  onChange
}: {
  label: string
  unit: string
  value: number | null
  onChange: (v: number | null) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-ink-2">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className="w-24 text-right"
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => {
            const v = parseDecimal(e.target.value)
            if (v !== undefined) onChange(v)
          }}
        />
        <span className="w-9 text-ink-3">{unit}</span>
      </span>
    </label>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="border-b border-line px-4 py-3">
      <h2 className="mb-1 text-ink-3 uppercase tracking-wide text-[11px]">{title}</h2>
      {children}
    </section>
  )
}

function Check({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 py-0.5 text-ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

const trNum = (v: number, d = 1): string => v.toFixed(d).replace('.', ',')

/** Kalınlık örneklerinden yarıçap aralığına (ekvator → kutup) eşit dağılmış 5 tanesi (noktalar kutba yığılır). */
function thicknessSamples<T extends { r: number }>(s: T[]): T[] {
  const r0 = s[0].r
  const r1 = s[s.length - 1].r
  const picked = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    s.reduce((best, p) => (Math.abs(p.r - (r0 + (r1 - r0) * f)) < Math.abs(best.r - (r0 + (r1 - r0) * f)) ? p : best))
  )
  return picked.filter((p, i) => picked.indexOf(p) === i)
}

/** Desen atlaması j seçimi: adaylar uç dönüşü küçükten büyüğe (core/patternCandidates); varsayılan j=1. */
function PatternSelect({
  index,
  value,
  candidates,
  onChange
}: {
  index: number
  value: number
  candidates: PatternCandidate[]
  onChange: (j: number) => void
}): React.JSX.Element {
  if (candidates.length === 0) return <span className="text-ink-3">desen j={value}</span>
  // Çok bantlı katmanlarda liste uzar: ilk 60 aday + seçili olan
  const shown = candidates.slice(0, 60)
  const current = candidates.find((c) => c.j === value)
  if (current && !shown.includes(current)) shown.push(current)
  return (
    <select
      className="w-40"
      aria-label={`Katman ${index + 1} desen`}
      title="Desen atlaması j: devre dönüşü 2πN + 2π·j/n, gcd(j, n) = 1. Uç dönüşü küçükten büyüğe sıralı."
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {!current && <option value={value}>j={value} (geçersiz)</option>}
      {shown.map((c) => (
        <option key={c.j} value={c.j}>
          j={c.j} · uç {trNum(c.dwellDeg)}°
        </option>
      ))}
    </select>
  )
}

export default function App(): React.JSX.Element {
  const { input, machine, setInput, setMachine, addLayer, updateLayer, removeLayer, loadProject } = useStore()
  const [projectMsg, setProjectMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const saveProject = (): void => download(serializeProject(input, machine), 'winding-proje.json')
  const openProject = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > MAX_PROJECT_BYTES) {
      setProjectMsg({ ok: false, text: `Proje dosyası geçersiz: dosya çok büyük (${file.size} bayt)` })
      return
    }
    const r = parseProject(await file.text())
    if (r.ok) {
      loadProject(r.input, r.machine)
      setProjectMsg({ ok: true, text: `${file.name} açıldı (${r.input.layers.length} katman)` })
    } else setProjectMsg({ ok: false, text: r.error })
  }
  const [progress, setProgress] = useState(1)

  const missing = useMemo(() => missingFields(input, machine.axisCount), [input, machine.axisCount])
  const candidates = useMemo(
    () => input.layers.map((l, i) => (l.kind === 'helical' ? patternCandidates(input, i, machine.axisCount) : [])),
    [input, machine.axisCount]
  )
  const plan = useMemo(() => (missing.length === 0 ? planWinding(input, machine.axisCount) : null), [input, machine.axisCount, missing])
  const gcode = useMemo(() => (plan ? generateGcode(plan, input, machine) : ''), [plan, input, machine])

  // tepe hız ve süre eksen limitleri dahil (limits.moveMinutes): limit girildiyse aşan hareketler yavaşlatılır
  const peak = useMemo(() => (plan ? peakSpeeds(plan, input.feedRate!, machine) : null), [plan, input.feedRate, machine])
  const slow = useMemo(() => (plan ? slowdownSummary(plan, machine) : null), [plan, machine])
  const speedWarn = useMemo(() => (peak ? speedWarnings(peak, machine) : []), [peak, machine])
  const checklist = useMemo(() => controllerChecklist(machine), [machine])
  const hasDome = input.layers.some((l) => l.kind === 'helical' && !!l.dome)
  const firstWind = useMemo(() => firstWindSteps(machine, { hasDome }), [machine, hasDome])
  const [done, setDone] = useState<Record<string, boolean>>({})
  const ext = machine.controller === 'mach3' ? 'tap' : 'ngc'
  const save = (): void => download(gcode, `winding.${ext}`)
  const saveSimKit = (): void => {
    const kit = generateSimKit(machine)
    download(kit.ini, 'winding-sim.ini')
    download(kit.hal, 'winding-sim.hal')
    download(kit.readme, 'winding-sim-README.txt')
  }
  const saveDryRun = (): void => download(generateDryRun(machine), `winding-kuru-test.${ext}`)
  const speedLimits = machine.maxSpeed ?? { carriage: null, mandrel: null, head: null, cross: null }
  const report = useMemo(() => (plan && gcode ? verifyGcode(gcode, machine, plan) : null), [plan, gcode, machine])
  const travelOf = (k: 'carriage' | 'cross'): { min: number | null; max: number | null } =>
    machine.travel?.[k] ?? { min: null, max: null }
  const setTravel = (k: 'carriage' | 'cross', patch: Partial<{ min: number | null; max: number | null }>): void =>
    setMachine({ travel: { ...machine.travel, [k]: { ...travelOf(k), ...patch } } })

  const axisNames = (['carriage', 'mandrel', 'head', 'cross'] as const).slice(0, machine.axisCount === 4 ? 4 : 3)
  const axisLabel = { carriage: 'Araba', mandrel: 'Mandrel', head: 'Kafa dön.', cross: 'Çapraz' }

  return (
    <div className="flex h-full">
      <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <Section title="Proje">
          <div className="flex gap-2">
            <button className={BTN} onClick={saveProject} title="Girdi ve makine ayarı JSON olarak iner">
              <Download size={14} strokeWidth={1.5} /> Projeyi kaydet
            </button>
            <label className={`${BTN} cursor-pointer`} title="Kaydedilmiş proje dosyasını aç (mevcut girdilerin yerine geçer)">
              <FolderOpen size={14} strokeWidth={1.5} /> Proje aç
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                data-testid="project-file"
                onChange={(e) => {
                  void openProject(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          {projectMsg && (
            <div className={`mt-1 ${projectMsg.ok ? 'text-ink-3' : 'text-critical'}`} data-testid="project-msg">
              {projectMsg.text}
            </div>
          )}
        </Section>

        <Section title="Mandrel ve bant">
          <NumField label="Mandrel çapı" unit="mm" value={input.mandrelDiameter} onChange={(v) => setInput({ mandrelDiameter: v })} />
          <NumField label="Sarım uzunluğu" unit="mm" value={input.windLength} onChange={(v) => setInput({ windLength: v })} />
          <NumField label="Bant genişliği" unit="mm" value={input.bandWidth} onChange={(v) => setInput({ bandWidth: v })} />
          <NumField label="Bant kalınlığı" unit="mm" value={input.bandThickness} onChange={(v) => setInput({ bandThickness: v })} />
          <NumField label="Elyaf hızı" unit="mm/dk" value={input.feedRate} onChange={(v) => setInput({ feedRate: v })} />
          <NumField label="Uç dönüşü (asgari)" unit="°" value={input.turnDwellMinDeg} onChange={(v) => setInput({ turnDwellMinDeg: v })} />
          {machine.axisCount === 4 && (
            <NumField label="Kafa boşluğu" unit="mm" value={input.standoff} onChange={(v) => setInput({ standoff: v })} />
          )}
        </Section>

        <Section title="Katmanlar">
          {input.layers.map((l, i) => (
            <div key={l.id} className="py-1">
              <div className="flex items-center gap-2">
                <span className="w-6 text-ink-3">{i + 1}</span>
                <span className="w-14">{l.kind === 'hoop' ? 'Hoop' : 'Helisel'}</span>
                {l.kind === 'helical' ? (
                  <span className="flex items-center gap-1">
                    <input
                      className="w-20 text-right"
                      inputMode="decimal"
                      aria-label={`Katman ${i + 1} açısı`}
                      value={l.angleDeg ?? ''}
                      onChange={(e) => {
                        const v = parseDecimal(e.target.value)
                        if (v !== undefined) updateLayer(l.id, { angleDeg: v })
                      }}
                    />
                    <span className="text-ink-3">° eksenden</span>
                  </span>
                ) : (
                  <span className="text-ink-3">açı otomatik</span>
                )}
                <button className="ml-auto text-ink-3 hover:text-critical" onClick={() => removeLayer(l.id)} aria-label="Katmanı sil">
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </div>
              {l.kind === 'helical' && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-8">
                  <label className="flex items-center gap-1 text-ink-2">
                    <input
                      type="checkbox"
                      checked={!!l.dome}
                      onChange={(e) => updateLayer(l.id, { dome: e.target.checked })}
                    />
                    Domlu
                  </label>
                  <PatternSelect
                    index={i}
                    value={l.patternSkip ?? 1}
                    candidates={candidates[i]}
                    onChange={(j) => updateLayer(l.id, { patternSkip: j === 1 ? null : j })}
                  />
                  {l.dome && (
                    <span className="ml-auto flex items-center gap-1">
                      <span className="text-ink-3">dom yüksekliği</span>
                      <input
                        className="w-16 text-right"
                        inputMode="decimal"
                        aria-label={`Katman ${i + 1} dom yüksekliği`}
                        value={l.domeHeight ?? ''}
                        onChange={(e) => {
                          const v = parseDecimal(e.target.value)
                          if (v !== undefined) updateLayer(l.id, { domeHeight: v })
                        }}
                      />
                      <span className="w-6 text-ink-3">mm</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <button className={BTN} onClick={() => addLayer('helical')}>
              <Plus size={14} strokeWidth={1.5} /> Helisel
            </button>
            <button className={BTN} onClick={() => addLayer('hoop')}>
              <Plus size={14} strokeWidth={1.5} /> Hoop
            </button>
          </div>
        </Section>

        <Section title="Makine">
          <SelectField
            label="Kontrolcü"
            value={machine.controller}
            options={[
              { value: 'linuxcnc', label: 'LinuxCNC' },
              { value: 'mach3', label: 'Mach3' }
            ]}
            onChange={(v) => {
              const controller = v as 'linuxcnc' | 'mach3'
              // Araştırma: Mach3'te G94 birleşik hareket F yorumu belirsiz → G93 öner (aşağıdan değiştirilebilir)
              setMachine(controller === 'mach3' ? { controller, feedMode: 'G93' } : { controller })
            }}
          />
          <SelectField
            label="Eksen sayısı"
            value={machine.axisCount}
            options={[
              { value: 3, label: '3 (X, A, C)' },
              { value: 4, label: '4 (X, A, C, Y)' }
            ]}
            onChange={(v) => setMachine({ axisCount: Number(v) as 3 | 4 })}
          />
          <SelectField
            label="Besleme modu"
            value={machine.feedMode}
            options={[
              { value: 'G94', label: 'G94 (mm/dk)' },
              { value: 'G93', label: 'G93 (inverse-time)' }
            ]}
            onChange={(v) => setMachine({ feedMode: v as 'G94' | 'G93' })}
          />
          {axisNames.map((k) => (
            <div key={k} className="flex items-center justify-between py-1">
              <span className="text-ink-2">{axisLabel[k]}</span>
              <span className="flex items-center gap-3">
                <input
                  className="w-12 text-center"
                  maxLength={1}
                  value={machine.names[k]}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase()
                    if (/^[A-Z]$/.test(v)) setMachine({ names: { ...machine.names, [k]: v } })
                  }}
                />
                <label className="flex items-center gap-1 text-ink-3">
                  <input
                    type="checkbox"
                    checked={machine.invert[k]}
                    onChange={(e) => setMachine({ invert: { ...machine.invert, [k]: e.target.checked } })}
                  />
                  ters
                </label>
              </span>
            </div>
          ))}
          <Check label="Başta eksenleri sıfırla (G92)" checked={machine.zeroAxesAtStart} onChange={(v) => setMachine({ zeroAxesAtStart: v })} />
          <Check label="Katmanlar arası dur (M0)" checked={machine.pauseBetweenLayers} onChange={(v) => setMachine({ pauseBetweenLayers: v })} />
        </Section>

        <Section title="Eksen hız limitleri (boş = kontrol yok)">
          {axisNames.map((k) => (
            <NumField
              key={k}
              label={`${axisLabel[k]} (${machine.names[k]})`}
              unit={k === 'carriage' || k === 'cross' ? 'mm/dk' : '°/dk'}
              value={speedLimits[k]}
              onChange={(v) => setMachine({ maxSpeed: { ...speedLimits, [k]: v } })}
            />
          ))}
        </Section>

        <Section title="Eksen strok sınırları (boş = kontrol yok)">
          {(machine.axisCount === 4 ? (['carriage', 'cross'] as const) : (['carriage'] as const)).map((k) => (
            <div key={k}>
              <NumField label={`${axisLabel[k]} (${machine.names[k]}) alt`} unit="mm" value={travelOf(k).min} onChange={(v) => setTravel(k, { min: v })} />
              <NumField label={`${axisLabel[k]} (${machine.names[k]}) üst`} unit="mm" value={travelOf(k).max} onChange={(v) => setTravel(k, { max: v })} />
            </div>
          ))}
          <div className="text-ink-3">Dönel eksenler (A, C) sınırsız kabul edilir.</div>
        </Section>

        <Section title="Kontrolcü ayar listesi">
          <ul className="list-disc space-y-1 pl-4 text-ink-2">
            {checklist.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button className={`${BTN} mt-2`} onClick={saveSimKit} title="LinuxCNC donanımsız simülasyon: INI + HAL + açıklama (üç dosya iner)">
            <Download size={14} strokeWidth={1.5} /> LinuxCNC sim kiti
          </button>
          <div className="mt-1 text-ink-3">Sim kiti LinuxCNC kurulu olmayan ortamda yazıldı, çalıştırılmadı.</div>
        </Section>

        <Section title="İlk sarım">
          <details data-testid="first-wind">
            <summary className="cursor-pointer text-ink-2">İlk sarım adımları ({firstWind.length} adım, işaretle)</summary>
            <ol className="mt-1 space-y-2 pl-1">
              {firstWind.map((s, n) => (
                <li key={s.title}>
                  <div className="text-ink">
                    {n + 1}. {s.title}
                  </div>
                  {s.items.map((it) => (
                    <Check
                      key={it}
                      label={it}
                      checked={!!done[`${s.title}|${it}`]}
                      onChange={(v) => setDone({ ...done, [`${s.title}|${it}`]: v })}
                    />
                  ))}
                </li>
              ))}
            </ol>
            <div className="mt-1 text-ink-3">İşaretler kaydedilmez. Makine kurulmadan doğrulanmadı.</div>
          </details>
        </Section>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <Preview plan={plan} mandrelDiameter={input.mandrelDiameter} length={input.windLength} progress={progress} />
          {!plan && (
            <div className="absolute left-4 top-4 rounded bg-surface/90 px-3 py-2 text-warning">
              Eksik alanlar: {missing.join(', ')}
            </div>
          )}
          <div className="absolute bottom-3 left-4 right-4 flex items-center gap-3 rounded bg-surface/90 px-3 py-2">
            <span className="text-ink-3">Sarım ilerlemesi</span>
            <input
              className="flex-1"
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="flex h-[300px] shrink-0 border-t border-line bg-surface">
          <div className="w-[320px] shrink-0 overflow-y-auto border-r border-line p-3">
            {plan ? (
              <>
                <div className="mb-2 text-ink-2">
                  Dış çap {plan.outerDiameter.toFixed(2)} mm · elyaf {(plan.totalFiberLength / 1000).toFixed(1)} m · ~
                  {(slow?.minutes ?? plan.totalMinutes).toFixed(1)} dk · {plan.moves.length} hareket
                </div>
                {slow && slow.slowedMoves > 0 && (
                  <div className="mb-2 text-warning" data-testid="slowdown">
                    Eksen hız limiti: {slow.slowedMoves} hareket yavaşlatıldı, süre +%
                    {trNum((slow.minutes / slow.baseMinutes - 1) * 100)} ({trNum(slow.baseMinutes)} → {trNum(slow.minutes)} dk). Bu
                    hareketlerde elyaf hızı girilen değerin altında.
                  </div>
                )}
                {peak && (
                  <div className="mb-2 text-ink-3">
                    Tepe hız: {machine.names.carriage} {Math.round(peak.carriage)} mm/dk · {machine.names.mandrel}{' '}
                    {Math.round(peak.mandrel)} °/dk · {machine.names.head} {Math.round(peak.head)} °/dk
                    {!hasAnySpeedLimit(machine) && <div>Eksen hız limiti girilmedi, aşım kontrolü yapılmadı.</div>}
                  </div>
                )}
                {report && (
                  <div className="mb-2 border-t border-line pt-1.5">
                    <div className={report.issues.some((i) => i.level === 'error') ? 'text-critical' : 'text-ink'}>
                      G-code doğrulama:{' '}
                      {report.issues.some((i) => i.level === 'error')
                        ? `${report.issues.filter((i) => i.level === 'error').length} hata`
                        : 'hata yok'}
                      {report.issues.some((i) => i.level === 'warning') &&
                        `, ${report.issues.filter((i) => i.level === 'warning').length} uyarı`}
                    </div>
                    <div className="text-ink-3">
                      {report.feedMoves} G1 + {report.rapidMoves} G0 · süre {report.minutes.toFixed(2)} dk
                      {report.planTimeRatio !== null && <> (plan oranı {report.planTimeRatio.toFixed(4)})</>} · {machine.names.carriage}{' '}
                      {report.range.carriage.min.toFixed(1)}…{report.range.carriage.max.toFixed(1)} mm
                    </div>
                    {report.issues.map((i, n) => (
                      <div key={n} className={i.level === 'error' ? 'text-critical' : 'text-warning'}>
                        {i.line > 0 ? `Satır ${i.line}: ` : ''}
                        {i.message}
                      </div>
                    ))}
                  </div>
                )}
                {speedWarn.map((w) => (
                  <div key={w} className="mb-1 text-warning">
                    {w}
                  </div>
                ))}
                {plan.layers.map((l) => (
                  <div key={l.index} className="border-t border-line py-1.5">
                    <div>
                      Katman {l.index + 1} · {l.kind === 'hoop' ? 'hoop' : 'helisel'}{l.dome ? ' domlu' : ''} {l.angleDeg.toFixed(2)}°
                    </div>
                    <div className="text-ink-3">
                      r {l.radius.toFixed(2)} mm · {l.bands} bant · kapsama {(l.coverage * 100).toFixed(0)}%
                      {l.kind === 'helical' && <> · desen j={l.patternSkip} · uç dönüşü {l.turnDwellDeg.toFixed(1)}°</>}
                      {l.dome && <> · kutup açıklığı r₀ {l.dome.poleRadius.toFixed(2)} mm</>}
                    </div>
                    {l.dome && (
                      <div className="text-ink-3" data-testid={`thickness-${l.index}`}>
                        Kalınlık t(r):{' '}
                        {thicknessSamples(l.dome.thickness)
                          .map((s) => `r ${trNum(s.r)} → ${trNum(s.t, 3)}`)
                          .join(' · ')}{' '}
                        mm · azami {trNum(l.dome.maxThickness, 3)} mm (r &lt; {trNum(l.dome.capRadius)} mm bant genişliği ortalaması)
                        {l.index > 0 && (
                          <>
                            {' '}
                            · önceki katmanlardan modele göre fazla {trNum(l.dome.buildup, 3)} mm
                            {l.dome.clearance !== null && <> · etkin kafa boşluğu {trNum(l.dome.clearance, 2)} mm</>}
                          </>
                        )}
                      </div>
                    )}
                    {l.warnings.map((w) => (
                      <div key={w} className="text-warning">
                        {w}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            ) : (
              <div className="text-ink-3">G-code için tüm alanlar doldurulmalı.</div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
              <span className="text-ink-3">G-code</span>
              <button
                className={`${BTN} ml-auto`}
                title="Elyaf ve mandrel yüksüz eksen yönü / birim / besleme testi"
                onClick={saveDryRun}
              >
                <Download size={14} strokeWidth={1.5} /> Kuru test
              </button>
              <button
                disabled={!gcode}
                className={`${BTN} disabled:opacity-40`}
                onClick={() => navigator.clipboard.writeText(gcode)}
              >
                <Copy size={14} strokeWidth={1.5} /> Kopyala
              </button>
              <button
                disabled={!gcode}
                className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-on-accent disabled:opacity-40"
                onClick={save}
              >
                <Download size={14} strokeWidth={1.5} /> Kaydet
              </button>
            </div>
            <textarea
              readOnly
              className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-[12px]"
              value={gcode.length > 200_000 ? gcode.slice(0, 200_000) + '\n... (önizleme kısaltıldı, Kaydet tamamını yazar)' : gcode}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
