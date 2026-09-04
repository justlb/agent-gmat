import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultsPage } from '../../../src/pages/agent/ResultsPage'
import { getRunView } from '../../../src/pages/agent/runViewApi'
import { askResultAssistant, getResultConversation, getResultSamples, listResultRuns, type ResultRun } from '../../../src/pages/agent/runResultsApi'

vi.mock('../../../src/pages/agent/runViewApi', () => ({ getRunView: vi.fn() }))
vi.mock('../../../src/pages/agent/runResultsApi', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/pages/agent/runResultsApi')>(), askResultAssistant: vi.fn(), getResultConversation: vi.fn(), getResultSamples: vi.fn(), listResultRuns: vi.fn() }))
const runs: ResultRun[] = [
  { runId: '26-09-04_12-00', runPath: 'gmat/mission-runs/26-09-04_12-00', name: 'Completed mission', templateId: 'orbit-keeping', createdAt: '2026-09-04T12:00:00Z', status: 'completed', workflow: { stages: { gmat: { status: 'completed' }, simu_cic: { status: 'completed' }, opalis: { status: 'completed' }, rf_comlink: { status: 'completed' } } } },
  { runId: '26-09-04_11-00', runPath: 'gmat/mission-runs/26-09-04_11-00', name: 'Failed mission', templateId: 'orbit-keeping', createdAt: '2026-09-04T11:00:00Z', status: 'failed', workflow: { stages: { gmat: { status: 'failed', message: 'Propagator failed' } } } },
]

beforeEach(() => {
  vi.mocked(listResultRuns).mockResolvedValue({ runs })
  vi.mocked(getRunView).mockResolvedValue({ overview: { fuelMassConsumed: { source: 'gmat_result.json', value: '1.234 kg' } } } as Awaited<ReturnType<typeof getRunView>>)
  vi.mocked(getResultSamples).mockImplementation(async path => path === runs[0].runPath ? [{ elapsedDays: 0, altitudeKm: 500, fuelMassKg: 10 }, { elapsedDays: 1, altitudeKm: 490, fuelMassKg: 9 }] : [])
  vi.mocked(getResultConversation).mockResolvedValue({ conversation: [] })
  vi.mocked(askResultAssistant).mockResolvedValue({ answer: 'The saved fuel consumption is 1.234 kg.' })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('Results page', () => {
  it('shows dated runs with statuses, the shared overview and graphs below it', async () => {
    render(<ResultsPage />)
    expect(await screen.findByText('1.234 kg')).toBeInTheDocument()
    const archive = screen.getByRole('complementary', { name: 'Saved mission runs' })
    expect(within(archive).getByText('Fully completed')).toBeInTheDocument()
    expect(within(archive).getByText('Failed / incomplete')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Altitude from GMAT output' })).toBeInTheDocument()
    expect(screen.getByText('Mission overview')).toBeInTheDocument()
  })

  it('switches the summary, graphs and chat context together, including runs without graphs', async () => {
    render(<ResultsPage />)
    await screen.findByText('1.234 kg')
    fireEvent.click(screen.getByRole('button', { name: /Failed mission/ }))
    await waitFor(() => expect(getRunView).toHaveBeenLastCalledWith(runs[1].runPath))
    expect(await screen.findByText(/No saved GMAT time-series data/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Altitude from GMAT output' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Question about this run')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('Question about this run'), { target: { value: 'Why did it fail?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText('The saved fuel consumption is 1.234 kg.')
    expect(askResultAssistant).toHaveBeenCalledWith(runs[1].runPath, 'Why did it fail?')
  })

  it('never displays a late assistant reply in another run', async () => {
    let resolve!: (value: { answer: string }) => void
    vi.mocked(askResultAssistant).mockReturnValue(new Promise(done => { resolve = done }))
    render(<ResultsPage />)
    await screen.findByText('1.234 kg')
    await waitFor(() => expect(screen.getByLabelText('Question about this run')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('Question about this run'), { target: { value: 'Explain run A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    fireEvent.click(screen.getByRole('button', { name: /Failed mission/ }))
    await act(async () => resolve({ answer: 'Late answer for run A' }))
    expect(screen.queryByText('Late answer for run A')).not.toBeInTheDocument()
    expect(screen.queryByText('Explain run A')).not.toBeInTheDocument()
  })

  it('provides a useful empty state', async () => {
    vi.mocked(listResultRuns).mockResolvedValue({ runs: [] })
    render(<ResultsPage />)
    expect(await screen.findByText('No runs found. Start one from New simulation.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument()
  })
})
