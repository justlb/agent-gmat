import path from "node:path"

import { snapshotDigitalThreadForRun, type DigitalThreadSnapshot } from "../digitalThread/digitalThreadStore.js"
import { appendRunConversation, snapshotMissionConversationForRun } from "../digitalThread/missionConversationStore.js"
import { writeRunAnalysisContext } from "../analysis/runAnalysisContext.js"

type MissionRunResult = { error?: string; status: string; warnings?: string[] }
type DraftConversationTurn = { assistant: string; user: string }

/** Persists the run context every GMAT template must expose to downstream
 * Simu-CIC, OPALIS, RF-COMLINK and the mission discussion. */
export async function finalizeMissionRun({
  digitalThreadSnapshot,
  draftConversation,
  result,
  root,
  runDir,
  workspaceDir,
}: {
  digitalThreadSnapshot: DigitalThreadSnapshot
  draftConversation: DraftConversationTurn[]
  result: MissionRunResult
  root: string
  runDir: string
  workspaceDir: string
}) {
  await snapshotMissionConversationForRun(workspaceDir, runDir, draftConversation)
  const answer = result.status === "failed" || result.status === "timeout"
    ? `GMAT ${result.status}: ${result.error || "GMAT did not produce a usable result. Review the generated log file for details."}`
    : result.warnings?.length
      ? `GMAT completed with safety warnings: ${result.warnings.join(" ")}`
      : "GMAT completed successfully. You can now ask questions about the saved results or request a revised run."
  await appendRunConversation(runDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question: "GMAT execution" })
  await snapshotDigitalThreadForRun(workspaceDir, runDir, digitalThreadSnapshot)
  await writeRunAnalysisContext(runDir)
  return path.relative(path.resolve(root), runDir)
}
