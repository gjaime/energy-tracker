import api from './client'

export const getEventos = (servicioId) =>
  api.get(`/eventos/${servicioId}`).then(r => r.data)

export const registrarLectura = (datos) =>
  api.post('/eventos/lectura', datos).then(r => r.data)
