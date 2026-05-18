import { useState, useEffect, useRef } from 'react'
import Header from './components/Header'
import TranscriptPanel from './components/TranscriptPanel'
import SuggestionPanel from './components/SuggestionPanel'
import SentScreen from './components/SelectedQueue'
import { SERMON_EXCERPT, MOCK_SCRIPTURES } from './data/mockData'

const SUGGESTION_MAX = 10
const SUGGESTION_TTL_MS = 5 * 60 * 1000  // 5 minutes

const api = window.electronAPI   // undefined in browser-only dev

export default function App() {
  const [segments, setSegments]         = useState([])   // transcript segments
  const [suggestions, setSuggestions]   = useState([])
  const [sentHistory, setSentHistory]   = useState([])   // {id, ...scripture, sentAt, sentToVP}
  const [isListening, setIsListening]   = useState(false)
  const [statusMsg, setStatusMsg]       = useState('')
  const [errorMsg, setErrorMsg]         = useState('')
  const [demoMode, setDemoMode]         = useState(!api)  // auto-demo when no Electron API

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

  // ------------------------------------------------------------------
  // Suggestion cap + TTL expiry (every 60s, drop cards older than 5 min)
  // ------------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - SUGGESTION_TTL_MS
      setSuggestions(prev => prev.filter(s => !s.addedAt || s.addedAt > cutoff))
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
          const s = { ...MOCK_SCRIPTURES[scriptureIdxRef.current++], addedAt: Date.now() }
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
      setSuggestions(prev => {
        const stamped = { ...card, addedAt: Date.now() }
        const next = [stamped, ...prev]
        return next.slice(0, SUGGESTION_MAX)
      })
    })
    api.onLlmError?.((data) => {
      setErrorMsg(`LM Studio error: ${data.message || 'Channel Error — try reloading the model in LM Studio'}`)
    })

    return () => {
      ['transcript-update', 'listening-status', 'listening-error', 'scripture-suggestion', 'llm-error'].forEach(
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
        <TranscriptPanel segments={segments} isListening={isListening} onClear={() => setSegments([])} />
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


