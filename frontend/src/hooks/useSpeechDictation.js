import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'

// useSpeechDictation — ephemeral mic → Azure Speech streaming transcription for the verbal walkthrough.
// No-surveillance / no-persistence by construction: the browser streams mic audio DIRECTLY to Azure with
// a short-lived token; audio never touches our backend and nothing (audio or transcript) is stored — the
// candidate reviews the dictated TEXT and submits it like a typed answer. The Speech SDK is lazy-loaded
// (dynamic import) so it never bloats the main bundle for people who don't dictate.
//
// Usage: const { available, listening, error, toggle } = useSpeechDictation(token, (text) => append(text))
// `available` is false when the walkthrough flag is off (the token endpoint 404s) → the caller hides the mic.
export function useSpeechDictation(probeToken, onText) {
  const [available, setAvailable] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const recognizerRef = useRef(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  // Probe availability once. 404 (feature off / not in progress) → keep the mic hidden.
  useEffect(() => {
    let active = true
    if (!probeToken) return undefined
    api.getProbeSpeechToken(probeToken)
      .then(() => { if (active) setAvailable(true) })
      .catch(() => { if (active) setAvailable(false) })
    return () => { active = false }
  }, [probeToken])

  const stop = useCallback(() => {
    const rec = recognizerRef.current
    recognizerRef.current = null
    setListening(false)
    if (rec) {
      try { rec.stopContinuousRecognitionAsync(() => rec.close(), () => rec.close()) } catch { /* already closed */ }
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    let creds
    try {
      creds = await api.getProbeSpeechToken(probeToken) // { token, region }
    } catch (e) {
      setAvailable(false) // flag turned off since mount — hide the mic
      return
    }
    try {
      const SDK = await import('microsoft-cognitiveservices-speech-sdk')
      const speechConfig = SDK.SpeechConfig.fromAuthorizationToken(creds.token, creds.region)
      speechConfig.speechRecognitionLanguage = 'en-US'
      const audioConfig = SDK.AudioConfig.fromDefaultMicrophoneInput() // prompts for mic permission
      const recognizer = new SDK.SpeechRecognizer(speechConfig, audioConfig)
      recognizer.recognized = (_s, e) => {
        if (e?.result?.reason === SDK.ResultReason.RecognizedSpeech && e.result.text) {
          onTextRef.current?.(e.result.text)
        }
      }
      recognizer.canceled = () => { setError('Voice input stopped. You can keep typing.'); stop() }
      recognizerRef.current = recognizer
      recognizer.startContinuousRecognitionAsync(
        () => setListening(true),
        () => { setError('Could not start the microphone — check the permission and try again.'); stop() },
      )
    } catch (e) {
      setError('Voice input is unavailable in this browser. You can type your answer.')
      stop()
    }
  }, [probeToken, stop])

  const toggle = useCallback(() => { if (listening) stop(); else start() }, [listening, start, stop])

  // Stop + release the mic on unmount.
  useEffect(() => () => stop(), [stop])

  return { available, listening, error, start, stop, toggle }
}
