import type { WorkflowLoopProgressEntry } from '../workspace/progressUtils'

type AgentProgressRailProps = {
  className?: string
  gmatGuiAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  // Kept for compatibility with existing callers; these controls intentionally
  // no longer render in the progress rail. They belong in Mission discussion.
  opalisPrepareAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  opalisRunAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  opalisGuiAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  rfComlinkGuiAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  simuCicGuiAction?: { disabled: boolean; label: string; onClick: () => void; title: string }
  onClose?: () => void
  progressUpdatedAt: string
  title: string
  workflowLoopProgressEntries: WorkflowLoopProgressEntry[]
}

export function AgentProgressRail({ className = 'agent-right-rail', gmatGuiAction, opalisGuiAction, rfComlinkGuiAction, simuCicGuiAction, onClose, progressUpdatedAt, title, workflowLoopProgressEntries }: AgentProgressRailProps) {
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
        {opalisGuiAction ? <button className="agent-progress-gmat-gui" disabled={opalisGuiAction.disabled} onClick={opalisGuiAction.onClick} title={opalisGuiAction.title} type="button">{opalisGuiAction.label}</button> : null}
        {rfComlinkGuiAction ? <button className="agent-progress-gmat-gui" disabled={rfComlinkGuiAction.disabled} onClick={rfComlinkGuiAction.onClick} title={rfComlinkGuiAction.title} type="button">{rfComlinkGuiAction.label}</button> : null}
      </section>
    </aside>
  )
}
