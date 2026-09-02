import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { createPlanningRun } from "../../../src/runs/missionRunService.js"
import { loadOrCreateDigitalThread } from "../../../src/digitalThread/digitalThreadStore.js"
import { selectSatelliteDefinition } from "../../../src/digitalThread/satelliteLibrary.js"
import { allGmatMissionScenarioDefinitions, gmatMissionScenarioDefinition } from "../../../src/gmat/templateRegistry.js"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createTestConfig } from "../../helpers/testConfig.js"

function assertValuesOnlyRender(reference: string, rendered: string) {
  const sourceLines = reference.replace(/\r\n/gu, "\n").split("\n")
  const renderedLines = rendered.replace(/\r\n/gu, "\n").split("\n")
  assert.equal(renderedLines.length, sourceLines.length, "the renderer must not add or remove template lines")
  for (const [index, sourceLine] of sourceLines.entries()) {
    const renderedLine = renderedLines[index]
    if (renderedLine === sourceLine) continue
    const assignment = sourceLine.indexOf("=")
    assert.ok(assignment >= 0, `line ${index + 1} changed outside an assignment`)
    assert.equal(renderedLine.slice(0, assignment + 1), sourceLine.slice(0, assignment + 1), `line ${index + 1} changed its GMAT structure`)
  }
}

