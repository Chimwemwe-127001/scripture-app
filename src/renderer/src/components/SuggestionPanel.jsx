import ScriptureCard from './ScriptureCard'
import ManualSearch from './ManualSearch'
import Panel, { PanelAction } from './Panel'

/**
 * SuggestionPanel: the "Next up" queue, newest first.
 * The lookup box sits on top because typing a reference is the operator's
 * fallback whenever detection misses.
 */
export default function SuggestionPanel({
  suggestions, onSent, onSendToScreen, onClear, onManualLookup, onFocusRef,
  bibleDbReady, llmStatus, isListening,
}) {
  return (
    <Panel
      title="Next up"
      count={suggestions.length}
      className="flex-1 min-w-0"
      actions={suggestions.length > 0 && (
        <PanelAction onClick={onClear} title="Clear all suggestions">Clear</PanelAction>
      )}
      footer={<>
        <span>Newest first</span>
        <span>Suggestions clear after 5 minutes</span>
      </>}
    >
      <div className="px-4 py-3 border-b border-line">
        <ManualSearch onLookup={onManualLookup} />
      </div>

      {suggestions.length === 0 ? (
        <div className="px-10 py-16 text-center text-fg-3 flex flex-col gap-2 items-center">
          <p className="text-fg-2">
            {isListening ? 'Nothing detected yet.' : 'No suggestions yet.'}
          </p>
          <p className="max-w-[360px]">
            Verses appear here as they are cited or paraphrased. Press a number key to send one to VideoPsalm.
          </p>
          {bibleDbReady === false && (
            <p className="text-err mt-2">The KJV database is missing. Run npm run setup-bible.</p>
          )}
          {llmStatus && !llmStatus.ok && (
            <p className="mt-2">LM Studio is off, so only cited references are detected.</p>
          )}
        </div>
      ) : (
        <div>
          {suggestions.map((s, i) => (
            <ScriptureCard
              key={s.id}
              scripture={s}
              hotkey={i < 9 ? i + 1 : null}   // only the first nine have a number key
              primary={i === 0}
              onSent={onSent}
              onSendToScreen={onSendToScreen}
              onFocusRef={onFocusRef}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}
