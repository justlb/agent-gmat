import { useEffect, useState, type ComponentProps } from 'react'
import { AgentFilesView } from './files/AgentFilesView'
import { getSelectedSatellite, listSatelliteDefinitions, selectSatelliteDefinition, type SatelliteDefinition } from './satelliteLibraryApi'

type Props = ComponentProps<typeof AgentFilesView> & { workspaceDir?: string | null; refreshSatellite?: number; onSatelliteSelected?: () => void }
export function MissionStudio({ workspaceDir, refreshSatellite = 0, onSatelliteSelected, ...files }: Props) {
  const [definitions, setDefinitions] = useState<SatelliteDefinition[]>([]); const [selectedId, setSelectedId] = useState(''); const [error, setError] = useState('')
  useEffect(() => { let cancelled = false; void Promise.all([listSatelliteDefinitions(), getSelectedSatellite(workspaceDir)]).then(([items, thread]) => { if (!cancelled) { setDefinitions(items); setSelectedId(String(thread.document.digital_thread?.satellite_definition?.id ?? '')); setError('') } }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load satellite selection') }); return () => { cancelled = true } }, [workspaceDir, refreshSatellite])
  const selected = definitions.find(item => item.id === selectedId)
  const source = <section className="mission-satellite-source"><div><span>SATELLITE SOURCE OF TRUTH</span><strong>{selected?.name ?? 'No satellite selected'}</strong><small>{selected ? `${selected.id}@${selected.version} · Versioned physical definition` : 'Select a satellite in Satellite Library before starting a GMAT mission.'}</small></div><select aria-label="Satellite version" value={selectedId} onChange={event => { const next = definitions.find(item => item.id === event.target.value); if (!next) return; void selectSatelliteDefinition(next.id, next.version, workspaceDir).then(() => { setSelectedId(next.id); onSatelliteSelected?.() }).catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to select satellite')) }}><option value="">Choose a satellite…</option>{definitions.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></section>
  return <div className="mission-studio">{error ? <p className="satellite-library-error">{error}</p> : null}<AgentFilesView {...files} topContent={source} /></div>
}
