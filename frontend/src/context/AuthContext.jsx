/**
 * Contexto de autenticación — disponible en toda la app.
 * Gestiona login, logout y el estado del usuario actual.
 */
import { createContext, useContext, useState, useEffect } from 'react'
import { login as apiLogin } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)

  // Al cargar la app, restaurar sesión si existe token guardado
  useEffect(() => {
    const userGuardado = localStorage.getItem('cfe_user')
    if (userGuardado) {
      setUsuario(JSON.parse(userGuardado))
    }
    setCargando(false)
  }, [])

  const login = async (email, password) => {
    const data = await apiLogin(email, password)
    localStorage.setItem('cfe_token', data.access_token)
    localStorage.setItem('cfe_user', JSON.stringify({
      id: data.usuario_id,
      nombre: data.nombre,
      rol: data.rol,
    }))
    setUsuario({ id: data.usuario_id, nombre: data.nombre, rol: data.rol })
    return data
  }

  const logout = () => {
    localStorage.removeItem('cfe_token')
    localStorage.removeItem('cfe_user')
    setUsuario(null)
  }

  return (
    <AuthContext.Provider value={{ usuario, login, logout, cargando }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
