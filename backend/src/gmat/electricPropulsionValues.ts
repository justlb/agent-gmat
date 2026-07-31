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

export function extractElectricPropulsionValues(template: string): ElectricPropulsionValues {
  return asElectricPropulsionValues(extractOrbitKeepingValues(template))
}

export function applyElectricPropulsionValueChanges(values: ElectricPropulsionValues, changes: ElectricPropulsionValueChange[]) {
  assertElectricPropulsionChangesAreNonStructural(values, changes)
  return asElectricPropulsionValues(applyOrbitKeepingValueChanges(asOrbitKeepingValues(values), changes))
}

export function renderElectricPropulsionValues(template: string, values: ElectricPropulsionValues) {
  return renderOrbitKeepingValues(template, asOrbitKeepingValues(values))
}