describe("generic GMAT mission template routes", () => {
  it("declares a complete OEM subscriber in every registered GMAT reference script", async () => {
    for (const definition of allGmatMissionScenarioDefinitions()) {
      const script = await fs.readFile(path.join(definition.skillDirectory, definition.gmatReferenceScript), "utf8")
      const subscriber = /^Create EphemerisFile\s+([A-Za-z][A-Za-z0-9_]*)\s*;/mu.exec(script)?.[1]
      assert.ok(subscriber, `${definition.id} is missing an EphemerisFile subscriber`)
      for (const property of ["Spacecraft", "Filename", "FileFormat", "EpochFormat", "InitialEpoch", "FinalEpoch", "StepSize", "Interpolator", "InterpolationOrder", "CoordinateSystem", "WriteEphemeris"]) {
        assert.match(script, new RegExp(`^${subscriber}\\.${property}\\s*=`, "mu"), `${definition.id} is missing ${subscriber}.${property}`)
      }
      assert.match(script, new RegExp(`^${subscriber}\\.FileFormat\\s*=\\s*CCSDS-OEM;`, "mu"), `${definition.id} must write CCSDS-OEM`)
      assert.match(script, new RegExp(`^${subscriber}\\.WriteEphemeris\\s*=\\s*true;`, "mu"), `${definition.id} must enable OEM output`)
      assert.match(script, new RegExp(`^Toggle ${subscriber} On;`, "mu"), `${definition.id} must activate its OEM subscriber during the mission sequence`)
    }
  })

  it("exposes one validated draft lifecycle for every registered template", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-template-contract-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const headers = { "x-codex-user-id": "alice" }
      const scenarios = [
        { satelliteId: "ref-leo-orbit-keeping", template: "orbit-keeping" },
        { satelliteId: "fudan-satellite", template: "electric-propulsion-transfer" },
        { satelliteId: "ref-leo-orbit-keeping", template: "chemical-hohmann-transfer" },
      ] as const
      for (const [index, scenario] of scenarios.entries()) {
        const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", `v${String(index + 1).padStart(4, "0")}`)
        const planningRun = await createPlanningRun(workspaceDir)
        await selectSatelliteDefinition(planningRun.workspaceDir, scenario.satelliteId, "1.0.0")
        const create = await server.inject({ method: "POST", url: `/api/gmat/templates/${scenario.template}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
        assert.equal(create.statusCode, 200, scenario.template)
        const draft = create.json() as { draftId: string; templateId: string }
        assert.equal(draft.templateId, scenario.template)
        const list = await server.inject({ method: "GET", url: `/api/gmat/templates/${scenario.template}/drafts?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
        assert.equal(list.statusCode, 200, scenario.template)
        assert.equal((list.json() as { drafts: Array<{ draftId: string }> }).drafts.some(candidate => candidate.draftId === draft.draftId), true, scenario.template)
      }
    } finally { await server.close() }
  })

  it("creates, updates, and reloads a chemical Hohmann draft through the shared API", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-template-routes-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
      const headers = { "x-codex-user-id": "alice" }

      const create = await server.inject({ method: "POST", url: "/api/gmat/templates/chemical-hohmann-transfer/drafts", headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(create.statusCode, 200)
      const draft = create.json() as { draftId: string; values: Record<string, unknown> }
      assert.match(draft.draftId, /^draft_/u)

      const update = await server.inject({ method: "PATCH", url: `/api/gmat/templates/chemical-hohmann-transfer/drafts/${draft.draftId}/values`, headers, payload: { path: "transfer.targetRadiusKm", value: "7378.1363", workspaceDir: planningRun.workspaceDir } })
      assert.equal(update.statusCode, 200)
      assert.equal((update.json() as { values: Record<string, unknown> }).values["transfer.targetRadiusKm"], 7378.1363)

      const reload = await server.inject({ method: "GET", url: `/api/gmat/templates/chemical-hohmann-transfer/drafts/${draft.draftId}?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
      assert.equal(reload.statusCode, 200)
      assert.equal((reload.json() as { values: Record<string, unknown> }).values["transfer.targetRadiusKm"], 7378.1363)
    } finally { await server.close() }
  })

  it("keeps every form value in one incomplete corrected-scenario draft and satellite.json", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-corrected-form-lifecycle-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
      const headers = { "x-codex-user-id": "alice" }
      const base = "/api/gmat/templates/chemical-3d-transfer"
      const create = await server.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(create.statusCode, 200, create.body)
      const created = create.json() as { draftId: string; missing: string[]; values: Record<string, unknown> }
      assert.equal(created.values["initialOrbit.smaKm"], null)
      assert.equal(created.values["targetOrbit.smaKm"], null)

      const entered = [
        ["initialOrbit.altitudeKm", "300"],
        ["initialOrbit.eccentricity", "0.001"],
        ["initialOrbit.inclinationDeg", "28.5"],
        ["targetOrbit.altitudeKm", "35786"],
        ["targetOrbit.inclinationDeg", "0.1"],
      ] as const
      let updated: { draftId: string; values: Record<string, unknown> } = created
      for (const [fieldPath, value] of entered) {
        const response = await server.inject({ method: "PATCH", url: `${base}/drafts/${created.draftId}/values`, headers, payload: { path: fieldPath, value, workspaceDir: planningRun.workspaceDir } })
        assert.equal(response.statusCode, 200, `${fieldPath}: ${response.body}`)
        updated = response.json() as typeof updated
        assert.equal(updated.draftId, created.draftId)
      }
      assert.equal(updated.values["initialOrbit.altitudeKm"], 300)
      assert.equal(updated.values["initialOrbit.eccentricity"], 0.001)
      assert.equal(updated.values["initialOrbit.inclinationDeg"], 28.5)
      assert.equal(updated.values["targetOrbit.altitudeKm"], 35786)
      assert.equal(updated.values["targetOrbit.inclinationDeg"], 0.1)

      const list = await server.inject({ method: "GET", url: `${base}/drafts?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
      const persisted = (list.json() as { drafts: Array<typeof updated> }).drafts.find(draft => draft.draftId === created.draftId)
      assert.ok(persisted, "an incomplete draft must remain discoverable")
      assert.equal(persisted.values["initialOrbit.eccentricity"], 0.001)
      assert.equal(persisted.values["targetOrbit.inclinationDeg"], 0.1)

      const satellite = await loadOrCreateDigitalThread(planningRun.workspaceDir)
      assert.equal(satellite.satellite.orbit.keplerian_elements.eccentricity, 0.001)
      const request = satellite.analysis_requests.gmat.chemical_3d_transfer as { parameters?: { targetOrbit?: Record<string, unknown> } }
      assert.equal(request.parameters?.targetOrbit?.altitudeKm, 35786)
      assert.equal(request.parameters?.targetOrbit?.inclinationDeg, 0.1)
    } finally { await server.close() }
  })

  it("generates syntactically intact Chemical 2D and 3D scripts from manual form values", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-chemical-rendering-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const headers = { "x-codex-user-id": "alice" }
      for (const template of ["chemical-2d-transfer", "chemical-3d-transfer"] as const) {
        const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", template, "versions", "v0001")
        const planningRun = await createPlanningRun(workspaceDir)
        await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
        const base = `/api/gmat/templates/${template}`
        const create = await server.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
        assert.equal(create.statusCode, 200, create.body)
        const draftId = (create.json() as { draftId: string }).draftId
        const fields = [
          ["initialOrbit.altitudeKm", "300"],
          ["initialOrbit.eccentricity", "0.001"],
          ["initialOrbit.inclinationDeg", "28.5"],
          ["targetOrbit.altitudeKm", "35786"],
          ...(template === "chemical-3d-transfer" ? [["targetOrbit.inclinationDeg", "0.1"]] : []),
        ] as const
        for (const [fieldPath, value] of fields) {
          const update = await server.inject({ method: "PATCH", url: `${base}/drafts/${draftId}/values`, headers, payload: { path: fieldPath, value, workspaceDir: planningRun.workspaceDir } })
          assert.equal(update.statusCode, 200, `${template}/${fieldPath}: ${update.body}`)
        }
        const confirm = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/confirm`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
        assert.equal(confirm.statusCode, 200, confirm.body)
        const execute = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/execute`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
        assert.equal(execute.statusCode, 200, execute.body)
        const scriptName = template === "chemical-2d-transfer" ? "chemical_2D_transfer.script" : "chemical_3D_transfer.script"
        const script = await fs.readFile(path.join(planningRun.workspaceDir, scriptName), "utf8")
        const definition = gmatMissionScenarioDefinition(template)
        const reference = await fs.readFile(path.join(definition.skillDirectory, definition.gmatReferenceScript), "utf8")
        assertValuesOnlyRender(reference, script)
        assert.doesNotMatch(script, /PointMasses\s*=\s*\{[^}]*\}\s*,/u)
        if (template === "chemical-2d-transfer") {
          assert.doesNotMatch(script, /Achieve 'Achieve ECC/u)
          assert.doesNotMatch(script, /targetOrbit\.eccentricity/u)
          assert.doesNotMatch(script, /targetOrbit\.inclinationDeg/u)
        } else assert.match(script, /AllForces\.PointMasses\s*=\s*\{Sun, Luna\};/u)
      }
    } finally { await server.close() }
  })

  it("takes electrical propulsion and power inputs from the selected satellite without exposing them as missing form fields", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-electrical-rendering-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "electrical", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-starlink-v1-5-public-rf", "1.0.0")
      const headers = { "x-codex-user-id": "alice" }
      const base = "/api/gmat/templates/electrical-2d-transfer"
      const create = await server.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      const draftId = (create.json() as { draftId: string }).draftId
      for (const [fieldPath, value] of [["initialOrbit.altitudeKm", "300"], ["initialOrbit.eccentricity", "0.001"], ["initialOrbit.inclinationDeg", "53"], ["targetOrbit.altitudeKm", "550"]] as const) {
        const update = await server.inject({ method: "PATCH", url: `${base}/drafts/${draftId}/values`, headers, payload: { path: fieldPath, value, workspaceDir: planningRun.workspaceDir } })
        assert.equal(update.statusCode, 200, update.body)
      }
      const confirm = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/confirm`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(confirm.statusCode, 200, confirm.body)
      const execute = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/execute`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(execute.statusCode, 200, execute.body)
      const script = await fs.readFile(path.join(planningRun.workspaceDir, "electrical_2D_transfer.script"), "utf8")
      assert.match(script, /ElectricThruster1\.ConstantThrust = 0\.0708;/u)
      assert.match(script, /SolarPowerSystem1\.InitialMaxPower = 4\.2;/u)
      assert.match(script, /ElectricThruster1\.MinimumUsablePower = 1;/u)
      assert.match(script, /targetFinalAltitudeKm = 550;/u)
    } finally { await server.close() }
  })

  it("persists scenario-specific mission parameters and altitude/SMA pairs for every reported failing family", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-scenario-parameter-families-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const headers = { "x-codex-user-id": "alice" }
      const cases = [
        { analysisKey: "chemical_escape", field: "mission.escapeC3", expected: 0.01, satellite: "ref-leo-orbit-keeping", template: "chemical-escape", value: "0.01" },
        { analysisKey: "chemical_leo_maintenance", field: "mission.targetAltitudeKm", expected: 500, satellite: "ref-leo-orbit-keeping", template: "chemical-leo-orbit-maintenance", value: "500" },
        { analysisKey: "electrical_2d_transfer", field: "mission.maxDays", expected: 1200, satellite: "ref-starlink-v1-5-public-rf", template: "electrical-2d-transfer", value: "1200" },
        { analysisKey: "electrical_leo_maintenance", field: "mission.days", expected: 120, satellite: "ref-starlink-v1-5-public-rf", template: "electrical-leo-orbit-maintenance", value: "120" },
      ] as const
      for (const item of cases) {
        const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", item.template, "versions", "v0001")
        const planningRun = await createPlanningRun(workspaceDir)
        await selectSatelliteDefinition(planningRun.workspaceDir, item.satellite, "1.0.0")
        const base = `/api/gmat/templates/${item.template}`
        const create = await server.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
        assert.equal(create.statusCode, 200, create.body)
        const draftId = (create.json() as { draftId: string }).draftId
        const altitude = await server.inject({ method: "PATCH", url: `${base}/drafts/${draftId}/values`, headers, payload: { path: "initialOrbit.altitudeKm", value: "300", workspaceDir: planningRun.workspaceDir } })
        assert.equal(altitude.statusCode, 200, altitude.body)
        const altitudeDraft = altitude.json() as { values: Record<string, unknown> }
        assert.equal(altitudeDraft.values["initialOrbit.altitudeKm"], 300)
        assert.equal(altitudeDraft.values["initialOrbit.smaKm"], 6678.1363)
        const update = await server.inject({ method: "PATCH", url: `${base}/drafts/${draftId}/values`, headers, payload: { path: item.field, value: item.value, workspaceDir: planningRun.workspaceDir } })
        assert.equal(update.statusCode, 200, `${item.template}: ${update.body}`)
        const satellite = await loadOrCreateDigitalThread(planningRun.workspaceDir)
        const request = (satellite.analysis_requests.gmat as Record<string, unknown>)[item.analysisKey] as { parameters?: { mission?: Record<string, unknown> } }
        assert.equal(request.parameters?.mission?.[item.field.slice("mission.".length)], item.expected, item.template)
      }
    } finally { await server.close() }
  })

  it("persists the first manual value through the legacy Mission Studio endpoint", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-mission-values-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
      const response = await server.inject({
        method: "PATCH",
        url: "/api/gmat/mission-values",
        headers: { "x-codex-user-id": "alice" },
        payload: {
          path: "transfer.targetRadiusKm",
          template: "chemical-hohmann-transfer",
          value: "7378.1363",
          workspaceDir: planningRun.workspaceDir,
        },
      })
      assert.equal(response.statusCode, 200)
      const payload = response.json() as { draft: { draftId: string; values: Record<string, unknown> } }
      assert.match(payload.draft.draftId, /^draft_/u)
      assert.equal(payload.draft.values["transfer.targetRadiusKm"], 7378.1363)
    } finally { await server.close() }
  })

  it("generates and exposes Hohmann artifacts through the generic template API", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-hohmann-generic-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
      const headers = { "x-codex-user-id": "alice" }
      const base = "/api/gmat/templates/chemical-hohmann-transfer"
      const create = await server.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(create.statusCode, 200)
      const draftId = (create.json() as { draftId: string }).draftId
      const values = [
        ["initialOrbit.epoch", "31258.66709490726"],
        ["initialOrbit.smaKm", "6678.1363"],
        ["initialOrbit.eccentricity", "0"],
        ["initialOrbit.inclinationDeg", "0"],
        ["transfer.targetRadiusKm", "7378.1363"],
      ] as const
      for (const [fieldPath, value] of values) {
        const update = await server.inject({ method: "PATCH", url: `${base}/drafts/${draftId}/values`, headers, payload: { path: fieldPath, value, workspaceDir: planningRun.workspaceDir } })
        assert.equal(update.statusCode, 200, fieldPath)
      }
      const confirm = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/confirm`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(confirm.statusCode, 200, confirm.body)
      const execute = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/execute`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(execute.statusCode, 200, execute.body)

      const listedDrafts = await server.inject({ method: "GET", url: `${base}/drafts?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
      assert.equal((listedDrafts.json() as { drafts: Array<{ draftId: string }> }).drafts.some(draft => draft.draftId === draftId), true)
      const listedFiles = await server.inject({ method: "GET", url: `${base}/files?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
      assert.equal(listedFiles.statusCode, 200, listedFiles.body)
      const files = (listedFiles.json() as { files: Array<{ draftId?: string; fileName: string; relativePath: string }> }).files
      assert.equal(files.some(file => file.fileName === "chemical_hohmann_transfer.script" && file.draftId === draftId), true)
      assert.equal(files.some(file => file.fileName === "run_manifest.json"), true)
      const valuesFile = files.find(file => file.fileName === "chemical_hohmann_transfer.values.yaml")
      assert.ok(valuesFile)
      const filesBeforeSelectingRun = await server.inject({ method: "GET", url: `${base}/files?${new URLSearchParams({ workspaceDir })}`, headers })
      assert.equal(filesBeforeSelectingRun.statusCode, 200, filesBeforeSelectingRun.body)
      assert.equal((filesBeforeSelectingRun.json() as { files: Array<{ relativePath: string }> }).files.some(file => file.relativePath === valuesFile.relativePath), true)
      const download = await server.inject({ method: "GET", url: `${base}/files/download?${new URLSearchParams({ relativePath: valuesFile.relativePath, workspaceDir })}`, headers })
      assert.equal(download.statusCode, 200)
      assert.match(download.body, new RegExp(`draft_id: ${draftId}`, "u"))
    } finally { await server.close() }
  })

  it("keeps pre-manifest GMAT runs in Mission Files history", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-legacy-history-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      const legacyRunDir = path.join(path.dirname(planningRun.workspaceDir), "26-08-01_10-30")
      await fs.mkdir(legacyRunDir, { recursive: true })
      await fs.writeFile(path.join(legacyRunDir, "chemical_2D_transfer.script"), "% legacy GMAT run\n")
      await fs.writeFile(path.join(legacyRunDir, "EphemerisFile1.oem"), "CCSDS_OEM_VERS = 1.0\n")
      const headers = { "x-codex-user-id": "alice" }

      const response = await server.inject({
        method: "GET",
        url: `/api/gmat/templates/chemical-2d-transfer/files?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`,
        headers,
      })
      assert.equal(response.statusCode, 200, response.body)
      const files = (response.json() as { files: Array<{ fileName: string; runPath: string }> }).files
      assert.equal(files.some(file => file.runPath.endsWith("26-08-01_10-30") && file.fileName === "chemical_2D_transfer.script"), true)
      assert.equal(files.some(file => file.runPath.endsWith("26-08-01_10-30") && file.fileName === "EphemerisFile1.oem"), true)
    } finally { await server.close() }
  })
})
