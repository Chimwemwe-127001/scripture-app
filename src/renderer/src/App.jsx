import { useState, useEffect, useRef } from 'react'
import Header from './components/Header'
import TranscriptPanel from './components/TranscriptPanel'
import SuggestionPanel from './components/SuggestionPanel'
import SentScreen from './components/SelectedQueue'
import { SERMON_EXCERPT, MOCK_SCRIPTURES } from './data/mockData'

const SUGGESTION_MAX  = 10
const SUGGESTION_TTL_MS = 5 * 60 * 1000  // 5 minutes

// Rotating palette: each chunk gets its own accent colour
const CHUNK_COLORS = [
  { bg: 'rgba(251,191,36,0.15)',  border: '#fbbf24', text: '#fcd34d' }, // amber
  { bg: 'rgba(56,189,248,0.15)',  border: '#38bdf8', text: '#7dd3fc' }, // sky
  { bg: 'rgba(244,114,182,0.15)', border: '#f472b6', text: '#f9a8d4' }, // pink
  { bg: 'rgba(52,211,153,0.15)',  border: '#34d399', text: '#6ee7b7' }, // emerald
  { bg: 'rgba(167,139,250,0.15)', border: '#a78bfa', text: '#c4b5fd' }, // violet
  { bg: 'rgba(251,146,60,0.15)',  border: '#fb923c', text: '#fdba74' }, // orange
]

// Distinct accent for operator-entered verses so they read differently to
// anything the detection produced.
const MANUAL_COLOR = { bg: 'rgba(148,163,184,0.15)', border: '#94a3b8', text: '#cbd5e1' }

