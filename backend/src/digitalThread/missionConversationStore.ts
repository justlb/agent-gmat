import fs from "node:fs/promises"
import path from "node:path"

export type MissionConversationTurn = {
  answer: string
  askedAt: string
  channel: "gmat-draft" | "simu-cic"
  question: string
}

function conversationPath(workspaceDir: string) {
  return path.join(path.resolve(workspaceDir), "digital-thread", "mission-conversation.json")
}

function missionRunConversationPath(workspaceDir: string) {
  const resolved = path.resolve(workspaceDir)
  return resolved.split(path.sep).includes("mission-runs") ? path.join(resolved, "conversation.json") : null
}

function validTurn(value: unknown): value is MissionConversationTurn {
  return Boolean(value && typeof value === "object" && typeof (value as MissionConversationTurn).question === "string" && typeof (value as MissionConversationTurn).answer === "string" && typeof (value as MissionConversationTurn).askedAt === "string" && ((value as MissionConversationTurn).channel === "gmat-draft" || (value as MissionConversationTurn).channel === "simu-cic"))
}

function validRunTurn(value: unknown): value is { answer: string; askedAt?: string; question: string } {
  return Boolean(value && typeof value === "object" && typeof (value as { question?: unknown }).question === "string" && typeof (value as { answer?: unknown }).answer === "string")
}

export async function loadMissionConversation(workspaceDir: string): Promise<MissionConversationTurn[]> {
  const source = await fs.readFile(conversationPath(workspaceDir), "utf8").catch(() => "[]")
  const parsed: unknown = JSON.parse(source)
  if (!Array.isArray(parsed)) throw new Error("mission conversation is invalid")
  return parsed.filter(validTurn)
}

export async function appendMissionConversation(workspaceDir: string, turn: MissionConversationTurn) {
  const previous = await loadMissionConversation(workspaceDir)
  const output = conversationPath(workspaceDir)
  await fs.mkdir(path.dirname(output), { recursive: true })
  const source = `${JSON.stringify([...previous, turn], null, 2)}\n`
  await fs.writeFile(output, source, "utf8")
  const missionRunOutput = missionRunConversationPath(workspaceDir)
  if (missionRunOutput) await fs.writeFile(missionRunOutput, source, "utf8")
}

/** Stores the immutable conversation context that led to one GMAT run. */
export async function snapshotMissionConversationForRun(workspaceDir: string, runDir: string, draftConversation: DraftTurn[] = []) {
  return mergeMissionConversationIntoRun(workspaceDir, runDir, draftConversation)
}

type DraftTurn = { assistant: string; user: string }

/**
 * Adds only this draft's conversation to its run without deleting later
 * result-analysis questions. The workspace-level mission archive deliberately
 * is not included: it spans separate GMAT conversations and must never make a
 * new mission appear to inherit another mission's discussion.
 */
export async function mergeMissionConversationIntoRun(workspaceDir: string, runDir: string, draftConversation: DraftTurn[] = []) {
  void workspaceDir
  const draftTurns: MissionConversationTurn[] = draftConversation.map((turn, index) => ({
    answer: turn.assistant,
    askedAt: new Date(0 + index).toISOString(),
    channel: "gmat-draft",
    question: turn.user,
  }))
  const output = path.join(path.resolve(runDir), "conversation.json")
  const source = await fs.readFile(output, "utf8").catch(() => "[]")
  const existing: unknown = JSON.parse(source)
  if (!Array.isArray(existing)) throw new Error("GMAT run conversation is invalid")
  const merged = [...draftTurns, ...existing.filter(validRunTurn)].filter((turn, index, turns) =>
    turns.findIndex(candidate => candidate.question === turn.question && candidate.answer === turn.answer) === index,
  )
  await fs.writeFile(output, `${JSON.stringify(merged, null, 2)}\n`, "utf8")
  return merged
}

export async function appendRunConversation(runDir: string, turn: MissionConversationTurn) {
  const output = path.join(path.resolve(runDir), "conversation.json")
  const source = await fs.readFile(output, "utf8").catch(() => "[]")
  const parsed: unknown = JSON.parse(source)
  if (!Array.isArray(parsed)) throw new Error("GMAT run conversation is invalid")
  const previous = parsed.filter(validRunTurn)
  await fs.writeFile(output, `${JSON.stringify([...previous, turn], null, 2)}\n`, "utf8")
}
