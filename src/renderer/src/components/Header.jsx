export default function Header({ isListening }) {
  return (
    <header className="flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-surface-3 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-brand flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>
            </svg>
          </div>
          <span className="font-semibold text-white text-sm tracking-wide">Scripture Suggestion Panel</span>
        </div>
        <span className="text-surface-4 text-xs hidden sm:inline">v1.0 — Phase 1 UI Prototype</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-3 h-3">
            {isListening && (
              <span className="pulse-ring absolute inline-flex h-3 w-3 rounded-full bg-high opacity-75" />
            )}
            <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-high' : 'bg-surface-4'}`} />
          </div>
          <span className={`text-xs font-medium ${isListening ? 'text-high' : 'text-surface-4'}`}>
            {isListening ? 'LISTENING' : 'IDLE'}
          </span>
        </div>

        <span className="text-surface-4 text-xs">
          Whisper: <span className="text-white">small</span>
        </span>
        <span className="text-surface-4 text-xs">
          LLM: <span className="text-white">mistral:7b</span>
        </span>
      </div>
    </header>
  )
}
