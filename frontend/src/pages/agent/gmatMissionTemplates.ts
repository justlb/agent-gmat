export const GMAT_MISSION_TEMPLATES = {
  chemical3d: 'chemical-3d-transfer',
  chemicalHohmann: 'chemical-hohmann-transfer',
  electricPropulsion: 'electric-propulsion-transfer',
  orbitKeeping: 'orbit-keeping',
} as const

export type GmatMissionTemplateId = typeof GMAT_MISSION_TEMPLATES[keyof typeof GMAT_MISSION_TEMPLATES]
export type GmatChatMode = 'gmat-orbit-keeping' | 'gmat-electric-propulsion' | 'gmat-chemical-hohmann' | 'gmat-chemical-3d'

export type MissionInputField = {
  defaultValue?: number | string
  derived?: 'initialAltitude'
  label: string
  path: string
  /** The stored GMAT value is a radius/SMA, while engineers enter altitude. */
  valueTransform?: 'earth-radius'
  unit?: string
}

export type GmatMissionTemplateDefinition = {
  assumedFields?: MissionInputField[]
  chatMode: GmatChatMode
  downstream: string[]
  id: GmatMissionTemplateId
  inputFields: MissionInputField[]
  label: string
  objective: string
  outputs: string[]
  satelliteRequirements: string[]
  summary: string
}

