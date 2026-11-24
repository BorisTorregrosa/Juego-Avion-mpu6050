const http = require('http');
const { WebSocketServer } = require('ws');

const PUERTO = process.env.PORT || 3000;
const CLAVE = process.env.SENSOR_KEY || 'cambia-esta-clave';

// Servidor web simple: sirve para comprobar que Render esta despierto
const servidor = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Servidor del avion activo');
});

const wss = new WebSocketServer({ noServer: true });
let sensor = null;          // la conexion del ESP32
const juegos = new Set();   // las conexiones de los juegos/paginas abiertas

function enviar(ws, texto) {
  if (ws.readyState === 1) ws.send(texto);
}

function estadoSensor() {
  return JSON.stringify({ estado: 'sensor', conectado: sensor !== null });
}

function avisarEstado() {
  const msg = estadoSensor();
  juegos.forEach((j) => enviar(j, msg));
}

// Aqui se decide quien puede entrar
servidor.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const rol = url.searchParams.get('role');
  if (rol === 'sensor' && url.searchParams.get('key') !== CLAVE) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.rol = rol === 'sensor' ? 'sensor' : 'juego';
    wss.emit('connection', ws);
  });
});

wss.on('connection', (ws) => {
  if (ws.rol === 'sensor') {
    if (sensor) sensor.close();   // si ya habia un ESP32, lo reemplazamos
    sensor = ws;
    console.log('Sensor conectado');
    avisarEstado();

    // Todo lo que manda el ESP32 se reenvia a los juegos
    ws.on('message', (datos) => {
      const texto = datos.toString();
      juegos.forEach((j) => enviar(j, texto));
    });

    ws.on('close', () => {
      if (sensor === ws) {
        sensor = null;
        console.log('Sensor desconectado');
        avisarEstado();
      }
    });
  } else {
    juegos.add(ws);
    console.log('Juego conectado. Total:', juegos.size);
    enviar(ws, estadoSensor());   // le contamos si el ESP32 ya esta conectado

    // Si el juego manda "cal", se lo pasamos al ESP32 para que calibre
    ws.on('message', (datos) => {
      if (datos.toString() === 'cal' && sensor) enviar(sensor, 'cal');
    });

    ws.on('close', () => {
      juegos.delete(ws);
      console.log('Juego desconectado. Total:', juegos.size);
    });
  }
});

servidor.listen(PUERTO, () => {
  console.log('Servidor escuchando en el puerto', PUERTO);
});