import { useParams } from 'react-router-dom'
import { DocsPage } from '../../features/docs/DocsPage'

export default function DocsTopic() {
  const { topic } = useParams()
  return (
    <>
      <title>{`${topic ?? 'Docs'} · Faultline docs`}</title>
      <DocsPage slug={topic} />
    </>
  )
}
