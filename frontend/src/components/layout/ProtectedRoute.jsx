import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export function ProtectedRoute({ children }) {
  const { usuario, cargando } = useAuth()
  if (cargando) return <div style={{ minHeight: '100vh', background: '#0a0f14' }} />
  if (!usuario) return <Navigate to="/login" replace />
  return children
}
