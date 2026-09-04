import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rfGroundStationsFromDatabase } from '../../src/rfComlink/groundStationCatalog.js'

test('RF catalogue intersects installed sites with Simu-CIC and exposes available bands', () => {
  const row = (code: string, band: string, location: string) => [code, band, location, ...Array(27).fill('0')].map(x => `"${x}"`).join('\t')
  const stations = rfGroundStationsFromDatabase([
    'CIC_MPM_VERS = 1.0', row('KOU_CNES', 'S', 'KOUROU'), row('KOU_CNES', 'X', 'KOUROU'),
    row('AUS', 'S', 'AUSSAGUEL'), row('UNKNOWN', 'S', 'UNKNOWN'),
  ].join('\n'))
  assert.deepEqual(stations.map(x => x.id).sort(), ['aussaguel', 'kourou'])
  assert.deepEqual(stations.find(x => x.id === 'kourou')?.bands, ['S', 'X'])
  assert.deepEqual(rfGroundStationsFromDatabase(''), [])
})
