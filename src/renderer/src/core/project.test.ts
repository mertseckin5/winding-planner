import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { MAX_LAYERS, PROJECT_FORMAT, parseProject, serializeProject } from './project'
import { baseInput, machine3 } from './test-fixtures'
import type { MachineConfig, WindingInput } from './types'
import { missingFields, planWinding } from './winding'

const fullInput: WindingInput = {
  ...baseInput,
  layers: [
    { id: 'd', kind: 'helical', angleDeg: 45, dome: true, domeHeight: 40, patternSkip: 5 },
    { id: 'h', kind: 'hoop', angleDeg: null },
    { id: 'a', kind: 'helical', angleDeg: 30, patternSkip: null }
  ]
}
const fullMachine: MachineConfig = {
  ...machine3,
  controller: 'mach3',
  axisCount: 4,
  feedMode: 'G93',
  names: { carriage: 'X', mandrel: 'B', head: 'C', cross: 'Z' },
  invert: { carriage: true, mandrel: false, head: true, cross: false },
  pauseBetweenLayers: true,
  maxSpeed: { carriage: 6000, mandrel: null, head: 7200, cross: null },
  travel: { carriage: { min: -60, max: 600 }, cross: { min: null, max: 200 } }
}

/** Geçerli bir proje nesnesi; testler bozmak için değiştirir */
const good = (): Record<string, unknown> => JSON.parse(serializeProject(fullInput, fullMachine))
const err = (data: unknown): string => {
  const r = parseProject(typeof data === 'string' ? data : JSON.stringify(data))
  if (r.ok) throw new Error('reddedilmeliydi')
  return r.error
}

