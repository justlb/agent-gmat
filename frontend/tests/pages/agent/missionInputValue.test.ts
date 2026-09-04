import { describe, expect, it } from 'vitest'
import { missionInputValue, satelliteFrequencyBands } from '../../../src/pages/agent/missionInputValue'

describe('mission inputs', () => {
  const field = { path: 'initialOrbit.altitudeKm', label: 'Altitude', derived: 'initialAltitude' as const }
  it('displays altitude from the stored semi-major axis', () => {
    expect(missionInputValue({ 'initialOrbit.smaKm': 6631.1363 }, field)).toBe(253)
  })
  it('preserves edits and empty values until saved', () => {
    expect(missionInputValue({ 'initialOrbit.altitudeKm': '', 'initialOrbit.smaKm': 6631.1363 }, field)).toBe('')
    expect(missionInputValue({ 'initialOrbit.altitudeKm': 0 }, field)).toBe(0)
    expect(missionInputValue({}, field)).toBe('')
  })
  it('extracts every satellite RF band without duplicates', () => {
    expect(satelliteFrequencyBands({ links: [{ frequency_band: 's' }, { frequency_band: 'X' }, { frequency_band: 'S' }] })).toEqual(['S', 'X'])
  })
})
