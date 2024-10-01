// Importar las dependencias necesarias 
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)); // Para soportar ES Modules

// Crear la aplicación Express
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware para analizar JSON
app.use(bodyParser.json());

// Variables de entorno
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RAILWAY_URL = process.env.RAILWAY_URL || 'http://localhost:3000'; // Usa la URL de Railway en producción o localhost en desarrollo

// Crear un objeto para almacenar la información de los clientes
const clients = {};

// Función para enviar mensajes a Telegram
const sendToTelegram = (message) => {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
        }),
    })
    .then(response => response.json())
    .then(data => {
        if (!data.ok) {
            console.error("Error al enviar mensaje:", data);
        }
    })
    .catch(error => console.error("Error en la petición:", error));
};

// Endpoint para recibir mensajes de Telegram
app.post('/webhook', (req, res) => {
    const message = req.body.message;
    if (message && message.text) {
        const reply = `Internet ZD: ${message.text}`;
        io.emit('chat message', reply); // Enviar el mensaje al chat del portal
    }
    res.sendStatus(200);
});

// Servir los archivos estáticos desde la carpeta 'public'
app.use(express.static(__dirname + '/public'));

// Manejar nuevas conexiones de Socket.IO
io.on('connection', (socket) => {
    console.log('Un usuario se ha conectado');

    // Almacenar el nombre y CI del usuario cuando se envía la información
    socket.on('user data', (data) => {
        clients[socket.id] = data;
        console.log(`Usuario conectado: ${data.nombre}, CI: ${data.ci}`);
    });

    // Manejar los mensajes del chat
    socket.on('chat message', (msg) => {
        const user = clients[socket.id];
        const message = `${user.nombre} (${user.ci}): ${msg}`;
        console.log(message);

        // Enviar el mensaje a Telegram
        sendToTelegram(message);

        // Enviar el mensaje a todos los conectados
        io.emit('chat message', message);
    });

    // Manejar la desconexión del usuario
    socket.on('disconnect', () => {
        const user = clients[socket.id];
        if (user) {
            console.log(`Usuario desconectado: ${user.nombre}`);
            delete clients[socket.id];
        }
    });
});

// Iniciar el servidor en el puerto dinámico
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de chat escuchando en *:${PORT}`);
});

// Configurar el Webhook en Telegram
const setWebhook = async () => {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${RAILWAY_URL}/webhook`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log('Webhook establecido:', data);
    } catch (error) {
        console.error('Error al establecer el webhook:', error);
    }
};

// Llama a la función para establecer el Webhook
setWebhook().catch(console.error);
