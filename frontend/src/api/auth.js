import api from './client'

export const login = async (email, password) => {
  const { data } = await api.post('/auth/login', { email, password })
  return data
}
