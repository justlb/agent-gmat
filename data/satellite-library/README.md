# data/satellite-library

**Single source of truth** for physical satellite definitions. JSON files here are scanned at runtime and presented in the satellite selector.

Each JSON is a complete, versioned spacecraft definition. A mission run copies its selected satellite definition into a run-local `satellite.json` snapshot — the library itself is never modified.

## Format

Each file is a single satellite definition with at least:
- `satellite.identity.name` — display name
- `satellite.identity.id` — unique ID (e.g., `ref-leo-orbit-keeping`, `fudan-satellite`)
- `satellite.identity.version` — version string (e.g., `1.0.0`)
- `satellite.bus.physical.*` — dry mass, drag area, drag coefficient
- `satellite.bus.propulsion_subsystem.*` — propellant mass, Isp, thruster type
- `satellite.bus.opalis.*` — OPALIS-specific electrical parameters

## Related

- [Adding a satellite](../../docs/tutorials/ADD_A_SATELLITE.md)
- [Digital-thread store](../../backend/src/digitalThread/satelliteLibrary.ts)
