import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parseDocument } from "yaml"

import { confirmGeoGsoOrbitKeepingDraft, createGeoGsoOrbitKeepingDraft, generateGeoGsoOrbitKeepingMission } from "../../src/gmat/geoGsoOrbitKeeping.js"
import { createMissionRun } from "../../src/runs/missionRunService.js"

test("GEO/GSO scenario renders full Keplerian state, fuel, tolerances and run-local OEM", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "geo-gso-scenario-"))
  const run = await createMissionRun(root)
  const values = {
    "initialOrbit.epoch": "21545",
    "initialOrbit.smaKm": 42164.17,
    "initialOrbit.eccentricity": 0.07,
    "initialOrbit.inclinationDeg": 15,
    "initialOrbit.raanDeg": 60,
    "initialOrbit.argPeriapsisDeg": 0,
    "initialOrbit.trueAnomalyDeg": 360,
    "spacecraft.initialFuelMassKg": 3000,
    "spacecraft.dryMassKg": 1800,
    "spacecraft.dragAreaM2": 15,
    "spacecraft.dragCoefficient": 2.2,
    "propulsion.ispSeconds": 300,
    "propagation.decrementMass": 0,
    "propagation.includeSun": 0,
    "propagation.includeLuna": 1,
    "propagation.atmosphereModel": "MSISE90",
    "propagation.relativisticCorrection": 1,
  }
  const draft = await createGeoGsoOrbitKeepingDraft(run.workspaceDir, values)
  await confirmGeoGsoOrbitKeepingDraft(run.workspaceDir, draft.draftId)
  const generated = await generateGeoGsoOrbitKeepingMission({ draft: await confirmGeoGsoOrbitKeepingDraft(run.workspaceDir, draft.draftId), workspaceDir: run.workspaceDir })
  const script = await fs.readFile(generated.scriptPath, "utf8")
  const yaml = parseDocument(await fs.readFile(generated.valuesPath, "utf8")).toJS() as { values: Record<string, unknown> }
  assert.match(script, /GEO\.RAAN\s*=\s*60;/u)
  assert.match(script, /GEO_Tank\.FuelMass\s*=\s*3000;/u)
  assert.match(script, /tolerance_northsouth\s*=\s*0\.05;/u)
  assert.match(script, /tolerance_eastwest\s*=\s*0\.1;/u)
  assert.match(script, /mission_days    = 30;/u)
  assert.match(script, /EastWest\.DecrementMass\s*=\s*false;/u)
  assert.match(script, /NorthSouth\.DecrementMass\s*=\s*false;/u)
  assert.match(script, /GEO_FM\.PointMasses\s*=\s*\{Luna\};/u)
  assert.match(script, /GEO_FM\.Drag\s*=\s*On;/u)
  assert.match(script, /GEO_FM\.Drag\.AtmosphereModel\s*=\s*MSISE90;/u)
  assert.match(script, /GEO_FM\.RelativisticCorrection\s*=\s*On;/u)
  assert.match(script, /Create ImpulsiveBurn EastWest;/u)
  assert.match(script, /Create ImpulsiveBurn NorthSouth;/u)
  assert.match(script, /Propagate 'Coast to next equator crossing' GEO_Prop\(GEO\) \{GEO\.Earth\.Latitude = 0\};/u)
  assert.match(script, /EphemerisFile1\.Filename = '.+EphemerisFile1\.oem';/u)
  assert.equal(yaml.values["initialOrbit.trueAnomalyDeg"], 360)
})
