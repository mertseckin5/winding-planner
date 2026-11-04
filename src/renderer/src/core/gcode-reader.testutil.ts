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
