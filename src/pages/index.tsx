/**
 * Landing page — STATIC (top level of src/pages, no DeepSpace providers) and
 * prerendered at build. Keep it renderable without a browser.
 */
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import { Landing } from '../features/landing/Landing'

export default function LandingPage() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing">
        <Landing />
      </div>
    </>
  )
}
