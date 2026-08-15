import fs from "node:fs/promises"
import path from "node:path"

export type RFComlinkBatchCapability = {
  batchMode: "gui_only"
  documentationPath: string
  executableExists: boolean
  executablePath: string
  nextAction: string
}

/**
 * RF-COMLINK's installed documentation describes .rfcl and CIC inputs but
 * does not document a command-line runner. Conventional help arguments were
 * verified on this installation and interpreted as .rfcl file paths. The web
 * workflow must therefore prepare a scenario then open the GUI; it must not
 * claim that a native batch computation exists.
 */
export async function discoverRFComlinkBatchCapability(): Promise<RFComlinkBatchCapability> {
  const installationDir = process.env.RF_COMLINK_HOME?.trim() || "D:\\STAGE\\APP\\rf-comlink"
  const executablePath = path.join(installationDir, "rf-comlink.exe")
  const documentationPath = path.join(installationDir, "doc", "index.html")
  const executableExists = await fs.access(executablePath).then(() => true).catch(() => false)
  return {
    batchMode: "gui_only",
    documentationPath,
    executableExists,
    executablePath,
    nextAction: executableExists
      ? "Prepare the .rfcl scenario and open RF-COMLINK GUI. Native batch execution is unavailable on this installation."
      : "Set RF_COMLINK_HOME to the RF-COMLINK installation directory, then rerun the probe.",
  }
}
