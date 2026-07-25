import { useEffect } from 'react'

// Lightweight per-page <title> + meta description (no react-helmet dependency). Sets the document
// title and updates the description / og:title / twitter:title so each route reads correctly in the
// browser tab and to JS-executing crawlers. Restores the previous values on unmount.
//
// Note: social link-unfurlers (Slack, iMessage, Twitter) read the STATIC index.html and don't run
// JS, so they fall back to the site-wide OG card — which is the intended default.
const SUFFIX = 'Touchstones'
const HOME_TITLE = 'Touchstones — Real work. Real person. Provable.'

export default function Seo({ title, description }) {
  useEffect(() => {
    const fullTitle = title ? `${title} · ${SUFFIX}` : HOME_TITLE
    const prevTitle = document.title
    document.title = fullTitle

    const setMeta = (selector, value) => {
      if (!value) return null
      const el = document.querySelector(selector)
      if (!el) return null
      const prev = el.getAttribute('content')
      el.setAttribute('content', value)
      return () => el.setAttribute('content', prev ?? '')
    }

    const restorers = [
      setMeta('meta[name="description"]', description),
      setMeta('meta[property="og:title"]', fullTitle),
      setMeta('meta[name="twitter:title"]', fullTitle),
      setMeta('meta[property="og:description"]', description),
      setMeta('meta[name="twitter:description"]', description),
    ].filter(Boolean)

    return () => {
      document.title = prevTitle
      restorers.forEach((restore) => restore())
    }
  }, [title, description])

  return null
}
