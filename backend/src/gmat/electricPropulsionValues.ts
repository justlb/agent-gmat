import type { OrbitKeepingValueChange, OrbitKeepingValueSlot, OrbitKeepingValues } from "./orbitKeepingValues.js"
import { applyOrbitKeepingValueChanges, extractOrbitKeepingValues, renderOrbitKeepingValues } from "./orbitKeepingValues.js"

export type ElectricPropulsionValueSlot = OrbitKeepingValueSlot
export type ElectricPropulsionValues = {
  schemaVersion: 1
  templateId: "electric-propulsion-transfer"
  slots: ElectricPropulsionValueSlot[]
}
export type ElectricPropulsionValueChange = OrbitKeepingValueChange

function assertElectricPropulsionChangesAreNonStructural(values: ElectricPropulsionValues, changes: ElectricPropulsionValueChange[]) {
  const slotsById = new Map(values.slots.map(slot => [slot.id, slot]))
  for (const change of changes) {
    const slot = slotsById.get(change.id)
    if (slot?.context.startsWith("ElectricTransferReport.Add =")) {
      throw new Error("ElectricTransferReport.Add is fixed report structure and cannot be modified")
    }
  }
}

function asOrbitKeepingValues(values: ElectricPropulsionValues): OrbitKeepingValues {
  return { ...values, templateId: "orbit-keeping" }
}

function asElectricPropulsionValues(values: OrbitKeepingValues): ElectricPropulsionValues {
  return { ...values, templateId: "electric-propulsion-transfer" }
}

// The template is immutable except for this explicit, engineering-facing set.
// Keeping the values file narrow prevents a draft (or an LLM response) from
// rewriting subscribers, force models, hardware topology, or mission commands.
const EDITABLE_CONTEXT_PREFIXES = [
  "DefaultSC.Epoch =", "DefaultSC.SMA =", "DefaultSC.ECC =", "DefaultSC.INC =", "DefaultSC.RAAN =", "DefaultSC.AOP =", "DefaultSC.TA =", "DefaultSC.DryMass =",
  "ElectricTank1.FuelMass =", "daysofpropagation =", "ElectricThruster1.MaximumUsablePower =", "ElectricThruster1.MinimumUsablePower =",
  "SolarPowerSystem1.InitialEpoch =", "SolarPowerSystem1.InitialMaxPower =", "ElectricTransferReport.Filename =", "ElectricTransferReport.Add =", "EphemerisFile1.Filename =",
  "SolarPowerSystem1.Margin =", "SolarPowerSystem1.BusCoeff1 =",
] as const

function isElectricPropulsionSlot(slot: OrbitKeepingValueSlot) {
  return EDITABLE_CONTEXT_PREFIXES.some(prefix => slot.context.startsWith(prefix))
}

export function extractElectricPropulsionValues(template: string): ElectricPropulsionValues {
  const source = extractOrbitKeepingValues(template)
  return asElectricPropulsionValues({ ...source, slots: source.slots.filter(isElectricPropulsionSlot) })
}

export function applyElectricPropulsionValueChanges(values: ElectricPropulsionValues, changes: ElectricPropulsionValueChange[]) {
  assertElectricPropulsionChangesAreNonStructural(values, changes)
  return asElectricPropulsionValues(applyOrbitKeepingValueChanges(asOrbitKeepingValues(values), changes))
}

export function renderElectricPropulsionValues(template: string, values: ElectricPropulsionValues) {
  const source = extractOrbitKeepingValues(template)
  const sourceSlots = new Map(source.slots.map(slot => [slot.id, slot]))
  for (const slot of values.slots) {
    const expected = sourceSlots.get(slot.id)
    if (!expected || !isElectricPropulsionSlot(expected) || expected.context !== slot.context) {
      throw new Error(`values YAML does not match editable electric-propulsion template slot ${slot.id}`)
    }
  }
  const renderedValues = applyOrbitKeepingValueChanges(source, values.slots.map(slot => ({ id: slot.id, value: slot.value })))
  return renderOrbitKeepingValues(template, renderedValues)
}
