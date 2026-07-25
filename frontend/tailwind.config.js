/** @type {import('tailwindcss').Config} */
//
// Touchstones design tokens: editorial evidence
// ---------------------------------------------------
// Ultramarine is the brand, provenance, and positive-state color. Amber is for
// review, and oxblood is for destructive or flagged states. The interface does
// not use green.
// Legacy color names remain aliases while older surfaces migrate, but ONLY when the editorial
// UI is enabled: with the flag off the original terracotta/ink palette is restored verbatim so
// the frozen production waitlist keeps the presentation the docs promise.
//
// Build-time flag. Tailwind's config is Node, so process.env is the only thing it can read
// (import.meta.env does not exist here). Vercel injects project env vars into the build, and
// `vercel build` injects .vercel/.env.<target>.local, so this matches the JSX branches which
// read import.meta.env.VITE_EDITORIAL_UI_ENABLED. Default OFF, matching the documented default.
const EDITORIAL_UI = process.env.VITE_EDITORIAL_UI_ENABLED === 'true'

// The pre-redesign palette, kept verbatim so flag-off is a true restore, not an approximation.
const legacyClay = {
  50: '#FBF0EB',
  100: '#F5DDD2',
  200: '#EBBBA5',
  300: '#DD9376',
  400: '#CE7050',
  500: '#BD5B3D', // DEFAULT — CTAs, score ring, verified accents
  600: '#A54A30',
  700: '#883A26',
  800: '#6B2E1F',
  900: '#4A2016',
  DEFAULT: '#BD5B3D',
}
const legacyAmber = {
  50: '#F9EFD8',
  100: '#F2E0B4',
  500: '#C28A2E',
  700: '#7A5414',
  DEFAULT: '#C28A2E',
}
const legacyFlag = {
  50: '#F3DED9',
  100: '#E7BCB3',
  500: '#9E3528',
  700: '#6E2018',
  DEFAULT: '#9E3528',
}

const brand = {
  50: '#EEF0FF',
  100: '#E2E6FF',
  200: '#C8CEFA',
  300: '#9DA9EF',
  400: '#7484E3',
  500: '#4358D0',
  600: '#3448C5',
  700: '#27389E',
  800: '#202D7E',
  900: '#1C2664',
  950: '#111744',
  DEFAULT: '#3448C5',
}

const success = brand

const warning = {
  50: '#FBF2DC',
  100: '#F2E0B4',
  200: '#E9CF91',
  500: '#B77A1D',
  600: '#956719',
  700: '#704B10',
  DEFAULT: '#B77A1D',
}

const danger = {
  50: '#F9EDEA',
  100: '#F1D5CF',
  200: '#E6B8B0',
  500: '#B34C3E',
  600: '#A33F32',
  700: '#7B2D25',
  DEFAULT: '#B34C3E',
}
export default {
  // Class-based dark mode, scoped: only the candidate code IDE opts in (wraps itself in `.dark`).
  // The rest of the site stays light — `dark:` variants are inert without a `.dark` ancestor.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Page surfaces — warm cream, never stark white backgrounds
        paper: '#FAF7F1', // app/page background
        sand: '#F1EADD', // subtle warm section band
        canvas: '#FCF9F3', // warm card / raised surface
        ink: '#221E18', // primary warm near-black text

        // Warm neutral ramp ("stone") — text, borders, muted fills
        stone: {
          50: '#FAF7F2',
          100: '#F2ECE2',
          200: '#E7DDCF',
          300: '#D5C8B6',
          400: '#A99A85',
          500: '#897B67',
          600: '#6A5D4D',
          700: '#4D4437',
          800: '#332C22',
          900: '#1F1A14',
        },

        brand,
        success,
        warning,
        danger,

        // Compatibility aliases for the ~984 existing clay-/amber-/flag- usages across 88 files.
        //
        // These MUST honour VITE_EDITORIAL_UI_ENABLED. Aliasing clay -> brand unconditionally
        // (as this file briefly did) silently repaints the ENTIRE product ultramarine even with
        // the flag off, because a Tailwind config is build-time and never sees the JSX flag
        // branches. That defeats the flag's whole purpose and falsifies the docs that promise the
        // frozen production waitlist keeps its existing presentation while the flag is off.
        // Both ramps are supersets of each other, so nothing 404s: it just renders the wrong
        // color, which is exactly why it is easy to miss.
        //
        // A Tailwind config is Node, so it reads process.env (Vercel injects project env vars at
        // build; `vercel build` also injects .vercel/.env.*.local). It cannot see import.meta.env.
        clay: EDITORIAL_UI ? brand : legacyClay,
        amber: EDITORIAL_UI ? warning : legacyAmber,
        flag: EDITORIAL_UI ? danger : legacyFlag,
      },
      fontFamily: {
        // Editorial serif headings + clean grotesque body (from the brand doc)
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: '#E7DDCF', // hairline = stone-200
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        // Soft, warm-tinted elevation — nothing harsh
        card: '0 1px 2px rgba(34,30,24,0.04), 0 8px 24px -12px rgba(17,23,68,0.12)',
        lift: '0 2px 4px rgba(34,30,24,0.05), 0 20px 50px -18px rgba(17,23,68,0.24)',
        glow: '0 22px 80px -28px rgba(52,72,197,0.48)',
      },
      maxWidth: {
        content: '1180px',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'grow-bar': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        'gradient-drift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'depth-float': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -10px, 0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.6s ease both',
        'grow-bar': 'grow-bar 1s cubic-bezier(0.22, 1, 0.36, 1) both',
        'gradient-drift': 'gradient-drift 14s ease-in-out infinite',
        'depth-float': 'depth-float 8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
