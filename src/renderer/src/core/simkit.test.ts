import { describe, expect, it } from 'vitest'
import { machine3 } from './test-fixtures'
import { generateSimKit } from './simkit'

const section = (ini: string, name: string): string => {
  const i = ini.indexOf(`[${name}]`)
  if (i < 0) return ''
  const rest = ini.slice(i + name.length + 2)
  const j = rest.search(/\n\[/)
  return j < 0 ? rest : rest.slice(0, j)
}

describe('LinuxCNC simülasyon kiti', () => {
  it('3 eksen: X A C, 3 eklem, trivkins coordinates=XAC', () => {
    const { ini } = generateSimKit(machine3)
    expect(ini).toMatch(/KINEMATICS = trivkins coordinates=XAC/)
    expect(ini).toMatch(/JOINTS = 3/)
    expect(ini).toMatch(/COORDINATES = X A C/)
    for (const l of ['X', 'A', 'C']) expect(ini).toContain(`[AXIS_${l}]`)
    expect(ini).not.toContain('[AXIS_Y]')
    expect(ini).not.toContain('[JOINT_3]')
  })

  it('4 eksen: X Y A C sıralı, eklem 0..3', () => {
    const { ini, hal } = generateSimKit({ ...machine3, axisCount: 4 })
    expect(ini).toMatch(/trivkins coordinates=XYAC/)
    expect(ini).toMatch(/JOINTS = 4/)
    expect(section(ini, 'JOINT_0')).toMatch(/TYPE = LINEAR/)
    expect(section(ini, 'JOINT_1')).toMatch(/TYPE = LINEAR/)
    expect(section(ini, 'JOINT_2')).toMatch(/TYPE = ANGULAR/)
    expect(section(ini, 'JOINT_3')).toMatch(/TYPE = ANGULAR/)
    for (let i = 0; i < 4; i++) expect(hal).toContain(`joint.${i}.motor-pos-cmd => joint.${i}.motor-pos-fb`)
  })

  it('eksen adları ve sıra değişince eklem tipleri doğru eşleşir', () => {
    const m = { ...machine3, names: { carriage: 'Z', mandrel: 'A', head: 'C', cross: 'Y' } }
    const { ini } = generateSimKit(m)
    expect(ini).toMatch(/trivkins coordinates=ZAC/)
    // eklem sırası A (0), C (1), Z (2)? standart sıra XYZABC: Z önce
    expect(section(ini, 'JOINT_0')).toMatch(/TYPE = LINEAR/)
    expect(section(ini, 'JOINT_1')).toMatch(/TYPE = ANGULAR/)
  })

  it('dönel eksenlerde MIN/MAX_LIMIT yazılmaz (sınırsız), lineer eksende yazılır', () => {
    const { ini } = generateSimKit(machine3)
    const assigned = /^(MIN|MAX)_LIMIT\s*=/m
    expect(section(ini, 'AXIS_A')).not.toMatch(assigned)
    expect(section(ini, 'AXIS_C')).not.toMatch(assigned)
    expect(section(ini, 'JOINT_1')).not.toMatch(assigned)
    expect(section(ini, 'AXIS_X')).toMatch(/^MIN_LIMIT = /m)
    expect(section(ini, 'AXIS_X')).toMatch(/^MAX_LIMIT = /m)
    expect(section(ini, 'JOINT_0')).toMatch(/^MAX_LIMIT = /m)
  })

  it('kullanıcının strok ve hız limitleri INI’ye geçer (hız /60)', () => {
    const m = {
      ...machine3,
      travel: { carriage: { min: -40, max: 560 } },
      maxSpeed: { carriage: 6000, mandrel: 7200, head: 3600, cross: null }
    }
    const { ini, readme } = generateSimKit(m)
    const x = section(ini, 'AXIS_X')
    expect(x).toMatch(/MIN_LIMIT = -40/)
    expect(x).toMatch(/MAX_LIMIT = 560/)
    expect(x).toMatch(/MAX_VELOCITY = 100\b/)
    expect(section(ini, 'AXIS_A')).toMatch(/MAX_VELOCITY = 120\b/)
    expect(section(ini, 'AXIS_C')).toMatch(/MAX_VELOCITY = 60\b/)
    // girilen değerler deneme değeri olarak listelenmez
    expect(readme).not.toMatch(/X azami hiz: simulasyon/)
    expect(readme).not.toMatch(/X alt strok: simulasyon/)
    expect(readme).toMatch(/X ivme: simulasyon/)
  })

  it('limit girilmemişse deneme değerleri README’de açıkça listelenir', () => {
    const { readme } = generateSimKit(machine3)
    expect(readme).toMatch(/X azami hiz: simulasyon deneme degeri/)
    expect(readme).toMatch(/X alt strok: simulasyon/)
    expect(readme).toMatch(/CALISTIRILMADI/)
  })

  it('HAL: thread, motion fonksiyonları, estop/tool döngüleri ve start var', () => {
    const { hal } = generateSimKit(machine3)
    for (const s of [
      'loadrt [KINS]KINEMATICS',
      'num_joints=[KINS]JOINTS',
      'addf motion-command-handler servo-thread',
      'addf motion-controller servo-thread',
      'iocontrol.0.user-enable-out => iocontrol.0.emc-enable-in',
      'iocontrol.0.tool-prepare => iocontrol.0.tool-prepared',
      'iocontrol.0.tool-change => iocontrol.0.tool-changed'
    ]) {
      expect(hal).toContain(s)
    }
    expect(hal.trim().endsWith('start')).toBe(true)
  })

  it('tüm dosyalar ASCII ve her eksen için hız/ivme tanımlı', () => {
    const k = generateSimKit({ ...machine3, axisCount: 4 })
    for (const t of [k.ini, k.hal, k.readme]) expect(/^[\x09\x0a\x20-\x7e]*$/.test(t)).toBe(true)
    for (const l of ['X', 'Y', 'A', 'C']) {
      expect(section(k.ini, `AXIS_${l}`)).toMatch(/MAX_VELOCITY = /)
      expect(section(k.ini, `AXIS_${l}`)).toMatch(/MAX_ACCELERATION = /)
    }
  })
})
