import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-003: kalıcı (persist) veri açılınca C sözleşmesi davranışı. zustand persist makine nesnesini bütün olarak
 * geri yükler (sığ birleştirme): eski kayıtta headAngleMode yok → eski ±φ + arayüz uyarısı; yeni kurulumda 'fiber'.
 */
function fakeStorage(data: Record<string, string>): Storage {
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    },
    removeItem: (k) => {
      delete data[k]
    },
    clear: () => undefined,
    key: () => null,
    length: 0
  }
}

async function loadStore(data: Record<string, string>): Promise<typeof import('./store')> {
  vi.resetModules()
  // zustand persist varsayılanı window.localStorage
  vi.stubGlobal('window', { localStorage: fakeStorage(data) })
  return import('./store')
}

afterEach(() => vi.unstubAllGlobals())

describe('REQ-003 store: persist ile C sözleşmesi', () => {
  it('REQ-003 yeni kurulum (kayıt yok): fiber, göz yarıçapı boş', async () => {
    const { useStore } = await loadStore({})
    expect(useStore.getState().machine.headAngleMode).toBe('fiber')
    expect(useStore.getState().machine.eyeRadius).toBeNull()
  })

  it('REQ-003 eski persist kaydı (alan yok): sözleşme seçilmemiş kalır (eski ±φ), diğer ayarlar korunur', async () => {
    const old = {
      state: {
        input: { mandrelDiameter: 50, windLength: 400, bandWidth: 6, bandThickness: 0.25, feedRate: 3000, turnDwellMinDeg: 20, standoff: null, layers: [] },
        machine: {
          controller: 'mach3',
          axisCount: 3,
          names: { carriage: 'X', mandrel: 'A', head: 'C', cross: 'Y' },
          invert: { carriage: false, mandrel: false, head: false, cross: false },
          feedMode: 'G93',
          zeroAxesAtStart: true,
          pauseBetweenLayers: false
        }
      },
      version: 0
    }
    const { useStore } = await loadStore({ 'winding-planner-v1': JSON.stringify(old) })
    const m = useStore.getState().machine
    expect(m.controller).toBe('mach3')
    expect(m.headAngleMode).toBeUndefined()
    // kullanıcı seçince kalıcı olur
    useStore.getState().setMachine({ headAngleMode: 'fiber' })
    expect(useStore.getState().machine.headAngleMode).toBe('fiber')
    // REQ-005/006/008: eski kayıtta ivme ve μ yok (kontrol yok), deneme seçimi başlangıç değerinde
    expect(m.maxAccel).toBeUndefined()
    expect(useStore.getState().input.friction).toBeUndefined()
    expect(useStore.getState().trial).toEqual({ layer: null, circuits: null })
  })

  it('REQ-005/006/008 yeni kurulum: μ boş, ivme alanı yok, deneme seçimi boş (gizli varsayılan yok)', async () => {
    const { useStore } = await loadStore({})
    const s = useStore.getState()
    expect(s.input.friction).toBeNull()
    expect(s.machine.maxAccel).toBeUndefined()
    expect(s.trial).toEqual({ layer: null, circuits: null })
    s.setTrial({ layer: 2 })
    expect(useStore.getState().trial).toEqual({ layer: 2, circuits: null })
  })
})
