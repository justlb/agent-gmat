import fs from "node:fs/promises"
import path from "node:path"

/**
 * Complete satellite-owned source snapshot embedded in every GMAT values YAML.
 * The mission draft stays separate under `values`; this copy lets an engineer
 * inspect exactly which selected/overridden satellite configuration was
 * available when a script was rendered.
 */
export type SatelliteYamlSnapshot = {
  source: "satellite.json"
  satellite: Record<string, unknown>
}

export async function loadSatelliteYamlSnapshot(workspaceDir: string): Promise<SatelliteYamlSnapshot | null> {
  const source = await fs.readFile(path.join(path.resolve(workspaceDir), "satellite.json"), "utf8").catch(() => null)
  if (source === null) return null
  try {
    const document: unknown = JSON.parse(source)
    const satellite = document && typeof document === "object" && !Array.isArray(document)
      ? (document as { satellite?: unknown }).satellite
      : null
    if (!satellite || typeof satellite !== "object" || Array.isArray(satellite)) return null
    return { source: "satellite.json", satellite: JSON.parse(JSON.stringify(satellite)) as Record<string, unknown> }
  } catch {
    return null
  }
}
