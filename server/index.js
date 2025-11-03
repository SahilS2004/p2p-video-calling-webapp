const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

// Get local network IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Handle root GET request
app.get('/', (req, res) => {
  res.json({
    message: 'P2P Video Calling - WebSocket Signaling Server',
    status: 'running',
    localIP: getLocalIP(),
    port: process.env.PORT || 3001,
    websocket: `ws://${getLocalIP()}:${process.env.PORT || 3001}`,
    info: 'This is a WebSocket signaling server for WebRTC peer connections. Connect using WebSocket protocol.'
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active connections
const clients = new Map();

// Broadcast to all clients
function broadcast(data, excludeClient = null) {
  wss.clients.forEach((client) => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  console.log(`Client connected: ${clientIP}`);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data.type);

      switch (data.type) {
        case 'register':
          // Register client with their local IP
          clients.set(ws, {
            id: data.id || Date.now().toString(),
            localIP: data.localIP,
            ready: false
          });
          ws.send(JSON.stringify({
            type: 'registered',
            serverIP: getLocalIP()
          }));
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          // Forward WebRTC signaling messages to specific peer
          if (data.targetIP) {
            const senderIP = clients.get(ws)?.localIP || 'unknown';
            let forwarded = false;
            wss.clients.forEach((client) => {
              const clientInfo = clients.get(client);
              if (clientInfo && clientInfo.localIP === data.targetIP && client !== ws) {
                client.send(JSON.stringify({
                  ...data,
                  fromIP: senderIP
                }));
                forwarded = true;
                console.log(`Forwarded ${data.type} from ${senderIP} to ${data.targetIP}`);
              }
            });
            if (!forwarded) {
              console.log(`Warning: Could not find peer with IP ${data.targetIP} to forward ${data.type}`);
            }
          }
          break;

        case 'disconnect':
          clients.delete(ws);
          broadcast({ type: 'peer-disconnected' }, ws);
          break;

        default:
          // Broadcast other messages
          broadcast(data, ws);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientIP}`);
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 3001;
const LOCAL_IP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Signaling server running:`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Network: http://${LOCAL_IP}:${PORT}\n`);
});

