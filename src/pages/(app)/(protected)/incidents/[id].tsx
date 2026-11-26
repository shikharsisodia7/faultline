import { useParams } from 'react-router-dom'
import { CloudIncidentPage } from '../../../../features/cloud/CloudIncidentPage'

export default function Incident() {
  const { id = '' } = useParams()
  return (
    <>
      <title>Incident · Faultline</title>
      <CloudIncidentPage incidentId={id} />
    </>
  )
}
