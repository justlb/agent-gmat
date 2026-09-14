import fs from 'node:fs/promises'
import path from 'node:path'
import { PREDEFINED_GROUND_STATIONS } from '../opalis/groundStationCatalog.js'
import { loadConfig } from '../config.js'

/** Same site matching as the RF-COMLINK scenario builder; never substitute another site. */
export function rfGroundStationsFromDatabase(database: string) {
  const rows = database.split(/\r?\n/u).filter(line => line.startsWith('"')).map(line =>
    line.split('\t').map(cell => cell.replace(/^"|"$/gu, '').replace(/""/gu, '"')),
  ).filter(row => row.length >= 30)
  return PREDEFINED_GROUND_STATIONS.flatMap(station => {
    const normalized = station.id.replaceAll('-', '').replaceAll('_', ' ').toUpperCase()
    const bands = [...new Set(rows.filter(row => row[2].toUpperCase().includes(normalized)
      || row[0].replaceAll('_', ' ').toUpperCase().includes(normalized)).map(row => row[1].toUpperCase()))].sort()
    return bands.length ? [{ ...station, bands }] : []
  })
}

export async function listRFComlinkGroundStations() {
  const configured = process.env.RF_COMLINK_HOME?.trim() || loadConfig().tools.rfComlink.home
  if (!configured) throw new Error('RF-COMLINK is not configured. Set tools.rfComlink.home in config.json.')
  const normalized = configured.replaceAll('\\', '/')
  const windowsPath = /^([a-z]):\/(.*)$/iu.exec(normalized)
  const home = process.platform !== 'win32' && windowsPath ? `/mnt/${windowsPath[1].toLowerCase()}/${windowsPath[2]}` : configured
  // The preparation script resolves Resources relative to the selected scenario template.
  const template = process.env.RF_COMLINK_TEMPLATE?.trim()
  const root = template ? path.dirname(path.dirname(template)) : home
  return rfGroundStationsFromDatabase(await fs.readFile(path.join(root, 'Resources', 'GROUND_STATION_DATABASE.txt'), 'utf8'))
}