const api = window.electronAPI   // undefined in browser-only dev

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
  const [demoMode, setDemoMode]         = useState(!api)  // auto-demo when no Electron API

  // Chunk analysis state for transcript highlighting + analyzing indicator
  const [analyzingChunks, setAnalyzingChunks] = useState([])   // [{chunkId, startAt, fireAt}]
  const [chunkHighlights, setChunkHighlights] = useState([])   // [{chunkId, startAt, fireAt, color, addedAt}]

  // LLM (LM Studio) status
  const [llmStatus, setLlmStatus]       = useState(null)   // { ok, model, error }
  const [llmEndpoint, setLlmEndpoint]   = useState('http://localhost:1234/v1')
  const [bibleDbReady, setBibleDbReady] = useState(false)

  // VideoPsalm status
  const [vpStatus, setVpStatus]         = useState(false)

  // Selected whisper model + audio device (controlled from Header)
  const [whisperModel, setWhisperModel]   = useState('small')
  const [deviceIndex, setDeviceIndex]     = useState(null)

  const demoWordIdxRef  = useRef(0)
  const demoTimersRef   = useRef([])

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

    api.checkBibleDb().then(r => setBibleDbReady(r.ready))
    api.checkLlmStatus().then(r => setLlmStatus(r))
    api.checkVideoPsalm?.().then(r => setVpStatus(r?.running ?? false))
  }, [])

  // Suggestion cap + TTL expiry (every 60s, drop cards and highlights older than 5 min)
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - SUGGESTION_TTL_MS
      setSuggestions(prev => prev.filter(s => !s.addedAt || s.addedAt > cutoff))
      setChunkHighlights(prev => prev.filter(h => !h.addedAt || h.addedAt > cutoff))
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
  // Demo mode: simulates the transcript and suggestions with mock data
  // ------------------------------------------------------------------
  function startDemoMode() {
    stopDemoTimers()
    setSegments([])
    setSuggestions([])
    setChunkHighlights([])
    setAnalyzingChunks([])
    demoWordIdxRef.current = 0
    setIsListening(true)
    setStatusMsg('Demo mode: simulated transcript')

    // Like the real pipeline, a suggestion appears only after the words that
    // cite it have been transcribed, and it highlights the segments holding
    // its cue phrase. A fixed timer would drift away from the text.
    let wordBuf  = []
    let spoken   = ''   // lower-case transcript shown so far
    const shown  = []   // one entry per segment: { at, end } where end is its offset in `spoken`
    let nextCue  = 0

    const showSegment = (text) => {
      const seg = makeSegment(text)
      spoken += (spoken ? ' ' : '') + text.toLowerCase()
      shown.push({ at: seg.at, end: spoken.length })
      setSegments(prev => [...prev, seg])

      // Fire every suggestion whose cue is now fully in the transcript, in order.
      while (nextCue < MOCK_SCRIPTURES.length) {
        const scripture = MOCK_SCRIPTURES[nextCue]
        const pos = spoken.indexOf(scripture.cue.toLowerCase())
        if (pos === -1) break

        const idx     = nextCue++
        const color   = CHUNK_COLORS[idx % CHUNK_COLORS.length]
        const chunkId = idx + 1
        const startAt = shown.find(s => s.end > pos).at   // segment where the cue begins
        const fireAt  = seg.at                            // segment where the cue ends

        setChunkHighlights(prev => [...prev, { chunkId, startAt, fireAt, color, addedAt: fireAt }])
        setSuggestions(prev => [
          { ...scripture, addedAt: fireAt, chunkId, chunkColor: color, startAt, fireAt },
          ...prev,
        ].slice(0, SUGGESTION_MAX))
      }
    }

    const wordTimer = setInterval(() => {
      const idx = demoWordIdxRef.current
      if (idx < SERMON_EXCERPT.length) {
        const n = Math.floor(Math.random() * 2) + 2
        wordBuf.push(...SERMON_EXCERPT.slice(idx, idx + n))
        demoWordIdxRef.current += n
      }

      const finished = demoWordIdxRef.current >= SERMON_EXCERPT.length
      if (wordBuf.length >= 12 || (finished && wordBuf.length > 0)) {
        showSegment(wordBuf.join(' '))
        wordBuf = []
      }
      if (finished) {
        clearInterval(wordTimer)
        setIsListening(false)
      }
    }, 700)
    demoTimersRef.current.push(wordTimer)
  }

  function stopDemoTimers() {
    demoTimersRef.current.forEach(t =>
      typeof t === 'number' ? clearTimeout(t) : clearInterval(t)
    )
    demoTimersRef.current = []
  }

  // ------------------------------------------------------------------
  // Real IPC mode
  // ------------------------------------------------------------------
  async function handleStartListening() {
    if (!api) { startDemoMode(); return }
    if (isStarting || isListening) return   // guard against a double click
    setErrorMsg('')
    setSuggestions([])
    setChunkHighlights([])
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
    if (!api) { stopDemoTimers(); setIsListening(false); setStatusMsg(''); return }
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
        chunkColor: MANUAL_COLOR,
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
      // chunkId === null means the instant regex path: amber, no transcript highlight
      const colorIdx = card.chunkId != null
        ? ((card.chunkId - 1) % CHUNK_COLORS.length + CHUNK_COLORS.length) % CHUNK_COLORS.length
        : 0
      const color = CHUNK_COLORS[colorIdx]
      if (card.chunkId != null) {
        setChunkHighlights(prev => {
          if (prev.some(h => h.chunkId === card.chunkId)) return prev
          return [...prev, {
            chunkId: card.chunkId, startAt: card.startAt, fireAt: card.fireAt,
            color, addedAt: Date.now(),
          }]
        })
      }
      setSuggestions(prev => {
        const stamped = { ...card, addedAt: Date.now(), chunkColor: color }
        return [stamped, ...prev].slice(0, SUGGESTION_MAX)
      })
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

  // Auto-start demo mode when running without Electron
  useEffect(() => {
    if (demoMode) startDemoMode()
    return stopDemoTimers
  }, [demoMode])

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

      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        if (!demoMode) { setDemoMode(true) }
        else { stopDemoTimers(); setIsListening(false); setDemoMode(false); setSegments([]) }
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
  }, [isListening, demoMode, suggestions, errorMsg, toast])

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
    <div className="flex flex-col h-screen bg-surface text-white" style={{ fontFamily: 'Inter, Segoe UI, system-ui, sans-serif' }}>
      <Header
        isListening={isListening}
        isStarting={isStarting}
        onManualLookup={handleManualLookup}
        statusMsg={statusMsg}
        errorMsg={errorMsg}
        demoMode={demoMode}
        whisperModel={whisperModel}
        deviceIndex={deviceIndex}
        llmStatus={llmStatus}
        llmEndpoint={llmEndpoint}
        bibleDbReady={bibleDbReady}
        vpStatus={vpStatus}
        onModelChange={setWhisperModel}
        onDeviceChange={setDeviceIndex}
        onEndpointChange={handleEndpointChange}
        onToggleListen={isListening ? handleStopListening : handleStartListening}
        onToggleDemo={() => {
          if (!demoMode) { setDemoMode(true) }
          else { stopDemoTimers(); setIsListening(false); setDemoMode(false); setSegments([]) }
        }}
      />
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
      <div className="flex flex-1 overflow-hidden gap-2 p-2">
        <TranscriptPanel
          segments={segments}
          isListening={isListening}
          isAnalyzing={analyzingChunks.length > 0}
          chunkHighlights={chunkHighlights}
          onClear={() => { setSegments([]); setChunkHighlights([]) }}
        />
        <SuggestionPanel
          suggestions={suggestions}
          onSent={handleSent}
          onSendToScreen={sendToScreen}
          onClear={() => setSuggestions([])}
          bibleDbReady={bibleDbReady}
          llmStatus={llmStatus}
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


