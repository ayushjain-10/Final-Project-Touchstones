import { useRef, useState } from 'react'
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion.js'

// Cursor-tracked 3D tilt + soft highlight — the "pop off the page" card
// treatment from Apple product pages / Aceternity's 3D Card Effect
// (perspective + rotateX/rotateY driven by pointer position), reimplemented
// here with the project's own Framer Motion primitives rather than pulling
// in an external component + its shadcn/Radix dependency chain.
// No-op (flat, static) under prefers-reduced-motion or on touch (no mousemove).
export default function TiltCard({ children, className = '', strength = 8 }) {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const rotateX = useSpring(useTransform(py, [0, 1], [strength, -strength]), {
    stiffness: 300,
    damping: 28,
  })
  const rotateY = useSpring(useTransform(px, [0, 1], [-strength, strength]), {
    stiffness: 300,
    damping: 28,
  })
  const glowX = useTransform(px, (v) => `${v * 100}%`)
  const glowY = useTransform(py, (v) => `${v * 100}%`)
  const glow = useMotionTemplate`radial-gradient(220px circle at ${glowX} ${glowY}, rgba(255,255,255,0.55), transparent 72%)`

  if (reduced) {
    return <div className={className}>{children}</div>
  }

  const handleMove = (e) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
  }
  const handleEnter = () => setHovered(true)
  const handleLeave = () => {
    setHovered(false)
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ rotateX, rotateY, transformPerspective: 1000 }}
      className={`relative isolate will-change-transform ${className}`}
    >
      {children}
      {/* Pointer-tracked highlight — only painted while hovering, so it can never
          wash out the card content at rest (no blend modes on by default). */}
      <motion.span
        aria-hidden
        style={{ background: glow, opacity: hovered ? 1 : 0 }}
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] transition-opacity duration-300"
      />
    </motion.div>
  )
}
