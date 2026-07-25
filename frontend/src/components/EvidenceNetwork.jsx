import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion.js'

const PALETTES = {
  light: {
    grid: 'rgba(45, 62, 184, 0.14)',
    line: 'rgba(39, 57, 190, 0.18)',
    trace: 'rgba(48, 75, 224, 0.42)',
    node: 'rgba(40, 61, 198, 0.38)',
    pulse: 'rgba(45, 78, 235, 0.95)',
    glow: 'rgba(85, 119, 255, 0.24)',
  },
  dark: {
    grid: 'rgba(183, 204, 255, 0.14)',
    line: 'rgba(83, 122, 238, 0.24)',
    trace: 'rgba(129, 164, 255, 0.48)',
    node: 'rgba(194, 213, 255, 0.48)',
    pulse: 'rgba(213, 226, 255, 0.98)',
    glow: 'rgba(84, 126, 255, 0.34)',
  },
}

const ROUTES = [
  [[0.03, 0.22], [0.31, 0.22], [0.31, 0.37], [0.72, 0.37], [0.72, 0.18], [0.97, 0.18]],
  [[0.08, 0.81], [0.24, 0.81], [0.24, 0.58], [0.58, 0.58], [0.58, 0.72], [0.94, 0.72]],
  [[0.18, 0.04], [0.18, 0.43], [0.45, 0.43], [0.45, 0.92]],
  [[0.03, 0.65], [0.39, 0.65], [0.39, 0.29], [0.84, 0.29], [0.84, 0.94]],
  [[0.57, 0.03], [0.57, 0.49], [0.76, 0.49], [0.76, 0.84], [0.98, 0.84]],
]

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function buildScene(width, height, density) {
  const spacing = density === 'sparse' ? 116 : 78
  const nodes = []

  for (let y = spacing / 2; y < height; y += spacing) {
    for (let x = spacing / 2; x < width; x += spacing) {
      const seed = Math.sin(x * 0.021 + y * 0.013)
      nodes.push({
        x: x + seed * 4,
        y: y + Math.cos(x * 0.011 - y * 0.017) * 4,
        phase: seed * Math.PI,
      })
    }
  }

  const routeIndexes = density === 'sparse' ? [0, 2, 4] : [0, 1, 2, 3, 4]
  const routes = routeIndexes.map((routeIndex, index) => ({
    points: ROUTES[routeIndex].map(([x, y]) => ({ x: x * width, y: y * height })),
    phase: index * 0.23 + 0.08,
    speed: 0.035 + index * 0.006,
    depth: (index % 3) - 1,
  }))

  return { nodes, routes }
}

function pointOnPath(points, progress) {
  let total = 0
  const lengths = []

  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    )
    lengths.push(length)
    total += length
  }

  let remaining = progress * total
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      const ratio = lengths[index] ? remaining / lengths[index] : 0
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      }
    }
    remaining -= lengths[index]
  }

  return points[points.length - 1]
}

