# 🎓 Sistema de Monitoreo de Examen

Sistema en tiempo real para vigilar la actividad de los alumnos durante un examen.

---

## 📁 Archivos incluidos

| Archivo | Descripción |
|---------|-------------|
| `server.js` | Servidor Node.js con Socket.io |
| `alumno.html` | Página para el alumno |
| `admin.html` | Dashboard del profesor |
| `package.json` | Dependencias del proyecto |

---

## 🚀 Instalación (una sola vez)

### Paso 1 — Instalar Node.js (gratis)
Ir a https://nodejs.org y descargar la versión **LTS**. Instalar normalmente.

### Paso 2 — Instalar las dependencias del proyecto
Abrir una terminal (CMD o PowerShell en Windows, Terminal en Mac/Linux) **dentro de la carpeta del proyecto** y ejecutar:

```bash
npm install
```

Esto descarga Express y Socket.io automáticamente.

---

## ▶️ Cómo usar

### Arrancar el servidor
```bash
node server.js
```
Vas a ver:
```
✅  Servidor corriendo en http://localhost:3000
   Alumno : http://localhost:3000/alumno
   Admin  : http://localhost:3000/admin
```

### Acceder a las páginas
- **Profesor:** abrir http://localhost:3000/admin
- **Alumnos:** abrir http://localhost:3000/alumno  
  (Si todos están en la misma red Wi-Fi, usar la IP local del servidor, ej: http://192.168.1.X:3000/alumno)

---

## ⚙️ Cómo funciona

### alumno.html
1. El alumno ingresa nombre y cédula y hace clic en "Ingresar al examen"
2. Cada **2 segundos** se envía un heartbeat al servidor
3. Si el alumno **cambia de pestaña** o minimiza la ventana, se registra el evento al instante

### admin.html
1. Muestra en tiempo real la lista de todos los alumnos conectados
2. Estado **Activo** (verde) / **Inactivo** (rojo) / **Activo con alerta** (amarillo)
3. Tags de alerta: "Sin señal" y "Cambió pestaña"
4. Banner de alerta parpadeante cuando hay actividad sospechosa

### server.js
- Guarda el estado de cada alumno en memoria (se reinicia si apagás el servidor)
- Si un alumno no manda heartbeat por **5 segundos**, lo marca como inactivo
- Notifica al admin inmediatamente ante cualquier cambio

---

## 🔧 Configuración

En `server.js` podés ajustar:
```js
const HEARTBEAT_TIMEOUT = 5000; // milisegundos (5000 = 5 segundos)
```

En `alumno.html` podés ajustar la frecuencia del heartbeat:
```js
setInterval(() => { ... }, 2000); // milisegundos (2000 = 2 segundos)
```
