import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Layer, MachineConfig, WindingInput } from './core/types'

/** REQ-008 deneme programı seçimi (katman indisi 0 tabanlı, devre sayısı k); null = seçilmedi, üretilmez */
export interface TrialSelection {
  layer: number | null
  circuits: number | null
}

interface State {
  input: WindingInput
  machine: MachineConfig
  /** Proje dosyasına yazılmaz (reçete değil, tek seferlik işlem seçimi; ADR-011) */
  trial: TrialSelection
  setTrial: (patch: Partial<TrialSelection>) => void
  setInput: (patch: Partial<WindingInput>) => void
  setMachine: (patch: Partial<MachineConfig>) => void
  addLayer: (kind: Layer['kind']) => void
  updateLayer: (id: string, patch: Partial<Layer>) => void
  removeLayer: (id: string) => void
  /** Proje dosyasından: girdi ve makineyi tamamen değiştirir (birleştirmez; eski hız/strok değerleri kalmaz) */
  loadProject: (input: WindingInput, machine: MachineConfig) => void
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      input: {
        mandrelDiameter: null,
        windLength: null,
        bandWidth: null,
        bandThickness: null,
        feedRate: null,
        turnDwellMinDeg: null,
        standoff: null,
        // REQ-006: boş = kayma kontrolü yok (gizli varsayılan yok)
        friction: null,
        layers: []
      },
      machine: {
        controller: 'linuxcnc',
        axisCount: 3,
        names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'Y' },
        invert: { carriage: false, mandrel: false, head: false, cross: false },
        feedMode: 'G94',
        zeroAxesAtStart: true,
        pauseBetweenLayers: false,
        // REQ-003 / ADR-003: yeni projede bükülmesiz sözleşme. Eski persist verisinde makine nesnesi bütün olarak
        // geri yüklenir (sığ birleştirme) → alan yok kalır → eski ±φ davranışı + arayüz uyarısı.
        headAngleMode: 'fiber',
        eyeRadius: null
        // REQ-005 maxAccel: alan yok = hiçbir eksende ivme limiti girilmedi (maxSpeed ile aynı)
      },
      trial: { layer: null, circuits: null },
      setTrial: (patch) => set((s) => ({ trial: { ...s.trial, ...patch } })),
      setInput: (patch) => set((s) => ({ input: { ...s.input, ...patch } })),
      setMachine: (patch) => set((s) => ({ machine: { ...s.machine, ...patch } })),
      addLayer: (kind) =>
        set((s) => ({
          input: {
            ...s.input,
            layers: [...s.input.layers, { id: crypto.randomUUID(), kind, angleDeg: null }]
          }
        })),
      updateLayer: (id, patch) =>
        set((s) => ({
          input: {
            ...s.input,
            layers: s.input.layers.map((l) => (l.id === id ? { ...l, ...patch } : l))
          }
        })),
      removeLayer: (id) =>
        set((s) => ({ input: { ...s.input, layers: s.input.layers.filter((l) => l.id !== id) } })),
      loadProject: (input, machine) => set({ input, machine })
    }),
    { name: 'winding-planner-v1' }
  )
)
