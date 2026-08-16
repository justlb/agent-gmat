/**
 * Fixed Simu-CIC ground-station catalogue.
 *
 * The source values are the stations exported by Simu-CIC in groundstation.scd.
 * Mission definitions store only the stable `id`; the Scilab adapter will resolve
 * the engineering coordinates from this catalogue when it creates a scenario.
 */
export type PredefinedGroundStation = Readonly<{
  id: string
  name: string
  longitudeDeg: number
  latitudeDeg: number
  altitudeM: number
  minElevationDeg: number
}>

type SimuCicRequest = { [key: string]: unknown }

export const SIMU_CIC_ATTITUDE_MODES = ["nadir_pointing", "ground_station_tracking"] as const
export type SimuCicAttitudeMode = typeof SIMU_CIC_ATTITUDE_MODES[number]

export const SIMU_CIC_SIMULTANEOUS_VISIBILITY_POLICIES = ["first_visible_station_wins"] as const

const stationRows = `
aussaguel|Aussaguel|1.499|43.43|154|0
kourou|Kourou|-52.64|5.1|94|0
albuquerque|Albuquerque|-106.5|35.13334|3200|0
al-springs|Al_Springs|133.884|-23.7|600|0
arrival-heights|Arrival_Heights|166.663|-77.83|250|0
ascension-island|Ascension_Island|-14.3325|-7.9165|10|0
athenes|Athenes|23.716|37.966|0|0
awarua|Awarua|168.38|-46.53|0|0
berlin|Berlin|13.416|52.5|0|0
bialystok|Bialystok|23.025|53.23|180|0
boulder|Boulder|-105.292|40.019|1655|0
bremen|Bremen|8.85|53.1|40|0
cebreros|Cebreros|-4.36755|40.452689|794.1|0
creil|Creil|2.48|49.27|50|0
darwin|Darwin|130.892|-12.424|30|0
eureka|Eureka|-86.42|80.05|610|0
fairbanks|Fairbanks|-147.7|64.82|0|0
fucino|Fucino|13.63|41.95|0|0
garmisch|Garmisch|11.063|47.476|740|0
hbk|HBK|27.71|-25.886|1533|0
inuvik|Inuvik|-133|68.18|0|0
izana|Izana|-16.5|28.3|2370|0
jpl|JPL|-118.17|34.2|0|0
karlsruhe|Karlsruhe|8.438|49.1|110|0
kerguelen|Kerguelen|70.225|-49.35|70|0
kiruna|Kiruna|21.063|67.89|410.8|0
lamont|Lamont|-97.486|36.604|320|0
lauder|Lauder|169.684|-45.038|370|0
lecap|LeCap|18.27|-33.55|0|0
macmurdo|MacMurdo|166.4|-77.51|0|0
madrid|Madrid|-3.7|40.433|0|0
malargue|Malargue|-69.398197|-35.776008|1550|0
maspalomas|Maspalomas|-15.63|27.76|0|0
matera|Matera|16.6|40.66|0|0
maurice|Maurice|57|-20|10|0
natal|Natal|-35.16|-5.93|48|0
new-norcia|New_Norcia|116.1915|-31.048225|252.26|0
ny-alesund|Ny_Alesund|11.9|78.9|20|0
ohiggins|OHiggins|-57.9|-63.22|0|0
orleans|Orleans|2.113|47.97|130|0
papeete|Papeete|-149.61|-17.583|0|0
paris|Paris|2.351|48.856|30|0
park-falls|Park_Falls|-90.273|45.945|440|0
perth|Perth|115.88|-31.8|20|0
pr-albert|Pr_Albert|-105.68|53.22|0|0
punta-arenas|Punta_Arenas|-70.86|-52.94|20.45|5
rome|Rome|12.5|41.9|21|0
santiago|Santiago|-70.669|-33.15|723.5|0
sodankyla|Sodankyla|26.633|67.368|180|0
stanford|Stanford|-122.179|37.408|148|0
surinam|Surinam|-55.2|5.8|0|0
svalbard|Svalbard|15.38|78.21|200|0
syowa|Syowa|39.35|-69|0|0
tarot-calern|Tarot_Calern|6.92353|43.752|1320|0
tarot-chili|Tarot_Chili|-70.7326|-29.259917|2398|0
tarot-reunion|Tarot_Reunion|55.410172|-21.198844|991|0
tokyo|Tokyo|139.715|35.700556|0|0
toulouse|Toulouse|1.4875|43.554|150|0
troll|Troll|2.53|-72|0|0
tromsoe|Tromsoe|18.92|69.67|0|0
tsukuba|Tsukuba|140.1215|36.0513|30|0
wollongong|Wollongong|150.879|-34.406|30|0
yatharagga|Yatharagga|115.354298|-29.0451555|259|5
yekaterinburg|Yekaterinburg|59.545|57.038|300|0
zugspitze|Zugspitze|10.98|47.42|2960|0
`

function parseStation(row: string): PredefinedGroundStation {
  const [id, name, longitudeDeg, latitudeDeg, altitudeM, minElevationDeg] = row.split("|")
  const station = { id, name, longitudeDeg: Number(longitudeDeg), latitudeDeg: Number(latitudeDeg), altitudeM: Number(altitudeM), minElevationDeg: Number(minElevationDeg) }
  if (!station.id || !station.name || Object.values(station).some(value => typeof value === "number" && !Number.isFinite(value))) {
    throw new Error(`invalid predefined Simu-CIC ground station: ${row}`)
  }
  return Object.freeze(station)
}

export const PREDEFINED_GROUND_STATIONS: readonly PredefinedGroundStation[] = Object.freeze(
  stationRows.trim().split(/\r?\n/u).map(parseStation),
)

const STATIONS_BY_ID = new Map(PREDEFINED_GROUND_STATIONS.map(station => [station.id, station]))

export function getPredefinedGroundStation(id: string) {
  return STATIONS_BY_ID.get(id) ?? null
}

/** Rejects values which cannot be expressed by the first Simu-CIC configuration UI. */
export function assertValidSimuCicRequest(request: SimuCicRequest) {
  const attitudeMode = request.attitude_mode
  if (attitudeMode !== null && attitudeMode !== undefined && !SIMU_CIC_ATTITUDE_MODES.includes(attitudeMode as SimuCicAttitudeMode)) {
    throw new Error(`unsupported Simu-CIC attitude_mode: ${String(attitudeMode)}`)
  }

  const stationIds = request.ground_station_ids
  if (!Array.isArray(stationIds) || !stationIds.every(id => typeof id === "string")) {
    throw new Error("Simu-CIC ground_station_ids must be an array of predefined station identifiers")
  }
  const duplicate = stationIds.find((id, index) => stationIds.indexOf(id) !== index)
  if (duplicate) throw new Error(`Simu-CIC ground_station_ids contains the same station twice: ${duplicate}`)
  const unsupported = stationIds.find(id => !getPredefinedGroundStation(id))
  if (unsupported) throw new Error(`unknown predefined Simu-CIC ground station: ${unsupported}`)

  const policy = request.simultaneous_visibility_policy
  if (policy !== null && policy !== undefined && !SIMU_CIC_SIMULTANEOUS_VISIBILITY_POLICIES.includes(policy as "first_visible_station_wins")) {
    throw new Error(`unsupported Simu-CIC simultaneous_visibility_policy: ${String(policy)}`)
  }
}
