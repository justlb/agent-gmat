import { useEffect, useState } from 'react'

import { confirmChemicalHohmannDraft, createChemicalHohmannDraft, discussChemicalHohmannDraft, executeChemicalHohmannDraft, type ChemicalHohmannDraft } from './chemicalHohmannApi'
import { updateMissionValue } from './missionValuesApi'

type Field = { label: string; path: string; placeholder: string; unit?: string }

const REQUIRED_FIELDS: Field[] = [
  { label: 'Initial epoch', path: 'initialOrbit.epoch', placeholder: 'TAIModJulian, e.g. 21545' },
  { label: 'Initial semi-major axis', path: 'initialOrbit.smaKm', placeholder: 'km', unit: 'km' },
  { label: 'Initial eccentricity', path: 'initialOrbit.eccentricity', placeholder: '0 to < 1' },
  { label: 'Initial inclination', path: 'initialOrbit.inclinationDeg', placeholder: 'degrees', unit: 'deg' },
  { label: 'Target orbit radius', path: 'transfer.targetRadiusKm', placeholder: 'km', unit: 'km' },
]
const OPTIONAL_FIELDS: Field[] = [
  { label: 'Target eccentricity', path: 'transfer.targetEccentricity', placeholder: 'default 0.005' },
  { label: 'Final propagation duration', path: 'transfer.finalPropagationSeconds', placeholder: 'seconds', unit: 's' },
]

function fieldValue(draft: ChemicalHohmannDraft | null, path: string) {
  const value = draft?.values[path]
  return value === null || value === undefined ? '' : String(value)
}

