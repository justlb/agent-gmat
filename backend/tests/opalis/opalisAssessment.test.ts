import assert from 'node:assert/strict'
import { test } from 'node:test'
import { opalisAssessment, type OpalisResultSummary } from '../../src/opalis/opalisResults.js'

const summary: OpalisResultSummary = { alerts: [], computedDurationSeconds: 600, finalSocPercent: 44,
  initialSocPercent: 90, maxDepthOfDischargePercent: null, resultRows: 10, simulationExecuted: true,
  solarArrayEnergy: null, solarSections: null, stopCondition: 'eBattMin reached' }
test('electrical assessment explains the battery stop independently of final charge', () => {
  const result = opalisAssessment(summary)
  assert.match(result.value, /Battery minimum reached/u)
  assert.match(result.detail!, /44.0%/u)
  assert.match(result.detail!, /10.0 min/u)
})
test('electrical assessment distinguishes low charge, normal end and missing evidence', () => {
  assert.match(opalisAssessment({ ...summary, stopCondition: 'Simulation Time', finalSocPercent: 19 }).value, /below 20%/u)
  assert.equal(opalisAssessment({ ...summary, stopCondition: 'Simulation Time', finalSocPercent: 20 }).value, 'Completed — no detected battery warning')
  assert.match(opalisAssessment({ ...summary, stopCondition: null }).value, /requires review/u)
  assert.match(opalisAssessment({ ...summary, stopCondition: 'Simulation Time', finalSocPercent: null }).value, /requires review/u)
  assert.equal(opalisAssessment(null).value, 'Waiting for results')
  assert.equal(opalisAssessment({ ...summary, simulationExecuted: false }).value, 'Calculation not executed')
})
