import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  askMultiRunAssistant,
  askResultAssistant,
  getResultConversation,
  type ResultRun,
  type ResultTurn,
} from './runResultsApi'

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

type DiscussionMode =
  | { kind: 'single'; run: ResultRun }
  | { kind: 'multi'; runs: ResultRun[] }

/**
 * Supports both single-run (persisted conversation) and multi-run (ephemeral)
 * analysis. In multi-run mode, each question is sent to the multi-run endpoint
 * which compares all selected runs. The conversation is not persisted server-side
 * in multi-run mode, only kept in component state.
 */
export function ResultsDiscussion({ mode }: { mode: DiscussionMode }) {
  const [turns, setTurns] = useState<ResultTurn[]>([])
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const mounted = useRef(true)
  const messages = useRef<HTMLDivElement>(null)

  // Stable key for dependency tracking — mode is an object that changes ref each render.
  const modeKey = mode.kind === 'single' ? `single:${mode.run.runPath}` : `multi:${mode.runs.map(r => r.runPath).join(',')}`

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Load persisted conversation only in single-run mode.
  useEffect(() => {
    let cancelled = false
    if (mode.kind === 'single') {
      setLoading(true)
      setError('')
      void getResultConversation(mode.run.runPath)
        .then(result => { if (!cancelled) setTurns(result.conversation) })
        .catch(reason => { if (!cancelled) setError(errorMessage(reason, 'Unable to load discussion')) })
        .finally(() => { if (!cancelled) setLoading(false) })
    } else {
      // Multi-run mode: ephemeral conversation, reset on selection change.
      setTurns([])
      setLoading(false)
      setError('')
    }
    return () => { cancelled = true }
  }, [modeKey, retry])

  useEffect(() => {
    if (messages.current) messages.current.scrollTop = messages.current.scrollHeight
  }, [turns, pending])

  const send = async () => {
    const question = message.trim()
    if (!question || loading || pending) return

    setPending(question)
    setMessage('')
    setError('')

    try {
      if (mode.kind === 'single') {
        const result = await askResultAssistant(mode.run.runPath, question)
        if (mounted.current) {
          setTurns(current => [...current, { question, answer: result.answer, askedAt: new Date().toISOString() }])
        }
      } else {
        const result = await askMultiRunAssistant(mode.runs.map(r => r.runPath), question)
        if (mounted.current) {
          setTurns(current => [...current, { question, answer: result.answer, askedAt: new Date().toISOString() }])
        }
      }
    } catch (reason) {
      if (mounted.current) {
        setError(errorMessage(reason, 'Analysis failed. Please retry.'))
        setMessage(question)
      }
    } finally {
      if (mounted.current) setPending('')
    }
  }

  const title = mode.kind === 'single'
    ? 'Discuss this run'
    : `Compare ${mode.runs.length} runs`

  const subtitle = mode.kind === 'single'
    ? mode.run.runId
    : mode.runs.map(r => r.runId).join(' · ')

  const description = mode.kind === 'single'
    ? "Answers use this run's saved evidence. No calculations are rerun."
    : 'The assistant compares all selected runs. No calculations are rerun.'

  return <>
    <header>
      <span>RESULTS ASSISTANT</span>
      <h2>{title}</h2>
      <small>{subtitle}</small>
      <p>{description}</p>
    </header>
    <div className="results-messages" ref={messages} role="log" aria-label="Run discussion" aria-live="polite">
      {loading ? <p className="results-notice">Loading discussion…</p> : null}
      {!loading && !turns.length && !pending ? <p className="results-notice">Ask about fuel consumption, mission performance, or compare run results.</p> : null}
      {turns.map((turn, index) => <div className="results-turn" key={`${turn.askedAt}-${index}`}>
        <div className="results-question"><strong>You</strong><p>{turn.question}</p></div>
        <div className="results-answer"><strong>Assistant</strong><ReactMarkdown>{turn.answer}</ReactMarkdown></div>
      </div>)}
      {pending ? <div className="results-turn">
        <div className="results-question"><strong>You</strong><p>{pending}</p></div>
        <p className="results-notice">Analyzing…</p>
      </div> : null}
    </div>
    {error ? <div className="results-error" role="alert">
      {error}
      <button type="button" disabled={!!pending} onClick={() => setRetry(value => value + 1)}>Reload discussion</button>
    </div> : null}
    <form className="results-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      <label htmlFor="results-question">{mode.kind === 'single' ? 'Question about this run' : 'Question about these runs'}</label>
      <textarea
        id="results-question"
        value={message}
        maxLength={12000}
        rows={3}
        disabled={loading || !!pending}
        onChange={event => setMessage(event.target.value)}
        placeholder={mode.kind === 'single' ? 'What explains these results?' : 'Compare fuel, altitude, or performance across runs?'}
      />
      <button disabled={loading || !!pending || !message.trim()} type="submit">{pending ? 'Analyzing…' : 'Send message'}</button>
    </form>
  </>
}
