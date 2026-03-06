import { useState, useEffect } from 'react'
import { getServicios } from '../api/servicios'

export function useServicios() {
  const [servicios, setServicios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = async () => {
    try {
      setCargando(true)
      setError(null)
      const data = await getServicios()
      setServicios(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar servicios')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  return { servicios, cargando, error, recargar: cargar }
}
