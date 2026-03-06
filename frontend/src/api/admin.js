import api from './client'

export const getPerfil   = ()           => api.get('/admin/perfil').then(r => r.data)
export const getSistema  = ()           => api.get('/admin/sistema').then(r => r.data)
export const cambiarPassword = (datos)  => api.put('/admin/password', datos).then(r => r.data)
export const editarServicio  = (id, datos) => api.put(`/admin/servicio/${id}`, datos).then(r => r.data)
