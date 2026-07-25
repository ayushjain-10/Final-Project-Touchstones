import { Component } from 'react'

// Top-level safety net: catches render-time crashes anywhere below it so a bad
// or unexpected data shape never blanks the whole app. Renders a calm,
// on-palette fallback with a reload instead of a white screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') console.error('App crashed:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-paper px-5">
          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-canvas p-8 text-center shadow-card">
            <p className="font-serif text-xl font-semibold text-ink">Something broke on our end</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-500">
              This page hit an unexpected error. Reloading usually clears it.
            </p>
            <button type="button" onClick={() => window.location.reload()} className="btn-primary mt-6">
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
