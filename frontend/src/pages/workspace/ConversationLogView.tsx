import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { MarkdownText } from "../../components/outputMarkdown"

const MAX_RENDERED_SESSIONS = 4
const MAX_RENDERED_TURNS = 40
const MAX_RENDERED_EVENTS = 120
const INITIAL_VISIBLE_TURNS = 3
const LOAD_MORE_TURN_COUNT = 3

type AgentMessage = {
  id: string
  text: string
}

type ConversationTurnView = {
  completed: boolean
  id: string
  messages: AgentMessage[]
  prompt: string
  sessionLabel?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function getEventItem(event: unknown) {
  return isRecord(event) && isRecord(event.item) ? event.item : null
}

function getItemText(item: Record<string, unknown>) {
  return typeof item.text === "string" ? item.text.trim() : ""
}

function getItemId(item: Record<string, unknown>, fallback: string) {
  return typeof item.id === "string" && item.id ? item.id : fallback
}

function getAgentMessages(events: unknown[]) {
  const messagesById = new Map<string, AgentMessage>()
  events.forEach((event, index) => {
    const item = getEventItem(event)
    if (!item || item.type !== "agent_message") return
    const text = getItemText(item)
    if (!text) return
    const id = getItemId(item, `agent-message-${index}`)
    if (messagesById.has(id)) messagesById.delete(id)
    messagesById.set(id, { id, text })
  })
  return [...messagesById.values()]
}

function hasTurnCompleted(events: unknown[]) {
  return events.some(event => isRecord(event) && event.type === "turn.completed")
}

function getTurnViews(session: Record<string, unknown>, sessionIndex: number, includeSessionLabel: boolean) {
  const sessionLabel = includeSessionLabel
    ? typeof session.title === "string" ? session.title : `Session ${sessionIndex + 1}`
    : undefined
  const turns = Array.isArray(session.turns) ? session.turns.filter(isRecord).slice(-MAX_RENDERED_TURNS) : []
  return turns.map((turn, turnIndex): ConversationTurnView => {
    const events = Array.isArray(turn.events) ? turn.events.slice(-MAX_RENDERED_EVENTS) : []
    return {
      completed: hasTurnCompleted(events),
      id: typeof turn.id === "string" && turn.id ? turn.id : `session-${sessionIndex}-turn-${turnIndex}`,
      messages: getAgentMessages(events),
      prompt: typeof turn.userPrompt === "string" ? turn.userPrompt : "",
      sessionLabel,
    }
  }).filter(turn => turn.prompt || turn.messages.length > 0)
}

function getSessionTimestamp(session: Record<string, unknown>) {
  const direct = [session.updatedAt, session.updated_at, session.completedAt, session.createdAt, session.created_at]
    .find(value => typeof value === "string") as string | undefined
  const latestTurn = Array.isArray(session.turns) ? session.turns.filter(isRecord).at(-1) : null
  const fromTurn = latestTurn && [latestTurn.updatedAt, latestTurn.completedAt, latestTurn.createdAt]
    .find(value => typeof value === "string") as string | undefined
  const value = fromTurn ?? direct
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : 0
}

function getSessionTitle(session: Record<string, unknown>, index: number) {
  if (typeof session.title === "string" && session.title.trim()) return session.title.trim()
  const firstTurn = Array.isArray(session.turns) ? session.turns.find(isRecord) : null
  if (firstTurn && typeof firstTurn.userPrompt === "string" && firstTurn.userPrompt.trim()) return firstTurn.userPrompt.trim().slice(0, 48)
  return `Conversation ${index + 1}`
}

function ConversationAgentMessage({ message }: { message: AgentMessage }) {
  return (
    <div className="wa-conversation-agent">
      <div className="wa-conversation-agent-head">
        <span className="wa-conversation-agent-icon">AI</span>
        <strong>AI Agent</strong>
      </div>
      <MarkdownText text={message.text} />
    </div>
  )
}

function ConversationTurn({ turn }: { turn: ConversationTurnView }) {
  const [expanded, setExpanded] = useState(false)
  const latestMessage = turn.messages[turn.messages.length - 1] ?? null
  const hiddenMessages = turn.completed && latestMessage
    ? turn.messages.slice(0, -1)
    : []
  const visibleMessages = turn.completed && latestMessage
    ? expanded ? turn.messages : [latestMessage]
    : turn.messages

  return (
    <div className="wa-conversation-turn">
      {turn.sessionLabel ? <div className="wa-conversation-session-inline">{turn.sessionLabel}</div> : null}
      {turn.prompt && <div className="wa-conversation-user">{turn.prompt}</div>}
      {hiddenMessages.length > 0 ? (
        <button
          className="wa-conversation-expand"
          type="button"
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? "收起中间回复" : `展开 ${hiddenMessages.length} 条中间回复`}
        </button>
      ) : null}
      {visibleMessages.map(message => (
        <ConversationAgentMessage key={message.id} message={message} />
      ))}
    </div>
  )
}

