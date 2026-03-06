import api from './client'

export const login = async (email, password) => {
  const formData = new FormData()
  formData.append('username', email)
  formData.append('password', password)
  const { data } = await api.post('/auth/login', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return data
}
