import { useEffect, useState } from 'react'
import { getSelectedSatellite, listSatelliteDefinitions, satelliteDefinitionDownloadUrl, selectSatelliteDefinition, type SatelliteDefinition } from './satelliteLibraryApi'

export function SatelliteLibrary({ workspaceDir, onSelected }: { workspaceDir?: string | null; onSelected?: () => void }) {
  const [definitions, setDefinitions] = useState<SatelliteDefinition[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')
  useEffect(() => {
    let cancelled = false
    void Promise.all([listSatelliteDefinitions(), getSelectedSatellite(workspaceDir)])
      .then(([items, thread]) => { if (!cancelled) { setDefinitions(items); setSelectedId(String(thread.document.digital_thread?.satellite_definition?.id ?? '')); setError('') } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load the satellite library') })
    return () => { cancelled = true }
  }, [workspaceDir])
  const select = async (definition: SatelliteDefinition) => {
    setSaving(definition.id); setError('')
    try { await selectSatelliteDefinition(definition.id, definition.version, workspaceDir); setSelectedId(definition.id); onSelected?.() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to select satellite') }
    finally { setSaving('') }
  }
  const metric = (definition: SatelliteDefinition, path: string) => path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, definition.satellite)
  const value = (definition: SatelliteDefinition, path: string, unit = '') => {
    const result = metric(definition, path)
    return result === null || result === undefined || result === '' ? '—' : `${String(result)}${unit ? ` ${unit}` : ''}`
  }
  const active = definitions.find(item => item.id === selectedId)
  return <div className="satellite-library">
    <section className="satellite-library-intro">
      <div><span>PHYSICAL SOURCE OF TRUTH</span><h2>Satellite Library</h2><p>Select a versioned spacecraft before describing a mission. Each run preserves an immutable snapshot of this definition.</p></div>
      <button type="button" disabled>Design with the LLM · next phase</button>
    </section>
    {error ? <p className="satellite-library-error">{error}</p> : null}
    <div className="satellite-library-grid">
      <div className="satellite-definition-list">
        {definitions.map(definition => <article className={`satellite-definition-card ${definition.id === selectedId ? 'is-selected' : ''}`} key={`${definition.id}:${definition.version}`}>
          <header><span>REFERENCE</span><small>v{definition.version}</small></header><h3>{definition.name}</h3><p>{definition.description}</p>
          <div className="satellite-metrics"><span>Dry mass <strong>{value(definition, 'bus.physical.mass_kg.dry', 'kg')}</strong></span><span>Solar array <strong>{value(definition, 'bus.electrical_subsystem.solar_panels.total_area_m2', 'm²')}</strong></span><span>Battery <strong>{value(definition, 'bus.electrical_subsystem.batteries.capacity_ah', 'Ah')}</strong></span></div>
          <dl className="satellite-technical-summary"><div><dt>Orbit</dt><dd>{value(definition, 'orbit.operational_parameters.orbit_type')} · {value(definition, 'orbit.operational_parameters.altitude_km.mean', 'km')}</dd></div><div><dt>State</dt><dd>a {value(definition, 'orbit.keplerian_elements.semi_major_axis_km', 'km')} · i {value(definition, 'orbit.keplerian_elements.inclination_deg', '°')}</dd></div><div><dt>Propulsion</dt><dd>{value(definition, 'bus.propulsion_subsystem.type')} · Isp {value(definition, 'bus.propulsion_subsystem.specific_impulse_seconds', 's')}</dd></div><div><dt>Power</dt><dd>{value(definition, 'bus.electrical_subsystem.solar_panels.total_power_generated_watts', 'W')} solar · bus {value(definition, 'bus.electrical_subsystem.spacecraft_bus_load_kw', 'kW')}</dd></div></dl>
          <div className="satellite-tags">{definition.capabilities.map(capability => <span key={capability}>{capability} · ready</span>)}{definition.mission_templates.map(template => <span key={template}>{template === 'orbit-keeping' ? 'Orbit keeping' : 'Electric transfer'}</span>)}</div>
          <a className="satellite-definition-download" href={satelliteDefinitionDownloadUrl(definition)}>Download reference JSON</a>
          <button type="button" disabled={saving === definition.id} onClick={() => void select(definition)}>{saving === definition.id ? 'Selecting…' : definition.id === selectedId ? 'Selected satellite' : 'Use for this workspace'}</button>
        </article>)}
      </div>
      <aside className="satellite-active-card"><span>ACTIVE SATELLITE</span>{active ? <><small>{active.id}@{active.version}</small><h3>{active.name}</h3><a className="satellite-definition-download" href={satelliteDefinitionDownloadUrl(active)}>Download reference JSON</a><hr /><h4>Mass</h4><dl><div><dt>Dry / wet mass</dt><dd>{value(active, 'bus.physical.mass_kg.dry', 'kg')} / {value(active, 'bus.physical.mass_kg.wet_at_launch', 'kg')}</dd></div><div><dt>Propellant</dt><dd>{value(active, 'bus.physical.mass_kg.propellant', 'kg')} max</dd></div></dl><h4>Propulsion & power</h4><dl><div><dt>Propulsion</dt><dd>{value(active, 'bus.propulsion_subsystem.type')}</dd></div><div><dt>Specific impulse</dt><dd>{value(active, 'bus.propulsion_subsystem.specific_impulse_seconds', 's')}</dd></div><div><dt>Solar maximum</dt><dd>{value(active, 'bus.electrical_subsystem.solar_panels.total_power_generated_watts', 'W')}</dd></div><div><dt>Thruster power</dt><dd>{value(active, 'bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw', 'kW')}–{value(active, 'bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw', 'kW')}</dd></div></dl></> : <p>Choose a reference satellite to make it the physical source of truth for this workspace.</p>}</aside>
    </div>
  </div>
}
