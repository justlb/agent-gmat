import { useEffect, useState } from 'react'
import { getSelectedSatellite, listSatelliteDefinitions, satelliteDefinitionDownloadUrl, selectSatelliteDefinition, type SatelliteDefinition } from './satelliteLibraryApi'

type TechnicalRow = [label: string, detail: string]

export function SatelliteLibrary({ workspaceDir, onSelected }: { workspaceDir?: string | null; onSelected?: () => void }) {
  const [definitions, setDefinitions] = useState<SatelliteDefinition[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')
  const canSelectForRun = /[\\/]gmat[\\/]mission-runs[\\/][^\\/]+$/u.test(workspaceDir ?? '')
  useEffect(() => {
    let cancelled = false
    void Promise.all([listSatelliteDefinitions(), getSelectedSatellite(workspaceDir)])
      .then(([items, thread]) => { if (!cancelled) { setDefinitions(items); setSelectedId(String(thread.document.digital_thread?.satellite_definition?.id ?? '')); setError('') } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load the satellite library') })
    return () => { cancelled = true }
  }, [workspaceDir])
  const select = async (definition: SatelliteDefinition) => {
    if (!canSelectForRun) {
      setError('Start a new GMAT mission discussion first. Its dated satellite.json will receive the selected satellite.')
      return
    }
    setSaving(definition.id); setError('')
    try { await selectSatelliteDefinition(definition.id, definition.version, workspaceDir); setSelectedId(definition.id); onSelected?.() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to select satellite') }
    finally { setSaving('') }
  }
  const metric = (definition: SatelliteDefinition, propertyPath: string) => propertyPath.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, definition.satellite)
  const value = (definition: SatelliteDefinition, propertyPath: string, unit = '') => {
    const result = metric(definition, propertyPath)
    return result === null || result === undefined || result === '' ? '—' : `${String(result)}${unit ? ` ${unit}` : ''}`
  }
  const rows = (definition: SatelliteDefinition): TechnicalRow[] => [
    ['Operator', value(definition, 'identity.operator')],
    ['Mission', value(definition, 'identity.mission_type')],
    ['Dry / wet mass', `${value(definition, 'bus.physical.mass_kg.dry', 'kg')} / ${value(definition, 'bus.physical.mass_kg.wet_at_launch', 'kg')}`],
    ['Propellant', value(definition, 'bus.physical.mass_kg.propellant', 'kg')],
    ['Aerodynamics', `${value(definition, 'bus.physical.drag_area_m2', 'm²')} · Cd ${value(definition, 'bus.physical.drag_coefficient')}`],
    ['Propulsion', value(definition, 'bus.propulsion_subsystem.type')],
    ['Thrust', value(definition, 'bus.propulsion_subsystem.main_engine_thrust_n', 'N') !== '—' ? value(definition, 'bus.propulsion_subsystem.main_engine_thrust_n', 'N') : value(definition, 'bus.propulsion_subsystem.nominal_thrust_newtons', 'N')],
    ['Specific impulse', value(definition, 'bus.propulsion_subsystem.specific_impulse_seconds', 's')],
    ['Solar array', `${value(definition, 'bus.electrical_subsystem.solar_panels.total_area_m2', 'm²')} · ${value(definition, 'bus.electrical_subsystem.solar_panels.total_power_generated_watts', 'W')}`],
    ['Battery', `${value(definition, 'bus.electrical_subsystem.batteries.chemistry')} · ${value(definition, 'bus.electrical_subsystem.batteries.energy_wh', 'Wh')}`],
    ['Bus load', `${value(definition, 'bus.electrical_subsystem.spacecraft_bus_load_kw', 'kW')} · ${value(definition, 'bus.electrical_subsystem.bus_voltage_v', 'V')}`],
    ['OPALIS load', `${value(definition, 'bus.opalis.power_distribution.consumption_mode')} · ${value(definition, 'bus.opalis.power_distribution.constant_load_w', 'W')}`],
  ]
  const renderRows = (definition: SatelliteDefinition, items: TechnicalRow[]) => <dl className="satellite-technical-summary">{items.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
  const renderSolarSections = (definition: SatelliteDefinition) => {
    const sections = metric(definition, 'bus.opalis.solar_generator.sections')
    if (!Array.isArray(sections) || !sections.length) return <p className="satellite-no-sections">No OPALIS solar section is defined.</p>
    return <div className="satellite-solar-sections">{sections.map((rawSection, index) => {
      const section = rawSection && typeof rawSection === 'object' ? rawSection as Record<string, unknown> : {}
      const sectionValue = (key: string, unit = '') => section[key] === null || section[key] === undefined || section[key] === '' ? '—' : `${String(section[key])}${unit ? ` ${unit}` : ''}`
      return <section key={index}><strong>Section {index + 1}</strong><span>{sectionValue('type')} · {sectionValue('anchor_type')}</span><dl><div><dt>Area</dt><dd>{sectionValue('area_m2', 'm²')}</dd></div><div><dt>Fill factor</dt><dd>{sectionValue('filling_factor')}</dd></div><div><dt>Cells</dt><dd>{sectionValue('cells_series')}S × {sectionValue('cells_parallel')}P</dd></div><div><dt>Rated power</dt><dd>{sectionValue('rated_power_w', 'W')}</dd></div></dl></section>
    })}</div>
  }
  const active = definitions.find(item => item.id === selectedId)
  return <div className="satellite-library">
    <section className="satellite-library-intro">
      <div><span>PHYSICAL SOURCE OF TRUTH</span><h2>Satellite Library</h2><p>Start a mission discussion, then select a versioned spacecraft for its dated run. Each run owns an independent satellite.json.</p></div>
      <button type="button" disabled>Design with the LLM · next phase</button>
    </section>
    {error ? <p className="satellite-library-error">{error}</p> : null}
    <div className="satellite-library-grid">
      <div className="satellite-definition-list">
        {definitions.map(definition => <article className={`satellite-definition-card ${definition.id === selectedId ? 'is-selected' : ''}`} key={`${definition.id}:${definition.version}`}>
          <header><span>REFERENCE</span><small>v{definition.version}</small></header><h3>{definition.name}</h3><p>{definition.description}</p>
          <div className="satellite-metrics"><span>Dry mass <strong>{value(definition, 'bus.physical.mass_kg.dry', 'kg')}</strong></span><span>Solar array <strong>{value(definition, 'bus.electrical_subsystem.solar_panels.total_area_m2', 'm²')}</strong></span><span>Battery <strong>{value(definition, 'bus.electrical_subsystem.batteries.capacity_ah', 'Ah')}</strong></span></div>
          {renderRows(definition, rows(definition).slice(0, 6))}
          <details className="satellite-definition-details"><summary>Electrical system &amp; OPALIS configuration</summary>{renderRows(definition, rows(definition).slice(6))}<dl className="satellite-technical-summary"><div><dt>Power margin</dt><dd>{value(definition, 'bus.electrical_subsystem.system_margin_percent', '%')}</dd></div><div><dt>Solar sections</dt><dd>{Array.isArray(metric(definition, 'bus.opalis.solar_generator.sections')) ? `${(metric(definition, 'bus.opalis.solar_generator.sections') as unknown[]).length} configured sections` : '—'}</dd></div><div><dt>Battery SoC</dt><dd>{value(definition, 'bus.opalis.battery.initial_state_of_charge')}</dd></div><div><dt>Voltage limits</dt><dd>{value(definition, 'bus.opalis.battery.initial_voltage_v', 'V')} initial · {value(definition, 'bus.opalis.battery.low_voltage_limit_v', 'V')} low</dd></div></dl>{renderSolarSections(definition)}</details>
          <div className="satellite-tags">{definition.capabilities.map(capability => <span key={capability}>{capability} · ready</span>)}{definition.mission_templates.map(template => <span key={template}>{template === 'orbit-keeping' ? 'Orbit keeping' : 'Electric transfer'}</span>)}</div>
          <a className="satellite-definition-download" href={satelliteDefinitionDownloadUrl(definition)}>Download reference JSON</a>
          <button type="button" disabled={!canSelectForRun || saving === definition.id} onClick={() => void select(definition)}>{saving === definition.id ? 'Selecting…' : definition.id === selectedId ? 'Selected satellite' : canSelectForRun ? 'Use for this mission' : 'Start a mission first'}</button>
        </article>)}
      </div>
      <aside className="satellite-active-card"><span>ACTIVE SATELLITE</span>{active ? <><small>{active.id}@{active.version}</small><h3>{active.name}</h3><p>{value(active, 'identity.operator')} · {value(active, 'identity.mission_type')}</p><a className="satellite-definition-download" href={satelliteDefinitionDownloadUrl(active)}>Download reference JSON</a><hr /><h4>Physical definition</h4>{renderRows(active, rows(active).slice(2, 6))}<h4>Electrical &amp; OPALIS</h4>{renderRows(active, rows(active).slice(8))}<h4>Solar array sections</h4>{renderSolarSections(active)}<h4>Template compatibility</h4><div className="satellite-tags">{active.mission_templates.map(template => <span key={template}>{template === 'orbit-keeping' ? 'Orbit keeping' : 'Electric transfer'}</span>)}</div></> : <p>Choose a reference satellite to make it the physical source of truth for this workspace.</p>}</aside>
    </div>
  </div>
}
