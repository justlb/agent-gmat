import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { generateElectricPropulsionMission, type GenerateElectricPropulsionMissionResult } from "./electricPropulsion.service.js"
import { extractElectricPropulsionValues, type ElectricPropulsionValueChange } from "./electricPropulsionValues.js"
import { defaultElectricPropulsionTemplatePath } from "./electricPropulsionTemplate.js"
import { gmatTemplateDefinition } from "./templateRegistry.js"

/**
 * Renders the electrical LEO station-keeping script through the shared
 * electric GMAT executor. The source script deliberately uses mission-domain
 * names (LEO_EP, XenonTank, ReboostThruster); the executor's stable contract
 * uses the neutral names below. Keeping this translation here makes the
 * mapping explicit and avoids maintaining a second copy of the GMAT runner.
 */
function normalizeElectricalLeoScript(source: string) {
  const required = [
    "Create Spacecraft LEO_EP;",
    "Create ElectricTank XenonTank;",
    "Create ElectricThruster ReboostThruster;",
    "Create ReportFile ReportFile1;",
    "Create EphemerisFile EphemerisFile1;",
    "While 'Continuous circular LEO electric orbit keeping'",
  ]
  for (const marker of required) if (!source.includes(marker)) throw new Error(`electrical LEO template is missing: ${marker}`)
  return source
    .replaceAll("LEO_EP", "DefaultSC")
    .replaceAll("XenonTank", "ElectricTank1")
    .replaceAll("ReboostThruster", "ElectricThruster1")
    .replaceAll("SolarArray", "SolarPowerSystem1")
    .replaceAll("LEO_ForceModel", "DefaultProp_ForceModel")
    .replaceAll("LEO_Prop", "DefaultProp")
    .replaceAll("ReboostBurn", "FiniteBurn1")
    .replaceAll("ReportFile1", "ElectricTransferReport")
}

export async function generateElectricalLeoOrbitMaintenanceMission(input: {
  changes: ElectricPropulsionValueChange[]
  execution?: { bin: string; timeoutMs: number }
  request: string
  workspaceDir: string
}): Promise<GenerateElectricPropulsionMissionResult> {
  const definition = gmatTemplateDefinition("electrical-leo-orbit-maintenance")
  const sourcePath = path.join(definition.skillDirectory, definition.gmatReferenceScript)
  const source = await fs.readFile(sourcePath, "utf8")
  const normalized = normalizeElectricalLeoScript(source)
  // Drafts currently use the transfer form, whose slot IDs encode its source
  // line numbers. Rebind edits by their stable GMAT assignment context before
  // rendering the normalized LEO script.
  const transferSlots = extractElectricPropulsionValues(await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")).slots
  const leoSlots = extractElectricPropulsionValues(normalized).slots
  const changes = input.changes.flatMap(change => {
    const context = transferSlots.find(slot => slot.id === change.id)?.context
    const target = context ? leoSlots.find(slot => slot.context === context) : undefined
    return target ? [{ ...change, id: target.id }] : []
  })
  const temporaryTemplate = path.join(os.tmpdir(), `electrical-leo-orbit-maintenance-${createHash("sha256").update(normalized).digest("hex").slice(0, 12)}-${randomUUID()}.script`)
  await fs.writeFile(temporaryTemplate, normalized, "utf8")
  try {
    return await generateElectricPropulsionMission({
      ...input,
      changes,
      request: `Electrical LEO orbit maintenance: ${input.request}`,
      templatePath: temporaryTemplate,
    })
  } finally {
    await fs.unlink(temporaryTemplate).catch(() => undefined)
  }
}
