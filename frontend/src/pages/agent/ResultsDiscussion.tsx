import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { askResultAssistant, getResultConversation, type ResultRun, type ResultTurn } from './runResultsApi'

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

/**
 * Keeps each discussion scoped to the selected immutable run. The parent gives
 * this component a runPath key, so a reply from a previous run cannot appear
 * in the discussion for a newly selected run.
 */
export function ResultsDiscussion({ run }: { run: ResultRun }) {
  const [turns, setTurns] = useState<ResultTurn[]>([])
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const mounted = useRef(true)
  const messages = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void getResultConversation(run.runPath)
      .then(result => {
        if (!cancelled) setTurns(result.conversation)
      })
      .catch(reason => {
        if (!cancelled) setError(errorMessage(reason, 'Unable to load discussion'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [run.runPath, retry])

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
      const result = await askResultAssistant(run.runPath, question)
      if (mounted.current) {
        setTurns(current => [...current, { question, answer: result.answer, askedAt: new Date().toISOString() }])
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

  return <>
    <header>
      <span>RESULTS ASSISTANT</span>
      <h2>Discuss this run</h2>
      <small>{run.runId}</small>
      <p>Answers use this run’s saved evidence. No calculations are rerun.</p>
    </header>
    <div className="results-messages" ref={messages} role="log" aria-label="Run discussion" aria-live="polite">
      {loading ? <p className="results-notice">Loading discussion…</p> : null}
      {!loading && !turns.length && !pending ? <p className="results-notice">Ask about fuel consumption, mission performance, or why a pipeline stage failed.</p> : null}
      {turns.map((turn, index) => <div className="results-turn" key={`${turn.askedAt}-${index}`}>
        <div className="results-question"><strong>You</strong><p>{turn.question}</p></div>
        <div className="results-answer"><strong>Assistant</strong><ReactMarkdown>{turn.answer}</ReactMarkdown></div>
      </div>)}
      {pending ? <div className="results-turn">
        <div className="results-question"><strong>You</strong><p>{pending}</p></div>
        <p className="results-notice">Analyzing this run’s saved results…</p>
      </div> : null}
    </div>
    {error ? <div className="results-error" role="alert">
      {error}
      <button type="button" disabled={!!pending} onClick={() => setRetry(value => value + 1)}>Reload discussion</button>
    </div> : null}
    <form className="results-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      <label htmlFor="results-question">Question about this run</label>
      <textarea
        id="results-question"
        value={message}
        maxLength={12000}
        rows={3}
        disabled={loading || !!pending}
        onChange={event => setMessage(event.target.value)}
        placeholder="What explains these results?"
      />
      <button disabled={loading || !!pending || !message.trim()} type="submit">{pending ? 'Analyzing…' : 'Send message'}</button>
    </form>
  </>
}
