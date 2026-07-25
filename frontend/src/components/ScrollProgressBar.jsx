import { motion, useScroll, useSpring } from 'framer-motion'

// Thin terracotta bar pinned to the very top of the viewport, filling with
// scroll position — the same read-progress cue used on Linear/Vercel-style
// marketing sites. useSpring smooths the raw scroll fraction so it doesn't
// feel like it's stepping. Honors prefers-reduced-motion via the spring's own
// zero-duration fallback (CSS media query in index.css also neutralizes any
// residual transition).
export default function ScrollProgressBar() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 300, damping: 40, restDelta: 0.001 })

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-clay-500"
    />
  )
}
