import type { AxisKey } from './limits'
import type { MachineConfig } from './types'

export interface SimKit {
  ini: string
  hal: string
  readme: string
}

/** Simülasyonda limit girilmemiş eksenler için kullanılan DENEME değerleri (gerçek makine değil). */
const SIM_FALLBACK = {
  /** mm/dk ve °/dk */
  speed: { carriage: 60000, cross: 60000, mandrel: 360000, head: 360000 } as Record<AxisKey, number>,
  /** mm/sn² ve °/sn² */
  accel: { carriage: 1000, cross: 1000, mandrel: 3600, head: 3600 } as Record<AxisKey, number>,
  travel: { min: -2000, max: 2000 }
}

const LETTER_ORDER = 'XYZABCUVW'
const LINEAR: AxisKey[] = ['carriage', 'cross']

interface JointDef {
  key: AxisKey
  letter: string
  linear: boolean
  index: number
}

function joints(machine: MachineConfig): JointDef[] {
  const keys: AxisKey[] = machine.axisCount === 4 ? ['carriage', 'cross', 'mandrel', 'head'] : ['carriage', 'mandrel', 'head']
  return keys
    .map((key) => ({ key, letter: machine.names[key].toUpperCase(), linear: LINEAR.includes(key) }))
    .sort((p, q) => LETTER_ORDER.indexOf(p.letter) - LETTER_ORDER.indexOf(q.letter))
    .map((j, index) => ({ ...j, index }))
}

const num = (v: number): string => String(Number(v.toPrecision(10)))

/**
 * LinuxCNC (2.9 söz dizimi) donanımsız simülasyon yapılandırması: trivkins + her eklem için
 * "komut = geri besleme" döngüsü. Eksen sınırları ve azami hızlar makine ayarlarından gelir; girilmemişse
 * deneme değerleri kullanılır ve dosyada belirtilir. DİKKAT: bu dosyalar LinuxCNC kurulu olmayan bir ortamda
 * yazıldı ve çalıştırılmadı; hata verirse LinuxCNC'nin kendi sim/axis örneğini temel alın.
 */
