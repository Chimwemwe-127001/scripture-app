import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

const MODELS = [
  { value: 'auto',              label: 'Automatic (recommended)', note: 'The best model for this PC: distil-large-v3.5 on an NVIDIA GPU, small.en on the CPU.' },
  { value: 'distil-large-v3.5', label: 'distil-large-v3.5',       note: 'English. About 1.1 GB of GPU memory. Fewest invented words.' },
  { value: 'large-v3-turbo',    label: 'large-v3-turbo',          note: 'Multilingual. About 1.1 GB of GPU memory.' },
  { value: 'small.en',          label: 'small.en',                note: 'English. Runs on the CPU when there is no GPU, slower.' },
]

function Section({ title, children }) {
  return (
    <section className="px-4 py-3 border-b border-line last:border-b-0">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg-3 mb-2.5">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-fg-2">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-fg-3">{hint}</span>}
    </label>
  )
}

const INPUT = `h-8 px-2 rounded-md bg-ink-2 border border-line text-fg
               hover:border-line-strong focus:border-accent focus:outline-none
               disabled:opacity-50 disabled:cursor-not-allowed`

/**
 * SettingsPanel: the choices made before a service, kept out of the main
 * view so the console only shows what matters while someone is preaching.
 */
export default function SettingsPanel({
  onClose, locked,
  devices, deviceIndex, onDeviceChange,
  whisperModel, onModelChange,
  llmEndpoint, llmStatus, onEndpointChange,
  bibleDbReady,
}) {
  const [endpoint, setEndpoint] = useState(llmEndpoint)
  const panelRef = useRef(null)

  useEffect(() => { setEndpoint(llmEndpoint) }, [llmEndpoint])

  // Close on Escape or on a click outside the panel.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const model = MODELS.find(m => m.value === whisperModel)

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Settings"
      className="absolute right-2 top-[52px] z-40 w-[380px] bg-ink-1 border border-line-strong
                 rounded-md shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center justify-between h-10 px-4 border-b border-line">
        <span className="font-medium text-fg">Settings</span>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-ink-2"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <Section title="Audio">
        {locked && (
          <p className="text-[12px] text-warn">Stop listening to change audio settings.</p>
        )}
        <Field label="Input device" hint="Speaker loopback devices are hidden on purpose.">
          <select
            value={deviceIndex ?? ''}
            disabled={locked}
            onChange={e => onDeviceChange(e.target.value === '' ? null : Number(e.target.value))}
            className={INPUT}
          >
            <option value="">System default</option>
            {devices.map(d => <option key={d.index} value={d.index}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Whisper model" hint={model?.note}>
          <select
            value={whisperModel}
            disabled={locked}
            onChange={e => onModelChange(e.target.value)}
            className={INPUT}
          >
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Language model (optional)">
        <Field
          label="LM Studio endpoint"
          hint={llmStatus?.ok
            ? `Connected: ${llmStatus.model}`
            : 'Not connected. Paraphrase detection is off; explicit references still work.'}
        >
          <form
            className="flex gap-2"
            onSubmit={e => { e.preventDefault(); onEndpointChange(endpoint.trim()) }}
          >
            <input
              value={endpoint}
              onChange={e => setEndpoint(e.target.value)}
              spellCheck={false}
              className={`${INPUT} flex-1 font-mono text-[12px]`}
            />
            <button
              type="submit"
              className="h-8 px-3 rounded-md border border-line-strong text-fg hover:bg-ink-3"
            >
              Save
            </button>
          </form>
        </Field>
      </Section>

      <Section title="Bible">
        <p className="text-fg-2">
          {bibleDbReady
            ? 'King James Version, 31,102 verses, stored locally.'
            : <>Database missing. Run <code className="font-mono text-fg">npm run setup-bible</code>.</>}
        </p>
      </Section>

      <p className="px-4 py-2.5 text-[12px] text-fg-3 border-t border-line">
        Changes are saved automatically.
      </p>
    </div>
  )
}
