import { DEG, RAD } from './angles'
import type { Move, WindingInput, WindingPlan } from './types'

/**
 * REQ-008 ek (S8): ara katman (katman > 1) denemesi önceki katmanların sarılı olduğunu varsayar. Boş mandrelde
 * temas yarıçapı Δr = r − (D/2 + t) küçüktür. Program A ve X'i komut ettiği için aynı yolda gövde elyaf açısı
 * tan α' = (r'/r)·tan α olur (hoop: tan α' = 2πr'/adım); 4 eksende kafa boşluğu Δr büyür. Katman 1'de boş liste.
 * Not: MM'nin "≈ L·tanα·Δr/r² faz kayması" tahmini bu modelle çelişiyor (A komutlu; ADR-014, MM'ye soru).
 */
export function trialWarnings(plan: WindingPlan, input: WindingInput, layerIndex: number, axisCount: 3 | 4): string[] {
  const info = plan.layers[layerIndex]
  if (!info || layerIndex === 0) return []
  const rEmpty = input.mandrelDiameter! / 2 + input.bandThickness!
  const dr = info.radius - rEmpty
  const empty = Math.atan((rEmpty / info.radius) * Math.tan(info.angleDeg * RAD)) * DEG
  return [
    `Önceki ${layerIndex} katman sarılı varsayıldı (temas yarıçapı ${info.radius.toFixed(2)} mm). Boş mandrelde temas yarıçapı ${dr.toFixed(2)} mm küçük: aynı X/A ile gövde elyaf açısı ≈ ${empty.toFixed(2)}° olur (planlanan ${info.angleDeg.toFixed(2)}°)${axisCount === 4 ?`, kafa boşluğu ${dr.toFixed(2)} mm büyür` : ''}; deneme bu katmanı birebir temsil etmez, sonuç tam programa aktarılmamalı.`,
    'A sıfırı önceki sarımla aynı referansta kurulmalı (deneme A fazı tam programla aynı varsayılıyor).'
  ]
}

/**
 * REQ-008: seçilen katmanın ilk k devresinden bağımsız deneme planı. Tam planın aynı hareketleri (aynı F kuralı
 * generateGcode'da uygulanır); başlangıç = katmanın ilk geçişinden önceki konum (G0 + elyaf bağlama M0, REQ-001).
 * A, katman başındaki değerin 360°'nin katı kadar geri kaydırılır: mandrel açısı (faz) tam programla aynı kalır,
 * deneme başında mandrel onlarca tur boşa dönmez.
 * Devre: helisel/domlu katmanda gidiş + uç + dönüş + uç (iki dwell); hoop katmanında tek gidiş-dönüş (k = 1).
 * Hata mesajı Türkçe Error olarak atılır.
 */
export function trialPlan(plan: WindingPlan, input: WindingInput, layerIndex: number, k: number): WindingPlan {
  const info = plan.layers[layerIndex]
  if (!info) throw new Error(`Deneme: katman ${layerIndex + 1} yok`)
  if (!Number.isInteger(k) || k < 1) throw new Error('Deneme: devre sayısı k 1 veya daha büyük tam sayı olmalı')
  if (k > info.circuits) {
    throw new Error(`Deneme: katman ${layerIndex + 1}'de ${info.circuits} devre var, k=${k} fazla`)
  }
  const firstPass = plan.moves.findIndex((m) => m.layer === layerIndex && m.kind === 'pass')
  if (firstPass < 1) throw new Error(`Deneme: katman ${layerIndex + 1} hareketi bulunamadı`)
  const start = plan.moves[firstPass - 1]
  const body: Move[] = []
  let dwells = 0
  for (let i = firstPass; i < plan.moves.length; i++) {
    const m = plan.moves[i]
    if (m.layer !== layerIndex || m.kind === 'transition' || m.kind === 'position') break
    body.push(m)
    if (m.kind === 'dwell') dwells++
    if (info.kind === 'helical' && dwells === 2 * k) break
  }
  const offset = 360 * Math.floor(start.a / 360)
  const moves: Move[] = [
    { ...start, kind: 'position', a: start.a - offset, fiberLength: 0 },
    ...body.map((m) => ({ ...m, a: m.a - offset }))
  ]
  const totalFiberLength = body.reduce((s, m) => s + m.fiberLength, 0)
  return {
    ...plan,
    moves,
    totalFiberLength,
    totalMinutes: totalFiberLength / plan.feedRate,
    outerDiameter: 2 * (info.radius + input.bandThickness!),
    eyeClearance: info.eyeClearance
  }
}
