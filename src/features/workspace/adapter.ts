import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Annotation, HypothesisReview, Intervention } from '@faultline/engine'

export interface Bookmark {
  id: string
  ts: number
  label: string
  author?: string
}

export interface SavedSimulation {
  id: string
  label: string
  branchAtSec: number
  interventions: Intervention[]
  overall: 'better' | 'worse' | 'mixed' | 'same'
  summary: string
  assumptions: string[]
  createdAt: number
  author?: string
}

export interface PresencePeer {
  userId: string
  name: string
  color: string
  /** Playhead the peer is looking at (UTC ms). */
  t?: number
  eventId?: string
}

export interface ReviewTally {
  support: number
  reject: number
  confirm: number
  mine?: HypothesisReview
}

/**
 * Persistence + collaboration surface for the workspace. The demo uses a
 * browser-local implementation; the authenticated app uses DeepSpace records.
 * Optional methods are absent when the viewer cannot write.
 */
export interface WorkspaceAdapter {
  mode: 'local' | 'cloud'
  /** Shown in the UI so local-only persistence is never mistaken for sync. */
  notice: string
  canEdit: boolean
  annotations: Annotation[]
  addAnnotation?: (a: { eventId?: string; ts?: number; body: string; kind: Annotation['kind'] }) => Promise<void>
  removeAnnotation?: (id: string) => Promise<void>
  /** Effective review status per hypothesis id. */
  reviews: Record<string, HypothesisReview>
  tallies?: Record<string, ReviewTally>
  setReview?: (hypothesisId: string, review: HypothesisReview) => Promise<void>
  bookmarks: Bookmark[]
  addBookmark?: (b: { ts: number; label: string }) => Promise<void>
  removeBookmark?: (id: string) => Promise<void>
  simulations: SavedSimulation[]
  saveSimulation?: (s: Omit<SavedSimulation, 'id' | 'createdAt'>) => Promise<void>
  peers?: PresencePeer[]
  updatePresence?: (state: { t: number; eventId?: string }) => void
}

interface LocalState {
  annotations: Annotation[]
  reviews: Record<string, HypothesisReview>
  bookmarks: Bookmark[]
  simulations: SavedSimulation[]
}

const EMPTY: LocalState = { annotations: [], reviews: {}, bookmarks: [], simulations: [] }

function read(key: string): LocalState {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<LocalState>
    return { ...EMPTY, ...parsed }
  } catch {
    return EMPTY
  }
}

function write(key: string, state: LocalState) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* storage full or blocked: state stays in memory for this session */
  }
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Browser-local workspace for demos and the standalone build. Nothing leaves
 * the browser; seeded synthetic annotations are merged in read-only.
 */
export function useLocalWorkspace(incidentId: string, seeded: Annotation[], notice: string): WorkspaceAdapter {
  const key = `faultline:workspace:${incidentId}`
  const [state, setState] = useState<LocalState>(EMPTY)
  useEffect(() => setState(read(key)), [key])
  const update = useCallback(
    (fn: (s: LocalState) => LocalState) =>
      setState((prev) => {
        const next = fn(prev)
        write(key, next)
        return next
      }),
    [key],
  )

  return useMemo<WorkspaceAdapter>(
    () => ({
      mode: 'local',
      notice,
      canEdit: true,
      annotations: [...seeded, ...state.annotations].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)),
      addAnnotation: async (a) => update((s) => ({ ...s, annotations: [...s.annotations, { id: uid('ann'), author: 'You (this browser)', ...a }] })),
      removeAnnotation: async (id) => update((s) => ({ ...s, annotations: s.annotations.filter((x) => x.id !== id) })),
      reviews: state.reviews,
      setReview: async (hypothesisId, review) => update((s) => ({ ...s, reviews: { ...s.reviews, [hypothesisId]: review } })),
      bookmarks: state.bookmarks,
      addBookmark: async (b) => update((s) => ({ ...s, bookmarks: [...s.bookmarks, { id: uid('bm'), ...b }].sort((x, y) => x.ts - y.ts) })),
      removeBookmark: async (id) => update((s) => ({ ...s, bookmarks: s.bookmarks.filter((x) => x.id !== id) })),
      simulations: state.simulations,
      saveSimulation: async (sim) => update((s) => ({ ...s, simulations: [{ ...sim, id: uid('sim'), createdAt: Date.now() }, ...s.simulations].slice(0, 20) })),
    }),
    [notice, seeded, state, update],
  )
}
