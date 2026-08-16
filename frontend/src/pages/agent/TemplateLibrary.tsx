import { useState } from 'react'

type TemplateDefinition = {
  id: 'orbit-keeping' | 'electric-propulsion-transfer' | 'chemical-hohmann-transfer'
  name: string
  summary: string
  objective: string
  requiredMissionInputs: string[]
  satelliteRequirements: string[]
  outputs: string[]
  downstream: string[]
}

const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'orbit-keeping',
    name: 'Orbit keeping',
    summary: 'Chemical-propulsion LEO station keeping with drag decay and reboost events.',
    objective: 'Maintain a minimum orbital altitude while consuming the chemical propellant carried by the selected satellite.',
    requiredMissionInputs: ['Initial epoch', 'Initial altitude or semi-major axis', 'Eccentricity', 'Inclination', 'Initial fuel mass', 'Minimum reboost altitude'],
    satelliteRequirements: ['Dry mass', 'Chemical propellant capacity', 'Specific impulse', 'Drag area and coefficient'],
    outputs: ['GMAT script and values', 'Orbit and reboost reports', 'OEM ephemeris', 'Run-local satellite.json'],
    downstream: ['Simu-CIC attitude and CIC files', 'OPALIS electrical model', 'RF-COMLINK link analysis'],
  },
  {
    id: 'electric-propulsion-transfer',
    name: 'Electric propulsion transfer',
    summary: 'Low-thrust electric orbit transfer driven by the selected satellite electrical system.',
    objective: 'Propagate an electric-thrust transfer using the spacecraft mass, propellant, thruster and solar-power constraints.',
    requiredMissionInputs: ['Initial epoch', 'Initial altitude or semi-major axis', 'Eccentricity', 'Inclination', 'Electric-thrust duration'],
    satelliteRequirements: ['Dry mass', 'Electric propellant capacity', 'Thruster power limits', 'Solar-array power, bus load and margin'],
    outputs: ['GMAT script and values', 'Electric-transfer report', 'OEM ephemeris', 'Run-local satellite.json'],
    downstream: ['Simu-CIC attitude and CIC files', 'OPALIS electrical model', 'RF-COMLINK link analysis'],
  },
  {
    id: 'chemical-hohmann-transfer',
    name: 'Chemical Hohmann transfer',
    summary: 'Two-impulse chemical transfer solved by GMAT’s differential corrector.',
    objective: 'Raise or lower an Earth orbit using a transfer-orbit burn followed by a circularisation burn at apoapsis.',
    requiredMissionInputs: ['Initial epoch', 'Initial altitude or semi-major axis', 'Eccentricity', 'Inclination', 'Target orbit radius'],
    satelliteRequirements: ['Dry mass', 'Chemical propulsion and Isp', 'Drag area and coefficient'],
    outputs: ['GMAT script and values', 'GMAT execution log', 'Run-local satellite.json'],
    downstream: ['GMAT execution only in the initial baseline'],
  },
]

export function TemplateLibrary() {
  const [activeId, setActiveId] = useState<TemplateDefinition['id']>('orbit-keeping')
  const active = TEMPLATES.find(template => template.id === activeId) ?? TEMPLATES[0]
  return <div className="template-library">
    <section className="satellite-library-intro">
      <div><span>GMAT MODEL LIBRARY</span><h2>Mission Templates</h2><p>Explore the deterministic GMAT models available in Mission Studio. Choosing a template for a run remains a Mission Studio action.</p></div>
    </section>
    <div className="template-library-grid">
      <div className="template-definition-list">
        {TEMPLATES.map(template => <article className={`template-definition-card ${template.id === activeId ? 'is-selected' : ''}`} key={template.id}>
          <header><span>GMAT TEMPLATE</span><small>{template.id}</small></header><h3>{template.name}</h3><p>{template.summary}</p>
          <dl className="template-card-summary"><div><dt>Mission inputs</dt><dd>{template.requiredMissionInputs.length}</dd></div><div><dt>Satellite constraints</dt><dd>{template.satelliteRequirements.length}</dd></div><div><dt>Downstream tools</dt><dd>{template.downstream.length}</dd></div></dl>
          <button type="button" onClick={() => setActiveId(template.id)}>View template details</button>
        </article>)}
      </div>
      <aside className="template-active-card">
        <span>MODEL DESCRIPTION</span><small>{active.id}</small><h3>{active.name}</h3><p>{active.summary}</p><hr />
        <h4>Purpose</h4><p>{active.objective}</p>
        <h4>Required mission inputs</h4><ul>{active.requiredMissionInputs.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Read from satellite.json</h4><ul>{active.satelliteRequirements.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Generated artifacts</h4><ul>{active.outputs.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Next workflow stages</h4><ul>{active.downstream.map(item => <li key={item}>{item}</li>)}</ul>
      </aside>
    </div>
  </div>
}
