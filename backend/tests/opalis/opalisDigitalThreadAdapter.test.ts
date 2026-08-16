import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { adaptDigitalThreadToOpalis } from "../../src/opalis/opalisDigitalThreadAdapter.js"
import type { DigitalThreadDocument } from "../../src/digitalThread/digitalThreadStore.js"

function opalisReadyDocument(): DigitalThreadDocument {
  return {
    schema_version: 1,
    digital_thread: { revision: 1 },
    provenance: { derivations: [], values: {} },
    satellite: {
      identity: { name: "OPALIS test satellite" },
      bus: {
        opalis: {
          model: { template_id: "empty.opalis", simulation_mode: "Simple", power_supply: "MediumSat", regulation_type: "DET", distribution_resistance_ohm: 0.035 },
          simulation: { reference_time_step_s: 0.1, reference_duration_s: 86400, satellite_temperature_c: 20, regulated_mode: "NonRegulated", current_limit_mode: "Constant", voltage_limit_mode: "Constant", thermal_model: "Reduced" },
          battery: { initial_voltage_v: 50, initial_state_of_charge: 0.9, energy_wh: 3000, cells_parallel: 17, cells_series: 13, cable_resistance_ohm: 0.05, low_voltage_limit_v: 52.15119 },
          power_distribution: { rated_power_w: 10000, consumption_mode: "Constant", constant_load_w: 1500, margin_w: 0 },
          environment: { solar_constant_w_m2: 1360, albedo_w_m2: 410, earth_radiation_w_m2: 210 },
          solar_generator: {
            cell_model: "3G30 BOL",
            cell_area_m2: 0.0031,
            sections: [
              { type: "RigidPanel", area_m2: 2, anchor_type: "BodyMounted", filling_factor: 0.85, cells_parallel: 21, cells_series: 25, rated_power_w: 10000 },
              { type: "RigidPanel", area_m2: 6, anchor_type: "Deployed", filling_factor: 0.85, cells_parallel: 65, cells_series: 25, rated_power_w: 10000 },
            ],
          },
        },
      },
    },
    analysis_requests: { gmat: { electric_propulsion_transfer: {}, orbit_keeping: {} } },
  }
}

describe("OPALIS digital-thread adapter", () => {
  it("maps a satellite.json into the static empty.opalis contract", () => {
    const result = adaptDigitalThreadToOpalis(opalisReadyDocument())
    assert.equal(result.validation.status, "ready")
    assert.equal(result.validation.missing.length, 0)
    assert.equal(result.template, "empty.opalis")
    assert.ok(result.parameters.some(item => item.opalis_path === "SimulationModel.SolarGenerator.Sections[1].SectionArea" && item.value === 6))
    assert.ok(result.parameters.some(item => item.opalis_path === "SimulationModel.SolarGenerator.Sections[0].Cell.AreaCell" && item.value === 0.0031))
    assert.ok(result.parameters.some(item => item.opalis_path === "SimulationModel.DistributionLines[0].Pdim" && item.value === 10000))
  })

  it("blocks preparation when a solar section is incomplete", () => {
    const document = opalisReadyDocument()
    const section = ((document.satellite.bus as Record<string, unknown>).opalis as Record<string, unknown>)
    const generator = section.solar_generator as Record<string, unknown>
    delete (generator.sections as Array<Record<string, unknown>>)[0].filling_factor
    const result = adaptDigitalThreadToOpalis(document)
    assert.equal(result.validation.status, "blocked")
    assert.ok(result.validation.missing.includes("satellite.bus.opalis.solar_generator.sections[0].filling_factor"))
  })

  it("collapses duplicated legacy solar-section definitions", () => {
    const document = opalisReadyDocument()
    const opalis = ((document.satellite.bus as Record<string, unknown>).opalis as Record<string, unknown>)
    const generator = opalis.solar_generator as Record<string, unknown>
    const sections = generator.sections as Array<Record<string, unknown>>
    generator.sections = [...sections, structuredClone(sections[0]), structuredClone(sections[1])]
    const result = adaptDigitalThreadToOpalis(document)
    const areas = result.parameters.filter(item => /Sections\[\d+\]\.SectionArea$/u.test(item.opalis_path))
    assert.equal(areas.length, 2)
    assert.deepEqual(areas.map(item => item.value), [2, 6])
  })

  it("blocks an electrical configuration whose initial battery voltage is at or below its low limit", () => {
    const document = referenceDocument()
    document.satellite.bus.opalis.battery.initial_voltage_v = 50
    document.satellite.bus.opalis.battery.low_voltage_limit_v = 52
    const adapted = adaptDigitalThreadToOpalis(document)
    assert.equal(adapted.validation.status, "blocked")
    assert.match(adapted.validation.warnings.join("\n"), /initial_voltage_v must be strictly greater/u)
  })
})
