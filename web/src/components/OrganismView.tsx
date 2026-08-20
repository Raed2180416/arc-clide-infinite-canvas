import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { AtlasNode, Overview } from '../types'

const COLORS: Record<string, number> = { repository: 0xc084fc, organ: 0x54d6e6, file: 0x64a8ff }

export function OrganismView({ overview, selectedId, onSelect }: { overview: Overview; selectedId: string | null; onSelect: (id: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const focusNodes = useMemo(() => overview.nodes.filter(node => node.kind !== 'file' || node.primaryOrganId), [overview])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !('WebGL2RenderingContext' in window)) return
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x070b12, 0.025)
    const camera = new THREE.PerspectiveCamera(48, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 500)
    camera.position.set(0, 18, 46)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.prepend(renderer.domElement)
    const positions = new Float32Array(focusNodes.length * 3)
    const colors = new Float32Array(focusNodes.length * 3)
    focusNodes.forEach((node, index) => {
      positions.set([node.position.x, node.position.y, node.position.z], index * 3)
      const color = new THREE.Color(node.id === selectedId ? 0xf4f7fb : COLORS[node.kind])
      colors.set([color.r, color.g, color.b], index * 3)
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.72, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true }))
    scene.add(points)
    const nodeById = new Map(overview.nodes.map((node, index) => [node.id, index]))
    const linePositions: number[] = []
    overview.edges.forEach(edge => {
      const source = overview.nodes[nodeById.get(edge.source) ?? -1]
      const target = overview.nodes[nodeById.get(edge.target) ?? -1]
      if (!source || !target) return
      linePositions.push(source.position.x, source.position.y, source.position.z, target.position.x, target.position.y, target.position.z)
    })
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    scene.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0x29415e, transparent: true, opacity: 0.22 })))
    let frame = 0
    const render = () => {
      points.rotation.y += window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.00045
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    render()
    const resize = new ResizeObserver(() => {
      camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(host.clientWidth, host.clientHeight)
    })
    resize.observe(host)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      renderer.dispose()
      geometry.dispose()
      lineGeometry.dispose()
      renderer.domElement.remove()
    }
  }, [focusNodes, overview, selectedId])

  const organs = overview.nodes.filter(node => node.kind === 'organ')
  return (
    <div className="visual-panel organism-panel" aria-label="3D organism orientation" ref={hostRef}>
      <div className="panel-caption"><div><span className="eyebrow">Orientation surface</span><h3>3D organism</h3></div><span>{overview.denominators.organs} organs · {overview.denominators.files.toLocaleString()} files</span></div>
      <div className="webgl-fallback" aria-hidden="true"><div className="fallback-glow" /></div>
      <div className="organ-access-list" aria-label="System organs">
        {organs.map((node: AtlasNode) => <button aria-pressed={selectedId === node.id} key={node.id} onClick={() => onSelect(node.id)} type="button"><span />{node.label}</button>)}
      </div>
    </div>
  )
}
