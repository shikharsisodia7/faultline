/**
 * Public demo workspace — static page (no DeepSpace providers), so anyone can
 * open it instantly. Signed-in users can copy the incident into their own
 * workspace from the header.
 */
import { Link, useParams } from 'react-router-dom'
import { DemoWorkspacePage } from '../../features/demo/DemoWorkspacePage'

export default function DemoIncident() {
  const { slug = '' } = useParams()
  return (
    <>
      <title>{`${slug.replace(/-/g, ' ')} · Faultline demo`}</title>
      <DemoWorkspacePage
        slug={slug}
        headerRight={
          <Link to={`/incidents/new?fromDemo=${encodeURIComponent(slug)}`} className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90">
            Copy to my workspace
          </Link>
        }
      />
    </>
  )
}
