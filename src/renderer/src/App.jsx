import { useState, useEffect, useRef } from 'react'
import Header from './components/Header'
import TranscriptPanel from './components/TranscriptPanel'
import SuggestionPanel from './components/SuggestionPanel'
import SentScreen from './components/SelectedQueue'
import { SERMON_EXCERPT, MOCK_SCRIPTURES } from './data/mockData'

const SUGGESTION_MAX  = 10
const SUGGESTION_TTL_MS = 5 * 60 * 1000  // 5 minutes

// Rotating palette — each chunk gets a unique accent color
const CHUNK_COLORS = [
  { bg: 'rgba(251,191,36,0.15)',  border: '#fbbf24', text: '#fcd34d' }, // amber
  { bg: 'rgba(56,189,248,0.15)',  border: '#38bdf8', text: '#7dd3fc' }, // sky
  { bg: 'rgba(244,114,182,0.15)', border: '#f472b6', text: '#f9a8d4' }, // pink
  { bg: 'rgba(52,211,153,0.15)',  border: '#34d399', text: '#6ee7b7' }, // emerald
  { bg: 'rgba(167,139,250,0.15)', border: '#a78bfa', text: '#c4b5fd' }, // violet
  { bg: 'rgba(251,146,60,0.15)',  border: '#fb923c', text: '#fdba74' }, // orange
]

const api = window.electronAPI   // undefined in browser-only dev

export default function App() {
  const [segments, setSegments]         = useState([])   // transcript segments
  const [suggestions, setSuggestions]   = useState([])
  const [sentHistory, setSentHistory]   = useState([])   // {id, ...scripture, sentAt, sentToVP}
  const [isListening, setIsListening]   = useState(false)
  const [statusMsg, setStatusMsg]       = useState('')
  const [errorMsg, setErrorMsg]         = useState('')
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

  const scriptureIdxRef = useRef(0)
  const demoWordIdxRef  = useRef(0)
  const demoTimersRef   = useRef([])

  // ------------------------------------------------------------------
  // Check LLM + Bible DB + VP status on mount (real Electron only)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!api) return
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
  // Demo mode — simulates transcript + suggestions with mock data
  // ------------------------------------------------------------------
  function startDemoMode() {
    stopDemoTimers()
    setSegments([])
    setChunkHighlights([])
    setAnalyzingChunks([])
    scriptureIdxRef.current = 0
    demoWordIdxRef.current  = 0
    setIsListening(true)
    setStatusMsg('Demo mode — simulated transcript')

    let wordBuf = []
    const wordTimer = setInterval(() => {
      if (demoWordIdxRef.current >= SERMON_EXCERPT.length) {
        clearInterval(wordTimer)
        setIsListening(false)
        return
      }
      const n = Math.floor(Math.random() * 2) + 2
      wordBuf.push(...SERMON_EXCERPT.slice(demoWordIdxRef.current, demoWordIdxRef.current + n))
      demoWordIdxRef.current += n

      if (wordBuf.length >= 12 || demoWordIdxRef.current >= SERMON_EXCERPT.length) {
        const text = wordBuf.join(' ')
        wordBuf = []
        setSegments(prev => [...prev, { id: Date.now(), text }])
      }
    }, 700)
    demoTimersRef.current.push(wordTimer)

    const scheduleScripture = (delay) => {
      const t = setTimeout(() => {
        if (scriptureIdxRef.current < MOCK_SCRIPTURES.length) {
          const idx    = scriptureIdxRef.current++
          const color  = CHUNK_COLORS[idx % CHUNK_COLORS.length]
          const now    = Date.now()
          const fakeChunkId = idx + 1
          const s = {
            ...MOCK_SCRIPTURES[idx],
            addedAt: now,
            chunkId: fakeChunkId,
            chunkColor: color,
            startAt: now - 9000,
            fireAt: now,
          }
          setChunkHighlights(prev => [...prev, {
            chunkId: fakeChunkId, startAt: now - 9000, fireAt: now, color, addedAt: now,
          }])
          setSuggestions(prev => [s, ...prev].slice(0, SUGGESTION_MAX))
          scheduleScripture(9000)
        }
      }, delay)
      demoTimersRef.current.push(t)
    }
    scheduleScripture(4000)
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
    setErrorMsg('')
    setSuggestions([])
    setChunkHighlights([])
    setAnalyzingChunks([])
    setStatusMsg('Starting Whisper…')
    await api.startListening({ model: whisperModel, deviceIndex })
  }

  async function handleStopListening() {
    if (!api) { stopDemoTimers(); setIsListening(false); setStatusMsg(''); return }
    await api.stopListening()
  }

  // Wire up IPC listeners once
  useEffect(() => {
    if (!api) return

    api.onTranscript((msg) => {
      setSegments(prev => [...prev, { id: Date.now(), text: msg.text }])
    })
    api.onListeningStatus((msg) => {
      if (typeof msg.listening === 'boolean') setIsListening(msg.listening)
      if (msg.message) setStatusMsg(msg.message)
    })
    api.onListeningError((msg) => {
      setErrorMsg(msg.message || 'Unknown error')
      setIsListening(false)
    })
    api.onScriptureSuggestion((card) => {
      // chunkId === null means instant regex detection — color amber, no transcript highlight
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
      setErrorMsg(`LM Studio error: ${data.message || 'Channel Error — try reloading the model in LM Studio'}`)
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
      } else if (e.key === 'Escape') {
        setSuggestions([])
      } else if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        if (!demoMode) { setDemoMode(true) }
        else { stopDemoTimers(); setIsListening(false); setDemoMode(false); setSegments([]) }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isListening, demoMode])

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


