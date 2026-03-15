import api from './client'

export const extraerRecibo = (archivo) => {
  const fd = new FormData()
  fd.append('archivo', archivo)
  return api.post('/onboarding/extraer', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }).then(r => r.data)
}

export const iniciarPerfil = (archivo, lecturaHoy) => {
  const fd = new FormData()
  fd.append('archivo', archivo)
  fd.append('lectura_hoy', lecturaHoy)
  return api.post('/onboarding/iniciar', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }).then(r => r.data)
}

export const subirHistorial = (servicioId, archivos) => {
  const fd = new FormData()
  fd.append('servicio_id', servicioId)
  archivos.forEach(f => fd.append('archivos', f))
  return api.post('/onboarding/historial', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180000,
  }).then(r => r.data)
}

export const marcarOnboardingCompleto = () =>
  api.post('/onboarding/completar').then(r => r.data)

export const subirHistorialXML = (servicioId, archivos) => {
  const fd = new FormData()
  fd.append('servicio_id', servicioId)
  archivos.forEach(f => fd.append('archivos', f))
  return api.post('/onboarding/historial-xml', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }).then(r => r.data)
}
