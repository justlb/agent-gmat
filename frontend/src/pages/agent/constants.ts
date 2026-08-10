import type { AgentWorkspaceView } from './types'

export const TARGET_SAMPLE_RATE = 16000
export const DEFAULT_LANGUAGE = 'zh-en'
export type AgentNavItem = {
  href: `#${AgentWorkspaceView}`
  label: string
  meta: string
}

export const NAV_ITEMS: AgentNavItem[] = [
  { label: 'Satellites', href: '#satellites', meta: 'Library' },
  { label: 'Results', href: '#tools', meta: 'GMAT Analysis' },
  { label: 'Mission Studio', href: '#mission', meta: 'Missions' },
]
export const NAV_VIEWS: AgentWorkspaceView[] = ['satellites', 'tools', 'mission']
export const WORKSPACE_GEOMETRY_AFTER_GLB_PATH = '01_cad/geometry_after.glb'
export const CONVERSATION_HISTORY_RELATIVE_PATH = 'logs/conversation-history.json'
export const CONVERSATION_PREVIEW_SESSION_LIMIT = 3
export const CONVERSATION_PREVIEW_TURN_LIMIT = 12
export const CONVERSATION_PREVIEW_EVENT_LIMIT = 80
export const AGENT_HOME_PATH = '/agent'
