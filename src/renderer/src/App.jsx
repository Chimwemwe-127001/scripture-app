import { useState, useEffect, useRef } from 'react'
import TopBar from './components/TopBar'
import SettingsPanel from './components/SettingsPanel'
import TranscriptPanel from './components/TranscriptPanel'
import SuggestionPanel from './components/SuggestionPanel'
import SentScreen from './components/SelectedQueue'

const SUGGESTION_MAX  = 10
const SUGGESTION_TTL_MS = 5 * 60 * 1000  // 5 minutes

const api = window.electronAPI   // undefined outside Electron

export default function App() {
  const [segments, setSegments]         = useState([])   // transcript segments
  const [suggestions, setSuggestions]   = useState([])
  const [sentHistory, setSentHistory]   = useState([])   // {id, ...scripture, sentAt, sentToVP}
  const [isListening, setIsListening]   = useState(false)
  // 'starting' covers the gap between clicking Listen and Whisper reporting
  // ready. Loading large-v3 can take a minute, and the button is disabled in
  // that time so a second click cannot restart the load.
  const [isStarting, setIsStarting]     = useState(false)
  const [statusMsg, setStatusMsg]       = useState('')
  const [errorMsg, setErrorMsg]         = useState('')
  const [toast, setToast]               = useState('')

  // Chunks the LLM is still reading, for the "reading" indicator.
  const [analyzingChunks, setAnalyzingChunks] = useState([])   // [{chunkId, startAt, fireAt}]
  // Where each suggestion came from, so the transcript can point at it.
  const [links, setLinks] = useState([])                       // [{id, reference, heard, startAt, fireAt, addedAt}]
  // Reference of the card under the mouse; its source is highlighted.
  const [focusRef, setFocusRef] = useState(null)

  // LLM (LM Studio) status
  const [llmStatus, setLlmStatus]       = useState(null)   // { ok, model, error }
  const [llmEndpoint, setLlmEndpoint]   = useState('http://localhost:1234/v1')
  const [bibleDbReady, setBibleDbReady] = useState(false)

  // VideoPsalm status
  const [vpStatus, setVpStatus]         = useState(false)

  // Selected whisper model + audio device (chosen in the settings panel)
  const [whisperModel, setWhisperModel]   = useState('small')
  const [deviceIndex, setDeviceIndex]     = useState(null)
  const [devices, setDevices]             = useState([])

  const [settingsOpen, setSettingsOpen]   = useState(false)
  const [listeningSince, setListeningSince] = useState(null)

  // Strictly increasing segment ids, unique even within one millisecond.
  const segmentSeqRef = useRef(0)
  const nextSegmentId = () => {
    segmentSeqRef.current += 1
    return `seg-${Date.now()}-${segmentSeqRef.current}`
  }

  /**
   * Build a transcript segment.
   *
   * `id` is a unique React key. `at` is the arrival timestamp used to match
   * segments to chunk highlights. Keeping them separate means two segments
   * arriving in the same millisecond never share a key.
   */
  const makeSegment = (text) => ({ id: nextSegmentId(), at: Date.now(), text })

  // ------------------------------------------------------------------
  // Check LLM + Bible DB + VP status on mount (real Electron only)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!api) return

    // Restore saved preferences before anything else, so the operator does not
    // have to reselect their model and input device before every service.
    api.getSettings?.().then(saved => {
      if (!saved) return
      if (saved.whisperModel) setWhisperModel(saved.whisperModel)
      if (saved.deviceIndex !== undefined) setDeviceIndex(saved.deviceIndex)
      if (saved.llmEndpoint) setLlmEndpoint(saved.llmEndpoint)
    })

    Promise.all([api.getAudioDevices(), api.getSettings?.()]).then(([list, saved]) => {
      if (!Array.isArray(list)) return
      setDevices(list)
      const savedIndex = saved?.deviceIndex
      if (savedIndex != null && !list.some(d => d.index === savedIndex)) setDeviceIndex(null)
    })

    api.checkBibleDb().then(r => setBibleDbReady(r.ready))
    api.checkLlmStatus().then(r => setLlmStatus(r))
    api.checkVideoPsalm?.().then(r => setVpStatus(r?.running ?? false))
  }, [])

  useEffect(() => {
    setListeningSince(isListening ? Date.now() : null)
  }, [isListening])

  // Suggestion cap + TTL expiry (every 60s, drop cards and highlights older than 5 min)
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - SUGGESTION_TTL_MS
      setSuggestions(prev => prev.filter(s => !s.addedAt || s.addedAt > cutoff))
      setLinks(prev => prev.filter(l => l.addedAt > cutoff))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  // ------------------------------------------------------------------
  // VP status polling every 15s
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!api?.checkVideoPsalm) return
    const id = setInterval(async () => {
      const r = await api.checkVideoPsalm()
      setVpStatus(r?.running ?? false)
    }, 15_000)
    return () => clearInterval(id)
  }, [])

  // ------------------------------------------------------------------
  // Listening
  // ------------------------------------------------------------------
  async function handleStartListening() {
    if (!api) return
    if (isStarting || isListening) return   // guard against a double click
    setErrorMsg('')
    setSuggestions([])
    setLinks([])
    setAnalyzingChunks([])
    setIsStarting(true)
    setStatusMsg('Loading Whisper model…')
    try {
      await api.startListening({ model: whisperModel, deviceIndex })
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to start listening')
      setIsStarting(false)
    }
  }

  async function handleStopListening() {
    if (!api) return
    setIsStarting(false)
    await api.stopListening()
  }

  // ------------------------------------------------------------------
  // Shared VideoPsalm send, used by both the card button and the
  // number-key shortcuts so they always behave the same.
  // ------------------------------------------------------------------
  async function sendToScreen(scripture) {
    if (!api?.sendToVideoPsalm) {
      return { ok: false, error: 'VideoPsalm bridge unavailable' }
    }
    try {
      const result = await api.sendToVideoPsalm(scripture.reference)
      if (result?.ok) {
        handleSent(scripture, true)
        return { ok: true }
      }
      const msg = result?.error || 'Unknown error'
      setErrorMsg(`VideoPsalm: ${msg}`)
      return { ok: false, error: msg }
    } catch (err) {
      const msg = err?.message || 'Failed'
      setErrorMsg(`VideoPsalm: ${msg}`)
      return { ok: false, error: msg }
    }
  }

  // ------------------------------------------------------------------
  // Manual reference lookup, the operator's override when detection misses
  // ------------------------------------------------------------------
  async function handleManualLookup(query) {
    if (!api?.lookupReference) return { ok: false, error: 'Lookup unavailable' }

    const result = await api.lookupReference(query)
    if (!result?.ok) return result

    const now = Date.now()
    setSuggestions(prev => {
      const stamped = result.cards.map((c, i) => ({
        ...c,
        // Unique key even when the same verse is looked up twice in a row.
        id: `${c.id}-manual-${now}-${i}`,
        addedAt: now,
      }))
      return [...stamped, ...prev].slice(0, SUGGESTION_MAX)
    })
    return { ok: true }
  }

  // Wire up IPC listeners once
  useEffect(() => {
    if (!api) return

    api.onTranscript((msg) => {
      setSegments(prev => [...prev, makeSegment(msg.text)])
    })
    api.onListeningStatus((msg) => {
      if (typeof msg.listening === 'boolean') {
        setIsListening(msg.listening)
        // Whisper has reported its state, so the start-up window is over.
        setIsStarting(false)
      }
      if (msg.message) setStatusMsg(msg.message)
    })
    api.onListeningError((msg) => {
      // Warnings (e.g. "transcription is falling behind") keep the session
      // running. Only real errors stop listening.
      const isWarning = msg.type === 'warning'
      setErrorMsg(msg.message || 'Unknown error')
      if (!isWarning) {
        setIsListening(false)
        setIsStarting(false)
      }
    })
    api.onScriptureSuggestion((card) => {
      const addedAt = Date.now()
      setLinks(prev => [...prev, {
        id: card.id, reference: card.reference, heard: card.heard,
        startAt: card.startAt, fireAt: card.fireAt, addedAt,
      }])
      setSuggestions(prev => [{ ...card, addedAt }, ...prev].slice(0, SUGGESTION_MAX))
    })
    api.onLlmError?.((data) => {
      setErrorMsg(`LM Studio error: ${data.message || 'Channel Error. Try reloading the model in LM Studio.'}`)
    })
    api.onAnalyzing?.(({ chunkId, startAt, fireAt }) => {
      setAnalyzingChunks(prev => [...prev, { chunkId, startAt, fireAt }])
    })
    api.onAnalyzingDone?.(({ chunkId }) => {
      setAnalyzingChunks(prev => prev.filter(c => c.chunkId !== chunkId))
    })

    return () => {
      ['transcript-update', 'listening-status', 'listening-error', 'scripture-suggestion',
       'llm-error', 'scripture-analyzing', 'scripture-analyzing-done'].forEach(
        ch => api.removeAllListeners(ch)
      )
    }
  }, [])

  // ------------------------------------------------------------------
  // Keyboard shortcuts
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault()
        if (isListening) handleStopListening()
        else handleStartListening()
        return
      }

      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(open => !open)
        return
      }

      // Number keys send the Nth suggestion straight to VideoPsalm.
      // In a booth, reaching for the mouse costs real seconds mid-service.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        const target = suggestions[idx]
        if (target) {
          e.preventDefault()
          setToast(`Sending ${target.reference}…`)
          sendToScreen(target).then(r => {
            setToast(r.ok ? `Sent ${target.reference}` : `Failed: ${target.reference}`)
            setTimeout(() => setToast(''), 2000)
          })
        }
        return
      }

      if (e.key === 'Escape') {
        // Escape only dismisses transient UI. Clearing suggestions needs the
        // explicit Clear button, because Escape is pressed by reflex.
        if (errorMsg) { setErrorMsg(''); return }
        if (toast) { setToast(''); return }
        document.activeElement?.blur?.()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isListening, suggestions, errorMsg, toast])

  // ------------------------------------------------------------------
  // LLM auto-retry: poll every 30s when LLM is disconnected
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!api || llmStatus?.ok) return
    const id = setInterval(async () => {
      const r = await api.checkLlmStatus()
      setLlmStatus(r)
    }, 30_000)
    return () => clearInterval(id)
  }, [llmStatus?.ok])

  // ------------------------------------------------------------------
  // Settings: saved as soon as they change
  // ------------------------------------------------------------------
  function handleModelChange(model) {
    setWhisperModel(model)
    api?.saveSettings?.({ whisperModel: model })
  }

  function handleDeviceChange(index) {
    setDeviceIndex(index)
    api?.saveSettings?.({ deviceIndex: index })
  }

  // ------------------------------------------------------------------
  // LLM endpoint change
  // ------------------------------------------------------------------
  async function handleEndpointChange(url) {
    setLlmEndpoint(url)
    if (!api) return
    const status = await api.setLlmEndpoint(url)
    setLlmStatus(status)
  }

  // ------------------------------------------------------------------
  // Sent history
  // Called by ScriptureCard when user clicks card body (viaPsalm=false)
  // or clicks Send to Screen button (viaPsalm=true, called from SendToScreenBtn)
  // ------------------------------------------------------------------
  const handleSent = (scripture, viaPsalm = false) => {
    setSentHistory(prev => {
      // Avoid exact duplicates within 5s (e.g. double-click)
      const recent = prev.find(s => s.reference === scripture.reference &&
        Date.now() - s.sentAt < 5000)
      if (recent) return prev
      return [...prev, { ...scripture, sentAt: Date.now(), sentToVP: viaPsalm }]
    })
  }

  const handleRemoveFromHistory = (id) => {
    setSentHistory(prev => prev.filter(s => s.id !== id))
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="relative flex flex-col h-screen bg-ink-0 text-fg">
      <TopBar
        isListening={isListening}
        isStarting={isStarting}
        listeningSince={listeningSince}
        statusMsg={statusMsg}
        whisperModel={whisperModel}
        llmStatus={llmStatus}
        vpStatus={vpStatus}
        bibleDbReady={bibleDbReady}
        onToggleListen={isListening ? handleStopListening : handleStartListening}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen(open => !open)}
      />
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          locked={isListening || isStarting}
          devices={devices}
          deviceIndex={deviceIndex}
          onDeviceChange={handleDeviceChange}
          whisperModel={whisperModel}
          onModelChange={handleModelChange}
          llmEndpoint={llmEndpoint}
          llmStatus={llmStatus}
          onEndpointChange={handleEndpointChange}
          bibleDbReady={bibleDbReady}
        />
      )}
      {errorMsg && (
        <div className="mx-2 mt-1 px-3 py-2 bg-red-900/40 border border-red-700 rounded text-red-300 text-xs flex items-center justify-between">
          <span>⚠ {errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="ml-4 text-red-400 hover:text-white">✕</button>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md
                        bg-surface-2 border border-brand/50 text-white text-xs shadow-lg">
          {toast}
        </div>
      )}
      {!api && (
        <div className="mx-2 mt-2 px-3 py-2 border border-surface-3 rounded text-surface-4 text-xs">
          The desktop bridge is not available. Start the app with npm run dev.
        </div>
      )}
      <div className="flex flex-1 min-h-0 gap-px bg-line">
        <TranscriptPanel
          segments={segments}
          isListening={isListening}
          isAnalyzing={analyzingChunks.length > 0}
          links={links}
          focusRef={focusRef}
          onClear={() => { setSegments([]); setLinks([]) }}
        />
        <SuggestionPanel
          onManualLookup={handleManualLookup}
          onFocusRef={setFocusRef}
          suggestions={suggestions}
          onSent={handleSent}
          onSendToScreen={sendToScreen}
          onClear={() => setSuggestions([])}
          bibleDbReady={bibleDbReady}
          llmStatus={llmStatus}
          isListening={isListening}
        />
        <SentScreen
          history={sentHistory}
          onRemove={handleRemoveFromHistory}
          onClear={() => setSentHistory([])}
        />
      </div>
    </div>
  )
}


