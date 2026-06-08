const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos desde la misma carpeta
app.use(express.static(path.join(__dirname)));

// Ruta explícita para alumno y admin
app.get('/alumno', (req, res) => res.sendFile(path.join(__dirname, 'alumno.html')));
app.get('/admin',  (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ── Estado en memoria ──────────────────────────────────────────────
// alumnos[socketId] = { nombre, cedula, activo, ultimoHeartbeat, alertas[] }
const alumnos = {};
const HEARTBEAT_TIMEOUT = 5000; // 5 s sin heartbeat → inactivo

// ── Utilidad: notificar al admin el estado actual ──────────────────
function broadcastEstado() {
  const lista = Object.entries(alumnos).map(([id, a]) => ({
    socketId: id,
    nombre: a.nombre,
    cedula: a.cedula,
    activo: a.activo,
    alertas: a.alertas,
  }));
  io.to('admin').emit('estado_alumnos', lista);
}

// ── Watchdog: revisa heartbeats cada segundo ───────────────────────
setInterval(() => {
  const ahora = Date.now();
  let cambio = false;
  for (const id in alumnos) {
    const a = alumnos[id];
    const sinSenal = ahora - a.ultimoHeartbeat > HEARTBEAT_TIMEOUT;
    if (sinSenal && a.activo) {
      a.activo = false;
      if (!a.alertas.includes('sin_heartbeat')) a.alertas.push('sin_heartbeat');
      cambio = true;
      console.log(`[WATCHDOG] ${a.nombre} → inactivo (sin heartbeat)`);
    }
  }
  if (cambio) broadcastEstado();
}, 1000);

// ── Conexiones ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  // El admin se une a su sala privada
  socket.on('join_admin', () => {
    socket.join('admin');
    console.log(`[ADMIN] panel conectado`);
    broadcastEstado();
  });

  // El alumno se registra con nombre y cédula
  socket.on('registrar_alumno', ({ nombre, cedula }) => {
    alumnos[socket.id] = {
      nombre,
      cedula,
      activo: true,
      ultimoHeartbeat: Date.now(),
      alertas: [],
    };
    console.log(`[REGISTRO] ${nombre} (${cedula})`);
    broadcastEstado();
  });

  // Heartbeat periódico del alumno
  socket.on('heartbeat', () => {
    if (alumnos[socket.id]) {
      alumnos[socket.id].ultimoHeartbeat = Date.now();
      alumnos[socket.id].activo = true;
      // Si vuelve a estar activo, quitar alerta de heartbeat
      alumnos[socket.id].alertas = alumnos[socket.id].alertas.filter(a => a !== 'sin_heartbeat');
      broadcastEstado();
    }
  });

  // El alumno cambió de pestaña / ventana
  socket.on('cambio_pestana', ({ oculta }) => {
    if (alumnos[socket.id]) {
      if (oculta) {
        if (!alumnos[socket.id].alertas.includes('cambio_pestana'))
          alumnos[socket.id].alertas.push('cambio_pestana');
        console.log(`[ALERTA] ${alumnos[socket.id].nombre} cambió de pestaña`);
      } else {
        // Volvió a la pestaña del examen
        alumnos[socket.id].alertas = alumnos[socket.id].alertas.filter(a => a !== 'cambio_pestana');
      }
      broadcastEstado();
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    if (alumnos[socket.id]) {
      console.log(`[DISCONNECT] ${alumnos[socket.id].nombre}`);
      delete alumnos[socket.id];
      broadcastEstado();
    } else {
      console.log(`[DISCONNECT] ${socket.id} (sin registrar)`);
    }
  });
});

// ── Arrancar servidor ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅  Servidor corriendo en http://localhost:${PORT}`);
  console.log(`   Alumno : http://localhost:${PORT}/alumno`);
  console.log(`   Admin  : http://localhost:${PORT}/admin\n`);
});
