import api from './client'

export const getServicios = () =>
  api.get('/servicios/').then(r => r.data)
