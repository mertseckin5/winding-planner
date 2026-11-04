import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Layer, MachineConfig, WindingInput } from './core/types'

interface State {
  input: WindingInput
  machine: MachineConfig
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
        layers: []
      },
      machine: {
        controller: 'linuxcnc',
        axisCount: 3,
        names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'Y' },
        invert: { carriage: false, mandrel: false, head: false, cross: false },
        feedMode: 'G94',
        zeroAxesAtStart: true,
        pauseBetweenLayers: false
      },
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
