import { useEffect, useState, type ComponentProps } from 'react'

import { AgentFilesView } from './files/AgentFilesView'
import { isGmatMissionTemplateId, type GmatMissionTemplateId } from './gmatMissionTemplates'
import { listMissionTemplateDefinitions, type MissionTemplateDefinition } from './missionTemplateCatalogApi'
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
  const [templates, setTemplates] = useState<MissionTemplateDefinition[]>([])
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
    void Promise.all([listSatelliteDefinitions(), getSelectedSatellite(workspaceDir), listMissionTemplateDefinitions()])
      .then(([items, thread, availableTemplates]) => {
        if (cancelled) return
        setDefinitions(items)
        setTemplates(availableTemplates)
        setSelectedId(String(thread.document.digital_thread?.satellite_definition?.id ?? ''))
        setError('')
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load satellite selection') })
    return () => { cancelled = true }
  }, [workspaceDir, refreshSatellite])

  const selectedTemplate = templates.find(item => item.id === missionTemplate)
  const compatibleDefinitions = selectedTemplate ? definitions.filter(item => item.mission_templates.includes(selectedTemplate.id)) : definitions
  const selected = compatibleDefinitions.find(item => item.id === selectedId)
  const source = <div className="mission-setup-sources">
    <section className="mission-template-source">
      <div>
        <span>GMAT MISSION SCENARIO</span>
        <strong>{selectedTemplate?.name ?? 'Choose a mission scenario'}</strong>
        <small>{templateLocked ? 'The mission scenario is locked for the current draft.' : 'Choose the mission scenario before entering mission parameters.'}</small>
      </div>
      <select aria-label="GMAT mission scenario" disabled={templateLocked || (!canSelectForRun && !onStartMission)} value={missionTemplate ?? ''} onChange={event => {
        const next = isGmatMissionTemplateId(event.target.value) ? event.target.value : null
        void ensureMissionRun().then(() => onMissionTemplateSelected?.(next)).catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to start a mission run'))
      }}>
        <option value="">Choose a mission scenario...</option>
        {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
    </section>
    <section className="mission-satellite-source">
      <div>
        <span>SATELLITE SOURCE OF TRUTH</span>
        <strong>{selected?.name ?? 'No satellite selected'}</strong>
        <small>{selected ? `${selected.id}@${selected.version} · Versioned physical definition` : selectedTemplate ? `Choose a satellite compatible with ${selectedTemplate.name}.` : 'Select a satellite in Satellite Library before starting a GMAT mission.'}</small>
      </div>
      <select aria-label="Satellite version" disabled={satelliteLocked || (!canSelectForRun && !onStartMission)} value={selectedId} onChange={event => {
        const next = definitions.find(item => item.id === event.target.value)
        if (!next) return
        void ensureMissionRun().then(runWorkspaceDir => selectSatelliteDefinition(next.id, next.version, runWorkspaceDir))
          .then(() => { setSelectedId(next.id); onSatelliteSelected?.() })
          .catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to select satellite'))
      }}>
        <option value="">Choose a satellite…</option>
        {compatibleDefinitions.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
      </select>
    </section>
  </div>

  return <div className="mission-studio">{error ? <p className="satellite-library-error">{error}</p> : null}<AgentFilesView {...files} topContent={source} /></div>
}