describe('proje dosyası: geri dönüş', () => {
  it('kaydet → aç: girdi ve makine aynı, G-code aynı', () => {
    const r = parseProject(serializeProject(fullInput, fullMachine))
    if (!r.ok) throw new Error(r.error)
    expect(r.input).toEqual(fullInput)
    expect(r.machine).toEqual(fullMachine)
    const g = (i: WindingInput, m: MachineConfig): string => generateGcode(planWinding(i, m.axisCount), i, m)
    expect(g(r.input, r.machine)).toBe(g(fullInput, fullMachine))
  })

  it('boş (null) ölçüler null kalır; gizli varsayılan doldurulmaz', () => {
    const empty: WindingInput = { mandrelDiameter: null, windLength: null, bandWidth: null, bandThickness: null, feedRate: null, turnDwellMinDeg: null, standoff: null, layers: [] }
    const r = parseProject(serializeProject(empty, machine3))
    if (!r.ok) throw new Error(r.error)
    expect(r.input).toEqual(empty)
    expect(r.machine).toEqual(machine3)
    expect(missingFields(r.input, 3).length).toBeGreaterThan(0)
  })

  it('eksik sayısal alan null olur (eski dosya), bilinmeyen alanlar atılır', () => {
    const d = good()
    const input = d.input as Record<string, unknown>
    delete input.standoff
    input.evil = '<script>'
    ;(input.layers as Record<string, unknown>[])[0].foo = 1
    ;(d.machine as Record<string, unknown>).postCommand = 'rm -rf'
    d.extra = { a: 1 }
    const r = parseProject(JSON.stringify(d))
    if (!r.ok) throw new Error(r.error)
    expect(r.input.standoff).toBeNull()
    expect('evil' in r.input).toBe(false)
    expect('foo' in r.input.layers[0]).toBe(false)
    expect('postCommand' in r.machine).toBe(false)
  })

  it('__proto__ alanı prototipi kirletmez', () => {
    const text = serializeProject(fullInput, fullMachine).replace('"input": {', '"input": {"__proto__": {"polluted": true}, ')
    const r = parseProject(text)
    expect(r.ok).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    if (r.ok) expect((r.input as unknown as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('geçersiz/yinelenen katman kimliği yeniden adlandırılır', () => {
    const d = good()
    const layers = (d.input as Record<string, unknown>).layers as Record<string, unknown>[]
    layers[1].id = layers[0].id
    layers[2].id = '<img src=x>'
    const r = parseProject(JSON.stringify(d))
    if (!r.ok) throw new Error(r.error)
    const ids = r.input.layers.map((l) => l.id)
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) expect(id).toMatch(/^[\w-]+$/)
  })
})

describe('proje dosyası: bozuk ve kötü niyetli girdiler reddedilir (Türkçe hata)', () => {
  const mutate = (fn: (d: Record<string, any>) => void): Record<string, unknown> => {
    const d = good() as Record<string, any>
    fn(d)
    return d
  }

  it('JSON değil / yanlış biçim / yeni sürüm / üst düzey liste', () => {
    expect(err('{bozuk')).toMatch(/geçerli JSON değil/)
    expect(err('')).toMatch(/JSON/)
    expect(err('[1,2]')).toMatch(/dosya: nesne olmalı/)
    expect(err('null')).toMatch(/nesne olmalı/)
    expect(err(mutate((d) => (d.format = 'baska')))).toMatch(new RegExp(PROJECT_FORMAT))
    expect(err(mutate((d) => (d.version = 99)))).toMatch(/daha yeni bir sürüm/)
    expect(err(mutate((d) => (d.version = '1')))).toMatch(/version/)
  })

  it('sonlu olmayan sayı (1e999 → Infinity), NaN metni, metin sayı, negatif ölçü, aşırı büyük', () => {
    const text = serializeProject(fullInput, fullMachine).replace('"mandrelDiameter": 50', '"mandrelDiameter": 1e999')
    expect(err(text)).toMatch(/mandrelDiameter: sonlu sayı/)
    expect(err(serializeProject(fullInput, fullMachine).replace('"windLength": 500', '"windLength": NaN'))).toMatch(/JSON/)
    expect(err(mutate((d) => (d.input.bandWidth = '6')))).toMatch(/bandWidth: sayı veya boş/)
    expect(err(mutate((d) => (d.input.mandrelDiameter = -50)))).toMatch(/mandrelDiameter: > 0/)
    expect(err(mutate((d) => (d.input.feedRate = 0)))).toMatch(/feedRate/)
    expect(err(mutate((d) => (d.input.windLength = 1e12)))).toMatch(/en çok/)
    expect(err(mutate((d) => (d.input.standoff = -1)))).toMatch(/standoff: ≥ 0/)
  })

  it('katman: sayı sınırı, tür, açı, j, dom', () => {
    expect(err(mutate((d) => (d.input.layers = Array.from({ length: MAX_LAYERS + 1 }, () => ({ kind: 'hoop', angleDeg: null })))))).toMatch(/en çok 200 katman/)
    expect(err(mutate((d) => (d.input.layers = 'abc')))).toMatch(/layers: liste/)
    expect(err(mutate((d) => (d.input.layers[0].kind = 'polar')))).toMatch(/layers\[0\]\.kind/)
    expect(err(mutate((d) => (d.input.layers[0].angleDeg = 120)))).toMatch(/90/)
    expect(err(mutate((d) => (d.input.layers[0].patternSkip = 1.5)))).toMatch(/patternSkip: tam sayı/)
    expect(err(mutate((d) => (d.input.layers[0].patternSkip = 0)))).toMatch(/patternSkip/)
    expect(err(mutate((d) => (d.input.layers[0].dome = 'yes')))).toMatch(/dome/)
    expect(err(mutate((d) => (d.input.layers[0].domeHeight = -3)))).toMatch(/domeHeight/)
    expect(err(mutate((d) => (d.input.layers[2] = null)))).toMatch(/layers\[2\]: nesne/)
  })

  it('makine: denetleyici, eksen sayısı, eksen adları, tersleme, hız ve strok', () => {
    expect(err(mutate((d) => (d.machine.controller = 'grbl')))).toMatch(/controller/)
    expect(err(mutate((d) => (d.machine.axisCount = 5)))).toMatch(/axisCount/)
    expect(err(mutate((d) => (d.machine.feedMode = 'G95')))).toMatch(/feedMode/)
    expect(err(mutate((d) => (d.machine.names.head = 'CC')))).toMatch(/names\.head/)
    expect(err(mutate((d) => (d.machine.names.head = 'x')))).toMatch(/names\.head/)
    expect(err(mutate((d) => (d.machine.names.head = 'F')))).toMatch(/komut harfi/)
    expect(err(mutate((d) => (d.machine.names.head = 'X')))).toMatch(/farklı olmalı/)
    expect(err(mutate((d) => (d.machine.invert.mandrel = 1)))).toMatch(/invert\.mandrel/)
    expect(err(mutate((d) => delete d.machine.pauseBetweenLayers))).toMatch(/pauseBetweenLayers/)
    expect(err(mutate((d) => (d.machine.maxSpeed.carriage = -5)))).toMatch(/maxSpeed\.carriage/)
    expect(err(mutate((d) => (d.machine.travel.carriage = { min: 10, max: 5 })))).toMatch(/alt sınır üst sınırdan büyük/)
    expect(err(mutate((d) => (d.machine = [])))).toMatch(/machine: nesne/)
  })

  it('aşırı büyük dosya ve derin iç içe yapı çökmeden reddedilir', () => {
    expect(err('{"a":"' + 'x'.repeat(1_100_000) + '"}')).toMatch(/çok büyük/)
    expect(err('['.repeat(200_000) + ']'.repeat(200_000))).toMatch(/büyük|JSON|nesne/)
  })
})
