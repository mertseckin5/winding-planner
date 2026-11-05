import { estimateMinutes, type AxisKey, type AxisSpeeds } from './limits'
import type { MachineConfig, TravelLimit, WindingPlan } from './types'

export type IssueLevel = 'error' | 'warning'

export interface Issue {
  level: IssueLevel
  /** 1 tabanlı satır; genel sorunlarda 0 */
  line: number
  message: string
}

export interface VerifyReport {
  issues: Issue[]
  /** G1 hareket sayısı */
  feedMoves: number
  /** G0 hareket sayısı (süreye dahil değil) */
  rapidMoves: number
  /** G1 hareketlerinin toplam süresi (dak), LinuxCNC besleme kurallarıyla */
  minutes: number
  /** Mantıksal (tersleme geri alınmış) eksen aralığı */
  range: Record<AxisKey, { min: number; max: number }>
  /** G-code'dan bağımsız hesaplanan tepe hızlar (X/Y mm/dk, A/C °/dk) */
  peak: AxisSpeeds
  /** Program sonu mantıksal konumu */
  finalPos: Record<AxisKey, number>
  /** G-code süresi / plan süresi (plan verildiyse) */
  planTimeRatio: number | null
  /** REQ-005 ivme raporu; hiçbir etkin eksende ivme limiti girilmemişse null */
  accel: AccelReport | null
}

/** Bir G1 sınırında (ardışık iki G1 arası veya duruş ↔ G1) bir eksenin hız sıçraması. Birimler saniye tabanlı. */
export interface AccelEvent {
  /** Sınırdan sonraki G1'in satırı (programın/duraklamanın sonundaysa son G1'in satırı) */
  line: number
  axis: AxisKey
  /** |v_sonraki − v_önceki| (mm/s veya °/s); duruş tarafı 0 */
  deltaV: number
  /** min(T_önceki, T_sonraki) (s); duruş tarafı sayılmaz */
  minT: number
  /** İstenen ivme |Δv| / min(T) (mm/s² veya °/s²) */
  demand: number
  /** Rampa süresi |Δv|/a > min(T): bu hızlara bu hareket içinde ulaşılamaz */
  unreachable: boolean
}

export interface AccelReport {
  /** Kullanılan ivme limitleri (yalnız girilmiş, etkin eksenler) */
  limits: Partial<Record<AxisKey, number>>
  /** Rapor (1): rampa süresi komşu hareketten uzun olan sınır sayısı ve ilk satırı */
  unreachable: number
  firstUnreachableLine: number | null
  /** Rapor (2): eksen başına tepe |Δv|/min(T) ve tepe |Δv| */
  peak: Partial<Record<AxisKey, { demand: number; demandLine: number; deltaV: number; deltaVLine: number }>>
  /** Rapor (2) ayrıntısı: Δv > 0 olan her sınır × ivmeli eksen */
  events: AccelEvent[]
  /** Rapor (3): her sınırda tam durma varsayımıyla süre üst sınırı (dak) = süre + Σ max_eksen (|v₁| + |v₂|)/(2a) */
  boundMinutes: number
  /** Ek bilgi: v²/(2a) > |Δ| olan G1 sayısı (tek hareket içinde bu hıza çıkılıp durulamaz) */
  shortMoves: number
}

/** Kullanıcının girdiği etkin eksen ivme limitleri (sonlu, pozitif); boş = o eksende kontrol yok. */
export function activeAccel(machine: MachineConfig): Partial<Record<AxisKey, number>> {
  const out: Partial<Record<AxisKey, number>> = {}
  const keys = machine.axisCount === 4 ? KEYS : KEYS.slice(0, 3)
  for (const k of keys) {
    const v = machine.maxAccel?.[k]
    if (v !== null && v !== undefined && Number.isFinite(v) && v > 0) out[k] = v
  }
  return out
}

const KEYS: AxisKey[] = ['carriage', 'mandrel', 'head', 'cross']
const KNOWN_G = new Set([0, 1, 17, 20, 21, 40, 49, 80, 90, 91, 92, 93, 94])
const KNOWN_M = new Set([0, 2, 30])
const EPS = 1e-9

function stripComments(line: string): string {
  return line.replace(/\([^)]*\)/g, ' ').replace(/;.*$/, '')
}

