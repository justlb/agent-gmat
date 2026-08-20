import type { OrbitKeepingValueChange, OrbitKeepingValueSlot, OrbitKeepingValues } from "./orbitKeepingValues.js"
import { applyOrbitKeepingValueChanges, extractOrbitKeepingValues, renderOrbitKeepingValues } from "./orbitKeepingValues.js"

export type ElectricPropulsionValueSlot = OrbitKeepingValueSlot
/**
 * Satellite-owned inputs recorded alongside the editable GMAT slots.
 *
 * These values are deliberately not additional template slots: the reference
 * GMAT script remains structurally fixed.  They make the per-run YAML a
 * complete, auditable translation of satellite.json.  The generator uses the
 * thrust/Isp/power fields to calibrate the FixedEfficiency thruster model;
 * battery capacity is retained for downstream electrical analyses because the
 * fixed GMAT SolarPowerSystem has no battery model to configure.
 */
export type ElectricPropulsionSatelliteInputs = {
  source: "satellite.json"
  propulsion: {
    specificImpulseSeconds: number | null
    nominalThrustNewtons: number | null
    nominalThrusterPowerKw: number | null
    dutyCycle: number | null
    fixedEfficiency: number | null
    minimumUsablePowerKw: number | null
    maximumUsablePowerKw: number | null
  }
  electrical: {
    solarArray: {
      totalPowerGeneratedWatts: number | null
      totalAreaM2: number | null
      efficiencyPercent: number | null
    }
    busLoadKw: number | null
    battery: {
      capacityAh: number | null
      energyWh: number | null
    }
  }
}
export type ElectricPropulsionValues = {
  schemaVersion: 1
  templateId: "electric-propulsion-transfer"
  slots: ElectricPropulsionValueSlot[]
  satelliteInputs?: ElectricPropulsionSatelliteInputs
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

function finiteNumberAt(value: unknown, path: string) {
  const result = path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value)
  return typeof result === "number" && Number.isFinite(result) ? result : null
}

/** Extract the satellite-owned electric inputs from the run's satellite.json. */
export function electricPropulsionSatelliteInputs(document: unknown): ElectricPropulsionSatelliteInputs {
  return {
    source: "satellite.json",
    propulsion: {
      specificImpulseSeconds: finiteNumberAt(document, "satellite.bus.propulsion_subsystem.specific_impulse_seconds"),
      nominalThrustNewtons: finiteNumberAt(document, "satellite.bus.propulsion_subsystem.nominal_thrust_newtons")
        ?? finiteNumberAt(document, "satellite.bus.propulsion_subsystem.electric_thruster.constant_thrust_newtons"),
      nominalThrusterPowerKw: finiteNumberAt(document, "satellite.bus.propulsion_subsystem.electric_thruster.nominal_thruster_power_kw"),
      dutyCycle: finiteNumberAt(document, "satellite.bus.propulsion_subsystem.nominal_duty_cycle"),
      fixedEfficiency: finiteNumberAt(document, "satellite.bus.propulsion_subsystem.electric_thruster.fixed_efficiency"),
      minimumUsablePowerKw: finiteNumberAt(document, "satellite.bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw"),
      maximumUsablePowerKw: finiteNumberAt(document, "satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw"),
    },
    electrical: {
      solarArray: {
        totalPowerGeneratedWatts: finiteNumberAt(document, "satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts"),
        totalAreaM2: finiteNumberAt(document, "satellite.bus.electrical_subsystem.solar_panels.total_area_m2"),
        efficiencyPercent: finiteNumberAt(document, "satellite.bus.electrical_subsystem.solar_panels.efficiency_percent"),
      },
      // This is the allocation used during the electric transfer when set;
      // otherwise the normal spacecraft bus load is the authoritative value.
      busLoadKw: finiteNumberAt(document, "satellite.bus.electrical_subsystem.electric_propulsion_mode.bus_load_kw")
        ?? finiteNumberAt(document, "satellite.bus.electrical_subsystem.spacecraft_bus_load_kw"),
      battery: {
        capacityAh: finiteNumberAt(document, "satellite.bus.electrical_subsystem.batteries.capacity_ah"),
        energyWh: finiteNumberAt(document, "satellite.bus.electrical_subsystem.batteries.energy_wh"),
      },
    },
  }
}

// The template is immutable except for this explicit, engineering-facing set.
// Keeping the values file narrow prevents a draft (or an LLM response) from
// rewriting subscribers, force models, hardware topology, or mission commands.
const EDITABLE_CONTEXT_PREFIXES = [
  "DefaultSC.Epoch =", "DefaultSC.SMA =", "DefaultSC.ECC =", "DefaultSC.INC =", "DefaultSC.RAAN =", "DefaultSC.AOP =", "DefaultSC.TA =", "DefaultSC.DryMass =", "DefaultSC.Cd =", "DefaultSC.DragArea =",
  "ElectricTank1.FuelMass =", "targetFinalAltitudeKm =", "ElectricThruster1.MaximumUsablePower =", "ElectricThruster1.MinimumUsablePower =",
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
