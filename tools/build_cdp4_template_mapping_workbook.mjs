import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const cdpJsonPath = "C:/Users/justl/Documents/xwechat_files/wxid_6mmbdg6y39pd12_092c/msg/file/2026-08/bfce970d-4af0-4479-9853-e00cac5c91e9_formatted.json";
const cdpCsvPath = "C:/Users/justl/Documents/xwechat_files/wxid_6mmbdg6y39pd12_092c/msg/file/2026-08/parameter_types_local_test_model.csv";

const rows = [
  ["satellite.identity.name", ""],
  ["satellite.identity.manufacturer", "manufacturer; supplier"],
  ["satellite.identity.operator; country; platform; constellation", ""],
  ["satellite.identity.cospar_id; norad_id", ""],
  ["satellite.identity.mission_type; mission_objective; status", ""],
  ["satellite.bus.physical.mass_kg.dry", "dry mass"],
  ["satellite.bus.physical.mass_kg.wet_at_launch; maximum_wet", "wet mass"],
  ["satellite.bus.physical.mass_kg.propellant; payload; adapter", "mass; target mass"],
  ["satellite.bus.physical.dimensions_meters.body_length", "length"],
  ["satellite.bus.physical.dimensions_meters.body_width", "width; breadth"],
  ["satellite.bus.physical.dimensions_meters.body_height", "height"],
  ["satellite.bus.physical.dimensions_meters.solar_array_span", "length; width; area"],
  ["satellite.bus.physical.drag_area_m2; solar_radiation_pressure_area_m2", "area"],
  ["satellite.bus.physical.drag_coefficient; solar_radiation_pressure_coefficient", ""],
  ["satellite.bus.physical.center_of_mass_m.x/y/z", "cartesian coordinate x; cartesian coordinate y; cartesian coordinate z"],
  ["satellite.bus.physical.inertia_kg_m2.ixx/iyy/izz", "mass moment of inertia"],
  ["satellite.bus.physical.inertia_kg_m2.ixy/ixz/iyz", ""],
  ["satellite.bus.physical.structure_material", ""],
  ["propulsion_subsystem.architecture; selected_engine_id; selected_operating_mode", ""],
  ["propulsion_subsystem.mission_engine_selection.*", ""],
  ["propulsion_subsystem.propellant_management.tank_pressurization; feed_system; isolation_valves", ""],
  ["propulsion_subsystem.propellant_management.total_usable_propellant_kg; residual_propellant_kg", "mass"],
  ["propulsion_subsystem.propellant_tanks[].propellant", "propellant type"],
  ["propulsion_subsystem.propellant_tanks[].capacity_kg; usable_mass_kg; residual_mass_kg", "mass"],
  ["propulsion_subsystem.propellant_tanks[].pressure_bar", "pressure"],
  ["propulsion_subsystem.propellant_tanks[].temperature_range_celsius.min/max", "temperature; minimum operational temperature; maximum operational temperature"],
  ["propulsion_subsystem.engines[].name; propulsion_family; technology; role", ""],
  ["propulsion_subsystem.engines[].quantity_installed; quantity_operational", ""],
  ["propulsion_subsystem.engines[].redundancy", "redundancy concept; redundancy scheme; redundancy type"],
  ["propulsion_subsystem.engines[].propellant; propellants.fuel; propellants.oxidizer", "propellant type"],
  ["propulsion_subsystem.engines[].propellants.mixture_ratio", "ratio"],
  ["propulsion_subsystem.engines[].performance.nominal_thrust_n; thrust_range_n; thrust_range_mn", "thrust"],
  ["propulsion_subsystem.engines[].performance.specific_impulse_seconds", "specific impulse"],
  ["propulsion_subsystem.engines[].performance.total_impulse_ns; minimum_impulse_bit_ns", "impulse"],
  ["propulsion_subsystem.engines[].performance.delta_v_mps", "delta-v; total Δv"],
  ["propulsion_subsystem.engines[].performance.efficiency_percent", "efficiency"],
  ["propulsion_subsystem.engines[].performance.duty_cycle", "power duty cycle"],
  ["propulsion_subsystem.engines[].performance.design_lifetime_hours", "lifetime"],
  ["propulsion_subsystem.engines[].performance.restart_cycles; burn_time_s", ""],
  ["propulsion_subsystem.engines[].power.nominal_power_kw; minimum_usable_power_kw; maximum_usable_power_kw", "power; active power; peak consumed power"],
  ["propulsion_subsystem.engines[].power.power_processing_unit_efficiency_percent", "efficiency"],
  ["propulsion_subsystem.engines[].power.bus_voltage_v", "voltage; source voltage"],
  ["propulsion_subsystem.engines[].feed_system.*", "pressure"],
  ["propulsion_subsystem.engines[].installation.mounting_location; thrust_axis_body_frame; plume_keep_out_zones", ""],
  ["propulsion_subsystem.engines[].installation.gimbal_range_deg.pitch/yaw", "angle; half angle"],
  ["propulsion_subsystem.gmat_legacy_compatibility.type; propellant", "propellant type"],
  ["propulsion_subsystem.gmat_legacy_compatibility.specific_impulse_seconds", "specific impulse"],
  ["propulsion_subsystem.gmat_legacy_compatibility.main_engine_thrust_n; nominal_thrust_newtons", "thrust"],
  ["propulsion_subsystem.gmat_legacy_compatibility.nominal_duty_cycle", "power duty cycle"],
  ["propulsion_subsystem.gmat_legacy_compatibility.electric_thruster.*power*_kw", "power"],
  ["electrical_subsystem.solar_panels.type", "solar array type"],
  ["electrical_subsystem.solar_panels.efficiency_percent", "efficiency"],
  ["electrical_subsystem.solar_panels.total_area_m2", "area"],
  ["electrical_subsystem.solar_panels.total_power_generated_watts; beginning_of_life_power_watts; end_of_life_power_watts", "power; power handling capability"],
  ["electrical_subsystem.solar_panels.array_orientation", ""],
  ["electrical_subsystem.solar_panels.degradation_percent_per_year", ""],
  ["electrical_subsystem.batteries.chemistry; quantity", ""],
  ["electrical_subsystem.batteries.capacity_ah", "battery capacity"],
  ["electrical_subsystem.batteries.energy_wh", "energy"],
  ["electrical_subsystem.batteries.voltage_v", "voltage"],
  ["electrical_subsystem.batteries.depth_of_discharge_percent", "fraction; ratio"],
  ["electrical_subsystem.batteries.maximum_charge_power_w; maximum_discharge_power_w", "power"],
  ["electrical_subsystem.bus_voltage_v", "voltage"],
  ["electrical_subsystem.spacecraft_bus_load_kw; electric_propulsion_mode.bus_load_kw", "power; mean consumed power; peak consumed power"],
  ["electrical_subsystem.electric_propulsion_mode.maximum_simultaneous_thrusters", ""],
  ["electrical_subsystem.system_margin_percent", ""],
  ["attitude_control_subsystem.control_mode", "spacecraft attitude; enumeration attitude stability"],
  ["attitude_control_subsystem.pointing_accuracy_arcsec; pointing_stability_arcsec_per_sec", ""],
  ["attitude_control_subsystem.actuators.reaction_wheels; magnetic_torquers", ""],
  ["attitude_control_subsystem.actuators.thrusters", "number of attitude control thrusters per thrust axis"],
  ["attitude_control_subsystem.sensors.*", ""],
  ["thermal_subsystem.control_method", ""],
  ["thermal_subsystem.operational_temp_range_celsius.min/max", "minimum operational temperature; maximum operational temperature"],
  ["thermal_subsystem.radiators_area_m2", "area"],
  ["thermal_subsystem.survival_heaters_power_w", "power"],
  ["opalis.model.template_id; reference_source; simulation_mode; power_supply; regulation_type", ""],
  ["opalis.model.distribution_resistance_ohm", "resistance"],
  ["opalis.simulation.reference_time_step_s; reference_duration_s", "time; duration; period duration"],
  ["opalis.simulation.satellite_temperature_c", "temperature"],
  ["opalis.simulation.regulated_mode; current_limit_mode; voltage_limit_mode; thermal_model", ""],
  ["opalis.battery.initial_voltage_v; low_voltage_limit_v", "voltage"],
  ["opalis.battery.initial_state_of_charge", "fraction; ratio"],
  ["opalis.battery.energy_wh", "energy"],
  ["opalis.battery.cells_parallel", ""],
  ["opalis.battery.cells_series", "number of cells in series"],
  ["opalis.battery.cell_model; cell_type", "battery cell type"],
  ["opalis.battery.cell_capacity_ah", "battery capacity"],
  ["opalis.battery.cable_resistance_ohm", "resistance"],
  ["opalis.power_distribution.constant_load_w; margin_w; rated_power_w", "power"],
  ["opalis.power_distribution.consumption_mode", ""],
  ["opalis.environment.solar_constant_w_m2; albedo_w_m2; earth_radiation_w_m2", "irradiance; areic heat flow rate"],
  ["opalis.solar_generator.cell_model", "solar cell type"],
  ["opalis.solar_generator.cell_area_m2; sections[].area_m2", "area"],
  ["opalis.solar_generator.sections[].type; anchor_type; filling_factor; cells_parallel; cells_series; rated_power_w", ""],
  ["rf_comlink.data_handling.initial_memory_usage_bits; memory_capacity_bits", "data volume"],
  ["rf_comlink.data_handling.payload_binary_rate.mode", ""],
  ["rf_comlink.data_handling.payload_binary_rate.rate_bps", "data rate"],
  ["rf_comlink.data_handling.payload_binary_rate.active_duration_s; repeat_period_s", "duration; period duration"],
  ["rf_comlink.links[].system.frequency_band", "frequency band"],
  ["rf_comlink.links[].system.frequency_range_mhz; frequency_mhz", "frequency; frequency bandwidth"],
  ["rf_comlink.links[].system.data_rate_bps", "data rate"],
  ["rf_comlink.links[].system.bit_error_rate; modulation; coding; required_ebn0_db; required_ebn0_manual", ""],
  ["rf_comlink.links[].spacecraft_antenna.antenna_type", ""],
  ["rf_comlink.links[].spacecraft_antenna.gain_db", "antenna gain; maximum antenna gain; minimum antenna gain"],
  ["rf_comlink.links[].spacecraft_antenna.figure_of_merit_db_per_k; eirp_dbw; pointing_loss_db; axial_ratio_db", ""],
  ["rf_comlink.links[].spacecraft_antenna.polarization", "electromagnetic polarization; electromagnetic polarization state; electromagnetic polarization direction"],
  ["rf_comlink.links[].propagation.atmospheric_loss_db; weather_unavailability_percent", ""],
  ["payload.primary_instrument.name; type", ""],
  ["payload.primary_instrument.power_consumption_w", "power; mean consumed power; peak consumed power"],
  ["payload.primary_instrument.mass_kg", "mass"],
  ["payload.primary_instrument.optical_system.aperture_meters", "diameter"],
  ["payload.primary_instrument.optical_system.focal_length_meters", "image focal; object focal"],
  ["payload.primary_instrument.optical_system.f_number; spectral_bands; swath_width_km; radiometric_resolution_bits", ""],
  ["payload.primary_instrument.onboard_processing.compression; storage_capacity_gb; processing_unit", ""],
  ["payload.secondary_instruments[]", ""],
  ["mission_lifecycle.launch.launch_date", "Launch date"],
  ["mission_lifecycle.launch.launch_site; launch_vehicle; injection_accuracy", ""],
  ["mission_lifecycle.launch.deployment_altitude_km", "altitude; altitude of apogee; altitude of perigee"],
  ["mission_lifecycle.lifetime.design_lifetime_years; consumables_end_of_life_years", "lifetime"],
  ["mission_lifecycle.lifetime.expected_decommissioning_year", ""],
  ["mission_lifecycle.end_of_life_plan.strategy; target_reentry_point; passivation", ""],
  ["mission_lifecycle.end_of_life_plan.residual_propellant_required_kg", "mass"],
  ["mission_lifecycle.end_of_life_plan.graveyard_orbit_altitude_km", "altitude"]
];

