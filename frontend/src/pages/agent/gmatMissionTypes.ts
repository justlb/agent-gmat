export type GmatMissionValue = string | number | null

export type GmatMissionDraftBase<TStatus extends string> = {
  assistantMessage?: string
  confirmed: boolean
  conversation: Array<{ assistant: string; user: string }>
  createdAt?: string
  draftId: string
  missing: string[]
  status: TStatus
  updatedAt?: string
  values: Record<string, GmatMissionValue>
}
