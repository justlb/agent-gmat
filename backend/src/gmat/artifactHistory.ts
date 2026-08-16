import fs from "node:fs/promises"
import path from "node:path"

type ArtifactSnapshot = { bytes: number; source: string; stored_as: string }
export type HistoricalRunArtifact = { filePath: string; stage: string; version: string }

function snapshotId() {
  return new Date().toISOString().replace(/[:.]/gu, "-")
}

async function availableDirectory(parent: string) {
  await fs.mkdir(parent, { recursive: true })
  const base = snapshotId()
  for (let attempt = 0; ; attempt += 1) {
    const candidate = path.join(parent, attempt ? `${base}-${attempt + 1}` : base)
    try {
      await fs.mkdir(candidate, { recursive: false })
      return candidate
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
}

/**
 * Saves byte-for-byte copies of mutable tool outputs before a rerun replaces
 * them. GMAT output is already immutable per run; this covers sub-tools that
 * intentionally reuse a calculated filename inside that run.
 */
export async function snapshotRunArtifacts(runDir: string, stage: string, relativePaths: string[]) {
  const existing: Array<{ source: string; relative: string; size: number }> = []
  for (const relative of relativePaths) {
    const source = path.resolve(runDir, relative)
    if (!source.startsWith(`${path.resolve(runDir)}${path.sep}`)) throw new Error("artifact path must remain inside the run directory")
    const stat = await fs.stat(source).catch(() => null)
    if (stat?.isFile() && stat.size > 0) existing.push({ relative, size: stat.size, source })
  }
  if (!existing.length) return null

  const target = await availableDirectory(path.join(runDir, "artifact-history", stage))
  const artifacts: ArtifactSnapshot[] = []
  for (const artifact of existing) {
    const destination = path.join(target, artifact.relative)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.copyFile(artifact.source, destination)
    artifacts.push({ bytes: artifact.size, source: artifact.relative, stored_as: path.relative(target, destination).split(path.sep).join("/") })
  }
  await fs.writeFile(path.join(target, "manifest.json"), `${JSON.stringify({ artifacts, captured_at: new Date().toISOString(), schema_version: 1, stage }, null, 2)}\n`, "utf8")
  return target
}

/** Lists saved versions without treating them as executable mission runs. */
export async function listRunArtifactHistory(runDir: string): Promise<HistoricalRunArtifact[]> {
  const root = path.join(runDir, "artifact-history")
  const output: HistoricalRunArtifact[] = []
  const stages = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const stage of stages.filter(entry => entry.isDirectory() && /^[A-Za-z0-9_-]+$/u.test(entry.name))) {
    const stageDir = path.join(root, stage.name)
    const versions = await fs.readdir(stageDir, { withFileTypes: true }).catch(() => [])
    for (const version of versions.filter(entry => entry.isDirectory() && /^[A-Za-z0-9_-]+$/u.test(entry.name))) {
      const versionDir = path.join(stageDir, version.name)
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const entryPath = path.join(directory, entry.name)
          if (entry.isFile()) output.push({ filePath: entryPath, stage: stage.name, version: version.name })
          else if (entry.isDirectory()) await visit(entryPath)
        }
      }
      await visit(versionDir)
    }
  }
  return output
}
