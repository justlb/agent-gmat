import { useEffect, useState } from 'react'
import type { GmatMissionTemplateId } from './gmatMissionTemplates'
import { listMissionTemplateDefinitions, missionTemplateExampleScriptUrl, type MissionTemplateDefinition } from './missionTemplateCatalogApi'

export function TemplateLibrary() {
  const [activeId, setActiveId] = useState<GmatMissionTemplateId>('orbit-keeping')
  const [templates, setTemplates] = useState<MissionTemplateDefinition[]>([])
  const [error, setError] = useState('')
  useEffect(() => { let cancelled = false; void listMissionTemplateDefinitions().then(items => { const visible = items.filter(item => item.id !== 'chemical-3d-transfer'); if (!cancelled) { setTemplates(visible); setActiveId(current => visible.some(item => item.id === current) ? current : visible[0]?.id ?? 'orbit-keeping') } }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load templates') }); return () => { cancelled = true } }, [])
  const active = templates.find(template => template.id === activeId) ?? templates[0]
  return <div className="template-library">
    <section className="satellite-library-intro">
      <div><span>GMAT MODEL LIBRARY</span><h2>Mission Templates</h2><p>Explore the deterministic GMAT models available in Mission Studio. Choosing a template for a run remains a Mission Studio action.</p></div>
    </section>
    <div className="template-library-grid">
      <div className="template-definition-list">
        {error ? <p className="satellite-library-error">{error}</p> : null}
        {templates.map(template => <article className={`template-definition-card ${template.id === activeId ? 'is-selected' : ''}`} key={template.id}>
          <header><span>GMAT TEMPLATE</span><small>{template.id}</small></header><h3>{template.name}</h3><p>{template.ui.summary}</p>
          <dl className="template-card-summary"><div><dt>Mission inputs</dt><dd>{template.ui.missionInputFields.length}</dd></div><div><dt>Satellite constraints</dt><dd>{template.ui.satelliteRequirements.length}</dd></div><div><dt>Downstream tools</dt><dd>{template.downstreamAnalyses.length}</dd></div></dl>
          <div className="template-definition-actions">
            <button type="button" onClick={() => setActiveId(template.id)}>More information</button>
            <a download href={missionTemplateExampleScriptUrl(template.id)}>Download example script</a>
          </div>
        </article>)}
      </div>
      {active ? <aside className="template-active-card">
        <span>MODEL DESCRIPTION</span><small>{active.id}</small><h3>{active.name}</h3><p>{active.ui.summary}</p><hr />
        <h4>Purpose</h4><p>{active.ui.objective}</p>
        <h4>Modifiable mission values</h4>
        <p className="template-example-note">Reference values from the example GMAT script. They are examples, not imposed mission values.</p>
        <dl className="template-input-examples">{active.ui.missionInputFields.map(item => <div key={item.path}><dt>{item.label}{item.unit ? ` (${item.unit})` : ''}</dt><dd>{item.exampleValue === undefined ? 'Not defined in the example script' : String(item.exampleValue)}</dd></div>)}</dl>
        <h4>Read from satellite.json</h4><ul>{active.ui.satelliteRequirements.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Generated artifacts</h4><ul>{active.ui.outputs.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Next workflow stages</h4><ul>{active.downstreamAnalyses.map(item => <li key={item}>{item}</li>)}</ul>
      </aside> : <aside className="template-active-card"><p>Loading template catalogue…</p></aside>}
    </div>
  </div>
}