function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = header.split(",");
  return lines.map(line => Object.fromEntries(line.split(",").map((value, index) => [columns[index], value])));
}

function selectedValues(valueSets, byId) {
  return valueSets.flatMap(id => {
    const set = byId.get(id);
    if (!set) return [];
    const raw = set[set.valueSwitch?.toLowerCase()] ?? set.manual;
    try { return JSON.parse(raw); } catch { return raw ? [raw] : []; }
  });
}

const [cdpObjects, csvText] = await Promise.all([
  fs.readFile(cdpJsonPath, "utf8").then(JSON.parse),
  fs.readFile(cdpCsvPath, "utf8")
]);
const byId = new Map(cdpObjects.map(item => [item.iid, item]));
const typeById = new Map(parseCsv(csvText).map(row => [row.IID, row]));
const componentByParameter = new Map();
for (const element of cdpObjects.filter(item => item.classKind === "ElementDefinition")) {
  for (const parameterId of element.parameter ?? []) componentByParameter.set(parameterId, element.name);
}
const valuesByType = new Map();
for (const parameter of cdpObjects.filter(item => item.classKind === "Parameter")) {
  const type = typeById.get(parameter.parameterType);
  const component = componentByParameter.get(parameter.iid);
  if (!type || !component) continue;
  const values = selectedValues(parameter.valueSet ?? [], byId).filter(value => value !== "-");
  if (!values.length) continue;
  const entries = valuesByType.get(type.Name) ?? [];
  for (const value of values) {
    const entry = `${component}: ${value}${type["Unit Short Name"] && !type["Unit Short Name"].startsWith("[") ? ` ${type["Unit Short Name"]}` : ""}`;
    if (!entries.includes(entry)) entries.push(entry);
  }
  valuesByType.set(type.Name, entries);
}

