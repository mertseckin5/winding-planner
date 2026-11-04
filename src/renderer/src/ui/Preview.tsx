import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RAD } from '../core/angles'
import type { WindingPlan } from '../core/types'

const PALETTE = ['#84a6e0', '#e0b25c', '#7cbf86', '#f08a80', '#c39be0', '#6fcfd1']

/** Mandrel ekseni = sahnede X. Y-up. */
function buildGeometry(plan: WindingPlan): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const color = new THREE.Color()
  const moves = plan.moves
  let prev = moves[0]
  const add = (x: number, a: number, r: number, layer: number): void => {
    pos.push(x, r * Math.cos(a * RAD), r * Math.sin(a * RAD))
    color.set(PALETTE[layer % PALETTE.length])
    col.push(color.r, color.g, color.b)
  }
  add(prev.x, prev.a, prev.radius, prev.layer)
  for (let i = 1; i < moves.length; i++) {
    const m = moves[i]
    if (m.kind !== 'position') {
      const steps = m.kind === 'pass' ? Math.min(400, Math.max(8, Math.ceil(Math.abs(m.a - prev.a) / 6))) : 6
      for (let s = 1; s <= steps; s++) {
        const f = s / steps
        add(prev.x + (m.x - prev.x) * f, prev.a + (m.a - prev.a) * f, prev.radius + (m.radius - prev.radius) * f, m.layer)
      }
    } else {
      add(m.x, m.a, m.radius, m.layer)
    }
    prev = m
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

function Path({ plan, progress }: { plan: WindingPlan; progress: number }): React.JSX.Element {
  const line = useMemo(
    () => new THREE.Line(buildGeometry(plan), new THREE.LineBasicMaterial({ vertexColors: true })),
    [plan]
  )
  useEffect(() => {
    const total = line.geometry.getAttribute('position').count
    line.geometry.setDrawRange(0, Math.max(2, Math.floor(total * progress)))
  }, [line, progress])
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line]
  )
  return <primitive object={line} />
}

/** Mandrel silueti: silindir gövde, domlu katman varsa iki uçta yarım-elips dom (en yüksek dom yüksekliği). Eksen = Y, sahnede X'e yatırılır. */
function MandrelBody({ r, L, domeH }: { r: number; L: number; domeH: number }): React.JSX.Element {
  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = []
    const N = 24
    if (domeH > 0) {
      for (let j = 0; j <= N; j++) {
        const u = (Math.PI / 2) * (1 - j / N)
        pts.push(new THREE.Vector2(Math.max(r * Math.cos(u), 1e-4), -domeH * Math.sin(u)))
      }
    } else {
      pts.push(new THREE.Vector2(1e-4, 0))
    }
    pts.push(new THREE.Vector2(r, 0), new THREE.Vector2(r, L))
    if (domeH > 0) {
      for (let j = 0; j <= N; j++) {
        const u = (Math.PI / 2) * (j / N)
        pts.push(new THREE.Vector2(Math.max(r * Math.cos(u), 1e-4), L + domeH * Math.sin(u)))
      }
    } else {
      pts.push(new THREE.Vector2(1e-4, L))
    }
    return new THREE.LatheGeometry(pts, 64)
  }, [r, L, domeH])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo} rotation={[0, 0, -Math.PI / 2]}>
      <meshStandardMaterial color="#3a3f46" transparent opacity={0.45} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Ölçüler değişince kamerayı mandrele sığdırır (Canvas'ın ilk kamerası ölçüler boşken kurulur). */
function CameraRig({ length, radius, extra }: { length: number; radius: number; extra: number }): null {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    const size = Math.max(length + 2 * extra, radius * 2, 1)
    camera.position.set(length / 2, size * 0.8, size * 1.1)
    camera.far = size * 50
    camera.updateProjectionMatrix()
    if (controls) {
      controls.target.set(length / 2, 0, 0)
      controls.update()
    }
  }, [camera, controls, length, radius, extra])
  return null
}

export function Preview({
  plan,
  mandrelDiameter,
  length,
  progress
}: {
  plan: WindingPlan | null
  mandrelDiameter: number | null
  length: number | null
  progress: number
}): React.JSX.Element {
  const r = mandrelDiameter ? mandrelDiameter / 2 : 0
  const L = length ?? 0
  const domeH = plan ? Math.max(0, ...plan.layers.map((l) => l.dome?.height ?? 0)) : 0
  const size = Math.max(L + 2 * domeH, r * 2, 1)
  return (
    <Canvas camera={{ position: [L / 2, size * 0.9, size * 0.9], fov: 40, near: 0.1, far: size * 50 }}>
      <color attach="background" args={['#1e2125']} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[size, size, size]} intensity={1.5} />
      {r > 0 && L > 0 && (
        <MandrelBody r={r} L={L} domeH={domeH} />
      )}
      {plan && plan.moves.length > 1 && <Path plan={plan} progress={progress} />}
      <OrbitControls makeDefault />
      <CameraRig length={L} radius={r} extra={domeH} />
    </Canvas>
  )
}
