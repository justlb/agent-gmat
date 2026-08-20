import { useState } from 'react'
import { GMAT_MISSION_TEMPLATE_DEFINITIONS, type GmatMissionTemplateId } from './gmatMissionTemplates'

const TEMPLATES = Object.values(GMAT_MISSION_TEMPLATE_DEFINITIONS)

export function TemplateLibrary() {
  const [activeId, setActiveId] = useState<GmatMissionTemplateId>('orbit-keeping')
  const active = TEMPLATES.find(template => template.id === activeId) ?? TEMPLATES[0]
  return <div className="template-library">
    <section className="satellite-library-intro">
      <div><span>GMAT MODEL LIBRARY</span><h2>Mission Scenarios</h2><p>Explore the deterministic GMAT mission scenarios available in Mission Studio. Choosing a scenario for a run remains a Mission Studio action.</p></div>
    </section>
    <div className="template-library-grid">
      <div className="template-definition-list">
        {TEMPLATES.map(template => <article className={`template-definition-card ${template.id === activeId ? 'is-selected' : ''}`} key={template.id}>
          <header><span>GMAT MISSION SCENARIO</span><small>{template.id}</small></header><h3>{template.label}</h3><p>{template.summary}</p>
          <dl className="template-card-summary"><div><dt>Mission inputs</dt><dd>{template.inputFields.length}</dd></div><div><dt>Satellite constraints</dt><dd>{template.satelliteRequirements.length}</dd></div><div><dt>Downstream tools</dt><dd>{template.downstream.length}</dd></div></dl>
          <button type="button" onClick={() => setActiveId(template.id)}>View scenario details</button>
        </article>)}
      </div>
      <aside className="template-active-card">
        <span>MODEL DESCRIPTION</span><small>{active.id}</small><h3>{active.label}</h3><p>{active.summary}</p><hr />
        <h4>Purpose</h4><p>{active.objective}</p>
        <h4>Required mission inputs</h4><ul>{active.inputFields.map(item => <li key={item.path}>{item.label}</li>)}</ul>
        <h4>Read from satellite.json</h4><ul>{active.satelliteRequirements.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Generated artifacts</h4><ul>{active.outputs.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Next workflow stages</h4><ul>{active.downstream.map(item => <li key={item}>{item}</li>)}</ul>
      </aside>
    </div>
  </div>
}
