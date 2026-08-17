import { useEffect, useState, type ComponentProps } from 'react'

import { AgentFilesView } from './files/AgentFilesView'
import { GMAT_MISSION_TEMPLATE_DEFINITIONS, isGmatMissionTemplateId, missionTemplateDefinition, type GmatMissionTemplateId } from './gmatMissionTemplates'
import { getSelectedSatellite, listSatelliteDefinitions, selectSatelliteDefinition, type SatelliteDefinition } from './satelliteLibraryApi'

type Props = ComponentProps<typeof AgentFilesView> & {
  workspaceDir?: string | null
  refreshSatellite?: number
  onSatelliteSelected?: () => void
  missionTemplate?: GmatMissionTemplateId | null
  onMissionTemplateSelected?: (template: GmatMissionTemplateId | null) => void
  onStartMission?: () => Promise<{ workspaceDir: string }>
}

export function MissionStudio({ workspaceDir, refreshSatellite = 0, onSatelliteSelected, missionTemplate = null, onMissionTemplateSelected, onStartMission, ...files }: Props) {
  const [definitions, setDefinitions] = useState<SatelliteDefinition[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const canSelectForRun = /[\\/]gmat[\\/]mission-runs[\\/][^\\/]+$/u.test(workspaceDir ?? '')
  const templateLocked = Boolean(files.activeGmatRunId || files.gmatMissionChat.draft)
  const satelliteLocked = Boolean(files.activeGmatRunId)
  const ensureMissionRun = async () => {
    if (canSelectForRun && workspaceDir) return workspaceDir
    if (!onStartMission) throw new Error('Unable to start a new mission run')
    return (await onStartMission()).workspaceDir
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([listSatelliteDefinitions(), getSelectedSatellite(workspaceDir)])
      .then(([items, thread]) => {
        if (cancelled) return
        setDefinitions(items)
        setSelectedId(String(thread.document.digital_thread?.satellite_definition?.id ?? ''))
        setError('')
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load satellite selection') })
    return () => { cancelled = true }
  }, [workspaceDir, refreshSatellite])

  const selected = definitions.find(item => item.id === selectedId)
  const source = <div className="mission-setup-sources">
    <section className="mission-template-source">
      <div>
        <span>GMAT MISSION TEMPLATE</span>
        <strong>{missionTemplate ? missionTemplateDefinition(missionTemplate).label : 'Choose a template'}</strong>
        <small>{templateLocked ? 'The template is locked for the current draft.' : 'Choose the mission model before entering mission parameters.'}</small>
      </div>
      <select aria-label="GMAT mission template" disabled={templateLocked || (!canSelectForRun && !onStartMission)} value={missionTemplate ?? ''} onChange={event => {
        const next = isGmatMissionTemplateId(event.target.value) ? event.target.value : null
        void ensureMissionRun().then(() => onMissionTemplateSelected?.(next)).catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to start a mission run'))
      }}>
        <option value="">Choose a template...</option>
        {Object.values(GMAT_MISSION_TEMPLATE_DEFINITIONS).map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
      </select>
    </section>
    <section className="mission-satellite-source">
      <div>
        <span>SATELLITE SOURCE OF TRUTH</span>
        <strong>{selected?.name ?? 'No satellite selected'}</strong>
        <small>{selected ? `${selected.id}@${selected.version} · Versioned physical definition` : 'Select a satellite in Satellite Library before starting a GMAT mission.'}</small>
      </div>
      <select aria-label="Satellite version" disabled={satelliteLocked || (!canSelectForRun && !onStartMission)} value={selectedId} onChange={event => {
        const next = definitions.find(item => item.id === event.target.value)
        if (!next) return
        void ensureMissionRun().then(runWorkspaceDir => selectSatelliteDefinition(next.id, next.version, runWorkspaceDir))
          .then(() => { setSelectedId(next.id); onSatelliteSelected?.() })
          .catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to select satellite'))
      }}>
        <option value="">Choose a satellite…</option>
        {definitions.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
      </select>
    </section>
  </div>

  return <div className="mission-studio">{error ? <p className="satellite-library-error">{error}</p> : null}<AgentFilesView {...files} topContent={source} /></div>
}
