import type { Layer, MachineConfig, TravelLimit, WindingInput } from './types'

/**
 * Proje (reçete) dosyası: girdi + makine ayarı, JSON. Açılan dosya güvenilmez veridir: parseProject her alanı
 * tip ve aralık olarak doğrular, bilinmeyen alanları atar, sonlu olmayan sayıları reddeder. Eksik sayısal ölçü
 * null olur (gizli varsayılan yok; missingFields eksik diye bildirir).
 */
export const PROJECT_FORMAT = 'winding-planner-project'
export const PROJECT_VERSION = 1
/** Makul sınırlar: kötü niyetli/bozuk dosyada bellek ve arayüz kilitlenmesin */
export const MAX_PROJECT_BYTES = 1_000_000
export const MAX_LAYERS = 200
/** Ölçüler için üst sınır (mm, mm/dk, derece); bundan büyüğü yazım hatası veya kötü niyetli kabul edilir */
const MAX_VALUE = 1e7

export function serializeProject(input: WindingInput, machine: MachineConfig): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, input, machine }, null, 2)
}

export type ParseResult = { ok: true; input: WindingInput; machine: MachineConfig } | { ok: false; error: string }

class ProjectError extends Error {}

const fail = (path: string, msg: string): never => {
  throw new ProjectError(`${path}: ${msg}`)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) fail(path, 'nesne olmalı')
  return v as Record<string, unknown>
}

/** Kendi alanını oku (prototip zincirinden değil) */
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)

/** null/eksik → null; sayı ise sonlu ve [min, MAX_VALUE] aralığında */
function num(o: Record<string, unknown>, k: string, path: string, min: number, minExclusive: boolean): number | null {
  const v = own(o, k)
  if (v === undefined || v === null) return null
  if (typeof v !== 'number') return fail(`${path}.${k}`, 'sayı veya boş olmalı')
  if (!Number.isFinite(v)) return fail(`${path}.${k}`, 'sonlu sayı olmalı')
  if (minExclusive ? !(v > min) : !(v >= min)) return fail(`${path}.${k}`, `${minExclusive ? '>' : '≥'} ${min} olmalı`)
  if (v > MAX_VALUE) return fail(`${path}.${k}`, `en çok ${MAX_VALUE} olabilir`)
  return v
}

function bool(o: Record<string, unknown>, k: string, path: string): boolean {
  const v = own(o, k)
  if (typeof v !== 'boolean') return fail(`${path}.${k}`, 'doğru/yanlış (true/false) olmalı')
  return v as boolean
}

function oneOf<T extends string | number>(o: Record<string, unknown>, k: string, path: string, allowed: readonly T[]): T {
  const v = own(o, k)
  if (!allowed.includes(v as T)) return fail(`${path}.${k}`, `şunlardan biri olmalı: ${allowed.join(', ')}`)
  return v as T
}

function parseLayer(v: unknown, i: number, used: Set<string>): Layer {
  const path = `input.layers[${i}]`
  const o = obj(v, path)
  const kind = oneOf(o, 'kind', path, ['helical', 'hoop'] as const)
  const rawId = own(o, 'id')
  let id = typeof rawId === 'string' && /^[\w-]{1,64}$/.test(rawId) && !used.has(rawId) ? rawId : `katman-${i + 1}`
  while (used.has(id)) id += '-'
  used.add(id)
  const angleDeg = num(o, 'angleDeg', path, 0, true)
  if (angleDeg !== null && angleDeg > 90) fail(`${path}.angleDeg`, 'en çok 90° olabilir')
  const layer: Layer = { id, kind, angleDeg }
  const dome = own(o, 'dome')
  if (dome !== undefined) {
    if (typeof dome !== 'boolean') fail(`${path}.dome`, 'doğru/yanlış (true/false) olmalı')
    layer.dome = dome as boolean
  }
  if (own(o, 'domeHeight') !== undefined) layer.domeHeight = num(o, 'domeHeight', path, 0, true)
  if (own(o, 'patternSkip') !== undefined) {
    const j = num(o, 'patternSkip', path, 1, false)
    if (j !== null && !Number.isInteger(j)) fail(`${path}.patternSkip`, 'tam sayı olmalı')
    layer.patternSkip = j
  }
  return layer
}

function parseInput(v: unknown): WindingInput {
  const o = obj(v, 'input')
  const layersRaw = own(o, 'layers')
  if (!Array.isArray(layersRaw)) fail('input.layers', 'liste olmalı')
  const arr = layersRaw as unknown[]
  if (arr.length > MAX_LAYERS) fail('input.layers', `en çok ${MAX_LAYERS} katman olabilir (${arr.length} var)`)
  const used = new Set<string>()
  return {
    mandrelDiameter: num(o, 'mandrelDiameter', 'input', 0, true),
    windLength: num(o, 'windLength', 'input', 0, true),
    bandWidth: num(o, 'bandWidth', 'input', 0, true),
    bandThickness: num(o, 'bandThickness', 'input', 0, true),
    feedRate: num(o, 'feedRate', 'input', 0, true),
    turnDwellMinDeg: num(o, 'turnDwellMinDeg', 'input', 0, true),
    standoff: num(o, 'standoff', 'input', 0, false),
    // REQ-006: yoksa (eski dosya) alan eklenmez; boş = kayma kontrolü yok
    ...(own(o, 'friction') !== undefined ? { friction: num(o, 'friction', 'input', 0, true) } : {}),
    layers: arr.map((l, i) => parseLayer(l, i, used))
  }
}

const AXES = ['carriage', 'mandrel', 'head', 'cross'] as const

