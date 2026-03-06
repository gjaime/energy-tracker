import { useState, useEffect } from 'react'
import { getEventos, registrarLectura } from '../api/eventos'

export function useEventos(servicioId) {
  const [eventos, setEventos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = async () => {
    if (!servicioId) return
    try {
      setCargando(true)
      setError(null)
      const data = await getEventos(servicioId)
      setEventos(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar lecturas')
    } finally {
      setCargando(false)
    }
  }

  const agregarLectura = async (fecha, lecturaValor, notas = '') => {
    const nuevo = await registrarLectura({ servicio_id: servicioId, fecha, lectura_valor: lecturaValor, notas })
    setEventos(prev => [nuevo, ...prev])
    return nuevo
  }

  useEffect(() => { cargar() }, [servicioId])

  return { eventos, cargando, error, recargar: cargar, agregarLectura }
}
