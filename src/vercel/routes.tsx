import { useParams, type RouteObject } from 'react-router-dom'
import { DocsPage } from '../features/docs/DocsPage'
import { AnalyticsPage, ComparePage } from '../features/insights/InsightPages'
import { useDemoDatasets } from '../features/insights/useDemoDatasets'
import { LabPage } from '../features/lab/LabPage'
import { useLocalLabStore } from '../features/lab/ChaosLab'

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
