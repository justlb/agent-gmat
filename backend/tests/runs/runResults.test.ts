import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { estimateOemRevolutions, listResultRuns, loadResultSamples, parseOrbitKeepingOem, resultRunStatus } from "../../src/runs/runResults.js"
import { loadRunWorkflowLog, updateRunWorkflowLog } from "../../src/opalis/workflowRunLog.js"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "run-results-"))
after(() => fs.rm(root, { recursive: true, force: true }))

describe("Results run archive", () => {
  it("requires all four stages to succeed and distinguishes partial, running, failed and unstarted runs", async () => {
    const workflow = await loadRunWorkflowLog(root)
    assert.equal(resultRunStatus("drafting", workflow), "not_started")
    assert.equal(resultRunStatus("completed", workflow), "partial")
    workflow.stages.gmat.status = "completed"
    workflow.stages.simu_cic.status = "running"
    assert.equal(resultRunStatus("completed", workflow), "running")
    workflow.stages.simu_cic.status = "failed"
    assert.equal(resultRunStatus("completed", workflow), "failed")
    for (const stage of Object.values(workflow.stages)) stage.status = "completed"
    assert.equal(resultRunStatus("completed", workflow), "completed")
    assert.equal(resultRunStatus("timeout", workflow), "failed")
  })

  it("includes failed runs without time series, sorts dates and excludes non-run folders", async () => {
    const collection = path.join(root, "gmat", "mission-runs")
    for (const [id, status, date] of [["26-09-04_10-00", "completed", "2026-09-04T10:00:00Z"], ["26-09-04_11-00", "failed", "2026-09-04T11:00:00Z"]]) {
      const runDir = path.join(collection, id)
      await fs.mkdir(runDir, { recursive: true })
      await fs.writeFile(path.join(runDir, "run_manifest.json"), JSON.stringify({ templateId: "orbit-keeping", status, createdAt: date }))
      await updateRunWorkflowLog(runDir, "gmat", status as "completed" | "failed", null)
    }
    await fs.mkdir(path.join(collection, "drafts"))
    const runs = await listResultRuns(root)
    assert.equal(runs.length, 2)
    assert.equal(runs[0].runId, "26-09-04_11-00")
    assert.equal(runs[0].status, "failed")
    assert.equal(runs[1].status, "partial")
    assert.deepEqual(await listResultRuns(root, path.join(collection, runs[0].runId)), runs)
    await assert.rejects(listResultRuns(root, "../other-user"), /inside the current user workspace/u)
  })

  it("uses the manifest to select the chemical Hohmann time series", async () => {
    const runDir = path.join(root, "chemical-series")
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(path.join(runDir, "run_manifest.json"), JSON.stringify({ templateId: "chemical-hohmann-transfer" }))
    await fs.writeFile(path.join(runDir, "orbit_timeseries.json"), JSON.stringify([{ elapsedDays: 1, altitudeKm: 1 }]))
    await fs.writeFile(path.join(runDir, "chemical_hohmann_timeseries.json"), JSON.stringify([{ elapsedDays: 2, altitudeKm: 400, fuelMassKg: 90 }]))

    assert.deepEqual(await loadResultSamples(runDir), {
      samples: [{ elapsedDays: 2, altitudeKm: 400, fuelMassKg: 90 }],
      source: "chemical_hohmann_timeseries.json",
    })
  })

  it("uses dense OEM positions for the orbit-keeping altitude curve while preserving sparse fuel reports", async () => {
    const runDir = path.join(root, "orbit-oem")
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(path.join(runDir, "run_manifest.json"), JSON.stringify({ templateId: "orbit-keeping" }))
    await fs.writeFile(path.join(runDir, "orbit_timeseries.json"), JSON.stringify([{ elapsedSeconds: 86400, fuelMassKg: 9.5, altitudeKm: 240 }]))
    await fs.writeFile(path.join(runDir, "EphemerisFile1.oem"), [
      "META_STOP",
      "2026-08-06T04:00:00.000 6628.1363 0 0 0 7.7 0",
      "2026-08-07T04:00:00.000 6629.1363 0 0 0 7.7 0",
    ].join("\n"))

    const result = await loadResultSamples(runDir)

    assert.equal(result.source, "EphemerisFile1.oem + orbit_timeseries.json")
    assert.deepEqual(result.samples.slice(0, 2), [
      { altitudeKm: 250, elapsedDays: 0 },
      { altitudeKm: 251, elapsedDays: 1 },
    ])
    assert.equal((result.samples.at(-1) as { fuelMassKg?: unknown }).fuelMassKg, 9.5)
  })

  it("parses all OEM segments as one elapsed trajectory", () => {
    const samples = parseOrbitKeepingOem([
      "2026-08-06T04:00:00.000 6628.1363 0 0 0 7.7 0",
      "META_START",
      "2026-08-08T04:00:00.000 6628.1363 0 0 0 7.7 0",
    ].join("\n"))
    assert.deepEqual(samples.map(sample => sample.elapsedDays), [0, 2])
  })

  it("estimates completed revolutions from OEM state vectors", () => {
    const orbitalSpeed = Math.sqrt(398600.4418 / 6628.1363)
    const samples = estimateOemRevolutions([
      `2026-08-06T04:00:00.000 6628.1363 0 0 0 ${orbitalSpeed} 0`,
      `2026-08-06T05:31:00.000 6628.1363 0 0 0 ${orbitalSpeed} 0`,
    ].join("\n"))
    assert.ok(samples !== null)
    assert.ok(samples > 0.99 && samples < 1.01)
  })
})