export default function EvidenceNetwork({
  className = '',
  theme = 'light',
  density = 'normal',
  interactive = true,
}) {
  const canvasRef = useRef(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const context = canvas?.getContext('2d')
    if (!canvas || !parent || !context) return undefined

    const palette = PALETTES[theme] || PALETTES.light
    const pointer = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      influence: 0,
      targetInfluence: 0,
    }

    let width = 1
    let height = 1
    let scene = { nodes: [], routes: [] }
    let raf = 0
    let lastFrame = 0
    let elapsed = 0
    let scroll = 0
    let scrollTarget = 0
    let inViewport = true
    let pageVisible = !document.hidden

    const project = (point, depth = 0) => {
      let x = point.x
      let y = point.y + scroll * depth * 8

      if (pointer.influence > 0.01) {
        const dx = x - pointer.x
        const dy = y - pointer.y
        const distance = Math.hypot(dx, dy) || 1
        const reach = 180
        if (distance < reach) {
          const force = ((reach - distance) / reach) ** 2 * pointer.influence * 7
          x += (dx / distance) * force
          y += (dy / distance) * force
        }
      }

      return { x, y }
    }

    const drawPulse = (point) => {
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 13)
      glow.addColorStop(0, palette.glow)
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      context.fillStyle = glow
      context.beginPath()
      context.arc(point.x, point.y, 13, 0, Math.PI * 2)
      context.fill()

      context.fillStyle = palette.pulse
      context.beginPath()
      context.arc(point.x, point.y, 2.4, 0, Math.PI * 2)
      context.fill()
    }

    const drawFrame = (animated) => {
      context.clearRect(0, 0, width, height)

      if (animated) {
        pointer.x += (pointer.targetX - pointer.x) * 0.08
        pointer.y += (pointer.targetY - pointer.y) * 0.08
        pointer.influence += (pointer.targetInfluence - pointer.influence) * 0.08
        scroll += (scrollTarget - scroll) * 0.06
      }

      context.fillStyle = palette.grid
      for (const node of scene.nodes) {
        const point = project(node, Math.sin(node.phase) * 0.35)
        const pulse = animated ? Math.sin(elapsed * 0.7 + node.phase) * 0.18 : 0
        context.globalAlpha = 0.78 + pulse
        context.beginPath()
        context.arc(point.x, point.y, 1, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1

      for (let routeIndex = 0; routeIndex < scene.routes.length; routeIndex += 1) {
        const route = scene.routes[routeIndex]
        const points = route.points.map((point) => project(point, route.depth))

        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.strokeStyle = palette.line
        context.lineWidth = 1
        context.setLineDash([])
        context.beginPath()
        context.moveTo(points[0].x, points[0].y)
        for (let index = 1; index < points.length; index += 1) {
          context.lineTo(points[index].x, points[index].y)
        }
        context.stroke()

        context.strokeStyle = palette.trace
        context.lineWidth = 1
        context.setLineDash([2, 10])
        context.lineDashOffset = animated ? -(elapsed * (3 + routeIndex)) : -routeIndex * 3
        context.stroke()
        context.setLineDash([])

        context.fillStyle = palette.node
        for (const point of points) {
          context.beginPath()
          context.arc(point.x, point.y, 2.2, 0, Math.PI * 2)
          context.fill()
        }

        const progress = animated
          ? (route.phase + elapsed * route.speed) % 1
          : route.phase % 1
        drawPulse(pointOnPath(points, progress))
      }
    }

    const schedule = () => {
      if (!raf && !reducedMotion && inViewport && pageVisible) {
        raf = requestAnimationFrame(animate)
      }
    }

    const animate = (now) => {
      raf = 0
      if (!inViewport || !pageVisible || reducedMotion) return
      if (lastFrame) elapsed += Math.min(now - lastFrame, 32) / 1000
      lastFrame = now
      drawFrame(true)
      schedule()
    }

    const resize = () => {
      width = Math.max(1, parent.clientWidth)
      height = Math.max(1, parent.clientHeight)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      scene = buildScene(width, height, density)
      pointer.x = pointer.targetX || width / 2
      pointer.y = pointer.targetY || height / 2
      drawFrame(false)
    }

    const updateScroll = () => {
      const rect = parent.getBoundingClientRect()
      const viewportHeight = window.innerHeight || 1
      scrollTarget = clamp(
        (viewportHeight / 2 - (rect.top + rect.height / 2)) / viewportHeight,
        -1,
        1,
      )
      schedule()
    }

    const handlePointerMove = (event) => {
      const rect = parent.getBoundingClientRect()
      pointer.targetX = event.clientX - rect.left
      pointer.targetY = event.clientY - rect.top
      pointer.targetInfluence = 1
    }

    const handlePointerLeave = () => {
      pointer.targetInfluence = 0
    }

    const handleVisibility = () => {
      pageVisible = !document.hidden
      lastFrame = 0
      if (pageVisible) schedule()
      else if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const resizeObserver = new ResizeObserver(resize)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry?.isIntersecting ?? true
      lastFrame = 0
      if (inViewport) {
        if (reducedMotion) drawFrame(false)
        else schedule()
      } else if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    })

    resizeObserver.observe(parent)
    intersectionObserver.observe(canvas)
    window.addEventListener('scroll', updateScroll, { passive: true })
    document.addEventListener('visibilitychange', handleVisibility)
    if (interactive && !reducedMotion) {
      parent.addEventListener('pointermove', handlePointerMove, { passive: true })
      parent.addEventListener('pointerleave', handlePointerLeave)
    }

    resize()
    updateScroll()
    if (!reducedMotion) schedule()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      window.removeEventListener('scroll', updateScroll)
      document.removeEventListener('visibilitychange', handleVisibility)
      parent.removeEventListener('pointermove', handlePointerMove)
      parent.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [density, interactive, reducedMotion, theme])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  )
}