export function generateSimKit(machine: MachineConfig): SimKit {
  const js = joints(machine)
  const letters = js.map((j) => j.letter)
  const coordsSpaced = letters.join(' ')
  const coordsJoined = letters.join('')
  const linearMaxPerSec = Math.max(
    ...js.filter((j) => j.linear).map((j) => (machine.maxSpeed?.[j.key] ?? SIM_FALLBACK.speed[j.key]) / 60)
  )
  const usedFallback: string[] = []

  const ini: string[] = []
  const push = (...l: string[]): void => {
    ini.push(...l)
  }
  push(
    '# winding-planner: LinuxCNC simulasyon yapilandirmasi (donanimsiz)',
    '# Bu dosya LinuxCNC kurulu olmayan ortamda uretildi, CALISTIRILMADI. Hata verirse',
    '# LinuxCNC ile gelen sim/axis ornegini temel alip KINS, TRAJ ve AXIS/JOINT bolumlerini buradan tasiyin.',
    '',
    '[EMC]',
    'MACHINE = winding-sim',
    'DEBUG = 0',
    '',
    '[DISPLAY]',
    'DISPLAY = axis',
    'CYCLE_TIME = 0.100',
    'POSITION_OFFSET = RELATIVE',
    'POSITION_FEEDBACK = ACTUAL',
    'MAX_FEED_OVERRIDE = 1.5',
    'INTRO_TIME = 0',
    'PROGRAM_PREFIX = ~/linuxcnc/nc_files',
    '',
    '[TASK]',
    'TASK = milltask',
    'CYCLE_TIME = 0.010',
    '',
    '[RS274NGC]',
    'PARAMETER_FILE = winding-sim.var',
    '',
    '[EMCMOT]',
    'EMCMOT = motmod',
    'COMM_TIMEOUT = 1.0',
    'SERVO_PERIOD = 1000000',
    '',
    '[HAL]',
    'HALFILE = winding-sim.hal',
    '',
    '[EMCIO]',
    'EMCIO = io',
    'CYCLE_TIME = 0.100',
    'TOOL_TABLE = winding-sim.tbl',
    '',
    '[KINS]',
    `KINEMATICS = trivkins coordinates=${coordsJoined}`,
    `JOINTS = ${js.length}`,
    '',
    '[TRAJ]',
    `COORDINATES = ${coordsSpaced}`,
    'LINEAR_UNITS = mm',
    'ANGULAR_UNITS = degree',
    'CYCLE_TIME = 0.010',
    `DEFAULT_LINEAR_VELOCITY = ${num(linearMaxPerSec / 4)}`,
    `MAX_LINEAR_VELOCITY = ${num(linearMaxPerSec)}`,
    'NO_FORCE_HOMING = 1',
    ''
  )

  for (const j of js) {
    const userSpeed = machine.maxSpeed?.[j.key]
    const speed = userSpeed !== null && userSpeed !== undefined && userSpeed > 0 ? userSpeed : SIM_FALLBACK.speed[j.key]
    if (!(userSpeed !== null && userSpeed !== undefined && userSpeed > 0)) usedFallback.push(`${j.letter} azami hiz`)
    const perSec = speed / 60
    const accel = SIM_FALLBACK.accel[j.key]
    usedFallback.push(`${j.letter} ivme`)

    // Dönel eksenler sınırsız: MIN/MAX_LIMIT yazılmaz (LinuxCNC -1e99/1e99 kullanır)
    let minLimit = ''
    let maxLimit = ''
    if (j.linear) {
      const t = (machine.travel as Partial<Record<AxisKey, { min: number | null; max: number | null }>> | undefined)?.[j.key]
      const mn = t?.min ?? null
      const mx = t?.max ?? null
      if (mn === null) usedFallback.push(`${j.letter} alt strok`)
      if (mx === null) usedFallback.push(`${j.letter} ust strok`)
      minLimit = `MIN_LIMIT = ${num(mn ?? SIM_FALLBACK.travel.min)}`
      maxLimit = `MAX_LIMIT = ${num(mx ?? SIM_FALLBACK.travel.max)}`
    }
    push(
      `[AXIS_${j.letter}]`,
      ...(j.linear ? [minLimit, maxLimit] : ['# donel eksen: sinirsiz (MIN/MAX_LIMIT yazilmadi)']),
      `MAX_VELOCITY = ${num(perSec)}`,
      `MAX_ACCELERATION = ${num(accel)}`,
      '',
      `[JOINT_${j.index}]`,
      `TYPE = ${j.linear ? 'LINEAR' : 'ANGULAR'}`,
      ...(j.linear ? [minLimit, maxLimit] : []),
      `MAX_VELOCITY = ${num(perSec)}`,
      `MAX_ACCELERATION = ${num(accel)}`,
      'HOME = 0',
      'HOME_SEARCH_VEL = 0',
      'HOME_LATCH_VEL = 0',
      'FERROR = 100',
      'MIN_FERROR = 100',
      ''
    )
  }

  const hal: string[] = [
    '# winding-planner: LinuxCNC simulasyon HAL (donanimsiz, komut = geri besleme dongusu)',
    '# CALISTIRILMADI: bkz. INI basligi.',
    'loadrt [KINS]KINEMATICS',
    'loadrt [EMCMOT]EMCMOT servo_period_nsec=[EMCMOT]SERVO_PERIOD num_joints=[KINS]JOINTS',
    'loadrt threads name1=servo-thread period1=[EMCMOT]SERVO_PERIOD',
    'addf motion-command-handler servo-thread',
    'addf motion-controller servo-thread',
    ''
  ]
  for (const j of js) {
    hal.push(`# eklem ${j.index}: ${j.letter} (${j.linear ? 'lineer' : 'donel'})`)
    hal.push(`net j${j.index}-pos joint.${j.index}.motor-pos-cmd => joint.${j.index}.motor-pos-fb`)
  }
  hal.push(
    '',
    'net estop-loop iocontrol.0.user-enable-out => iocontrol.0.emc-enable-in',
    'net tool-prep-loop iocontrol.0.tool-prepare => iocontrol.0.tool-prepared',
    'net tool-change-loop iocontrol.0.tool-change => iocontrol.0.tool-changed',
    '',
    'start',
    ''
  )

  const readme = [
    'LinuxCNC simulasyon kiti (winding-planner)',
    '==========================================',
    '',
    'Amac: donanim olmadan, uretilen G-code\'un gercek LinuxCNC planlayicisinda nasil davrandigini gormek.',
    'DURUM: Bu dosyalar LinuxCNC kurulu olmayan ortamda yazildi ve CALISTIRILMADI. Ilk denemede hata cikabilir;',
    'LinuxCNC ile gelen sim/axis ornegini temel alip KINS/TRAJ/AXIS/JOINT bolumlerini tasiyin.',
    '',
    'Kurulum (Linux veya LinuxCNC ISO / sanal makine):',
    '1. winding-sim.ini ve winding-sim.hal dosyalarini ~/linuxcnc/configs/winding-sim/ altina kopyalayin.',
    '2. Bos winding-sim.var ve winding-sim.tbl dosyalari olusturun (touch).',
    '3. `linuxcnc ~/linuxcnc/configs/winding-sim/winding-sim.ini` ile acin; E-stop ve Machine On.',
    '4. Programi yukleyip calistirin.',
    '',
    'Denenecek maddeler (arastirmadan):',
    '- A ekseni birikimli on binlerce derece donuyor mu (WRAPPED_ROTARY kapali, sinirsiz)?',
    '- G94 ile X+A birlikte: gercek sure, winding-planner suresine yakin mi? (kronometre veya Axis sure gostergesi)',
    '- G93 ile F=1/dak degeri: hareket 1 dakikada bitiyor mu? (kuru test programindaki 30 sn testi)',
    '- Dom segmentlerinde hiz dusuyor mu (ileri bakis kisiti)? halscope ile joint hizini izleyin.',
    '- Hiz sinirlari asilirsa LinuxCNC hareketi yavaslatir: planlanan sure ile gercek sure farkini olcun.',
    '',
    'SIM DEGERLERI (gercek makine degil, girilmemis alanlar icin deneme degeri):',
    ...(usedFallback.length > 0 ? usedFallback.map((u) => `- ${u}: simulasyon deneme degeri`) : ['- yok']),
    'Ivme degerleri her zaman deneme degeridir; kisa hareketlerde gercek sureyi etkiler.',
    ''
  ].join('\n')

  return { ini: ini.join('\n'), hal: hal.join('\n'), readme }
}
