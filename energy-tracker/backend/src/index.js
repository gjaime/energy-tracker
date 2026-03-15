require('dotenv').config()
const express = require('express')
const cors    = require('cors')

const authRoutes       = require('./routes/auth')
const onboardingRoutes = require('./routes/onboarding')
const lecturasRoutes   = require('./routes/lecturas')
const statsRoutes      = require('./routes/stats')
const serviciosRoutes  = require('./routes/servicios')
const ciclosRoutes     = require('./routes/ciclos')
const recibosRoutes    = require('./routes/recibos')
const adminRoutes      = require('./routes/admin')

const app  = express()
const PORT = process.env.PORT || 3847

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth',       authRoutes)
app.use('/api/onboarding', onboardingRoutes)
app.use('/api/lecturas',   lecturasRoutes)
app.use('/api/stats',      statsRoutes)
app.use('/api/servicios',  serviciosRoutes)
app.use('/api/ciclos',     ciclosRoutes)
app.use('/api/recibos',    recibosRoutes)
app.use('/api/admin',      adminRoutes)

app.get('/health', (_, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
)

app.listen(PORT, '0.0.0.0', () =>
  console.log(`Energy Tracker API corriendo en :${PORT}`)
)
