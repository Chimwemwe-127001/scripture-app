import { useState, useEffect, useRef } from 'react'
import Header from './components/Header'
import TranscriptPanel from './components/TranscriptPanel'
import SuggestionPanel from './components/SuggestionPanel'
import SelectedQueue from './components/SelectedQueue'
import { SERMON_EXCERPT, MOCK_SCRIPTURES } from './data/mockData'

const api = window.electronAPI   // undefined in browser-only dev

export default function App() {
  const [segments, setSegments]         = useState([])   // transcript segments
  const [suggestions, setSuggestions]   = useState([])
  const [selectedQueue, setSelectedQueue] = useState([])
  const [isListening, setIsListening]   = useState(false)
  const [statusMsg, setStatusMsg]       = useState('')
  const [errorMsg, setErrorMsg]         = useState('')
  const [demoMode, setDemoMode]         = useState(!api)  // auto-demo when no Electron API

  // LLM (LM Studio) status
  const [llmStatus, setLlmStatus]       = useState(null)   // { ok, model, error }
  const [llmEndpoint, setLlmEndpoint]   = useState('http://localhost:1234/v1')
  const [bibleDbReady, setBibleDbReady] = useState(false)

  // Selected whisper model + audio device (controlled from Header)
  const [whisperModel, setWhisperModel]   = useState('small')
  const [deviceIndex, setDeviceIndex]     = useState(null)

  const scriptureIdxRef = useRef(0)
  const demoWordIdxRef  = useRef(0)
  const demoTimersRef   = useRef([])

  // ------------------------------------------------------------------
  // Check LLM + Bible DB status on mount (real Electron only)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!api) return
    api.checkBibleDb().then(r => setBibleDbReady(r.ready))
    api.checkLlmStatus().then(r => setLlmStatus(r))
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

    // Transcript simulation: append 2–3 words every 700ms
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

      // Flush buffer as a segment every ~15 words for realistic phrasing
      if (wordBuf.length >= 12 || demoWordIdxRef.current >= SERMON_EXCERPT.length) {
        const text = wordBuf.join(' ')
        wordBuf = []
        setSegments(prev => [...prev, { id: Date.now(), text }])
      }
    }, 700)
    demoTimersRef.current.push(wordTimer)

    // Scripture simulation: first card at 4s, then every 9s
    const scheduleScripture = (delay) => {
      const t = setTimeout(() => {
        if (scriptureIdxRef.current < MOCK_SCRIPTURES.length) {
          const s = MOCK_SCRIPTURES[scriptureIdxRef.current++]
          setSuggestions(prev => [s, ...prev])
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
      setSuggestions(prev => [card, ...prev])
    })

    return () => {
      ['transcript-update', 'listening-status', 'listening-error', 'scripture-suggestion'].forEach(
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
  // LLM endpoint change
  // ------------------------------------------------------------------
  async function handleEndpointChange(url) {
    setLlmEndpoint(url)
    if (!api) return
    const status = await api.setLlmEndpoint(url)
    setLlmStatus(status)
  }

  // ------------------------------------------------------------------
  // Selected queue actions
  // ------------------------------------------------------------------
  const handleSelect = (scripture) => {
    setSelectedQueue(prev => {
      if (prev.find(s => s.id === scripture.id)) return prev
      return [...prev, scripture]
    })
    setSuggestions(prev => prev.filter(s => s.id !== scripture.id))
  }

  const handleRemove = (id) => {
    setSelectedQueue(prev => prev.filter(s => s.id !== id))
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
        <TranscriptPanel segments={segments} isListening={isListening} />
        <SuggestionPanel suggestions={suggestions} onSelect={handleSelect} />
        <SelectedQueue queue={selectedQueue} onRemove={handleRemove} />
      </div>
    </div>
  )
}
