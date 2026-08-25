import { useEffect, useState } from 'react'
import type { GmatMissionTemplateId } from './gmatMissionTemplates'
import { listMissionTemplateDefinitions, type MissionTemplateDefinition } from './missionTemplateCatalogApi'

export function TemplateLibrary() {
  const [activeId, setActiveId] = useState<GmatMissionTemplateId>('orbit-keeping')
  const [templates, setTemplates] = useState<MissionTemplateDefinition[]>([])
  const [error, setError] = useState('')
  useEffect(() => { let cancelled = false; void listMissionTemplateDefinitions().then(items => { if (!cancelled) { setTemplates(items); setActiveId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? 'orbit-keeping') } }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load mission scenarios') }); return () => { cancelled = true } }, [])
  const active = templates.find(template => template.id === activeId) ?? templates[0]
  return <div className="template-library">
    <section className="satellite-library-intro">
      <div><span>GMAT MODEL LIBRARY</span><h2>Mission scenarios</h2><p>Explore the deterministic GMAT mission scenarios available in Mission Studio. Choosing a scenario for a run remains a Mission Studio action.</p></div>
    </section>
    <div className="template-library-grid">
      <div className="template-definition-list">
        {error ? <p className="satellite-library-error">{error}</p> : null}
        {templates.map(template => <article className={`template-definition-card ${template.id === activeId ? 'is-selected' : ''}`} key={template.id}>
          <header><span>GMAT MISSION SCENARIO</span><small>{template.id}</small></header><h3>{template.name}</h3><p>{template.ui.summary}</p>
          <dl className="template-card-summary"><div><dt>Mission inputs</dt><dd>{template.ui.missionInputFields.length}</dd></div><div><dt>Satellite constraints</dt><dd>{template.ui.satelliteRequirements.length}</dd></div><div><dt>Downstream tools</dt><dd>{template.downstreamAnalyses.length}</dd></div></dl>
          <button type="button" onClick={() => setActiveId(template.id)}>View scenario details</button>
        </article>)}
      </div>
      {active ? <aside className="template-active-card">
        <span>MODEL DESCRIPTION</span><small>{active.id}</small><h3>{active.name}</h3><p>{active.ui.summary}</p><hr />
        <h4>Purpose</h4><p>{active.ui.objective}</p>
        <h4>Required mission inputs</h4><ul>{active.ui.missionInputFields.map(item => <li key={item.path}>{item.label}</li>)}</ul>
        <h4>Read from satellite.json</h4><ul>{active.ui.satelliteRequirements.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Generated artifacts</h4><ul>{active.ui.outputs.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Next workflow stages</h4><ul>{active.downstreamAnalyses.map(item => <li key={item}>{item}</li>)}</ul>
      </aside> : <aside className="template-active-card"><p>Loading mission-scenario catalogue…</p></aside>}
    </div>
  </div>
}
