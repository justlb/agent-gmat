import type { DigitalThreadDocument, JsonValue } from "../digitalThread/digitalThreadStore.js"
import { getAtPath } from "../digitalThread/digitalThreadStore.js"

export type OpalisParameter = {
  opalis_path: string
  source_path: string
  unit: string
  value: boolean | number | string
}

export type OpalisInputValidation = {
  missing: string[]
  status: "blocked" | "ready"
  warnings: string[]
}

export type OpalisInputParameters = {
  parameters: OpalisParameter[]
  schema_version: 1
  source_satellite: "satellite.json"
  template: string | null
  validation: OpalisInputValidation
}

type Mapping = { opalisPath: string; sourcePath: string; unit: string; valueType: "number" | "string" }

const STATIC_MAPPINGS: readonly Mapping[] = [
  { sourcePath: "satellite.identity.name", opalisPath: "SimulationModel.PowerProfil.SatelliteName", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.model.simulation_mode", opalisPath: "SimulationModel.SimulationMode", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.simulation.reference_time_step_s", opalisPath: "SimulationModel.SimulationTiming.Timestep", unit: "s", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.simulation.reference_duration_s", opalisPath: "SimulationModel.SimulationTiming.Simultime", unit: "s", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.simulation.satellite_temperature_c", opalisPath: "SimulationModel.PowerProfil.SatelliteTemperature", unit: "degC", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.simulation.regulated_mode", opalisPath: "SimulationModel.PowerProfil.Regulated", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.simulation.current_limit_mode", opalisPath: "SimulationModel.PowerProfil.CurrentLimitMode", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.simulation.voltage_limit_mode", opalisPath: "SimulationModel.PowerProfil.VoltageLimitMode", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.simulation.thermal_model", opalisPath: "SimulationModel.PowerProfil.ThermalModel", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.model.power_supply", opalisPath: "SimulationModel.GlobalArchitecture.VSupply", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.model.regulation_type", opalisPath: "SimulationModel.GlobalArchitecture.RegulType", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.model.distribution_resistance_ohm", opalisPath: "SimulationModel.GlobalArchitecture.RDistribution", unit: "ohm", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.battery.initial_voltage_v", opalisPath: "SimulationModel.SimulationInitialisation.VBatt", unit: "V", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.battery.initial_state_of_charge", opalisPath: "SimulationModel.SimulationInitialisation.SocBattery", unit: "ratio", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.battery.energy_wh", opalisPath: "SimulationModel.Battery.Energy", unit: "Wh", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.battery.cells_parallel", opalisPath: "SimulationModel.Battery.NParallel", unit: "count", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.battery.cells_series", opalisPath: "SimulationModel.Battery.NSerie", unit: "count", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.battery.cable_resistance_ohm", opalisPath: "SimulationModel.Battery.Rcable", unit: "ohm", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.battery.low_voltage_limit_v", opalisPath: "SimulationModel.Battery.Vl", unit: "V", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.power_distribution.rated_power_w", opalisPath: "SimulationModel.DistributionLines[0].Pdim", unit: "W", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.power_distribution.consumption_mode", opalisPath: "SimulationModel.DistributionLines[0].PowerConsumptionMode", unit: "text", valueType: "string" },
  { sourcePath: "satellite.bus.opalis.power_distribution.constant_load_w", opalisPath: "SimulationModel.DistributionLines[0].PConstant", unit: "W", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.power_distribution.margin_w", opalisPath: "SimulationModel.DistributionLines[0].PMargin", unit: "W or %", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.environment.solar_constant_w_m2", opalisPath: "SimulationModel.SolarGenerator.SolarConstant", unit: "W/m²", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.environment.albedo_w_m2", opalisPath: "SimulationModel.SolarGenerator.Albedo", unit: "W/m²", valueType: "number" },
  { sourcePath: "satellite.bus.opalis.environment.earth_radiation_w_m2", opalisPath: "SimulationModel.SolarGenerator.PEarth", unit: "W/m²", valueType: "number" },
]

function object(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function addMappedParameter(parameters: OpalisParameter[], missing: string[], document: DigitalThreadDocument, mapping: Mapping) {
  const value = getAtPath(document, mapping.sourcePath)
  const valid = mapping.valueType === "number"
    ? typeof value === "number" && Number.isFinite(value)
    : typeof value === "string" && value.trim().length > 0
  if (!valid) { missing.push(mapping.sourcePath); return }
  parameters.push({ opalis_path: mapping.opalisPath, source_path: mapping.sourcePath, unit: mapping.unit, value: value as string | number })
}

function addSectionParameters(parameters: OpalisParameter[], missing: string[], document: DigitalThreadDocument) {
  const rawSections = getAtPath(document, "satellite.bus.opalis.solar_generator.sections")
  if (!Array.isArray(rawSections) || !rawSections.length) {
    missing.push("satellite.bus.opalis.solar_generator.sections")
    return
  }
  // Older reference records repeated an identical opposite-side pair. OPALIS
  // models one entry per section geometry here, so collapse exact duplicates
  // while preserving the first occurrence. New reference files contain only
  // the two intended entries.
  const sections = rawSections.filter((section, index) => rawSections.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(section)) === index)
  const fields: Array<[string, string, string, "number" | "string"]> = [
    ["type", "Type", "text", "string"], ["area_m2", "SectionArea", "m²", "number"], ["anchor_type", "AnchorType", "text", "string"],
    ["filling_factor", "FillingFactor", "ratio", "number"], ["cells_parallel", "NPsection", "count", "number"], ["cells_series", "NSsection", "count", "number"], ["rated_power_w", "PdimSA", "W", "number"],
  ]
  sections.forEach((section, index) => {
    const record = object(section)
    for (const [field, opalisField, unit, valueType] of fields) {
      const sourcePath = `satellite.bus.opalis.solar_generator.sections[${index}].${field}`
      const value = record?.[field]
      const valid = valueType === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === "string" && value.trim().length > 0
      if (!valid) { missing.push(sourcePath); continue }
      parameters.push({ opalis_path: `SimulationModel.SolarGenerator.Sections[${index}].${opalisField}`, source_path: sourcePath, unit, value: value as string | number })
    }
    const cellModel = getAtPath(document, "satellite.bus.opalis.solar_generator.cell_model")
    const cellArea = getAtPath(document, "satellite.bus.opalis.solar_generator.cell_area_m2")
    if (typeof cellModel !== "string" || !cellModel.trim()) missing.push("satellite.bus.opalis.solar_generator.cell_model")
    else parameters.push({ opalis_path: `SimulationModel.SolarGenerator.Sections[${index}].Cell.Name`, source_path: "satellite.bus.opalis.solar_generator.cell_model", unit: "text", value: cellModel })
    if (typeof cellArea !== "number" || !Number.isFinite(cellArea)) missing.push("satellite.bus.opalis.solar_generator.cell_area_m2")
    else parameters.push({ opalis_path: `SimulationModel.SolarGenerator.Sections[${index}].Cell.AreaCell`, source_path: "satellite.bus.opalis.solar_generator.cell_area_m2", unit: "mÂ²", value: cellArea })
  })
}

/** Converts the run digital thread into the exact static OPALIS assignments.
 * It deliberately does not inspect or invent dynamic CIC geometry. */
export function adaptDigitalThreadToOpalis(document: DigitalThreadDocument): OpalisInputParameters {
  const parameters: OpalisParameter[] = []
  const missing: string[] = []
  const warnings: string[] = []
  // A dated mission starts from an intentionally empty digital thread. Do
  // not drown the engineer in every OPALIS field when the actual missing
  // action is simply selecting the physical satellite for this run.
  const selectedSatelliteId = getAtPath(document, "digital_thread.satellite_definition.id")
  if (typeof selectedSatelliteId !== "string" || !selectedSatelliteId.trim()) {
    return {
      parameters,
      schema_version: 1,
      source_satellite: "satellite.json",
      template: null,
      validation: {
        missing: ["digital_thread.satellite_definition"],
        status: "blocked",
        warnings: ["Select a satellite for this dated mission. Its OPALIS electrical model will be copied into satellite.json."],
      },
    }
  }
  for (const mapping of STATIC_MAPPINGS) addMappedParameter(parameters, missing, document, mapping)
  addSectionParameters(parameters, missing, document)
  const templateValue = getAtPath(document, "satellite.bus.opalis.model.template_id")
  const template = typeof templateValue === "string" && templateValue.trim() ? templateValue.trim() : null
  if (!template) missing.push("satellite.bus.opalis.model.template_id")

  const soc = getAtPath(document, "satellite.bus.opalis.battery.initial_state_of_charge")
  if (typeof soc === "number" && (soc < 0 || soc > 1)) warnings.push("satellite.bus.opalis.battery.initial_state_of_charge must be between 0 and 1")
  const initialVoltage = getAtPath(document, "satellite.bus.opalis.battery.initial_voltage_v")
  const lowVoltageLimit = getAtPath(document, "satellite.bus.opalis.battery.low_voltage_limit_v")
  if (typeof initialVoltage === "number" && typeof lowVoltageLimit === "number" && initialVoltage <= lowVoltageLimit) {
    warnings.push("satellite.bus.opalis.battery.initial_voltage_v must be strictly greater than satellite.bus.opalis.battery.low_voltage_limit_v")
  }
  const consumptionMode = getAtPath(document, "satellite.bus.opalis.power_distribution.consumption_mode")
  if (consumptionMode !== "Constant" && consumptionMode !== "Profile") warnings.push("satellite.bus.opalis.power_distribution.consumption_mode should be Constant or Profile")

  return {
    parameters,
    schema_version: 1,
    source_satellite: "satellite.json",
    template,
    validation: { missing: [...new Set(missing)], status: missing.length || warnings.length ? "blocked" : "ready", warnings },
  }
}
