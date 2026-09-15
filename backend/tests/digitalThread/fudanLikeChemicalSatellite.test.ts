import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { loadOrCreateDigitalThread } from "../../src/digitalThread/digitalThreadStore.js"
import { getSatelliteDefinition, selectSatelliteDefinition } from "../../src/digitalThread/satelliteLibrary.js"

describe("Fudan-like chemical tutorial satellite", () => {
  it("is discoverable and creates a chemical-only run-local physical snapshot", async () => {
    const definition = await getSatelliteDefinition("fudan-like-chemical-demo", "1.0.0")
    assert.match(String(definition.satellite.bus.propulsion_subsystem.type), /chemical/u)
    assert.deepEqual(definition.mission_templates, ["orbit-keeping", "chemical-hohmann-transfer"])

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "fudan-like-chemical-"))
    await selectSatelliteDefinition(workspaceDir, definition.id, definition.version)
    const document = await loadOrCreateDigitalThread(workspaceDir)

    assert.equal(document.satellite.bus.physical.mass_kg.dry, 49.568)
    assert.match(String(document.satellite.bus.propulsion_subsystem.type), /chemical/u)
    assert.equal(document.satellite.bus.propulsion_subsystem.electric_thruster, undefined)
    assert.equal(document.digital_thread.satellite_definition.id, definition.id)
  })
})
