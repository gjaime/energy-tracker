# Frontend — CFE Tracker

Interfaz web construida con React 18 + Vite.

## Estructura

```
frontend/src/
├── main.jsx                        → Entrada + rutas (React Router)
├── api/                            → Capa de comunicación con el backend
│   ├── client.js                   → Axios con JWT automático
│   ├── auth.js
│   ├── servicios.js
│   ├── eventos.js
│   └── recibos.js
├── context/
│   └── AuthContext.jsx             → Sesión global (login/logout)
├── hooks/
│   ├── useServicios.js
│   ├── useEventos.js
│   └── useRecibos.js
├── components/
│   ├── layout/ProtectedRoute.jsx   → Redirige si no hay sesión
│   └── ui/
│       ├── AlertaCiclo.jsx         → Banner rojo ciclo >60 días
│       └── ResumenAjuste.jsx       → Modal resultado de importación
└── pages/
    ├── Login.jsx
    └── Dashboard.jsx               → Vista principal (3 tabs)
```

## Desarrollo local

```bash
cd frontend
npm install
npm run dev
```
