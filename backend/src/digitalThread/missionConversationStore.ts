import fs from "node:fs/promises"
import path from "node:path"

import { updateJsonFile } from "../shared/atomicPersistence.js"
import { isMissionRunWorkspacePath } from "../runs/runWorkspace.js"

export type MissionConversationTurn = {
  answer: string
  askedAt: string
  channel: "gmat-draft" | "simu-cic" | "opalis" | "rf-comlink"
  question: string
}

function conversationPath(workspaceDir: string) {
  return path.join(path.resolve(workspaceDir), "digital-thread", "mission-conversation.json")
}

function missionRunConversationPath(workspaceDir: string) {
  const resolved = path.resolve(workspaceDir)
  return isMissionRunWorkspacePath(resolved) ? path.join(resolved, "conversation.json") : null
}

function validTurn(value: unknown): value is MissionConversationTurn {
  return Boolean(value && typeof value === "object" && typeof (value as MissionConversationTurn).question === "string" && typeof (value as MissionConversationTurn).answer === "string" && typeof (value as MissionConversationTurn).askedAt === "string" && ((value as MissionConversationTurn).channel === "gmat-draft" || (value as MissionConversationTurn).channel === "simu-cic" || (value as MissionConversationTurn).channel === "opalis" || (value as MissionConversationTurn).channel === "rf-comlink"))
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
  const output = conversationPath(workspaceDir)
  const next = await updateJsonFile<MissionConversationTurn[]>(output, [], previous => [...previous.filter(validTurn), turn])
  const missionRunOutput = missionRunConversationPath(workspaceDir)
  if (missionRunOutput) await updateJsonFile(missionRunOutput, [], () => next)
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
  return updateJsonFile<MissionConversationTurn[]>(output, [], existing => {
    const merged = [...draftTurns, ...existing.filter(validRunTurn)].filter((turn, index, turns) =>
      turns.findIndex(candidate => candidate.question === turn.question && candidate.answer === turn.answer) === index,
    )
    return merged
  })
}

export async function appendRunConversation(runDir: string, turn: MissionConversationTurn) {
  const output = path.join(path.resolve(runDir), "conversation.json")
  await updateJsonFile<MissionConversationTurn[]>(output, [], parsed => [...parsed.filter(validRunTurn), turn])
}