export const GMAT_MISSION_TEMPLATE_DEFINITIONS: Record<GmatMissionTemplateId, GmatMissionTemplateDefinition> = {
  'chemical-3d-transfer': {
    chatMode: 'gmat-chemical-3d', downstream: ['Simu-CIC attitude and CIC files', 'OPALIS electrical model', 'RF-COMLINK link analysis'],
    id: 'chemical-3d-transfer', label: '3D Chemical Transfer',
    objective: 'Transfer an inclined Earth orbit to near GEO with apogee raising, plane change and circularisation burns.',
    outputs: ['GMAT script and values', 'GMAT execution log', 'Run-local satellite.json'],
    satelliteRequirements: ['Dry mass', 'Chemical propulsion and Isp', 'Drag area and coefficient'],
    summary: 'Three-burn chemical transfer to a near-geosynchronous orbit with a plane change.',
    inputFields: [
      { label: 'Epoch', path: 'initialOrbit.epoch' }, { label: 'Initial altitude', path: 'initialOrbit.altitudeKm', unit: 'km' },
      { label: 'Initial eccentricity', path: 'initialOrbit.eccentricity' }, { label: 'Initial inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
      { label: 'Final altitude', path: 'transfer.finalAltitudeKm', unit: 'km' }, { label: 'Final inclination', path: 'transfer.finalInclinationDeg', unit: 'deg' },
    ],
  },
  'orbit-keeping': {
    chatMode: 'gmat-orbit-keeping',
    downstream: ['Simu-CIC attitude and CIC files', 'OPALIS electrical model', 'RF-COMLINK link analysis'],
    id: 'orbit-keeping',
    label: 'LEO Orbit Maintenance (Chemical)',
    objective: 'Maintain a minimum orbital altitude while consuming the chemical propellant carried by the selected satellite.',
    outputs: ['GMAT script and values', 'Orbit and reboost reports', 'OEM ephemeris', 'Run-local satellite.json'],
    satelliteRequirements: ['Dry mass', 'Chemical propellant capacity', 'Specific impulse', 'Drag area and coefficient'],
    summary: 'Chemical-propulsion LEO station keeping with drag decay and reboost events.',
    inputFields: [
      { label: 'Epoch', path: 'initialOrbit.epoch' }, { label: 'Initial semi-major axis', path: 'initialOrbit.smaKm', unit: 'km' },
      { derived: 'initialAltitude', label: 'Initial altitude', path: 'initialOrbit.altitudeKm', unit: 'km' },
      { label: 'Eccentricity', path: 'initialOrbit.eccentricity' }, { label: 'Inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
      { label: 'Drag area', path: 'spacecraft.dragAreaM2', unit: 'm2' }, { label: 'Drag coefficient', path: 'spacecraft.dragCoefficient' },
      { label: 'Initial fuel mass', path: 'spacecraft.initialFuelMassKg', unit: 'kg' },
      { label: 'Minimum reboost altitude', path: 'stationKeeping.minimumAltitudeKm', unit: 'km' },
    ],
    assumedFields: [
      { defaultValue: 0, label: 'RAAN', path: 'initialOrbit.raanDeg', unit: 'deg' }, { defaultValue: 0, label: 'Argument of periapsis', path: 'initialOrbit.argPeriapsisDeg', unit: 'deg' }, { defaultValue: 0, label: 'True anomaly', path: 'initialOrbit.trueAnomalyDeg', unit: 'deg' },
      { label: 'Dry mass', path: 'spacecraft.dryMassKg', unit: 'kg' }, { label: 'Specific impulse', path: 'propulsion.ispSeconds', unit: 's' }, { label: 'Target semi-major axis', path: 'stationKeeping.targetSmaKm', unit: 'km' }, { label: 'Fuel reserve', path: 'stationKeeping.fuelReserveKg', unit: 'kg' }, { label: 'End-of-life altitude', path: 'endOfLife.finalAltitudeKm', unit: 'km' },
    ],
  },
  'electric-propulsion-transfer': {
    chatMode: 'gmat-electric-propulsion',
    downstream: ['Simu-CIC attitude and CIC files', 'OPALIS electrical model', 'RF-COMLINK link analysis'],
    id: 'electric-propulsion-transfer',
    label: '2D Electrical Transfer',
    objective: 'Propagate an electric-thrust transfer using the spacecraft mass, propellant, thruster and solar-power constraints.',
    outputs: ['GMAT script and values', 'Electric-transfer report', 'OEM ephemeris', 'Run-local satellite.json'],
    satelliteRequirements: ['Dry mass', 'Electric propellant capacity', 'Thruster power limits', 'Solar-array power, bus load and margin'],
    summary: 'Low-thrust electric orbit transfer driven by the selected satellite electrical system.',
    inputFields: [
      { label: 'Initial epoch', path: 'initialOrbit.epoch' }, { label: 'Initial semi-major axis', path: 'initialOrbit.smaKm', unit: 'km' },
      { derived: 'initialAltitude', label: 'Initial altitude', path: 'initialOrbit.altitudeKm', unit: 'km' },
      { label: 'Initial eccentricity', path: 'initialOrbit.eccentricity' }, { label: 'Initial inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
      { label: 'Target final altitude', path: 'transfer.finalAltitudeKm', unit: 'km' },
    ],
    assumedFields: [
      { defaultValue: 0, label: 'RAAN', path: 'initialOrbit.raanDeg', unit: 'deg' }, { defaultValue: 0, label: 'Argument of periapsis', path: 'initialOrbit.argPeriapsisDeg', unit: 'deg' }, { defaultValue: 0, label: 'True anomaly', path: 'initialOrbit.trueAnomalyDeg', unit: 'deg' },
      { label: 'Dry mass', path: 'spacecraft.dryMassKg', unit: 'kg' }, { label: 'Drag coefficient', path: 'spacecraft.dragCoefficient' }, { label: 'Drag area', path: 'spacecraft.dragAreaM2', unit: 'm2' }, { label: 'Electric propellant', path: 'spacecraft.initialFuelMassKg', unit: 'kg' },
      { label: 'Maximum usable thruster power', path: 'propulsion.maximumUsablePowerKw', unit: 'kW' }, { label: 'Minimum usable thruster power', path: 'propulsion.minimumUsablePowerKw', unit: 'kW' }, { label: 'Initial solar-array maximum power', path: 'power.initialMaxPowerKw', unit: 'kW' }, { label: 'Spacecraft bus load', path: 'power.busLoadKw', unit: 'kW' }, { label: 'Power-system margin', path: 'power.systemMarginPercent', unit: '%' },
    ],
  },
  'chemical-hohmann-transfer': {
    chatMode: 'gmat-chemical-hohmann',
    downstream: ['Simu-CIC attitude and CIC files', 'OPALIS electrical model', 'RF-COMLINK link analysis'],
    id: 'chemical-hohmann-transfer',
    label: '2D Chemical Transfer',
    objective: 'Raise or lower an Earth orbit using a transfer-orbit burn followed by a circularisation burn at apoapsis.',
    outputs: ['GMAT script and values', 'GMAT execution log', 'OEM ephemeris', 'Run-local satellite.json'],
    satelliteRequirements: ['Dry mass', 'Chemical propulsion and Isp', 'Drag area and coefficient'],
    summary: 'Two-impulse chemical transfer solved by GMAT’s differential corrector.',
    inputFields: [
      { label: 'Initial epoch', path: 'initialOrbit.epoch' },
      { label: 'Initial altitude', path: 'initialOrbit.smaKm', unit: 'km', valueTransform: 'earth-radius' },
      { label: 'Initial eccentricity', path: 'initialOrbit.eccentricity' },
      { label: 'Initial inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
      { label: 'Target altitude', path: 'transfer.targetRadiusKm', unit: 'km', valueTransform: 'earth-radius' },
      { label: 'Target eccentricity', path: 'transfer.targetEccentricity' },
      { label: 'Final propagation duration', path: 'transfer.finalPropagationSeconds', unit: 's' },
    ],
  },
}

export function missionTemplateDefinition(template: GmatMissionTemplateId) {
  return GMAT_MISSION_TEMPLATE_DEFINITIONS[template]
}

export function isGmatMissionTemplateId(value: string): value is GmatMissionTemplateId {
  return Object.prototype.hasOwnProperty.call(GMAT_MISSION_TEMPLATE_DEFINITIONS, value)
}

export function chatModeForMissionTemplate(template: GmatMissionTemplateId): GmatChatMode {
  return missionTemplateDefinition(template).chatMode
}

export function missionTemplateForChatMode(chatMode: GmatChatMode): GmatMissionTemplateId {
  return Object.values(GMAT_MISSION_TEMPLATE_DEFINITIONS).find(template => template.chatMode === chatMode)?.id
    ?? GMAT_MISSION_TEMPLATES.orbitKeeping
}