/**
 * Üretilen G-code'u plandan bağımsız okuyup yeniden simüle eder: modal durum (G90/G91, G92 ofseti,
 * G93/G94), her G1 için süre ve hız, eksen aralığı, biçim hataları. Plan verilirse süreyi karşılaştırır.
 * G0 (hızlı) hareketler süreye dahil edilmez; hızları kontrolcüye bağlı.
 */
export function verifyGcode(text: string, machine: MachineConfig, plan?: WindingPlan): VerifyReport {
  const issues: Issue[] = []
  const add = (level: IssueLevel, line: number, message: string): void => {
    issues.push({ level, line, message })
  }

  const active = machine.axisCount === 4 ? KEYS : KEYS.slice(0, 3)
  const letterToKey = new Map<string, AxisKey>()
  for (const k of active) letterToKey.set(machine.names[k].toUpperCase(), k)
  const sign = (k: AxisKey): number => (machine.invert[k] ? -1 : 1)

  // makine konumu, G92 ofseti (program = makine − ofset); mantıksal değerler raporlanır
  const mach: Record<AxisKey, number> = { carriage: 0, mandrel: 0, head: 0, cross: 0 }
  const offset: Record<AxisKey, number> = { carriage: 0, mandrel: 0, head: 0, cross: 0 }
  const range = Object.fromEntries(KEYS.map((k) => [k, { min: 0, max: 0 }])) as VerifyReport['range']
  const peak: AxisSpeeds = { carriage: 0, mandrel: 0, head: 0, cross: 0 }

  let motion: 0 | 1 | null = null
  let relative = false
  let inverseTime = false
  let feed: number | null = null
  let unitsOk = false
  let feedMoves = 0
  let rapidMoves = 0
  let minutes = 0
  let ended = false
  let combinedG94 = false

  // REQ-005: ivme. Her G1 sınırında eksen hızı sıçraması; ilk/son G1 ve M0/G0 çevresi duruş (komşu hız 0).
  const acc = activeAccel(machine)
  const accKeys = Object.keys(acc) as AxisKey[]
  const accOn = accKeys.length > 0
  type G1Rec = { line: number; T: number; v: Record<AxisKey, number> }
  let lastG1: G1Rec | null = null
  const events: AccelEvent[] = []
  const accPeak: AccelReport['peak'] = {}
  let unreachable = 0
  let firstUnreachableLine: number | null = null
  let extraSeconds = 0
  let shortMoves = 0
  const boundary = (p: G1Rec | null, n: G1Rec | null): void => {
    if (!accOn || (p === null && n === null)) return
    const line = (n ?? p)!.line
    const minT = Math.min(p?.T ?? Infinity, n?.T ?? Infinity)
    let worstExtra = 0
    let flagged = false
    for (const k of accKeys) {
      const a = acc[k]!
      const vp = p?.v[k] ?? 0
      const vn = n?.v[k] ?? 0
      worstExtra = Math.max(worstExtra, (Math.abs(vp) + Math.abs(vn)) / (2 * a))
      const deltaV = Math.abs(vn - vp)
      if (!(deltaV > EPS)) continue
      const demand = deltaV / minT
      const bad = deltaV / a > minT
      if (bad) flagged = true
      events.push({ line, axis: k, deltaV, minT, demand, unreachable: bad })
      const pk = accPeak[k]
      if (!pk) accPeak[k] = { demand, demandLine: line, deltaV, deltaVLine: line }
      else {
        if (demand > pk.demand) {
          pk.demand = demand
          pk.demandLine = line
        }
        if (deltaV > pk.deltaV) {
          pk.deltaV = deltaV
          pk.deltaVLine = line
        }
      }
    }
    extraSeconds += worstExtra
    if (flagged) {
      unreachable++
      if (firstUnreachableLine === null) firstUnreachableLine = line
    }
  }
  /** Duruş: M0/M1/M2/M30 veya G0 (önceki G1'den sonra eksenler durur) */
  const stop = (): void => {
    boundary(lastG1, null)
    lastG1 = null
  }

  const lines = text.split(/\r?\n/)
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) add('error', 0, 'G-code ASCII dışı karakter içeriyor (kontrolcüler hata verebilir)')

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1
    const code = stripComments(raw).trim()
    if (code === '') return
    if (ended) {
      add('warning', lineNo, 'Program sonu (M2/M30) sonrasında kod var')
      return
    }

    const words: { letter: string; value: number }[] = []
    for (const m of code.toUpperCase().matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/g)) {
      words.push({ letter: m[1], value: Number(m[2]) })
    }
    const stripped = code.toUpperCase().replace(/([A-Z])\s*([-+]?\d*\.?\d+)/g, '').trim()
    if (stripped !== '') add('error', lineNo, `Ayrıştırılamayan metin: "${stripped}"`)

    const target: Partial<Record<AxisKey, number>> = {}
    let setOffset = false
    let lineF: number | null = null

    for (const w of words) {
      if (w.letter === 'G') {
        if (!KNOWN_G.has(w.value)) add('warning', lineNo, `Bilinmeyen G${w.value}`)
        if (w.value === 0 || w.value === 1) motion = w.value
        else if (w.value === 20) unitsOk = false
        else if (w.value === 21) unitsOk = true
        else if (w.value === 90) relative = false
        else if (w.value === 91) relative = true
        else if (w.value === 92) setOffset = true
        else if (w.value === 93) inverseTime = true
        else if (w.value === 94) inverseTime = false
      } else if (w.letter === 'M') {
        if (!KNOWN_M.has(w.value)) add('warning', lineNo, `Bilinmeyen M${w.value}`)
        if (w.value === 2 || w.value === 30) ended = true
        stop()
      } else if (w.letter === 'F') {
        lineF = w.value
        if (!Number.isFinite(w.value) || w.value <= 0) add('error', lineNo, `Geçersiz besleme F${w.value}`)
        else feed = w.value
      } else {
        const key = letterToKey.get(w.letter)
        if (key === undefined) add('error', lineNo, `Tanımsız eksen ${w.letter} (makine ${[...letterToKey.keys()].join('/')} eksenlerini kullanıyor)`)
        else if (!Number.isFinite(w.value)) add('error', lineNo, `${w.letter} değeri sonlu değil`)
        else target[key] = w.value
      }
    }

    const keys = Object.keys(target) as AxisKey[]
    if (setOffset) {
      for (const k of keys) offset[k] = mach[k] - target[k]!
      return
    }
    if (keys.length === 0) return

    if (motion === null) {
      add('error', lineNo, 'Eksen hareketi var ama G0/G1 seçilmemiş')
      return
    }
    if (!unitsOk) add('error', lineNo, 'Birim G21 (mm) seçilmeden hareket')

    const delta: Record<AxisKey, number> = { carriage: 0, mandrel: 0, head: 0, cross: 0 }
    for (const k of keys) {
      const dest = relative ? mach[k] + target[k]! : target[k]! + offset[k]
      delta[k] = dest - mach[k]
      mach[k] = dest
    }

    for (const k of KEYS) {
      const logical = mach[k] * sign(k)
      if (logical < range[k].min) range[k].min = logical
      if (logical > range[k].max) range[k].max = logical
    }

    if (motion === 0) {
      stop()
      rapidMoves++
      if (feedMoves > 0) add('warning', lineNo, 'G1 sonrasında G0: elyaf bağlıyken hızlı hareket (elyaf gerilir/kopabilir)')
      return
    }

    feedMoves++
    if (inverseTime && lineF === null) add('error', lineNo, 'G93 modunda her G1 satırında F gerekir')
    if (feed === null) {
      add('error', lineNo, 'G1 hareketi için F tanımlı değil')
      return
    }
    const lin = Math.hypot(delta.carriage, delta.cross)
    const rot = Math.hypot(delta.mandrel, delta.head)
    if (!inverseTime && lin > EPS && rot > EPS) combinedG94 = true
    let t: number
    if (inverseTime) t = 1 / feed
    else if (lin > EPS) t = lin / feed
    else if (rot > EPS) t = rot / feed
    else return
    minutes += t
    for (const k of KEYS) peak[k] = Math.max(peak[k], Math.abs(delta[k]) / t)
    if (accOn) {
      const T = t * 60
      const v = Object.fromEntries(KEYS.map((k) => [k, delta[k] / T])) as Record<AxisKey, number>
      const rec: G1Rec = { line: lineNo, T, v }
      boundary(lastG1, rec)
      lastG1 = rec
      if (accKeys.some((k) => (v[k] * v[k]) / (2 * acc[k]!) > Math.abs(delta[k]) + EPS)) shortMoves++
    }
  })
  stop()

  if (!ended) add('warning', 0, 'Program M2/M30 ile bitmiyor')
  if (machine.controller === 'mach3' && combinedG94) {
    add('warning', 0, 'Mach3 + G94 birleşik hareket: süre LinuxCNC kuralıyla hesaplandı; Mach3 F yorumu farklı olabilir (G93 önerilir)')
  }
  if (inverseTime) add('warning', 0, 'Program G93 modunda bitiyor (G94 yazılmalı)')
  if (relative) add('warning', 0, 'Program G91 (artımlı) modunda bitiyor')

  // mach konumu → mantıksal
  const finalPos = Object.fromEntries(KEYS.map((k) => [k, mach[k] * sign(k)])) as Record<AxisKey, number>

  // strok limitleri (girilmişse)
  const travel = machine.travel
  if (travel) {
    for (const k of active) {
      const t = (travel as Partial<Record<AxisKey, TravelLimit>>)[k]
      if (!t) continue
      if (t.min !== null && range[k].min < t.min - 1e-6) {
        add('error', 0, `${machine.names[k]} ekseni alt strok limitini aşıyor: ${range[k].min.toFixed(2)} < ${t.min}`)
      }
      if (t.max !== null && range[k].max > t.max + 1e-6) {
        add('error', 0, `${machine.names[k]} ekseni üst strok limitini aşıyor: ${range[k].max.toFixed(2)} > ${t.max}`)
      }
    }
  }

  // hız limitleri (girilmişse)
  const ms = machine.maxSpeed
  if (ms) {
    for (const k of active) {
      const lim = ms[k]
      // 1e-9 göreli pay yalnız kayan nokta işlemleri için (yazılan F zaten limit altına yuvarlanır)
      if (lim !== null && lim > 0 && peak[k] > lim * (1 + 1e-9)) {
        add('warning', 0, `${machine.names[k]} tepe hızı ${Math.round(peak[k])} > limit ${lim}: elyaf hızı programlanandan düşer`)
      }
    }
  }

  let planTimeRatio: number | null = null
  if (plan) {
    // plan süresi gcode.ts ile aynı kural: hareket başına max(elyaf süresi, |Δeksen|/limit)
    const planMinutes = estimateMinutes(plan, machine)
    planTimeRatio = planMinutes > 0 ? minutes / planMinutes : null
    if (planTimeRatio !== null && Math.abs(planTimeRatio - 1) > 0.01) {
      add('error', 0, `G-code süresi plandan %${(Math.abs(planTimeRatio - 1) * 100).toFixed(1)} farklı (F yorumu/yuvarlama hatası olabilir)`)
    }
    const last = plan.moves[plan.moves.length - 1]
    if (last) {
      const expect: Record<AxisKey, number> = { carriage: last.x, mandrel: last.a, head: last.c, cross: last.y }
      for (const k of active) {
        if (Math.abs(finalPos[k] - expect[k]) > 0.01) {
          add('error', 0, `${machine.names[k]} son konumu plandan farklı: ${finalPos[k].toFixed(3)} ≠ ${expect[k].toFixed(3)}`)
        }
      }
    }
  }

  let accel: AccelReport | null = null
  if (accOn) {
    accel = { limits: acc, unreachable, firstUnreachableLine, peak: accPeak, events, boundMinutes: minutes + extraSeconds / 60, shortMoves }
    if (unreachable > 0) {
      add(
        'warning',
        firstUnreachableLine ?? 0,
        `İvme: ${unreachable} hareket sınırında hız sıçraması girilen ivmeyle komşu hareket içinde tamamlanamaz (kontrolcü yavaşlatır; süre üst sınırı ${accel.boundMinutes.toFixed(2)} dk)`
      )
    }
  }

  return { issues, feedMoves, rapidMoves, minutes, range, peak, finalPos, planTimeRatio, accel }
}
