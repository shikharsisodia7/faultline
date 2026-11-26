/** Legacy scaffold route: the app's home is the incident list. */
import { Navigate } from 'react-router-dom'

export default function Home() {
  return <Navigate to="/incidents" replace />
}
