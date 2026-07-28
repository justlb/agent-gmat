import type { ThreadEvent } from "../types"

export function getEventErrorMessage(event: ThreadEvent): string | null {
  if (event.type === "turn.failed" || event.type === "thread_error") {
    return event.error.message ?? null
  }

  if (event.type === "error") {
    return event.message ?? null
  }

  return null
}

export function shouldSuppressEvent(_event: ThreadEvent) {
  return false
}
