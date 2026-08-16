import { useEffect, useMemo, useState } from 'react'
import { getSelectedSatellite, listSatelliteDefinitions, satelliteDefinitionDownloadUrl, type SatelliteDefinition } from './satelliteLibraryApi'

type TechnicalRow = [label: string, detail: string]

const templateLabel = (template: string) => template === 'orbit-keeping' ? 'Orbit keeping' : 'Electric transfer'

export function SatelliteLibrary({ workspaceDir }: { workspaceDir?: string | null }) {
  const [definitions, setDefinitions] = useState<SatelliteDefinition[]>([])
  const [activeDefinitionId, setActiveDefinitionId] = useState('')
  const [runSatelliteId, setRunSatelliteId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all([listSatelliteDefinitions(), getSelectedSatellite(workspaceDir)])
      .then(([items, thread]) => {
        if (cancelled) return
        const runId = String(thread.document.digital_thread?.satellite_definition?.id ?? '')
        setDefinitions(items)
        setRunSatelliteId(runId)
        setActiveDefinitionId(current => items.some(item => item.id === current) ? current : runId || items[0]?.id || '')
        setError('')
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load the satellite library') })
    return () => { cancelled = true }
  }, [workspaceDir])

  const metric = (definition: SatelliteDefinition, propertyPath: string) => propertyPath.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, definition.satellite)
  const value = (definition: SatelliteDefinition, propertyPath: string, unit = '') => {
    const result = metric(definition, propertyPath)
    return result === null || result === undefined || result === '' ? '—' : `${String(result)}${unit ? ` ${unit}` : ''}`
  }
  const rows = (definition: SatelliteDefinition): TechnicalRow[] => [
    ['Operator', value(definition, 'identity.operator')],
    ['Mission', value(definition, 'identity.mission_type')],
    ['Dry / wet mass', `${value(definition, 'bus.physical.mass_kg.dry', 'kg')} / ${value(definition, 'bus.physical.mass_kg.wet_at_launch', 'kg')}`],
    ['Propellant capacity', value(definition, 'bus.physical.mass_kg.propellant', 'kg')],
    ['Drag model', `${value(definition, 'bus.physical.drag_area_m2', 'm²')} · Cd ${value(definition, 'bus.physical.drag_coefficient')}`],
    ['Propulsion', value(definition, 'bus.propulsion_subsystem.type')],
    ['Thrust', value(definition, 'bus.propulsion_subsystem.main_engine_thrust_n', 'N') !== '—' ? value(definition, 'bus.propulsion_subsystem.main_engine_thrust_n', 'N') : value(definition, 'bus.propulsion_subsystem.nominal_thrust_newtons', 'N')],
    ['Specific impulse', value(definition, 'bus.propulsion_subsystem.specific_impulse_seconds', 's')],
    ['Solar array', `${value(definition, 'bus.electrical_subsystem.solar_panels.total_area_m2', 'm²')} · ${value(definition, 'bus.electrical_subsystem.solar_panels.total_power_generated_watts', 'W')}`],
    ['Battery', `${value(definition, 'bus.electrical_subsystem.batteries.chemistry')} · ${value(definition, 'bus.electrical_subsystem.batteries.energy_wh', 'Wh')}`],
    ['Bus load', `${value(definition, 'bus.electrical_subsystem.spacecraft_bus_load_kw', 'kW')} · ${value(definition, 'bus.electrical_subsystem.bus_voltage_v', 'V')}`],
    ['OPALIS distribution', `${value(definition, 'bus.opalis.power_distribution.consumption_mode')} · ${value(definition, 'bus.opalis.power_distribution.constant_load_w', 'W')}`],
  ]
  const renderRows = (items: TechnicalRow[]) => <dl className="satellite-technical-summary">{items.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
  const renderSolarSections = (definition: SatelliteDefinition) => {
    const sections = metric(definition, 'bus.opalis.solar_generator.sections')
    if (!Array.isArray(sections) || !sections.length) return <p className="satellite-no-sections">No OPALIS solar section is defined.</p>
    return <div className="satellite-solar-sections">{sections.map((rawSection, index) => {
      const section = rawSection && typeof rawSection === 'object' ? rawSection as Record<string, unknown> : {}
      const sectionValue = (key: string, unit = '') => section[key] === null || section[key] === undefined || section[key] === '' ? '—' : `${String(section[key])}${unit ? ` ${unit}` : ''}`
      return <section key={index}><strong>Section {index + 1}</strong><span>{sectionValue('type')} · {sectionValue('anchor_type')}</span><dl><div><dt>Area</dt><dd>{sectionValue('area_m2', 'm²')}</dd></div><div><dt>Fill factor</dt><dd>{sectionValue('filling_factor')}</dd></div><div><dt>Cells</dt><dd>{sectionValue('cells_series')}S × {sectionValue('cells_parallel')}P</dd></div><div><dt>Rated power</dt><dd>{sectionValue('rated_power_w', 'W')}</dd></div></dl></section>
    })}</div>
  }
  const renderRfLinks = (definition: SatelliteDefinition) => {
    const links = metric(definition, 'bus.rf_comlink.links')
    if (!Array.isArray(links) || !links.length) return <p className="satellite-no-sections">No RF link is defined.</p>
    return <div className="satellite-rf-links">{links.map((rawLink, index) => {
      const link = rawLink && typeof rawLink === 'object' ? rawLink as Record<string, unknown> : {}
      const system = link.system && typeof link.system === 'object' ? link.system as Record<string, unknown> : {}
      return <section key={String(link.id ?? index)}><strong>{String(link.name ?? `Link ${index + 1}`)}</strong><span>{String(link.direction ?? '—')} · {String(system.frequency_band ?? '—')} {system.frequency_mhz ? `${String(system.frequency_mhz)} MHz` : ''}</span><small>{system.data_rate_bps ? `${Number(system.data_rate_bps).toLocaleString()} bit/s` : 'Data rate not specified'} · BER {String(system.bit_error_rate ?? '—')}</small></section>
    })}</div>
  }

  const active = useMemo(() => definitions.find(item => item.id === activeDefinitionId) ?? null, [activeDefinitionId, definitions])
  return <div className="satellite-library">
    <section className="satellite-library-intro">
      <div><span>PHYSICAL COMPONENT LIBRARY</span><h2>Satellite Library</h2><p>Explore versioned physical definitions. This page documents spacecraft; satellite selection happens in Mission Studio and creates an independent run-local satellite.json.</p></div>
    </section>
    {error ? <p className="satellite-library-error">{error}</p> : null}
    <div className="satellite-library-grid">
      <div className="satellite-definition-list">
        {definitions.map(definition => <article className={`satellite-definition-card ${definition.id === activeDefinitionId ? 'is-selected' : ''}`} key={`${definition.id}:${definition.version}`}>
          <header><span>REFERENCE DEFINITION</span><small>v{definition.version}</small></header><h3>{definition.name}</h3><p>{definition.description}</p>
          <div className="satellite-metrics"><span>Dry mass <strong>{value(definition, 'bus.physical.mass_kg.dry', 'kg')}</strong></span><span>Solar array <strong>{value(definition, 'bus.electrical_subsystem.solar_panels.total_area_m2', 'm²')}</strong></span><span>RF links <strong>{Array.isArray(metric(definition, 'bus.rf_comlink.links')) ? (metric(definition, 'bus.rf_comlink.links') as unknown[]).length : 0}</strong></span></div>
          {renderRows(rows(definition).slice(0, 6))}
          <div className="satellite-tags">{definition.capabilities.map(capability => <span key={capability}>{capability}</span>)}{definition.mission_templates.map(template => <span key={template}>{templateLabel(template)}</span>)}{runSatelliteId === definition.id ? <span>Current run source</span> : null}</div>
          <div className="satellite-definition-actions"><button type="button" onClick={() => setActiveDefinitionId(definition.id)}>View full definition</button><a className="satellite-definition-download" href={satelliteDefinitionDownloadUrl(definition)}>Download JSON</a></div>
        </article>)}
      </div>
      <aside className="satellite-active-card">{active ? <><span>SPACECRAFT DEFINITION</span><small>{active.id}@{active.version}</small><h3>{active.name}</h3><p>{value(active, 'identity.operator')} · {value(active, 'identity.mission_type')}</p><a className="satellite-definition-download" href={satelliteDefinitionDownloadUrl(active)}>Download complete reference JSON</a><hr /><h4>Mass, aerodynamics &amp; propulsion</h4>{renderRows(rows(active).slice(2, 8))}<h4>Electrical system</h4>{renderRows(rows(active).slice(8, 12))}<h4>Solar-array sections</h4>{renderSolarSections(active)}<h4>RF-COMLINK links</h4>{renderRfLinks(active)}<h4>Compatible GMAT templates</h4><div className="satellite-tags">{active.mission_templates.map(template => <span key={template}>{templateLabel(template)}</span>)}</div></> : <p>No satellite definition is available.</p>}</aside>
    </div>
  </div>
}