function parseTravel(v: unknown, path: string): TravelLimit {
  const o = obj(v, path)
  const read = (k: 'min' | 'max'): number | null => {
    const x = own(o, k)
    if (x === undefined || x === null) return null
    if (typeof x !== 'number' || !Number.isFinite(x)) return fail(`${path}.${k}`, 'sonlu sayı veya boş olmalı')
    if (Math.abs(x) > MAX_VALUE) return fail(`${path}.${k}`, `mutlak değeri en çok ${MAX_VALUE} olabilir`)
    return x as number
  }
  const t = { min: read('min'), max: read('max') }
  if (t.min !== null && t.max !== null && t.min > t.max) fail(path, 'alt sınır üst sınırdan büyük')
  return t
}

function parseMachine(v: unknown): MachineConfig {
  const o = obj(v, 'machine')
  const names = obj(own(o, 'names'), 'machine.names')
  const invert = obj(own(o, 'invert'), 'machine.invert')
  const axisCount = oneOf(o, 'axisCount', 'machine', [3, 4] as const)
  const m: MachineConfig = {
    controller: oneOf(o, 'controller', 'machine', ['linuxcnc', 'mach3'] as const),
    axisCount,
    names: { carriage: '', mandrel: '', head: '', cross: '' },
    invert: { carriage: false, mandrel: false, head: false, cross: false },
    feedMode: oneOf(o, 'feedMode', 'machine', ['G94', 'G93'] as const),
    zeroAxesAtStart: bool(o, 'zeroAxesAtStart', 'machine'),
    pauseBetweenLayers: bool(o, 'pauseBetweenLayers', 'machine')
  }
  for (const k of AXES) {
    const n = own(names, k)
    if (typeof n !== 'string' || !/^[A-Z]$/.test(n)) fail(`machine.names.${k}`, 'tek büyük harf (A–Z) olmalı')
    if (n === 'F' || n === 'G' || n === 'M' || n === 'N') fail(`machine.names.${k}`, `${n} G-code komut harfi, eksen adı olamaz`)
    m.names[k] = n as string
    m.invert[k] = bool(invert, k, 'machine.invert')
  }
  const active = axisCount === 4 ? AXES : AXES.slice(0, 3)
  if (new Set(active.map((k) => m.names[k])).size !== active.length) fail('machine.names', 'eksen adları birbirinden farklı olmalı')
  const ms = own(o, 'maxSpeed')
  if (ms !== undefined && ms !== null) {
    const so = obj(ms, 'machine.maxSpeed')
    m.maxSpeed = {
      carriage: num(so, 'carriage', 'machine.maxSpeed', 0, true),
      mandrel: num(so, 'mandrel', 'machine.maxSpeed', 0, true),
      head: num(so, 'head', 'machine.maxSpeed', 0, true),
      cross: num(so, 'cross', 'machine.maxSpeed', 0, true)
    }
  }
  // REQ-005: ivme limitleri (/s²); her alan > 0 veya boş
  const ma = own(o, 'maxAccel')
  if (ma !== undefined && ma !== null) {
    const ao = obj(ma, 'machine.maxAccel')
    m.maxAccel = {
      carriage: num(ao, 'carriage', 'machine.maxAccel', 0, true),
      mandrel: num(ao, 'mandrel', 'machine.maxAccel', 0, true),
      head: num(ao, 'head', 'machine.maxAccel', 0, true),
      cross: num(ao, 'cross', 'machine.maxAccel', 0, true)
    }
  }
  const tr = own(o, 'travel')
  if (tr !== undefined && tr !== null) {
    const to = obj(tr, 'machine.travel')
    m.travel = {}
    for (const k of ['carriage', 'cross'] as const) {
      const t = own(to, k)
      if (t !== undefined && t !== null) m.travel[k] = parseTravel(t, `machine.travel.${k}`)
    }
  }
  // REQ-003: yoksa (eski dosya) alan eklenmez → eski ±φ davranışı ve "seçilmemiş" uyarısı
  if (own(o, 'headAngleMode') !== undefined) m.headAngleMode = oneOf(o, 'headAngleMode', 'machine', ['fiber', 'mirror'] as const)
  // REQ-004: 3 eksen göz yarıçapı (mm), > 0; boş = hesap yok
  if (own(o, 'eyeRadius') !== undefined) m.eyeRadius = num(o, 'eyeRadius', 'machine', 0, true)
  return m
}

/** Proje metnini doğrular; hata mesajları Türkçe ve alan yolunu içerir. */
export function parseProject(text: string): ParseResult {
  try {
    if (typeof text !== 'string') fail('dosya', 'metin değil')
    if (text.length > MAX_PROJECT_BYTES) fail('dosya', `çok büyük (en çok ${MAX_PROJECT_BYTES} karakter)`)
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Dosya geçerli JSON değil' }
    }
    const o = obj(data, 'dosya')
    if (own(o, 'format') !== PROJECT_FORMAT) fail('format', `"${PROJECT_FORMAT}" bekleniyordu (bu bir Winding Planner proje dosyası değil)`)
    const version = own(o, 'version')
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) fail('version', 'pozitif tam sayı olmalı')
    if ((version as number) > PROJECT_VERSION) {
      fail('version', `dosya daha yeni bir sürümle kaydedilmiş (${version}); bu uygulama en çok ${PROJECT_VERSION} okur`)
    }
    return { ok: true, input: parseInput(own(o, 'input')), machine: parseMachine(own(o, 'machine')) }
  } catch (e) {
    if (e instanceof ProjectError) return { ok: false, error: `Proje dosyası geçersiz: ${e.message}` }
    return { ok: false, error: 'Proje dosyası okunamadı' }
  }
}
