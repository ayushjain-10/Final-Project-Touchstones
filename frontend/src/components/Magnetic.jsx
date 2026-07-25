import { useRef } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion.js'

// Cursor "pull" on primary CTAs — the button leans a few px toward the pointer
// inside its own bounds, then springs back on leave. Same family of effect as
// the buttons on Linear/Vercel/Raycast. `strength` caps the pixel offset so it
// nudges rather than chases. No-op under prefers-reduced-motion or on touch.
export default function Magnetic({ children, strength = 10, className = '' }) {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 250, damping: 18, mass: 0.3 })
  const springY = useSpring(y, { stiffness: 250, damping: 18, mass: 0.3 })

  if (reduced) {
    return <div className={className}>{children}</div>
  }

  const handleMove = (e) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const relX = e.clientX - (rect.left + rect.width / 2)
    const relY = e.clientY - (rect.top + rect.height / 2)
    x.set((relX / (rect.width / 2)) * strength)
    y.set((relY / (rect.height / 2)) * strength)
  }
  const handleLeave = () => {
    x.set(0)
    y.set(0)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ x: springX, y: springY }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
