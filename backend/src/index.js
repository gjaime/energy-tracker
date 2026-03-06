require('dotenv').config()
const express = require('express')
const cors    = require('cors')

const authRoutes     = require('./routes/auth')
const lecturasRoutes = require('./routes/lecturas')
const statsRoutes    = require('./routes/stats')
const serviciosRoutes= require('./routes/servicios')
const ciclosRoutes   = require('./routes/ciclos')

const app  = express()
const PORT = process.env.PORT || 3847

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Rutas
app.use('/api/auth',      authRoutes)
app.use('/api/lecturas',  lecturasRoutes)
app.use('/api/confirmar', lecturasRoutes)  // alias
app.use('/api/cancelar',  lecturasRoutes)  // alias
app.use('/api/stats',     statsRoutes)
app.use('/api/servicios', serviciosRoutes)
app.use('/api/ciclos',    ciclosRoutes)

// Health check (usado por docker-compose y n8n)
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CFE Tracker API corriendo en puerto ${PORT}`)
})
