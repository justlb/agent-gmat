import fs from "node:fs/promises"
import path from "node:path"

import { defaultOrbitKeepingTemplatePath } from "../../../src/gmat/orbitKeepingTemplate.js"

/**
 * The configuration understood by the deterministic scenario builder.
 *
 * It deliberately does not contain a natural-language request.  A form (or a
 * future routing layer) supplies this object after validating it against the
 * run-local satellite.json.  This is the boundary that keeps a generated
 * script reproducible and independent from an LLM response.
 */
export type MissionScenario = {
  family: "transfer" | "orbit-maintenance" | "station-keeping-geo-gso" | "escape"
  propagationDimension: "2d" | "3d"
  propulsion: "chemical" | "electric"
}

export type ChemicalTransferInputs = {
  coastAfterTransferDays?: number
  /** Run-specific spacecraft value, normally copied from satellite.json. */
  dryMassKg?: number
  /** Run-specific mission value. It must include the protected reserve. */
  initialFuelMassKg: number
  initialEccentricity: number
  initialInclinationDeg: number
  initialSmaKm: number
  fuelReserveKg?: number
  /** Satellite-owned performance value, normally copied from satellite.json. */
  specificImpulseSeconds?: number
  targetSmaKm: number
}

export type BuiltMissionScript = {
  blocks: string[]
  scenario: MissionScenario
  script: string
  transfer: {
    arrivalEvent: "apoapsis" | "periapsis"
    firstBurnDeltaVKmPerSec: number
    minimumInitialFuelMassKg: number
    propellantRequiredKg: number
    secondBurnDeltaVKmPerSec: number
    transferDurationSeconds: number
  }
}

const EARTH_MU_KM3_PER_S2 = 398600.4418

function finitePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`)
}

function finiteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`)
}

function gmatNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error("scenario contains a non-finite GMAT value")
  return Number(value.toPrecision(15)).toString()
}

function replaceSingleAssignment(script: string, left: string, value: number) {
  const pattern = new RegExp(`(^\\s*${left.replaceAll(".", "\\.")}\\s*=\\s*)[^;]+;`, "mu")
  if (!pattern.test(script)) throw new Error(`orbit-keeping source block does not expose ${left}`)
  return script.replace(pattern, `$1${gmatNumber(value)};`)
}

function numericAssignment(script: string, left: string) {
  const pattern = new RegExp(`^\\s*${left.replaceAll(".", "\\.")}\\s*=\\s*([-+0-9.eE]+);`, "mu")
  const match = pattern.exec(script)
  const value = match ? Number(match[1]) : Number.NaN
  if (!Number.isFinite(value)) throw new Error(`orbit-keeping source block does not expose numeric ${left}`)
  return value
}

function sourceBlocks(template: string) {
  const sequenceMarker = "BeginMissionSequence;"
  const sequenceIndex = template.indexOf(sequenceMarker)
  if (sequenceIndex < 0) throw new Error("orbit-keeping source block does not expose its mission sequence")
  return template.slice(0, sequenceIndex)
}

/**
 * Builds a two-impulse, coplanar chemical Hohmann transfer.
 *
 * The physical/object blocks are copied from the approved orbit-keeping
 * template; the source template is never edited.  Only the mission sequence
 * is authored here.  That makes this a safe first example of block assembly:
 * it has a traceable source for every inherited GMAT object and no LLM
 * generated GMAT syntax.
 */
