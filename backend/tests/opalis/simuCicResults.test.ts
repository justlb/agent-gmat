import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { activeDuration, contactLatencyMs, loadSimuCicResultMetrics, parseCicScalar } from '../../src/opalis/simuCicResults.js'

const series = (values: number[]) => 'META_STOP\n' + values.map((v, i) => `61262 ${i * 60} ${v}`).join('\n')
test('CIC dates, midnight rollover, zero and malformed series', () => {
  const samples = parseCicScalar('META_STOP\n61262 86340 1\n61263 0 0\n61263 60 0')
  assert.equal(activeDuration(samples, v => v === 1), 60)
  assert.equal(activeDuration(parseCicScalar(series([0, 0])), v => v > 0), 0)
  assert.equal(parseCicScalar('META_STOP\n2026-08-10T00:00:00 0\n2026-08-10T00:01:00Z 1')[1].time - parseCicScalar(series([0, 1]))[0].time, 60)
  for (const text of ['META_STOP\n61262 0 1', 'META_STOP\n61262 0 0\n61262 0 1', 'META_STOP\n61262 0 0\n61262 60 NaN']) assert.throws(() => parseCicScalar(text))
})
test('latency is time-weighted over contact only, with distance interpolation', () => {
  const visibility = [{ time: 5, value: 1 }, { time: 15, value: 0 }, { time: 20, value: 0 }]
  const distances = [{ time: 0, value: 0 }, { time: 10, value: 2997.92458 }, { time: 20, value: 5995.84916 }]
  assert.ok(Math.abs(contactLatencyMs(visibility, distances)! - 10) < 1e-9)
  assert.equal(contactLatencyMs(parseCicScalar(series([0, 0])), distances), null)
  assert.throws(() => contactLatencyMs(visibility, distances.slice(1)))
})
test('run metrics use executed station ordering and isolate missing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simucic-metrics-'))
  try {
    const base = path.join(root, 'opalis/02-simu-cic'), dir = path.join(base, '02-fichiers-cic/Sat')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(base, 'simucic.definition.json'), JSON.stringify({ attitude: { ground_stations: [{ id: 'kiruna' }, { id: 'kourou' }] } }))
    await fs.writeFile(path.join(dir, 'Sat_SATELLITE_ECLIPSE.TXT'), series([0, 50, 100, 0]))
    await fs.writeFile(path.join(dir, 'Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_1.TXT'), series([1, 0, 1, 0]))
    await fs.writeFile(path.join(dir, 'Sat_DISTANCE_GROUND_STATION_1.TXT'), series([2997.92458, 2997.92458, 2997.92458, 2997.92458]))
    const metrics = await loadSimuCicResultMetrics(root, 'completed')
    assert.equal(metrics.contactTime.value, 'kiruna: 2.00 min; kourou: Unavailable')
    assert.equal(metrics.latency.value, 'kiruna: 10.00 / 20.00 ms; kourou: Unavailable')
    assert.equal(metrics.eclipseTime.value, '2.00 min')
    assert.equal((await loadSimuCicResultMetrics(root, 'running')).contactTime.value, 'Waiting for Simu-CIC')
    assert.equal((await loadSimuCicResultMetrics(root, 'failed')).contactTime.value, 'Unavailable')
    await fs.writeFile(path.join(dir, 'Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_1.TXT'), series([0, 0]))
    assert.match((await loadSimuCicResultMetrics(root, 'completed')).latency.value, /kiruna: No contact/u)
    await fs.writeFile(path.join(base, 'simucic.definition.json'), JSON.stringify({ attitude: { ground_stations: [] } }))
    assert.equal((await loadSimuCicResultMetrics(root, 'completed')).contactTime.value, 'Not applicable')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
