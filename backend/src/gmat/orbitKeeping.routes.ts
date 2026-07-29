import type { FastifyInstance } from "fastify"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { generateOrbitKeepingMission } from "./orbitKeeping.service.js"

type GenerateOrbitKeepingBody = { request?: unknown; workspaceDir?: unknown }
type OrbitKeepingFileKind = "script" | "values"

function getOrbitKeepingOutputDir(userWorkspaceRoot: string) {
  return path.join(path.resolve(userWorkspaceRoot), "gmat", "orbit-keeping")
}

function orbitKeepingFileKind(fileName: string): OrbitKeepingFileKind | null {
  if (fileName.endsWith(".script")) return "script"
  if (fileName.endsWith(".values.yaml")) return "values"
  return null
}

async function listOrbitKeepingFiles(userWorkspaceRoot: string) {
  const root = path.resolve(userWorkspaceRoot)
  const files: Array<{ artifactId: string; fileName: string; kind: OrbitKeepingFileKind; mtimeMs: number; relativePath: string; size: number }> = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name === "gmat") {
        const outputDir = path.join(child, "orbit-keeping")
        const outputEntries = await fs.readdir(outputDir, { withFileTypes: true }).catch(() => [])
        if (outputEntries.length === 0) {
          await visit(child, depth + 1)
          continue
        }
        for (const outputEntry of outputEntries) {
          if (!outputEntry.isFile()) continue
          const kind = orbitKeepingFileKind(outputEntry.name)
          if (!kind) continue
          const outputPath = path.join(outputDir, outputEntry.name)
          const stat = await fs.stat(outputPath)
          files.push({
            artifactId: outputEntry.name.replace(kind === "script" ? /\.script$/u : /\.values\.yaml$/u, ""),
            fileName: outputEntry.name,
            kind,
            mtimeMs: stat.mtimeMs,
            relativePath: path.relative(root, outputPath),
            size: stat.size,
          })
        }
        continue
      }
      await visit(child, depth + 1)
    }
  }
  await visit(root, 0)
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

function resolveListedOrbitKeepingFilePath(userWorkspaceRoot: string, relativePath: unknown) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null
  const root = path.resolve(userWorkspaceRoot)
  const filePath = path.resolve(root, relativePath)
  const normalized = filePath.split(path.sep).join("/")
  if (!isPathInside(root, filePath) || !/\/gmat\/orbit-keeping\/[^/]+\.(?:script|values\.yaml)$/u.test(normalized)) return null
  return filePath
}

function resolveOutputWorkspaceDir(userWorkspaceRoot: string, requestedWorkspaceDir: unknown) {
  if (typeof requestedWorkspaceDir !== "string" || !requestedWorkspaceDir.trim()) return userWorkspaceRoot
  const workspaceDir = path.resolve(requestedWorkspaceDir)
  if (!isPathInside(path.resolve(userWorkspaceRoot), workspaceDir)) {
    throw new Error("workspaceDir must be inside the current user workspace")
  }
  return workspaceDir
}

/** HTTP boundary for the one-call, deterministic orbit-keeping pipeline. */
export async function orbitKeepingRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get("/api/gmat/orbit-keeping/files", async (_req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    return reply.send({ files: await listOrbitKeepingFiles(userWorkspaceRoot) })
  })

  fastify.get<{ Querystring: { relativePath?: string } }>("/api/gmat/orbit-keeping/files/download", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    const filePath = resolveListedOrbitKeepingFilePath(userWorkspaceRoot, req.query.relativePath)
    if (!filePath) return reply.status(400).send({ error: "invalid GMAT artifact path" })
    const kind = orbitKeepingFileKind(filePath)
    if (!kind) return reply.status(400).send({ error: "invalid GMAT artifact path" })
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return reply.status(404).send({ error: "GMAT artifact not found" })
    return reply
      .header("Content-Type", kind === "script" ? "text/plain; charset=utf-8" : "application/x-yaml; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`)
      .header("Content-Length", String(stat.size))
      .send(createReadStream(filePath))
  })

  fastify.post<{ Body: GenerateOrbitKeepingBody }>("/api/gmat/orbit-keeping/generate", async (req, reply) => {
    const request = typeof req.body?.request === "string" ? req.body.request.trim() : ""
    if (!request) return reply.status(400).send({ error: "request must be a non-empty string" })

    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })

    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      return reply.send(await generateOrbitKeepingMission({
        connection: resolveModelBackend(config, "chatModel"),
        request,
        workspaceDir,
      }))
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to generate orbit-keeping mission") })
    }
  })
}
