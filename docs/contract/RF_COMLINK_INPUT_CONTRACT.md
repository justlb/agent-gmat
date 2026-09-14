# RF-COMLINK Input Contract

This contract defines the authorised sources for an RF-COMLINK execution. One execution belongs to one GMAT run and must not mix data from another run.

```text
satellite.json from the run ───────────┐
Simu-CIC definition + CIC/Sat files ───┼─> input manifest ─> prepared .rfcl
RF-COMLINK template station database ──┘
```

RF-COMLINK remains the authority for link-budget calculations. The backend prepares an auditable scenario and must not invent radio or geometry values.

## 1. Dynamic source: Simu-CIC output

The following files must belong to the selected run:

```text
<run>/opalis/02-simu-cic/simucic.definition.json
<run>/opalis/02-simu-cic/02-fichiers-cic/Sat/
```

For the selected station at index `<n>` in the executed definition, the required non-empty files are:

| Data | CIC file |
| --- | --- |
| range | `Sat_DISTANCE_GROUND_STATION_<n>.TXT` |
| visibility | `Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_<n>.TXT` |
| elevation / direction | `Sat_SATELLITE_DIRECTION-GROUND_STATION_<n>_FRAME.TXT` |

The executed attitude must be `ground_station_tracking` and contain the selected station. The visibility file must include a visible sample; otherwise preparation is blocked.

| Derived value | Method | Stored path |
| --- | --- | --- |
| mean range | arithmetic mean of distance samples during visible passes | `analysis_requests.rf_comlink.run_geometry.mean_range_km` |
| mean elevation | arithmetic mean of positive-elevation samples during visible passes | `analysis_requests.rf_comlink.run_geometry.mean_elevation_deg` |
| source files / count | exact CIC inputs and sample number | `analysis_requests.rf_comlink.run_geometry.source_files`, `sample_count` |

The builder embeds converted CIC copies in the `.rfcl` package. It converts Simu-CIC MJD dates to RF-COMLINK UTC dates and does not substitute another ephemeris or a template value.

## 2. Static source: run-local satellite.json

The only source of spacecraft radio inputs is `<run>/satellite.json`. The satellite library is not a direct input: values must already be copied into this run snapshot. Missing values remain missing and block preparation.

### Data handling

| Data | Path | Required rule |
| --- | --- | --- |
| initial memory | `satellite.bus.rf_comlink.data_handling.initial_memory_usage_bits` | >= 0 |
| capacity | `satellite.bus.rf_comlink.data_handling.memory_capacity_bits` | > 0 and >= initial memory |
| payload mode | `...data_handling.payload_binary_rate.mode` | `none` or `periodic` |
| rate, active duration, repeat period | `...payload_binary_rate.rate_bps`, `active_duration_s`, `repeat_period_s` | > 0 when periodic; duration <= period |

For a periodic payload, the backend creates a rate-profile CIC file on the selected distance CIC time grid. It is used only for the payload downlink.

### Radio links

Each `satellite.bus.rf_comlink.links[*]` entry defines one RF-COMLINK link. The generator creates only declared links and removes unused template links.

| Data | Path for link `<i>` | Rule |
| --- | --- | --- |
| identifier and name | `links[i].id`, `links[i].name` | non-empty |
| direction | `links[i].direction` | `EarthSpace` or `SpaceEarth` |
| station tracking | `links[i].requires_ground_station_tracking` | boolean |
| band, frequency, rate, BER, modulation | `links[i].system.*` | text values non-empty; numeric values > 0 |
| required Eb/N0 | `links[i].system.required_ebn0_db` | optional |
| antenna role | `links[i].spacecraft_antenna.role` | non-empty |
| transmitter EIRP | `links[i].spacecraft_antenna.eirp_dbw` or `system.transmit_power_dbm` | required for `SpaceEarth` |
| receiver G/T | `links[i].spacecraft_antenna.figure_of_merit_db_per_k` or `system.receiver_sensitivity_dbm` | required for `EarthSpace` |

When tracking is required, the station comes from `analysis_requests.simu_cic.ground_station_ids`. One configured station is selected automatically; with several stations, `analysis_requests.rf_comlink.selected_ground_station_id` is mandatory.

## 3. Template and station database

The configured installation provides `example/vide.rfcl`, or `example/example.rfcl` when the first template is unavailable. `RF_COMLINK_TEMPLATE` overrides this selection.

The template owns XML structure and station-database layout. For each link, the builder resolves the selected station at that frequency band and writes station hardware into the prepared scenario. It must not substitute another station or band. A missing matching database record must block preparation; explicit preflight enforcement remains required before a new station or band is trusted.

For `SpaceEarth`, ground receiving hardware comes from the station database; for `EarthSpace`, ground transmitting hardware comes from it. The backend records per-link system temperature in `analysis_requests.rf_comlink.run_geometry.system_temperature_k_by_link`: 300 K fallback for an uplink receiver, 250 K in X band and 150 K otherwise for a downlink receiver.

## 4. Resolved input manifest and scenario

Before generation, the backend writes `<run>/rf-comlink/01-input/rf-comlink-inputs.json`. This TypeScript-to-Python interface contains `source_satellite`, `source_simu_cic_definition`, selected station, `cic_inputs`, `data_handling`, `links`, `run_geometry`, and validation status. Scenario generation requires:

```json
"validation": { "status": "ready", "missing": [], "warnings": [] }
```

The generator writes `<run>/rf-comlink/02-scenario/prepared-rf-comlink.rfcl`. The frontend must not build RF-COMLINK XML or pass manual radio parameters to the Python generator.

## 5. Pre-launch validation rules

RF-COMLINK may be prepared only if:

1. Simu-CIC completed for the same run;
2. the executed definition uses tracking and contains the selected station;
3. all three CIC files exist, are non-empty, and include a visible sample;
4. `satellite.json` has valid data handling and at least one complete link;
5. required values are finite and satisfy this contract;
6. each station/band has a matching RF-COMLINK database record;
7. the manifest is saved with `validation.status = "ready"`.

Update the TypeScript adapter, preparation routes, Python generator, and focused tests together when this contract changes. Never infer inputs from a previous run, report, or example scenario.

## 6. Results boundary

Results are stored in `<run>/rf-comlink/03-results/rf-comlink-results.json`. They are never inputs to scenario preparation. The raw report and calculated `.rfcl` package remain the authoritative engineering evidence.
