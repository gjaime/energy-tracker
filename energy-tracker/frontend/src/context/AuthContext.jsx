import { createContext, useContext, useState, useEffect } from 'react'
import { login as apiLogin, register as apiRegister } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const guardado = localStorage.getItem('energy_user')
    if (guardado) setUsuario(JSON.parse(guardado))
    setCargando(false)
  }, [])

  const _guardarSesion = (data) => {
    const user = {
      id:                    data.usuario_id,
      nombre_usuario:        data.nombre_usuario,
      rol:                   data.rol,
      onboarding_completado: data.onboarding_completado,
    }
    localStorage.setItem('energy_token', data.access_token)
    localStorage.setItem('energy_user', JSON.stringify(user))
    setUsuario(user)
    return user
  }

  const login = async (nombre_usuario, pin) => {
    const data = await apiLogin(nombre_usuario, pin)
    return _guardarSesion(data)
  }

  const register = async (nombre_usuario, pin) => {
    const data = await apiRegister(nombre_usuario, pin)
    return _guardarSesion(data)
  }

  const completarOnboarding = () => {
    const actualizado = { ...usuario, onboarding_completado: true }
    localStorage.setItem('energy_user', JSON.stringify(actualizado))
    setUsuario(actualizado)
  }

  const logout = () => {
    localStorage.removeItem('energy_token')
    localStorage.removeItem('energy_user')
    setUsuario(null)
  }

  return (
    <AuthContext.Provider value={{ usuario, login, register, logout, completarOnboarding, cargando }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
