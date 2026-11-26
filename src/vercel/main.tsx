/**
 * Entry for the standalone Vercel build. Same UI and engines as the DeepSpace
 * app, without DeepSpace providers: data is synthetic or browser-local.
 */
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Link, Outlet, RouterProvider, useParams } from 'react-router-dom'
import '../styles.css'
import { ToastProvider, TooltipProvider } from '@/components/ui'
import { Landing } from '../features/landing/Landing'
// Route-level code splitting: the landing page never downloads the workspace.
const DemoIndexPage = lazy(() => import('../features/demo/DemoIndexPage').then((m) => ({ default: m.DemoIndexPage })))
const DemoWorkspacePage = lazy(() => import('../features/demo/DemoWorkspacePage').then((m) => ({ default: m.DemoWorkspacePage })))
import { fullAppHref } from '../lib/target'
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
        fullAppHref(`/demo/${encodeURIComponent(slug)}`) ? (
          <a href={fullAppHref(`/demo/${encodeURIComponent(slug)}`)!} className="hidden h-8 items-center rounded-lg px-2.5 text-[12.5px] text-muted-foreground hover:text-foreground sm:inline-flex">
            Open in full app
          </a>
        ) : null
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
        {fullAppHref() ? <a href={fullAppHref()!} className="underline">Full app on DeepSpace</a> : null}
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
