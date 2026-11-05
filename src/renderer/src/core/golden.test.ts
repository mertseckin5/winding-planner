import { describe, expect, it } from 'vitest'
import { generateGcode } from './gcode'
import { GOLDEN_CASES } from './test-fixtures'
import { planWinding } from './winding'

/**
 * Altın çıktı: desen seçimi (j) ve hız limitine göre süre uzatma eklenmeden ÖNCEKİ kodun (2026-11-04, 255 test)
 * ürettiği G-code'un FNV-1a özeti ve uzunluğu. j yok/1 ve hız limiti girilmemişken çıktı bit bit aynı kalmalı
 * (tek bilinçli istisna aşağıda, G94 + dom F düzeltmesi).
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 2026-11-05 BİLEREK değişti (REQ-001 + REQ-003, docs/engineering/decisions.md ADR-005). Önceki özetler:
 * base 3e 2b6596b2/3760, base 4e ad8f6664/4334, mixed 3e 37ddbbd3/184406, mixed 4e G93 e503c298/221249,
 * mixed 4e G94 ters 1ebf599d/221328, big dc54ea8d/7893.
 * Fark (eski kodun çıktısıyla satır satır karşılaştırıldı): (1) başlıkta C sözleşmesi ve 4 eksende Y sıfırı
 * AYAR KONTROL satırları, (2) 4 eksende G92'de Y yok, (3) 4 eksende ilk G0 üç satıra bölündü (Y geri, X/A/C,
 * Y başlangıç), (4) ilk G1 öncesi elyaf bağlama mesajı + M0, (5) 'fiber' seçili durumlarda C sözcükleri ve
 * G94'te lineer bileşeni olmayan satırların F'i (regression: "REQ-003 altın fark" testi). X/A/Y ve süre aynı.
 *
 * 2026-11-05 tur 2 BİLEREK değişti (REQ-007, ADR-010): domlu katmana giren/çıkan geçişler dom geodeziğini izliyor.
 * Yalnız domlu katman içeren üç "mixed" örnek değişti; önceki özetler mixed 3e e6a4dec5/184389, mixed 4e G93
 * 1a50ddd3/221429, mixed 4e G94 ters d8c647fb/221725. Kanıt: mm-req2.test.ts "REQ-007 altın çıktı farkı" yeni
 * planın geçiş gruplarını eski tek-hareket kuralına indirip sonraki A'ları kaydırınca bu eski özetleri bit bit verir.
 *
 * 2026-11-05 tur 3 BİLEREK değişti (REQ-011, ADR-013): 'fiber'de düz → domlu geçişten önceki son dwell'de C
 * değişmiyor (30° düz → 20° domlu: dwell C 30 yerine 150). Yalnız iki 'fiber' "mixed" örnek değişti; önceki özetler
 * mixed 3e ed905760/186293, mixed 4e G93 2d616a0f/223715. Kanıt: mm-req3.test.ts "REQ-011 altın çıktı" dwell C'si
 * geri alınınca bu özetler bit bit çıkar; tek G1 satırında C farklı, X/A/Y ve G93 F (süre) aynı. 'mirror' değişmez.
 */
const GOLDEN: Record<string, [string, number]> = {
  'base 3e G94 lnx': ['31ffb043', 4019],
  'base 4e G93 mach3': ['2d1d0262', 4782],
  'mixed 3e G94 lnx': ['ef48a5af', 186292],
  'mixed 4e G93 lnx dur': ['cae0d8c5', 223716],
  'mixed 4e G94 mach3 ters': ['c95ef361', 223968],
  'big 3e G93 mach3': ['1c87568f', 8135]
}

describe('altın çıktı (j=1, hız limiti yok): bit bit aynı', () => {
  for (const c of GOLDEN_CASES) {
    it(c.name, () => {
      const g = generateGcode(planWinding(c.input, c.m), c.input, c.m)
      const got: [string, number] = [fnv1a(g), g.length]
      expect(got).toEqual(GOLDEN[c.name])
    })
  }
})
