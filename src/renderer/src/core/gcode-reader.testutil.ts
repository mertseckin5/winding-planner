import { expect } from 'vitest'
import type { MachineConfig } from './types'

/**
 * Testler için bağımsız G-code okuyucu (plana ve verify.ts'e bakmaz). Eksen harfleri makine adlarından,
 * tersleme ve G92 sıfırlaması dahil; yalnız G90 (mutlak) program bekler.
 */
export type Axis = 'x' | 'a' | 'c' | 'y'

export interface Row {
  /** 1 tabanlı satır no */
  line: number
  code: 'G0' | 'G1' | 'M0' | 'M1' | 'other'
  /** Mantıksal (tersleme geri alınmış) konum, satırdan sonra */
  pos: Record<Axis, number>
  /** Satırdaki F (yoksa null) */
  f: number | null
  layer: number
  layerKind: string
  /** G93 modunda mı */
  inverse: boolean
}

/**
 * G0/G1 satırları, baştaki konumlama G0'ları tek satıra indirgenmiş (sonuncusu = tam başlangıç konumu).
 * REQ-001 ile 4 eksende ilk konumlama üç G0'dır; plan hareketleriyle (tek 'position') birebir eşleme için.
 */
export function motionRows(rows: Row[]): Row[] {
  const motion = rows.filter((r) => r.code === 'G0' || r.code === 'G1')
  const firstG1 = motion.findIndex((r) => r.code === 'G1')
  return firstG1 > 0 ? motion.slice(firstG1 - 1) : motion
}

export interface StationaryRun {
  /** Aralıktaki G1 satırları (ΔX = 0) */
  rows: Row[]
  /** Aralık başı konumu (önceki G1 satırı) */
  before: Row
  /** Önceki ve sonraki ΔX ≠ 0 G1'in ΔX işareti (carriage yönü) */
  dirIn: number
  dirOut: number
  /** Başlangıç dahil C dizisi */
  c: number[]
  /** Toplam ΔA (derece) */
  turn: number
}

/**
 * Durağan aralıklar (REQ-010/011 tanımı), yalnız G-code'dan: ardışık iki ΔX ≠ 0 G1 arasındaki ΔX = 0 G1 dizileri.
 * ΔX yazılan 3 ondalıktan; |ΔX| < 5e-4 → 0. İlk G1'den önceki konum (G0) ΔX ≠ 0 hareketi sayılmaz.
 */
export function stationaryRuns(rows: Row[]): StationaryRun[] {
  const mr = motionRows(rows)
  const out: StationaryRun[] = []
  const dx = (k: number): number => mr[k].pos.x - mr[k - 1].pos.x
  const moving = (k: number): boolean => k >= 1 && mr[k].code === 'G1' && Math.abs(dx(k)) >= 5e-4
  let k = 1
  while (k < mr.length) {
    if (moving(k) || mr[k].code !== 'G1') {
      k++
      continue
    }
    const first = k
    while (k < mr.length && mr[k].code === 'G1' && !moving(k)) k++
    if (!moving(first - 1) || k >= mr.length || !moving(k)) continue
    const run = mr.slice(first, k)
    out.push({
      rows: run,
      before: mr[first - 1],
      dirIn: Math.sign(dx(first - 1)),
      dirOut: Math.sign(dx(k)),
      c: [mr[first - 1].pos.c, ...run.map((r) => r.pos.c)],
      turn: run[run.length - 1].pos.a - mr[first - 1].pos.a
    })
  }
  return out
}

export function readGcode(gcode: string, m: MachineConfig): Row[] {
  const letter: Record<Axis, string> = { x: m.names.carriage, a: m.names.mandrel, c: m.names.head, y: m.names.cross }
  const sign: Record<Axis, number> = {
    x: m.invert.carriage ? -1 : 1,
    a: m.invert.mandrel ? -1 : 1,
    c: m.invert.head ? -1 : 1,
    y: m.invert.cross ? -1 : 1
  }
  const pos: Record<Axis, number> = { x: 0, a: 0, c: 0, y: 0 }
  const rows: Row[] = []
  let layer = -1
  let layerKind = ''
  let inverse = false
  gcode.split('\n').forEach((raw, i) => {
    const lm = /^\(Katman (\d+): (\w+)/.exec(raw)
    if (lm) {
      layer = Number(lm[1]) - 1
      layerKind = lm[2]
    }
    const code = raw.replace(/\([^)]*\)/g, '').trim().toUpperCase()
    if (code === '') return
    if (/G91/.test(code)) throw new Error(`G91 beklenmiyor (satır ${i + 1})`)
    const tok = code.split(/\s+/)
    if (tok.includes('G93')) inverse = true
    if (tok.includes('G94')) inverse = false
    let kind: Row['code'] = 'other'
    if (tok.includes('G0')) kind = 'G0'
    else if (tok.includes('G1')) kind = 'G1'
    else if (tok.some((t) => /^M0*1$/.test(t))) kind = 'M1'
    else if (tok.some((t) => /^M0*0$/.test(t))) kind = 'M0'
    const g92 = tok.includes('G92')
    for (const ax of ['x', 'a', 'c', 'y'] as Axis[]) {
      const w = tok.find((t) => t[0] === letter[ax] && /^-?[\d.]+$/.test(t.slice(1)))
      if (w === undefined) continue
      const v = Number(w.slice(1)) * sign[ax]
      if (g92) {
        if (v !== 0) throw new Error(`G92 sıfır dışı (satır ${i + 1})`)
      } else pos[ax] = v
    }
    const fw = tok.find((t) => /^F[\d.]+$/.test(t))
    rows.push({ line: i + 1, code: kind, pos: { ...pos }, f: fw ? Number(fw.slice(1)) : null, layer, layerKind, inverse })
  })
  return rows
}

/** REQ-011 kuralı (G-code'dan): C monoton; yön değişiyorsa (C₁ − 90)(C₂ − 90) ≤ 0, değişmiyorsa ≥ 0 */
export function checkReq011(list: StationaryRun[]): number {
  let n = 0
  for (const run of list) {
    let up = false
    let down = false
    for (let k = 1; k < run.c.length; k++) {
      if (run.c[k] > run.c[k - 1] + 2e-3) up = true
      if (run.c[k] < run.c[k - 1] - 2e-3) down = true
    }
    expect(up && down, `satır ${run.rows[0].line}: C ${run.c.join(' → ')} monoton değil`).toBe(false)
    const p = (run.c[0] - 90) * (run.c[run.c.length - 1] - 90)
    if (run.dirIn !== run.dirOut) expect(p, `satır ${run.rows[0].line}: yön değişiyor, C 90°'yi geçmeli`).toBeLessThanOrEqual(1e-3)
    else expect(p, `satır ${run.rows[0].line}: yön aynı, C 90°'yi geçmemeli`).toBeGreaterThanOrEqual(-1e-3)
    n++
  }
  return n
}
