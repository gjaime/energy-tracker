import api from './client'

export const getPerfil  = ()        => api.get('/admin/perfil').then(r => r.data)
export const getSistema = ()        => api.get('/admin/sistema').then(r => r.data)
export const cambiarPin = (datos)   => api.put('/admin/pin', datos).then(r => r.data)
