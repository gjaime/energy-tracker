import { useState, useEffect } from 'react'
import { getRecibos, importarRecibo } from '../api/recibos'

export function useRecibos(servicioId) {
  const [recibos, setRecibos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [importando, setImportando] = useState(false)
  const [error, setError] = useState(null)

  const cargar = async () => {
    if (!servicioId) return
    try {
      setCargando(true)
      const data = await getRecibos(servicioId)
      setRecibos(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar recibos')
    } finally {
      setCargando(false)
    }
  }

  const subir = async (archivo) => {
    try {
      setImportando(true)
      setError(null)
      const resultado = await importarRecibo(servicioId, archivo)
      await cargar() // recargar lista tras importar
      return resultado
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al importar recibo')
      throw e
    } finally {
      setImportando(false)
    }
  }

  useEffect(() => { cargar() }, [servicioId])

  return { recibos, cargando, importando, error, recargar: cargar, subir }
}
