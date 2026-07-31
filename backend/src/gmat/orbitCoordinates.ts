export type CartesianState = {
  vxKmPerSec: number
  vyKmPerSec: number
  vzKmPerSec: number
  xKm: number
  yKm: number
  zKm: number
}

export type KeplerianElements = {
  argPeriapsisDeg: number
  eccentricity: number
  inclinationDeg: number
  raanDeg: number
  semiMajorAxisKm: number
  trueAnomalyDeg: number
}

export const EARTH_EQUATORIAL_RADIUS_KM = 6378.1363
export const EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2 = 398600.4418

const EPSILON = 1e-10
const RAD_PER_DEG = Math.PI / 180
const DEG_PER_RAD = 180 / Math.PI

function clampUnit(value: number) { return Math.max(-1, Math.min(1, value)) }
function magnitude([x, y, z]: readonly number[]) { return Math.hypot(x, y, z) }
function dot([ax, ay, az]: readonly number[], [bx, by, bz]: readonly number[]) { return ax * bx + ay * by + az * bz }
function cross([ax, ay, az]: readonly number[], [bx, by, bz]: readonly number[]) { return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx] as const }
function normalizeDegrees(value: number) { return ((value % 360) + 360) % 360 }
function degrees(value: number) { return normalizeDegrees(value * DEG_PER_RAD) }
function radians(value: number) { return value * RAD_PER_DEG }

function assertFiniteVector(state: CartesianState) {
  if (Object.values(state).some(value => !Number.isFinite(value))) throw new Error("Cartesian state must contain finite position and velocity components")
}

/** Converts a perigee altitude and eccentricity to semi-major axis: a = (R_E + h_p) / (1 - e). */
export function semiMajorAxisFromPeriapsisAltitude(periapsisAltitudeKm: number, eccentricity: number) {
  if (!Number.isFinite(periapsisAltitudeKm) || periapsisAltitudeKm < 0) throw new Error("periapsis altitude must be a non-negative finite number")
  if (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) throw new Error("eccentricity must be finite and in the range [0, 1)")
  return (EARTH_EQUATORIAL_RADIUS_KM + periapsisAltitudeKm) / (1 - eccentricity)
}

/** Converts classical Earth-centred Keplerian elements to an EarthMJ2000Eq Cartesian state. */
export function keplerianToCartesian(elements: KeplerianElements): CartesianState {
  const { semiMajorAxisKm: semiMajorAxis, eccentricity, inclinationDeg, raanDeg, argPeriapsisDeg, trueAnomalyDeg } = elements
  if (!Number.isFinite(semiMajorAxis) || semiMajorAxis <= 0) throw new Error("semi-major axis must be a positive finite number")
  if (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) throw new Error("eccentricity must be finite and in the range [0, 1)")
  if ([inclinationDeg, raanDeg, argPeriapsisDeg, trueAnomalyDeg].some(value => !Number.isFinite(value))) throw new Error("Keplerian angular elements must be finite")

  const inclination = radians(inclinationDeg)
  const raan = radians(raanDeg)
  const argumentOfPeriapsis = radians(argPeriapsisDeg)
  const trueAnomaly = radians(trueAnomalyDeg)
  const semiLatusRectum = semiMajorAxis * (1 - eccentricity ** 2)
  const denominator = 1 + eccentricity * Math.cos(trueAnomaly)
  if (denominator <= EPSILON) throw new Error("Keplerian elements do not define a valid elliptic position")
  const radius = semiLatusRectum / denominator
  const positionPerifocal = [radius * Math.cos(trueAnomaly), radius * Math.sin(trueAnomaly), 0] as const
  const speedFactor = Math.sqrt(EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2 / semiLatusRectum)
  const velocityPerifocal = [-speedFactor * Math.sin(trueAnomaly), speedFactor * (eccentricity + Math.cos(trueAnomaly)), 0] as const

  const cosRaan = Math.cos(raan); const sinRaan = Math.sin(raan)
  const cosInclination = Math.cos(inclination); const sinInclination = Math.sin(inclination)
  const cosArgument = Math.cos(argumentOfPeriapsis); const sinArgument = Math.sin(argumentOfPeriapsis)
  const rotate = ([x, y, z]: readonly number[]) => [
    (cosRaan * cosArgument - sinRaan * sinArgument * cosInclination) * x + (-cosRaan * sinArgument - sinRaan * cosArgument * cosInclination) * y + sinRaan * sinInclination * z,
    (sinRaan * cosArgument + cosRaan * sinArgument * cosInclination) * x + (-sinRaan * sinArgument + cosRaan * cosArgument * cosInclination) * y - cosRaan * sinInclination * z,
    sinArgument * sinInclination * x + cosArgument * sinInclination * y + cosInclination * z,
  ] as const
  const [xKm, yKm, zKm] = rotate(positionPerifocal)
  const [vxKmPerSec, vyKmPerSec, vzKmPerSec] = rotate(velocityPerifocal)
  return { xKm, yKm, zKm, vxKmPerSec, vyKmPerSec, vzKmPerSec }
}

