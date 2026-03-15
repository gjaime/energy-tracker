import api from './client'

export const getEventos = (servicioId) =>
  api.get('/lecturas', { params: { servicio_id: servicioId } }).then(r => r.data)

export const registrarLectura = (datos) =>
  api.post('/lecturas', datos).then(r => r.data)
