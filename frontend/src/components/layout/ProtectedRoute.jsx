import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export function ProtectedRoute({ children }) {
  const { usuario, cargando } = useAuth()
  const { pathname } = useLocation()

  if (cargando) return <div style={{ minHeight: '100vh', background: '#0a0f14' }} />
  if (!usuario) return <Navigate to="/login" replace />

  if (!usuario.onboarding_completado && pathname !== '/onboarding')
    return <Navigate to="/onboarding" replace />

  if (usuario.onboarding_completado && pathname === '/onboarding')
    return <Navigate to="/" replace />

  return children
}
