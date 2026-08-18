import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { prepareVtsProject } from "../../src/vts/vts.routes.js"

test("prepares a VTS project from GMAT OEM positions without changing the GMAT artifact", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "vts-gmat-run-"))
  const originalOem = [
    "CCSDS_OEM_VERS = 1.0",
    "CREATION_DATE  = 2026-08-18T00:00:00.000",
    "ORIGINATOR     = GMAT USER",
    "",
    "META_START",
    "OBJECT_NAME = DefaultSC",
    "OBJECT_ID = SatId",
    "CENTER_NAME = Earth",
    "REF_FRAME = EME2000",
    "TIME_SYSTEM = UTC",
    "META_STOP",
    "",
    "2026-08-01T00:00:00.000 6678.1363 0 0 0 7.72 0",
    "2026-08-01T00:01:00.000 6662.0310 463.1734 0 -0.536 7.70 0",
    "",
  ].join("\n")
  await Promise.all([
    fs.writeFile(path.join(runDir, "EphemerisFile1.oem"), originalOem, "utf8"),
    fs.writeFile(path.join(runDir, "satellite.json"), JSON.stringify({ satellite: { identity: { name: "Test satellite" } } }), "utf8"),
  ])

  const generated = await prepareVtsProject(runDir)
  const [project, cic, unchangedOem] = await Promise.all([
    fs.readFile(generated.projectPath, "utf8"),
    fs.readFile(generated.ephemerisOutput, "utf8"),
    fs.readFile(path.join(runDir, "EphemerisFile1.oem"), "utf8"),
  ])

  assert.equal(generated.samples, 2)
  assert.match(project, /<Satellite Name="Test satellite"/u)
  assert.match(project, /Data\/GMAT_OEM_POSITION\.TXT/u)
  assert.match(cic, /^CIC_OEM_VERS = 2\.0/mu)
  assert.match(cic, /META_START[\s\S]+META_STOP/u)
  assert.match(cic, /^61253 0\.000000 6\.678136300000e\+03/mu)
  assert.equal(unchangedOem, originalOem)
})
