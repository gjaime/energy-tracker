import api from './client'

export const getRecibos = (servicioId) =>
  api.get('/recibos', { params: { servicio_id: servicioId } }).then(r => r.data)
