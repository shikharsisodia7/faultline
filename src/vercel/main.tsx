/**
 * Entry for the standalone Vercel build. Same UI and engines as the DeepSpace
 * app, without DeepSpace providers: data is synthetic or browser-local.
 */
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Link, Outlet, RouterProvider, useParams } from 'react-router-dom'
import '../styles.css'
import { ToastProvider, TooltipProvider } from '@/components/ui'
import { Landing } from '../features/landing/Landing'
import { DemoIndexPage } from '../features/demo/DemoIndexPage'
import { DemoWorkspacePage } from '../features/demo/DemoWorkspacePage'
import { CANONICAL_URL } from '../lib/target'
import { standaloneRoutes } from './routes'

function Shell() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <div data-testid="app-root" className="min-h-screen bg-background text-foreground">
          <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>}>
            <Outlet />
          </Suspense>
        </div>
      </TooltipProvider>
    </ToastProvider>
  )
}

function DemoRoute() {
  const { slug = '' } = useParams()
  return (
    <DemoWorkspacePage
      slug={slug}
      headerRight={
        <a href={`${CANONICAL_URL}/demo/${encodeURIComponent(slug)}`} className="hidden h-7 items-center rounded-md border border-border px-2.5 text-[12px] text-foreground hover:bg-secondary sm:inline-flex">
          Open in full app
        </a>
      }
    />
  )
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="font-mono text-[12px] text-muted-foreground">404</p>
      <p className="text-[15px] text-foreground">This page is not part of the standalone demo.</p>
      <div className="flex gap-3 text-[13px]">
        <Link to="/" className="underline">Home</Link>
        <a href={CANONICAL_URL} className="underline">Full app on DeepSpace</a>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/demo', element: <DemoIndexPage /> },
      { path: '/demo/:slug', element: <DemoRoute /> },
      ...standaloneRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
