/**
 * Cliente HTTP base — todas las llamadas al backend pasan por aquí.
 * Gestiona automáticamente el token JWT y los errores de sesión.
 */
import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Interceptor de REQUEST — agrega el token JWT en cada llamada
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('energy_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Interceptor de RESPONSE — maneja errores globalmente
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expirado o inválido → limpiar sesión y redirigir al login
      localStorage.removeItem('energy_token')
      localStorage.removeItem('energy_user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
