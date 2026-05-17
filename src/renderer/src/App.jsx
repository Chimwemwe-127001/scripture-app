import { useState, useEffect, useRef } from 'react'
import Header from './components/Header'
import TranscriptPanel from './components/TranscriptPanel'
import SuggestionPanel from './components/SuggestionPanel'
import SelectedQueue from './components/SelectedQueue'
import { SERMON_EXCERPT, MOCK_SCRIPTURES } from './data/mockData'

export default function App() {
  const [words, setWords] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [selectedQueue, setSelectedQueue] = useState([])
  const [isListening, setIsListening] = useState(false)

  const wordIdxRef = useRef(0)
  const scriptureIdxRef = useRef(0)

  // Simulate live transcript — starts after 1 second, appends 2-3 words every 700ms
  useEffect(() => {
    const startDelay = setTimeout(() => {
      setIsListening(true)
      const interval = setInterval(() => {
        if (wordIdxRef.current >= SERMON_EXCERPT.length) {
          setIsListening(false)
          clearInterval(interval)
          return
        }
        const chunkSize = Math.floor(Math.random() * 2) + 2
        const chunk = SERMON_EXCERPT.slice(wordIdxRef.current, wordIdxRef.current + chunkSize)
        wordIdxRef.current += chunkSize
        setWords(prev => [...prev, ...chunk])
      }, 700)
      return () => clearInterval(interval)
    }, 1000)
    return () => clearTimeout(startDelay)
  }, [])

  // Simulate scripture suggestions — first card at 4s, then every 9s
  useEffect(() => {
    const timers = []

    const scheduleNext = (delay) => {
      const t = setTimeout(() => {
        if (scriptureIdxRef.current < MOCK_SCRIPTURES.length) {
          const scripture = MOCK_SCRIPTURES[scriptureIdxRef.current]
          scriptureIdxRef.current++
          setSuggestions(prev => [scripture, ...prev])
          scheduleNext(9000)
        }
      }, delay)
      timers.push(t)
    }

    scheduleNext(4000)
    return () => timers.forEach(clearTimeout)
  }, [])

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

  return (
    <div className="flex flex-col h-screen bg-surface text-white" style={{ fontFamily: 'Inter, Segoe UI, system-ui, sans-serif' }}>
      <Header isListening={isListening} />
      <div className="flex flex-1 overflow-hidden gap-2 p-2">
        <TranscriptPanel words={words} />
        <SuggestionPanel suggestions={suggestions} onSelect={handleSelect} />
        <SelectedQueue queue={selectedQueue} onRemove={handleRemove} />
      </div>
    </div>
  )
}