/** Converts an EarthMJ2000Eq Cartesian state to classical Keplerian elements. */
export function cartesianToKeplerian(state: CartesianState): KeplerianElements {
  assertFiniteVector(state)
  const position = [state.xKm, state.yKm, state.zKm] as const
  const velocity = [state.vxKmPerSec, state.vyKmPerSec, state.vzKmPerSec] as const
  const radius = magnitude(position)
  const speed = magnitude(velocity)
  if (radius <= EPSILON || speed <= EPSILON) throw new Error("Cartesian state must have non-zero position and velocity magnitudes")
  const angularMomentum = cross(position, velocity)
  const angularMomentumMagnitude = magnitude(angularMomentum)
  if (angularMomentumMagnitude <= EPSILON) throw new Error("Cartesian state has zero specific angular momentum")
  const node = [-angularMomentum[1], angularMomentum[0], 0] as const
  const nodeMagnitude = magnitude(node)
  const radialVelocity = dot(position, velocity)
  const eccentricityVector = [
    ((speed ** 2 - EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2 / radius) * position[0] - radialVelocity * velocity[0]) / EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2,
    ((speed ** 2 - EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2 / radius) * position[1] - radialVelocity * velocity[1]) / EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2,
    ((speed ** 2 - EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2 / radius) * position[2] - radialVelocity * velocity[2]) / EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2,
  ] as const
  const eccentricity = magnitude(eccentricityVector)
  const specificEnergy = speed ** 2 / 2 - EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2 / radius
  if (Math.abs(specificEnergy) <= EPSILON) throw new Error("parabolic Cartesian states cannot be represented by this Keplerian GMAT template")
  const semiMajorAxisKm = -EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_SEC2 / (2 * specificEnergy)
  if (semiMajorAxisKm <= 0 || eccentricity >= 1) throw new Error("only bound elliptic Cartesian states can be represented by this Keplerian GMAT template")
  const inclinationDeg = Math.acos(clampUnit(angularMomentum[2] / angularMomentumMagnitude)) * DEG_PER_RAD
  const raanDeg = nodeMagnitude > EPSILON ? degrees(Math.atan2(node[1], node[0])) : 0

  let argPeriapsisDeg = 0
  let trueAnomalyDeg = 0
  if (eccentricity > EPSILON) {
    if (nodeMagnitude > EPSILON) {
      argPeriapsisDeg = Math.acos(clampUnit(dot(node, eccentricityVector) / (nodeMagnitude * eccentricity))) * DEG_PER_RAD
      if (eccentricityVector[2] < 0) argPeriapsisDeg = 360 - argPeriapsisDeg
    } else {
      argPeriapsisDeg = degrees(Math.atan2(eccentricityVector[1], eccentricityVector[0]))
    }
    trueAnomalyDeg = Math.acos(clampUnit(dot(eccentricityVector, position) / (eccentricity * radius))) * DEG_PER_RAD
    if (radialVelocity < 0) trueAnomalyDeg = 360 - trueAnomalyDeg
  } else if (nodeMagnitude > EPSILON) {
    trueAnomalyDeg = Math.acos(clampUnit(dot(node, position) / (nodeMagnitude * radius))) * DEG_PER_RAD
    if (position[2] < 0) trueAnomalyDeg = 360 - trueAnomalyDeg
  } else {
    trueAnomalyDeg = degrees(Math.atan2(position[1], position[0]))
  }
  return { semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg, argPeriapsisDeg: normalizeDegrees(argPeriapsisDeg), trueAnomalyDeg: normalizeDegrees(trueAnomalyDeg) }
}
