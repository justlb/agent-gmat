import path from "node:path"

import { snapshotDigitalThreadForRun, type DigitalThreadSnapshot } from "../digitalThread/digitalThreadStore.js"
import { appendRunConversation, snapshotMissionConversationForRun } from "../digitalThread/missionConversationStore.js"
import { writeConsolidatedRunReport } from "../opalis/consolidatedRunReport.js"
import { completeRunStage, deferRunStage, failRunStage } from "../runs/runLifecycle.js"
import { getErrorMessage } from "../shared/index.js"
import { updateRunManifest } from "../runs/runManifest.js"

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
  const gmatCompleted = result.status === "completed"
  const gmatGenerated = result.status === "generated"
  const gmatMessage = result.error ?? (result.warnings?.join(" ") || null)
  const answer = gmatGenerated
    ? "GMAT script generated successfully, but the simulation has not been executed yet."
    : result.status === "failed" || result.status === "timeout"
    ? `GMAT ${result.status}: ${result.error || "GMAT did not produce a usable result. Review the generated log file for details."}`
    : result.warnings?.length
      ? `GMAT completed with safety warnings: ${result.warnings.join(" ")}`
      : "GMAT completed successfully. You can now ask questions about the saved results or request a revised run."
  try {
    await snapshotMissionConversationForRun(workspaceDir, runDir, draftConversation)
    await appendRunConversation(runDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question: "GMAT execution" })
    await snapshotDigitalThreadForRun(workspaceDir, runDir, digitalThreadSnapshot)
    await updateRunManifest(runDir, { status: result.status })
    if (gmatCompleted) await completeRunStage(runDir, "gmat", gmatMessage)
    else if (gmatGenerated) await deferRunStage(runDir, "gmat", "GMAT script generated; simulation not executed.")
    else await failRunStage(runDir, "gmat", gmatMessage ?? `GMAT ended with status ${result.status}.`)
    // Preserve a partial report as soon as GMAT reaches a terminal state.
    await writeConsolidatedRunReport(runDir)
  } catch (error) {
    await updateRunManifest(runDir, { status: "failed", finalizationError: getErrorMessage(error, "unknown persistence error") }).catch(() => undefined)
    await failRunStage(runDir, "gmat", `Run finalization failed: ${getErrorMessage(error, "unknown persistence error")}`).catch(() => undefined)
    throw error
  }
  return path.relative(path.resolve(root), runDir)
}
