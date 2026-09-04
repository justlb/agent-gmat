import type { MissionInputField } from './missionTemplateCatalogApi'

export function missionInputValue(values: Record<string, string | number | null>, field: MissionInputField) {
  if (values[field.path] !== undefined && values[field.path] !== null) return values[field.path]!
  const sma = values['initialOrbit.smaKm']
  if (field.derived === 'initialAltitude' && sma !== null && sma !== undefined && sma !== '' && Number.isFinite(Number(sma))) {
    return Number((Number(sma) - 6378.1363).toFixed(9))
  }
  return ''
}

export function satelliteFrequencyBands(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  return [...new Set(Object.entries(value).flatMap(([key, item]) => key === 'frequency_band' && typeof item === 'string'
    ? [item.toUpperCase()] : satelliteFrequencyBands(item)))]
}