function valuesFor(csvTypes) {
  if (!csvTypes) return "";
  const names = csvTypes.split(";").map(name => name.trim());
  const values = names.flatMap(name => valuesByType.get(name) ?? []);
  return [...new Set(values)].join("\n");
}

const outputDir = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\//, ""), "outputs");
await fs.mkdir(outputDir, { recursive: true });
const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Correspondances");
sheet.showGridLines = false;
sheet.getRange(`A1:C${rows.length + 2}`).values = [
  ["Correspondances template Agent GMAT ↔ dictionnaire CDP4", null, null],
  ["Champ(s) du template", "Type CSV correspondant", "Valeur CDP4"],
  ...rows.map(([field, csvTypes]) => [field, csvTypes, valuesFor(csvTypes)])
];
sheet.mergeCells("A1:C1");
sheet.getRange("A1:C1").format = { fill: "#102A43", font: { bold: true, color: "#FFFFFF", size: 14 }, horizontalAlignment: "left", verticalAlignment: "center" };
sheet.getRange("A1:C1").format.rowHeight = 28;
sheet.getRange("A2:C2").format = { fill: "#1F5F8B", font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
const data = sheet.getRange(`A3:C${rows.length + 2}`);
data.format = { verticalAlignment: "top", wrapText: true, borders: { preset: "insideHorizontal", style: "thin", color: "#D9E2EC" } };
sheet.getRange(`A3:A${rows.length + 2}`).format.fill = "#F5F8FA";
sheet.getRange(`B3:B${rows.length + 2}`).conditionalFormats.add("containsBlanks", { format: { fill: "#FFF4E5" } });
sheet.getRange(`C3:C${rows.length + 2}`).conditionalFormats.add("containsBlanks", { format: { fill: "#FFF4E5" } });
sheet.getRange("A:A").format.columnWidth = 58;
sheet.getRange("B:B").format.columnWidth = 52;
sheet.getRange("C:C").format.columnWidth = 55;
sheet.freezePanes.freezeRows(2);
sheet.tables.add(`A2:C${rows.length + 2}`, true, "TemplateCdp4Mapping");
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "cdp4_template_csv_mapping_with_values.xlsx"));
const preview = await workbook.render({ sheetName: "Correspondances", range: "A1:C20", scale: 1.25, format: "png" });
await fs.writeFile(path.join(outputDir, "cdp4_template_csv_mapping.preview.png"), new Uint8Array(await preview.arrayBuffer()));
const check = await workbook.inspect({ kind: "table", range: "A1:C12", include: "values", tableMaxRows: 12, tableMaxCols: 3 });
console.log(check.ndjson);
