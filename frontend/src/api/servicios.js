import api from './client'

export const getServicios = () =>
  api.get('/servicios/').then(r => r.data)

export const crearServicio = (datos) =>
  api.post('/servicios/', datos).then(r => r.data)
