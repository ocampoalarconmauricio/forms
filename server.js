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
const alumnos = new Map();       // socketId → { nombre, cedula, activo, alertas, respuestas }
const admins = new Set();
const respuestasFinales = [];    // array de respuestas completas al finalizar examen
let examenFinalizado = false;

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
    nombre: a.nombre,
    cedula: a.cedula,
    activo: a.activo,
    alertas: a.alertas,
    progreso: a.progreso || 0,
  }));
  io.to('admins').emit('estado_alumnos', lista);
}

function guardarJSON() {
  fs.writeFileSync(RESPONSES_FILE, JSON.stringify(respuestasFinales, null, 2), 'utf8');
}

function generarCSV(data) {
  if (!data.length) return '';

  // Recopilar todas las claves de respuestas posibles
  const respKeys = new Set();
  data.forEach(r => {
    if (r.respuestas) Object.keys(r.respuestas).forEach(k => respKeys.add(k));
  });

  const cols = ['nombre', 'cedula', 'timestamp', ...Array.from(respKeys)];
  const header = cols.map(c => `"${c}"`).join(',');

  const rows = data.map(r => {
    return cols.map(c => {
      let v = '';
      if (c === 'nombre') v = r.nombre || '';
      else if (c === 'cedula') v = r.cedula || '';
      else if (c === 'timestamp') v = r.timestamp || '';
      else v = r.respuestas?.[c] ?? '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

// ── Socket ───────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Admin join
  socket.on('join_admin', () => {
    socket.join('admins');
    admins.add(socket.id);
    broadcast();
    socket.emit('respuestas_guardadas', respuestasFinales.length);
    socket.emit('examen_estado', { finalizado: examenFinalizado });
  });

  // Alumno registro
  socket.on('registrar_alumno', ({ nombre, cedula }) => {
    // Si ya existe una entrada con la misma cédula (reconexión), borrarla
    for (const [sid, a] of alumnos.entries()) {
      if (a.cedula === cedula.trim() && sid !== socket.id) {
        alumnos.delete(sid);
      }
    }
    alumnos.set(socket.id, {
      nombre: nombre.trim(),
      cedula: cedula.trim(),
      activo: true,
      alertas: [],       // siempre arranca limpio al reconectar
      progreso: 0,
      lastHeartbeat: Date.now(),
    });
    broadcast();
  });

  // Heartbeat
  socket.on('heartbeat', () => {
    const a = alumnos.get(socket.id);
    if (!a) return;
    a.activo = true;
    a.lastHeartbeat = Date.now();
    a.alertas = a.alertas.filter(x => x !== 'sin_heartbeat');
    broadcast();
  });

  // Cambio pestaña
  socket.on('cambio_pestana', ({ oculta }) => {
    const a = alumnos.get(socket.id);
    if (!a) return;
    if (oculta && !a.alertas.includes('cambio_pestana')) {
      a.alertas.push('cambio_pestana');
    }
    broadcast();
  });

  // Progreso del formulario
  socket.on('progreso', ({ pct }) => {
    const a = alumnos.get(socket.id);
    if (a) { a.progreso = pct; broadcast(); }
  });

  // Envío de respuestas
  socket.on('enviar_respuestas', ({ nombre, cedula, respuestas }) => {
    const entrada = {
      nombre,
      cedula,
      timestamp: new Date().toISOString(),
      respuestas,
    };
    // Reemplazar si ya existe (re-envío)
    const idx = respuestasFinales.findIndex(r => r.cedula === cedula);
    if (idx >= 0) respuestasFinales[idx] = entrada;
    else respuestasFinales.push(entrada);

    guardarJSON();

    const a = alumnos.get(socket.id);
    if (a) { a.progreso = 100; broadcast(); }
    io.to('admins').emit('respuestas_guardadas', respuestasFinales.length);
    socket.emit('respuestas_confirmadas');
  });

  // Admin: finalizar examen
  socket.on('finalizar_examen', () => {
    examenFinalizado = true;
    io.emit('examen_finalizado');
    broadcast();
  });

  // Admin: exportar CSV
  socket.on('exportar_csv', () => {
    const csv = generarCSV(respuestasFinales);
    socket.emit('csv_listo', { csv, total: respuestasFinales.length });
  });

  // Admin: exportar JSON
  socket.on('exportar_json', () => {
    socket.emit('json_listo', { data: respuestasFinales, total: respuestasFinales.length });
  });

  // Desconexión
  socket.on('disconnect', () => {
    if (alumnos.has(socket.id)) {
      const a = alumnos.get(socket.id);
      a.activo = false;
      if (!a.alertas.includes('sin_heartbeat')) a.alertas.push('sin_heartbeat');
      // Mantener en lista pero inactivo
      setTimeout(() => {
        alumnos.delete(socket.id);
        broadcast();
      }, 30000); // borramos después de 30s
      broadcast();
    }
    admins.delete(socket.id);
  });
});

// ── Heartbeat checker cada 5 s ───────────────────────────────────────────────
setInterval(() => {
  let changed = false;
  alumnos.forEach((a) => {
    if (a.activo && Date.now() - a.lastHeartbeat > 6000) {
      a.activo = false;
      if (!a.alertas.includes('sin_heartbeat')) { a.alertas.push('sin_heartbeat'); changed = true; }
    }
  });
  if (changed) broadcast();
}, 5000);

// ── Servir archivos estáticos ─────────────────────────────────────────────────
app.use(express.static(__dirname));

// ── Rutas ─────────────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'alumno.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'admin.html')));

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});