export function ChemicalHohmannForm({ activeRunId, onChanged, onRunExecuted, onRunOpalis, onRunRfComlink, onRunSimuCic, selectedSatelliteId, simuCicCompleted = false, simuCicRunning = false, workspaceDir }: {
  activeRunId?: string
  onChanged?: () => void
  onRunExecuted?: (run: { result: { error?: string; executionDurationMs?: number; status: 'generated' | 'completed' | 'failed' | 'timeout' }; runId: string; runPath: string }) => void
  onRunOpalis?: () => void
  onRunRfComlink?: () => void
  onRunSimuCic?: () => void
  selectedSatelliteId?: string
  simuCicCompleted?: boolean
  simuCicRunning?: boolean
  workspaceDir?: string | null
}) {
  const [draft, setDraft] = useState<ChemicalHohmannDraft | null>(null)
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [assistantMessage, setAssistantMessage] = useState('')
  const validWorkspace = Boolean(workspaceDir && /[\\/]gmat[\\/]mission-runs[\\/][^\\/]+$/u.test(workspaceDir))

  useEffect(() => {
    let cancelled = false
    setDraft(null); setEntries({}); setError(''); setNotice(''); setAssistantMessage('')
    if (!workspaceDir || !validWorkspace || !selectedSatelliteId) return () => { cancelled = true }
    setBusy(true)
    void createChemicalHohmannDraft(workspaceDir)
      .then(next => { if (!cancelled) { setDraft(next); setEntries(Object.fromEntries([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(field => [field.path, fieldValue(next, field.path)]))) } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to create the Hohmann mission draft') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [selectedSatelliteId, validWorkspace, workspaceDir])

  const saveField = async (field: Field) => {
    if (!workspaceDir || !draft || busy) return
    const value = (entries[field.path] ?? '').trim()
    if (!value) return
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await updateMissionValue({ draftId: draft.draftId, path: field.path, template: 'chemical-hohmann-transfer', value, workspaceDir }) as unknown as ChemicalHohmannDraft
      setDraft(next); setEntries(current => ({ ...current, [field.path]: fieldValue(next, field.path) })); onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save mission value') } finally { setBusy(false) }
  }
  const confirmAndRun = async () => {
    if (!workspaceDir || !draft || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const confirmed = await confirmChemicalHohmannDraft(draft.draftId, workspaceDir)
      setDraft(confirmed)
      const result = await executeChemicalHohmannDraft(confirmed.draftId, workspaceDir)
      if (result.result.status === 'completed') setNotice(`GMAT ${result.runId} completed. The script, values, log, manifest, result and satellite.json are available in this mission run.`)
      else setError(`GMAT ${result.result.status}: ${result.result.error ?? 'Review gmat.log in this mission run.'}`)
      // A generated script is a valid GMAT-GUI artifact even when console
      // execution later fails (for example while validating an OEM writer).
      // Promote it to the active run in every case, so the Workflow panel can
      // open and inspect exactly this run rather than leaving the user stuck.
      onRunExecuted?.(result)
      onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to run GMAT') } finally { setBusy(false) }
  }
  const askAssistant = async () => {
    const message = assistantMessage.trim()
    if (!workspaceDir || !draft || !message || busy) return
    setBusy(true); setError('')
    try {
      const next = await discussChemicalHohmannDraft(draft.draftId, message, workspaceDir)
      setDraft(next)
      setEntries(Object.fromEntries([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(field => [field.path, fieldValue(next, field.path)])))
      setAssistantMessage(''); onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to ask the mission assistant') } finally { setBusy(false) }
  }
  const missingLabels = REQUIRED_FIELDS.filter(field => draft?.missing.includes(field.path)).map(field => field.label)

  const input = (field: Field) => <input
    aria-label={`Enter ${field.label}`}
    className="gmat-mission-required-input"
    disabled={busy || !draft}
    key={field.path}
    onBlur={() => { void saveField(field) }}
    onChange={event => setEntries(current => ({ ...current, [field.path]: event.target.value }))}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveField(field) } }}
    placeholder={field.placeholder}
    value={entries[field.path] ?? ''}
  />

  return <section className="gmat-mission-chat chemical-hohmann-chat" aria-label="Chemical Hohmann transfer inputs">
    <div className="gmat-mission-chat-tabs"><span>General</span></div>
    <div className="gmat-mission-chat-layout">
      <aside className="gmat-mission-chat-sidebar">
        <section><header><strong>Required before GMAT can run</strong><span>{busy ? 'Saving…' : draft?.missing.length ? `${missingLabels.length} remaining` : draft ? 'Complete' : 'Waiting'}</span></header>
          {validWorkspace && selectedSatelliteId ? <ul>{REQUIRED_FIELDS.map(field => <li className={draft?.missing.includes(field.path) ? 'is-missing' : ''} key={field.path}><span>{field.label}{field.unit ? ` (${field.unit})` : ''}</span>{input(field)}</li>)}</ul> : <p className="gmat-mission-run-blocker">Choose a compatible chemical-propulsion satellite to unlock these values.</p>}
        </section>
        {validWorkspace && selectedSatelliteId ? <section><header><strong>Assumed defaults to confirm</strong><span>Template defaults</span></header><ul>
          {OPTIONAL_FIELDS.map(field => <li key={field.path}><span>{field.label}{field.unit ? ` (${field.unit})` : ''}</span>{input(field)}</li>)}
          <li><span>Vehicle properties</span><b>From satellite.json</b></li>
        </ul></section> : null}
        <button className="gmat-mission-run-button" disabled={busy || !draft || draft.missing.length > 0} onClick={() => { void confirmAndRun() }} type="button">{busy ? 'Running GMAT…' : 'Confirm and run GMAT'}</button>
        {activeRunId ? <><button className="gmat-mission-run-button" disabled={simuCicRunning} onClick={onRunSimuCic} type="button">{simuCicRunning ? 'Running Simu-CIC…' : 'Run Simu-CIC'}</button><button className="gmat-mission-run-button" disabled={!simuCicCompleted || simuCicRunning} onClick={onRunOpalis} type="button">Run OPALIS</button><button className="gmat-mission-run-button" disabled={!simuCicCompleted || simuCicRunning} onClick={onRunRfComlink} type="button">Generate RF-COMLINK .rfcl</button></> : null}
      </aside>
      <section className="gmat-mission-chat-thread">
        <header><strong>Mission discussion</strong><span>Deterministic template</span></header>
        <div className="gmat-mission-chat-history">
          {error ? <p className="chemical-hohmann-message is-error">{error}</p> : null}
          {notice ? <p className="chemical-hohmann-message">{notice}</p> : null}
          {!validWorkspace || !selectedSatelliteId ? <p className="gmat-mission-chat-placeholder">Select the Chemical Hohmann transfer template, then select the compatible chemical-propulsion satellite. A new dated mission run is created for this discussion.</p> : <><p className="gmat-mission-chat-placeholder">Enter the initial Keplerian orbit and the target orbit radius. The application converts the initial orbit to the Cartesian state required by the fixed GMAT tutorial, while satellite-owned values remain in satellite.json.</p><div className="chemical-hohmann-guidance"><strong>Assistant role</strong><p>The LLM can fill these exact same values from a natural-language message. It cannot modify satellite-owned values or the fixed GMAT algorithm.</p></div>{draft?.conversation.map((turn, index) => <div className="chemical-hohmann-turn" key={`${turn.user}-${index}`}><div className="is-user"><span>You</span>{turn.user}</div><div className="is-assistant"><span>GMAT assistant</span>{turn.assistant}</div></div>)}</>}
        </div>
        <div className="gmat-mission-composer"><textarea disabled={busy || !draft} onChange={event => setAssistantMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void askAssistant() } }} placeholder="Describe the Hohmann-transfer mission values; the assistant can fill the form..." rows={3} value={assistantMessage} /><button disabled={busy || !draft || !assistantMessage.trim()} onClick={() => { void askAssistant() }} type="button">Send</button></div>
      </section>
    </div>
  </section>
}
