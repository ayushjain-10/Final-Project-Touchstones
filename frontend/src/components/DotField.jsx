import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion.js'

// Interactive dot grid for the hero background. Real dots on a canvas that get
// pushed away from the cursor and "pop" (scale + brighten) as it passes over —
// a cheap parallax/3D feel. Sits behind content, pointer-events:none, so it
// never intercepts clicks. No-ops under prefers-reduced-motion: it paints one
// static grid (matching the old bg-grain look) and skips the animation loop.
//
// Tunables:
const SPACING = 18 // px between dots (finer, closer to the old grain)
const DOT_RADIUS = 1 // base dot size (small, like the original speckle)
const RADIUS = 120 // cursor influence radius (px)
const PUSH = 12 // max px a dot is shoved outward (subtle)
const EASE = 0.12 // return-spring stiffness (0..1)
const BASE = 'rgba(34, 30, 24, 0.16)' // resting speck (warm ink, matches bg-grain palette)
const HOT = 'rgba(158, 53, 40, 0.85)' // popped speck (clay/terracotta)

export default function DotField({ className = '' }) {
  const reduced = useReducedMotion()
  const canvasRef = useRef(null)
  const mouse = useRef({ x: -9999, y: -9999, active: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const parent = canvas.parentElement
    let dots = []
    let raf = 0
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    const build = () => {
      const w = parent.clientWidth
      const h = parent.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dots = []
      // Inset the grid a touch so edge dots aren't clipped.
      for (let y = SPACING / 2; y < h; y += SPACING) {
        for (let x = SPACING / 2; x < w; x += SPACING) {
          dots.push({ ox: x, oy: y, x, y, scale: 1, glow: 0 })
        }
      }
    }

    const paintStatic = () => {
      const w = parent.clientWidth
      const h = parent.clientHeight
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = BASE
      for (const d of dots) {
        ctx.beginPath()
        ctx.arc(d.ox, d.oy, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const draw = () => {
      const w = parent.clientWidth
      const h = parent.clientHeight
      ctx.clearRect(0, 0, w, h)
      const { x: mx, y: my, active } = mouse.current

      for (const d of dots) {
        let tx = d.ox
        let ty = d.oy
        let targetScale = 1
        let targetGlow = 0

        if (active) {
          const dx = d.ox - mx
          const dy = d.oy - my
          const dist = Math.hypot(dx, dy)
          if (dist < RADIUS) {
            const f = 1 - dist / RADIUS // 1 at cursor, 0 at edge
            const falloff = f * f // sharper near the center
            const ang = Math.atan2(dy, dx)
            tx = d.ox + Math.cos(ang) * PUSH * falloff
            ty = d.oy + Math.sin(ang) * PUSH * falloff
            targetScale = 1 + falloff * 0.9 // gentle "pop" — a little lift, not a bloom
            targetGlow = falloff
          }
        }

        // Spring toward targets for smooth motion + return.
        d.x += (tx - d.x) * EASE
        d.y += (ty - d.y) * EASE
        d.scale += (targetScale - d.scale) * EASE
        d.glow += (targetGlow - d.glow) * EASE

        const r = DOT_RADIUS * d.scale
        // Blend resting -> hot as it pops.
        if (d.glow > 0.01) {
          ctx.fillStyle = `rgba(158, 53, 40, ${0.16 + d.glow * 0.45})`
        } else {
          ctx.fillStyle = BASE
        }
        ctx.beginPath()
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }

    build()

    if (reduced) {
      paintStatic()
      const ro = new ResizeObserver(() => {
        build()
        paintStatic()
      })
      ro.observe(parent)
      return () => ro.disconnect()
    }

    const onMove = (e) => {
      const rect = parent.getBoundingClientRect()
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true }
    }
    const onLeave = () => {
      mouse.current.active = false
    }

    parent.addEventListener('pointermove', onMove)
    parent.addEventListener('pointerleave', onLeave)
    const ro = new ResizeObserver(build)
    ro.observe(parent)
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      parent.removeEventListener('pointermove', onMove)
      parent.removeEventListener('pointerleave', onLeave)
    }
  }, [reduced])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  )
}
