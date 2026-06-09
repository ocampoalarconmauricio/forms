const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const RESPONSES_FILE = path.join(__dirname, 'responses.json');

// ── State ────────────────────────────────────────────────────────────────────
const alumnos = new Map();    // socketId → { nombre, cedula, activo, alertas, progreso, lastHeartbeat }
const admins  = new Set();
const respuestasFinales = [];
let eventoAbierto = false;    // ← palanca: solo si true se aceptan respuestas

// Cargar respuestas previas si existen
if (fs.existsSync(RESPONSES_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(RESPONSES_FILE, 'utf8'));
    respuestasFinales.push(...data);
    console.log(`Cargadas ${respuestasFinales.length} respuestas previas`);
  } catch (_) {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function broadcast() {
  const lista = [...alumnos.values()].map(a => ({
    nombre:   a.nombre,
    cedula:   a.cedula,
    activo:   a.activo,
    alertas:  a.alertas,
    progreso: a.progreso || 0,
  }));
  io.to('admins').emit('estado_alumnos', lista);
}

function broadcastEstadoEvento() {
  io.emit('evento_estado', { abierto: eventoAbierto });
}

function guardarJSON() {
  fs.writeFileSync(RESPONSES_FILE, JSON.stringify(respuestasFinales, null, 2), 'utf8');
}

function generarCSV(data) {
  if (!data.length) return '';
  const respKeys = new Set();
  data.forEach(r => { if (r.respuestas) Object.keys(r.respuestas).forEach(k => respKeys.add(k)); });
  const cols = ['nombre', 'cedula', 'timestamp', ...Array.from(respKeys)];
  const header = cols.map(c => `"${c}"`).join(',');
  const rows = data.map(r =>
    cols.map(c => {
      let v = '';
      if      (c === 'nombre')    v = r.nombre    || '';
      else if (c === 'cedula')    v = r.cedula    || '';
      else if (c === 'timestamp') v = r.timestamp || '';
      else                        v = r.respuestas?.[c] ?? '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

// ── Socket ───────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── Admin ──
  socket.on('join_admin', () => {
    socket.join('admins');
    admins.add(socket.id);
    broadcast();
    socket.emit('respuestas_guardadas', respuestasFinales.length);
    socket.emit('evento_estado', { abierto: eventoAbierto });
  });

  socket.on('set_evento', ({ abierto }) => {
    if (!admins.has(socket.id)) return;
    eventoAbierto = abierto;
    broadcastEstadoEvento();
    broadcast();
  });

  socket.on('exportar_csv', () => {
    const csv = generarCSV(respuestasFinales);
    socket.emit('csv_listo', { csv, total: respuestasFinales.length });
  });

  socket.on('exportar_json', () => {
    socket.emit('json_listo', { data: respuestasFinales, total: respuestasFinales.length });
  });

  // ── Alumno ──
  socket.on('registrar_alumno', ({ nombre, cedula }) => {
    // Limpiar entrada vieja por cédula (reconexión)
    for (const [sid, a] of alumnos.entries()) {
      if (a.cedula === cedula.trim() && sid !== socket.id) {
        alumnos.delete(sid);
      }
    }
    alumnos.set(socket.id, {
      nombre:        nombre.trim(),
      cedula:        cedula.trim(),
      activo:        true,
      alertas:       [],
      progreso:      0,
      lastHeartbeat: Date.now(),
    });
    // Informar al alumno si el evento está abierto o no
    socket.emit('evento_estado', { abierto: eventoAbierto });
    broadcast();
  });

  socket.on('heartbeat', () => {
    const a = alumnos.get(socket.id);
    if (!a) return;
    a.activo = true;
    a.lastHeartbeat = Date.now();
    a.alertas = a.alertas.filter(x => x !== 'sin_heartbeat');
    // no broadcast aquí — el interval lo hace cada 5s para no saturar
  });

  socket.on('cambio_pestana', ({ oculta }) => {
    const a = alumnos.get(socket.id);
    if (!a) return;
    if (oculta) {
      if (!a.alertas.includes('cambio_pestana')) a.alertas.push('cambio_pestana');
    } else {
      a.alertas = a.alertas.filter(x => x !== 'cambio_pestana');
    }
    broadcast();
  });

  socket.on('progreso', ({ pct }) => {
    const a = alumnos.get(socket.id);
    if (a) a.progreso = pct;
    // no broadcast — el interval lo pickea
  });

  socket.on('enviar_respuestas', ({ nombre, cedula, respuestas }) => {
    if (!eventoAbierto) {
      socket.emit('envio_rechazado', { motivo: 'evento_cerrado' });
      return;
    }
    const entrada = { nombre, cedula, timestamp: new Date().toISOString(), respuestas };
    const idx = respuestasFinales.findIndex(r => r.cedula === cedula);
    if (idx >= 0) respuestasFinales[idx] = entrada;
    else respuestasFinales.push(entrada);
    guardarJSON();
    const a = alumnos.get(socket.id);
    if (a) a.progreso = 100;
    io.to('admins').emit('respuestas_guardadas', respuestasFinales.length);
    socket.emit('respuestas_confirmadas');
    broadcast();
  });

  // ── Desconexión ──
  socket.on('disconnect', () => {
    if (alumnos.has(socket.id)) {
      const a = alumnos.get(socket.id);
      a.activo = false;
      if (!a.alertas.includes('sin_heartbeat')) a.alertas.push('sin_heartbeat');
      setTimeout(() => { alumnos.delete(socket.id); broadcast(); }, 30000);
      broadcast();
    }
    admins.delete(socket.id);
  });
});

// ── Broadcast periódico (progreso + heartbeat check) ─────────────────────────
setInterval(() => {
  alumnos.forEach((a) => {
    if (a.activo && Date.now() - a.lastHeartbeat > 6000) {
      a.activo = false;
      if (!a.alertas.includes('sin_heartbeat')) a.alertas.push('sin_heartbeat');
    }
  });
  if (admins.size > 0) broadcast();
}, 3000);

// ── Servir archivos estáticos ─────────────────────────────────────────────────
app.use(express.static(__dirname));
app.get('/',      (_, res) => res.sendFile(path.join(__dirname, 'alumno.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'admin.html')));

server.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  console.log(`Admin:    http://localhost:${PORT}/admin`);
});