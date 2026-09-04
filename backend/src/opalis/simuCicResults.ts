import fs from 'node:fs/promises'
import path from 'node:path'

type Sample = { time: number; value: number }
type Metric = { value: string; source: string }
const CIC_DIR = 'opalis/02-simu-cic/02-fichiers-cic/Sat'

/** Scalar CIC MEM: MJD + UTC seconds, or ISO UTC timestamps. Reject corrupt series. */
export function parseCicScalar(text: string): Sample[] {
  const samples: Sample[] = []
  let data = false
  for (const raw of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === 'META_STOP') { data = true; continue }
    if (!data || !line || line.startsWith('COMMENT')) continue
    const fields = line.split(/\s+/u)
    let time: number
    let value: number
    if (fields.length === 3 && /^\d+$/u.test(fields[0])) {
      const seconds = Number(fields[1])
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new Error('Invalid CIC seconds')
      time = Number(fields[0]) * 86400 + seconds
      value = Number(fields[2])
    } else if (fields.length === 2 && /^\d{4}-\d{2}-\d{2}T/u.test(fields[0])) {
      time = Date.parse(fields[0].endsWith('Z') ? fields[0] : `${fields[0]}Z`) / 1000 + 40587 * 86400
      value = Number(fields[1])
    } else throw new Error('Unsupported CIC sample')
    if (!Number.isFinite(time) || !Number.isFinite(value) || (samples.length && time <= samples[samples.length - 1].time)) throw new Error('Invalid CIC series')
    samples.push({ time, value })
  }
  if (samples.length < 2) throw new Error('Insufficient CIC samples')
  return samples
}

/** Samples apply until the next timestamp; no extrapolation beyond the last sample. */
export function activeDuration(samples: Sample[], active: (value: number) => boolean) {
  return samples.slice(0, -1).reduce((total, sample, index) => total + (active(sample.value) ? samples[index + 1].time - sample.time : 0), 0)
}

export function contactLatencyMs(visibility: Sample[], distances: Sample[]): number | null {
  let weightedDistance = 0
  let duration = 0
  let j = 0
  for (let i = 0; i < visibility.length - 1; i++) {
    if (visibility[i].value !== 1) continue
    const start = visibility[i].time, end = visibility[i + 1].time
    if (start < distances[0].time || end > distances[distances.length - 1].time) throw new Error('Distance coverage incomplete')
    while (j < distances.length - 2 && distances[j + 1].time <= start) j++
    let cursor = start
    while (cursor < end && j < distances.length - 1) {
      const a = distances[j], b = distances[j + 1]
      const stop = Math.min(end, b.time)
      const at = (t: number) => a.value + (b.value - a.value) * (t - a.time) / (b.time - a.time)
      weightedDistance += (at(cursor) + at(stop)) / 2 * (stop - cursor)
      duration += stop - cursor
      cursor = stop
      if (cursor === b.time) j++
    }
  }
  return duration ? weightedDistance / duration / 299792.458 * 1000 : null
}

export async function loadSimuCicResultMetrics(runDir: string, status: string) {
  const unavailable = (source: string): Metric => ({ value: status === 'completed' || status === 'failed' ? 'Unavailable' : 'Waiting for Simu-CIC', source })
  const result = { contactTime: unavailable('CIC visibility'), latency: unavailable('CIC station distance'), eclipseTime: unavailable('CIC Earth eclipse') }
  // Do not expose partially written output as a completed engineering result.
  if (status !== 'completed') return result
  const read = async (file: string) => parseCicScalar(await fs.readFile(path.join(runDir, CIC_DIR, file), 'utf8'))
  try {
    const file = 'Sat_SATELLITE_ECLIPSE.TXT'
    const samples = await read(file)
    if (samples.some(s => s.value < 0 || s.value > 100)) throw new Error('Invalid eclipse percentage')
    result.eclipseTime = { value: `${(activeDuration(samples, v => v > 0) / 60).toFixed(2)} min`, source: `${CIC_DIR}/${file}; cumulative Earth eclipse including penumbra (>0%); sampled left-step integration, approximate` }
  } catch { result.eclipseTime.source += ': missing or invalid file' }
  try {
    // The executed definition fixes station order, unlike mutable draft settings.
    const definition = JSON.parse(await fs.readFile(path.join(runDir, 'opalis/02-simu-cic/simucic.definition.json'), 'utf8'))
    const stations: Array<{ id: string; name?: string }> = definition.attitude?.ground_stations ?? []
    if (!stations.length) {
      result.contactTime = { value: 'Not applicable', source: 'No ground station in executed Simu-CIC definition' }
      result.latency = { ...result.contactTime }
      return result
    }
    const contacts: string[] = [], latencies: string[] = [], sources: string[] = []
    for (const [index, station] of stations.entries()) {
      const label = station.name ?? station.id
      const visibilityFile = `Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_${index + 1}.TXT`
      const distanceFile = `Sat_DISTANCE_GROUND_STATION_${index + 1}.TXT`
      sources.push(`${label}: ${CIC_DIR}/${visibilityFile}, ${distanceFile}`)
      let visibility: Sample[]
      try {
        visibility = await read(visibilityFile)
        if (visibility.some(s => s.value !== 0 && s.value !== 1)) throw new Error('Invalid visibility')
        contacts.push(`${label}: ${(activeDuration(visibility, v => v === 1) / 60).toFixed(2)} min`)
      } catch { contacts.push(`${label}: Unavailable`); latencies.push(`${label}: Unavailable`); continue }
      if (activeDuration(visibility, v => v === 1) === 0) { latencies.push(`${label}: No contact`); continue }
      try {
        const distances = await read(distanceFile)
        if (distances.some(s => s.value < 0)) throw new Error('Invalid distance')
        const latency = contactLatencyMs(visibility, distances)
        latencies.push(latency === null ? `${label}: No contact` : `${label}: ${latency.toFixed(2)} / ${(2 * latency).toFixed(2)} ms`)
      } catch { latencies.push(`${label}: Unavailable`) }
    }
    result.contactTime = { value: contacts.join('; '), source: `${sources.join('; ')}; cumulative per station, sampled left-step integration, approximate` }
    result.latency = { value: latencies.join('; '), source: `${sources.join('; ')}; time-weighted mean during visibility; distance in km, linearly interpolated; one-way / round-trip propagation only, excludes processing and network delays` }
  } catch {
    result.contactTime.source += ': executed station definition missing or invalid'
    result.latency.source += ': executed station definition missing or invalid'
  }
  return result
}
