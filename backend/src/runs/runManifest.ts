/**
 * Role: Owns the canonical, atomically persisted manifest of one mission run.
 * Exports: loadRunManifest and updateRunManifest.
 * Dependencies: atomic JSON persistence and the GMAT template registry.
 * Invariant: runId matches the directory and every manifest has one stable
 * schema, tool identity, status and creation timestamp.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { isGmatTemplateId, type GmatTemplateId } from "../gmat/templateRegistry.js"
import { updateJsonFile } from "../shared/atomicPersistence.js"

export type RunManifestStatus = "completed" | "drafting" | "failed" | "generated" | "running" | "timeout"
export type RunManifest = Record<string, unknown> & {
  createdAt: string
  runId: string
  schemaVersion: 1
  status: RunManifestStatus
  templateId: GmatTemplateId | null
  tool: "GMAT"
}

const statuses = new Set<RunManifestStatus>(["completed", "drafting", "failed", "generated", "running", "timeout"])

function initialManifest(runDir: string): RunManifest {
  return { createdAt: new Date().toISOString(), runId: path.basename(runDir), schemaVersion: 1, status: "drafting", templateId: null, tool: "GMAT" }
}

function normalize(runDir: string, value: Record<string, unknown>): RunManifest {
  const runId = path.basename(path.resolve(runDir))
  const status = statuses.has(value.status as RunManifestStatus) ? value.status as RunManifestStatus : "drafting"
  const templateId = value.templateId === null || (typeof value.templateId === "string" && isGmatTemplateId(value.templateId)) ? value.templateId : null
  return {
    ...value,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    runId,
    schemaVersion: 1,
    status,
    templateId,
    tool: "GMAT",
  }
}

export function updateRunManifest(runDir: string, patch: Record<string, unknown>) {
  const output = path.join(path.resolve(runDir), "run_manifest.json")
  return updateJsonFile<RunManifest>(output, initialManifest(runDir), current => normalize(runDir, { ...current, ...patch }))
}

export async function loadRunManifest(runDir: string) {
  const source = await fs.readFile(path.join(path.resolve(runDir), "run_manifest.json"), "utf8")
  const parsed: unknown = JSON.parse(source)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid run_manifest.json: expected an object")
  return normalize(runDir, parsed as Record<string, unknown>)
}
