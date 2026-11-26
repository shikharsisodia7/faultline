import { lazy } from 'react'
import { useParams, type RouteObject } from 'react-router-dom'
import { useDemoDatasets } from '../features/insights/useDemoDatasets'
import { useLocalLabStore } from '../features/lab/useLocalLabStore'

const DocsPage = lazy(() => import('../features/docs/DocsPage').then((m) => ({ default: m.DocsPage })))
const LabPage = lazy(() => import('../features/lab/LabPage').then((m) => ({ default: m.LabPage })))
const ComparePage = lazy(() => import('../features/insights/InsightPages').then((m) => ({ default: m.ComparePage })))
const AnalyticsPage = lazy(() => import('../features/insights/InsightPages').then((m) => ({ default: m.AnalyticsPage })))

const INTRO = 'In the standalone demo these are the three synthetic incidents. The full app on DeepSpace includes your own imported incidents.'

function Lab() {
  return <LabPage store={useLocalLabStore('Standalone demo: scenarios are saved in this browser only.')} />
}

function Compare() {
  const d = useDemoDatasets()
  return <ComparePage {...d} intro={INTRO} />
}

function Analytics() {
  const d = useDemoDatasets()
  return <AnalyticsPage {...d} intro={INTRO} />
}

function DocsTopic() {
  const { topic } = useParams()
  return <DocsPage slug={topic} />
}

export const standaloneRoutes: RouteObject[] = [
  { path: '/lab', element: <Lab /> },
  { path: '/compare', element: <Compare /> },
  { path: '/analytics', element: <Analytics /> },
  { path: '/docs', element: <DocsPage /> },
  { path: '/docs/:topic', element: <DocsTopic /> },
]
