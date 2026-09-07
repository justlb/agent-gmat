import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MissionOverview } from '../../../src/pages/agent/MissionOverview'

afterEach(cleanup)
it('shows the electrical reason and details separately from execution status', () => {
  render(<MissionOverview stages={{ opalis: { status: 'completed' } }} overview={{ electricalConfiguration: {
    value: 'Battery minimum reached — simulation stopped', source: 'calculated-opalis.json',
    detail: 'Final battery charge: 44.0%. Computed duration: 10.0 min.',
  } }} />)
  expect(screen.getByText('Electrical assessment')).toBeInTheDocument()
  expect(screen.getByText('Battery minimum reached — simulation stopped')).toBeInTheDocument()
  expect(screen.getByText('Final battery charge: 44.0%. Computed duration: 10.0 min.')).toBeInTheDocument()
  expect(screen.getByText('OPALIS calculation: completed')).toBeInTheDocument()
})
