import type { WorkflowLoopProgressEntry } from '../workspace/progressUtils'

type AgentProgressRailProps = {
  className?: string
  gmatGuiAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  simuCicGuiAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  onClose?: () => void
  progressUpdatedAt: string
  title: string
  workflowLoopProgressEntries: WorkflowLoopProgressEntry[]
}

export function AgentProgressRail({ className = 'agent-right-rail', gmatGuiAction, simuCicGuiAction, onClose, progressUpdatedAt, title, workflowLoopProgressEntries }: AgentProgressRailProps) {
  return (
    <aside className={className}>
      <section>
        <header>
          <strong>{title}</strong>
          <span>{progressUpdatedAt}</span>
          {onClose ? (
            <button type="button" className="agent-progress-close" aria-label="Close progress panel" onClick={onClose}>
              x
            </button>
          ) : null}
        </header>
        {workflowLoopProgressEntries.map(item => (
          <div className={`agent-task-row is-${item.status}`} key={item.key}>
            <span>{item.label}</span>
            <em>{item.statusLabel}</em>
          </div>
        ))}
        {gmatGuiAction ? <button className="agent-progress-gmat-gui" disabled={gmatGuiAction.disabled} onClick={gmatGuiAction.onClick} title={gmatGuiAction.title} type="button">{gmatGuiAction.label}</button> : null}
        {simuCicGuiAction ? <button className="agent-progress-gmat-gui" disabled={simuCicGuiAction.disabled} onClick={simuCicGuiAction.onClick} title={simuCicGuiAction.title} type="button">{simuCicGuiAction.label}</button> : null}
      </section>
    </aside>
  )
}