function ConversationTimeline({ turns }: { turns: ConversationTurnView[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRestoreRef = useRef<number | null>(null)
  const [visibleTurnCount, setVisibleTurnCount] = useState(() => Math.min(INITIAL_VISIBLE_TURNS, turns.length))
  const visibleTurns = turns.slice(Math.max(0, turns.length - visibleTurnCount))
  const latestContentKey = useMemo(() => (
    visibleTurns.map(turn => {
      const latestMessage = turn.messages[turn.messages.length - 1]
      return [
        turn.id,
        turn.prompt.length,
        turn.completed ? "completed" : "running",
        latestMessage?.id ?? "",
        latestMessage?.text.length ?? 0,
      ].join(":")
    }).join("|")
  ), [visibleTurns])

  useEffect(() => {
    setVisibleTurnCount(count => {
      if (turns.length === 0) return 0
      if (count === 0) return Math.min(INITIAL_VISIBLE_TURNS, turns.length)
      return Math.min(Math.max(count, INITIAL_VISIBLE_TURNS), turns.length)
    })
  }, [turns.length])

  useLayoutEffect(() => {
    const previousHeight = pendingScrollRestoreRef.current
    const el = scrollRef.current
    if (!el) return
    if (previousHeight !== null) {
      pendingScrollRestoreRef.current = null
      el.scrollTop = Math.max(0, el.scrollHeight - previousHeight)
      return
    }
    el.scrollTop = el.scrollHeight
  }, [turns.length, visibleTurnCount, latestContentKey])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el || el.scrollTop > 24 || visibleTurnCount >= turns.length) return

    pendingScrollRestoreRef.current = el.scrollHeight
    setVisibleTurnCount(count => Math.min(turns.length, count + LOAD_MORE_TURN_COUNT))
  }

  return (
    <div className="wa-conversation-scroll" ref={scrollRef} onScroll={handleScroll}>
      {visibleTurnCount < turns.length ? (
        <div className="wa-conversation-load-hint">向上滚动加载更早对话</div>
      ) : null}
      {visibleTurns.map(turn => (
        <ConversationTurn key={turn.id} turn={turn} />
      ))}
    </div>
  )
}

export function ConversationLogView({ session }: { session: Record<string, unknown> }) {
  const sessions = useMemo(() => (Array.isArray(session.sessions) ? session.sessions.filter(isRecord) : [session])
    .map((item, index) => ({ item, index, timestamp: getSessionTimestamp(item), title: getSessionTitle(item, index) }))
    .sort((left, right) => right.timestamp - left.timestamp || right.index - left.index)
    .slice(0, MAX_RENDERED_SESSIONS), [session])
  const [selectedSessionIndex, setSelectedSessionIndex] = useState(0)
  useEffect(() => setSelectedSessionIndex(0), [sessions.length, sessions[0]?.timestamp])
  const selected = sessions[Math.min(selectedSessionIndex, Math.max(0, sessions.length - 1))]
  const turns = useMemo(() => (
    selected ? getTurnViews(selected.item, selected.index, false) : []
  ), [selected])
  return (
    <div className="wa-conversation-log">
      {sessions.length > 1 ? <nav className="wa-conversation-session-nav" aria-label="Conversation navigation">
        {sessions.map((item, index) => <button className={index === selectedSessionIndex ? "active" : ""} key={`${item.index}-${item.timestamp}`} onClick={() => setSelectedSessionIndex(index)} type="button">
          <strong>{item.title}</strong><small>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "Saved conversation"}</small>
        </button>)}
      </nav> : null}
      <ConversationTimeline turns={turns} />
    </div>
  )
}