export function buildChemicalTransferScript(template: string, inputs: ChemicalTransferInputs): BuiltMissionScript {
  finitePositive(inputs.initialSmaKm, "initial semi-major axis")
  finitePositive(inputs.targetSmaKm, "target semi-major axis")
  finitePositive(inputs.initialFuelMassKg, "initial fuel mass")
  finiteNonNegative(inputs.initialEccentricity, "initial eccentricity")
  finiteNonNegative(inputs.initialInclinationDeg, "initial inclination")
  if (inputs.initialEccentricity >= 1) throw new Error("chemical transfer requires an elliptic initial orbit (eccentricity < 1)")
  if (Math.abs(inputs.targetSmaKm - inputs.initialSmaKm) < 0.001) throw new Error("chemical transfer requires different initial and target semi-major axes")

  const r1 = inputs.initialSmaKm
  const r2 = inputs.targetSmaKm
  const semiMajorTransfer = (r1 + r2) / 2
  const firstBurnDeltaVKmPerSec = Math.sqrt(EARTH_MU_KM3_PER_S2 / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1)
  const secondBurnDeltaVKmPerSec = Math.sqrt(EARTH_MU_KM3_PER_S2 / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)))
  const transferDurationSeconds = Math.PI * Math.sqrt((semiMajorTransfer ** 3) / EARTH_MU_KM3_PER_S2)
  const arrivalEvent = r2 > r1 ? "apoapsis" : "periapsis"
  const coastAfterTransferDays = inputs.coastAfterTransferDays ?? 0
  const dryMassKg = inputs.dryMassKg ?? numericAssignment(template, "DefaultSC.DryMass")
  const specificImpulseSeconds = inputs.specificImpulseSeconds ?? numericAssignment(template, "TOI.Isp")
  const fuelReserveKg = inputs.fuelReserveKg ?? 1
  finiteNonNegative(coastAfterTransferDays, "coast after transfer duration")
  finitePositive(dryMassKg, "dry mass")
  finitePositive(specificImpulseSeconds, "specific impulse")
  finiteNonNegative(fuelReserveKg, "fuel reserve")
  const totalDeltaVKmPerSec = Math.abs(firstBurnDeltaVKmPerSec) + Math.abs(secondBurnDeltaVKmPerSec)
  const propellantRequiredKg = dryMassKg * (Math.exp((totalDeltaVKmPerSec * 1000) / (specificImpulseSeconds * 9.80665)) - 1)
  const minimumInitialFuelMassKg = propellantRequiredKg + fuelReserveKg
  if (inputs.initialFuelMassKg + 1e-9 < minimumInitialFuelMassKg) {
    throw new Error(`chemical transfer needs at least ${minimumInitialFuelMassKg.toFixed(3)} kg initial fuel (${propellantRequiredKg.toFixed(3)} kg manoeuvres + ${fuelReserveKg.toFixed(3)} kg reserve); received ${inputs.initialFuelMassKg.toFixed(3)} kg`)
  }

  let objects = sourceBlocks(template)
  objects = replaceSingleAssignment(objects, "DefaultSC.SMA", inputs.initialSmaKm)
  objects = replaceSingleAssignment(objects, "DefaultSC.ECC", inputs.initialEccentricity)
  objects = replaceSingleAssignment(objects, "DefaultSC.INC", inputs.initialInclinationDeg)
  objects = replaceSingleAssignment(objects, "DefaultSC.DryMass", dryMassKg)
  objects = replaceSingleAssignment(objects, "ChemicalTank1.FuelMass", inputs.initialFuelMassKg)
  objects = replaceSingleAssignment(objects, "TOI.Element1", firstBurnDeltaVKmPerSec)
  objects = replaceSingleAssignment(objects, "TOI.Isp", specificImpulseSeconds)
  objects = replaceSingleAssignment(objects, "GOI.Element1", secondBurnDeltaVKmPerSec)
  objects = replaceSingleAssignment(objects, "GOI.Isp", specificImpulseSeconds)

  const script = `${objects}%----------------------------------------
%---------- Scenario-builder mission sequence
%----------------------------------------
% Scenario: transfer / chemical / 2d
% Blocks: orbit-keeping spacecraft, chemical tank, force model, propagator,
%         impulsive burns, reports, and ephemeris subscriber.
% The two VNB burns implement a coplanar Hohmann transfer.
% Propellant check: ${gmatNumber(propellantRequiredKg)} kg required + ${gmatNumber(fuelReserveKg)} kg reserve; initial fuel = ${gmatNumber(inputs.initialFuelMassKg)} kg.

BeginMissionSequence;

Toggle EphemerisFile1 On;
Report OrbitAnalysisReport DefaultSC.A1ModJulian DefaultSC.Earth.Altitude DefaultSC.ChemicalTank1.FuelMass DefaultSC.TotalMass DefaultSC.Earth.SMA DefaultSC.Earth.ECC DefaultSC.EarthMJ2000Eq.INC;

Maneuver 'Transfer injection' TOI(DefaultSC);
Propagate 'Coast on transfer ellipse' DefaultProp(DefaultSC) {DefaultSC.Earth.${arrivalEvent === "apoapsis" ? "Apoapsis" : "Periapsis"}};
Maneuver 'Transfer circularization' GOI(DefaultSC);

${coastAfterTransferDays > 0 ? `Propagate 'Post-transfer coast' DefaultProp(DefaultSC) {DefaultSC.ElapsedDays = ${gmatNumber(coastAfterTransferDays)}};
` : ""}Report OrbitAnalysisReport DefaultSC.A1ModJulian DefaultSC.Earth.Altitude DefaultSC.ChemicalTank1.FuelMass DefaultSC.TotalMass DefaultSC.Earth.SMA DefaultSC.Earth.ECC DefaultSC.EarthMJ2000Eq.INC;
Report ReboostReport DefaultSC.A1ModJulian DefaultSC.ChemicalTank1.FuelMass DefaultSC.Earth.Altitude;
`

  return {
    blocks: ["orbit-keeping:spacecraft", "orbit-keeping:chemical-hardware", "orbit-keeping:force-model", "orbit-keeping:propagator", "orbit-keeping:subscribers", "chemical-transfer:hohmann-sequence"],
    scenario: { family: "transfer", propagationDimension: "2d", propulsion: "chemical" },
    script,
    transfer: { arrivalEvent, firstBurnDeltaVKmPerSec, minimumInitialFuelMassKg, propellantRequiredKg, secondBurnDeltaVKmPerSec, transferDurationSeconds },
  }
}

/** Materialises the first block-built scenario without changing either reference template. */
export async function generateChemicalTransferScript({
  inputs,
  outputPath,
  templatePath = defaultOrbitKeepingTemplatePath(),
}: {
  inputs: ChemicalTransferInputs
  outputPath: string
  templatePath?: string
}) {
  const template = await fs.readFile(templatePath, "utf8")
  const built = buildChemicalTransferScript(template, inputs)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, built.script, "utf8")
  return { ...built, outputPath, templatePath }
}
