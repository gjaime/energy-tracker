import api from './client'

export const login = (nombre_usuario, pin) =>
  api.post('/auth/login', { nombre_usuario, pin }).then(r => r.data)

export const register = (nombre_usuario, pin) =>
  api.post('/auth/register', { nombre_usuario, pin }).then(r => r.data)
