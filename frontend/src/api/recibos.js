import api from './client'

export const getRecibos = (servicioId) =>
  api.get(`/recibos/${servicioId}`).then(r => r.data)

export const importarRecibo = (servicioId, archivo) => {
  const formData = new FormData()
  formData.append('archivo', archivo)
  return api.post(`/recibos/${servicioId}/importar`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // 60s para dar tiempo a Claude de procesar el PDF
  }).then(r => r.data)
}
