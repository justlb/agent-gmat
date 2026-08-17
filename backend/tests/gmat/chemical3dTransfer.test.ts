import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { confirmChemical3dDraft, createChemical3dDraft, discussChemical3dDraft, generateChemical3dMission, setChemical3dDraftValue } from "../../src/gmat/chemical3dTransfer.js"
import { createPlanningRun } from "../../src/digitalThread/digitalThreadStore.js"

test("chemical 3D GEO transfer renders only its declared mission geometry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-chemical-3d-"))
  const planning = await createPlanningRun(root)
  let draft = await createChemical3dDraft(planning.workspaceDir, {
    "initialOrbit.epoch": "21545", "initialOrbit.altitudeKm": 300, "initialOrbit.eccentricity": 0.001,
    "initialOrbit.inclinationDeg": 28.5, "transfer.finalAltitudeKm": 35786,
    "transfer.finalInclinationDeg": 0, "spacecraft.dryMassKg": 850, "spacecraft.dragAreaM2": 15,
    "spacecraft.dragCoefficient": 2.2, "propulsion.ispSeconds": 300,
  })
  const confirmed = await confirmChemical3dDraft(planning.workspaceDir, draft.draftId)
  const generated = await generateChemical3dMission({ draft: confirmed, workspaceDir: planning.workspaceDir })
  const script = await fs.readFile(generated.scriptPath, "utf8")
  assert.match(script, /geoSat\.SMA\s+= 6678\.1363;/u)
  assert.match(script, /geoSat\.INC\s+= 28\.5;/u)
  assert.match(script, /geoSat\.RAAN\s+= 66\.99999999999999;/u)
  assert.match(script, /geoSat\.AOP\s+= 355\.0000000000957;/u)
  assert.match(script, /geoSat\.TA\s+= 249\.9999999999781;/u)
  assert.match(script, /Achieve 'Achieve RMAG' DC\(geoSat\.RMAG = 85000/u)
  assert.match(script, /Achieve 'Apply INC' DC\(geoSat\.EarthMJ2000Eq\.INC = 0/u)
  assert.match(script, /Achieve 'Achieve RMAG' DC\(geoSat\.RMAG = 42195/u)
  assert.match(script, /Achieve 'Achieve SMA' DC\(geoSat\.Earth\.SMA = 42164\.1363/u)
  assert.match(script, /Create EphemerisFile EphemerisFile1;/u)
  assert.match(script, /AllForces\.GravityField\.Earth\.Degree\s*=\s*4;/u)
  assert.match(script, /AllForces\.GravityField\.Earth\.Order\s*=\s*4;/u)
  assert.match(script, /BeginMissionSequence;\s*% GMAT subscribers[\s\S]*?Toggle EphemerisFile1 Off;/u)
  assert.match(script, /Toggle EphemerisFile1 On;/u)
  assert.match(script, /EndTarget;\s*% For targeter DC\s*% Do not collect OEM points[\s\S]*?OutputEndElapsedDays = geoSat\.ElapsedDays \+ 10;\s*Toggle EphemerisFile1 On;\s*Propagate 'Prop 10 days' DefaultProp\(geoSat\) \{geoSat\.ElapsedDays = OutputEndElapsedDays\}/u)
  assert.equal(generated.result.status, "generated")
})

test("chemical 3D GEO discussion records all explicit mission values", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-chemical-3d-discuss-"))
  const draft = await createChemical3dDraft(workspaceDir)
  const updates = [
    ["initialOrbit.epoch", "58100"], ["initialOrbit.altitudeKm", 300], ["initialOrbit.eccentricity", 0.001], ["initialOrbit.inclinationDeg", 28.5],
    ["transfer.finalAltitudeKm", 35786], ["transfer.finalInclinationDeg", 0], ["spacecraft.dryMassKg", 850], ["spacecraft.dragAreaM2", 15],
    ["spacecraft.dragCoefficient", 2.2], ["propulsion.ispSeconds", 320],
  ].map(([path, value]) => ({ path, value }))
  const discussed = await discussChemical3dDraft({
    connection: { apiKey: "test", baseUrl: "https://example.test/v1", model: "test-model" }, draft, message: "Fill the 3D GEO transfer.", workspaceDir,
    fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Chemical 3D GEO inputs recorded.\nupdates: ${JSON.stringify(updates)}` })),
  })
  assert.equal(discussed.status, "ready")
  assert.equal(discussed.values["transfer.finalAltitudeKm"], 35786)
  assert.equal(discussed.values["propulsion.ispSeconds"], 320)
})

test("chemical 3D GEO draft rejects a TAIModJulian epoch outside GMAT's range", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-chemical-3d-epoch-"))
  const draft = await createChemical3dDraft(workspaceDir)
  await assert.rejects(() => setChemical3dDraftValue(workspaceDir, draft, "initialOrbit.epoch", "61100"), /TAIModJulian range/u)
})
