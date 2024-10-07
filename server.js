// Importar las dependencias necesarias  
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');

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
const clientTelegramMap = {}; // Mapeo entre usuarios y mensajes en Telegram

// Ruta para almacenar los historiales de chat
const historyFilePath = path.join(__dirname, 'chatHistory.json');

// Función para leer el historial desde el archivo JSON
const readChatHistory = () => {
    if (fs.existsSync(historyFilePath)) {
        const data = fs.readFileSync(historyFilePath, 'utf8');
        return JSON.parse(data);
    }
    return {};
};

// Función para guardar el historial en el archivo JSON
const saveChatHistory = (history) => {
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));
};

// Función para enviar mensajes a Telegram
const sendToTelegram = (message, clientId) => {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            reply_markup: {
                force_reply: true,
                selective: true,
            }
        }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.ok) {
            // Asociar el mensaje enviado a Telegram con el cliente que lo envió
            clientTelegramMap[data.result.message_id] = clientId;
        } else {
            console.error("Error al enviar mensaje a Telegram:", data);
        }
    })
    .catch(error => console.error("Error en la petición a Telegram:", error));
};

// Endpoint para recibir mensajes de Telegram
app.post('/webhook', (req, res) => {
    const message = req.body.message;

    if (message && message.text && message.reply_to_message) {
        // Si el mensaje es una respuesta en Telegram
        const repliedMessageId = message.reply_to_message.message_id;

        // Verificar si estamos respondiendo a un mensaje de un cliente
        const clientId = clientTelegramMap[repliedMessageId];

        if (clientId) {
            const reply = `Soporte: ${message.text}`;

            // Enviar el mensaje solo al cliente que envió el mensaje original
            const destinatarioSocketId = Object.keys(clients).find(socketId => clients[socketId].ci === clientId);

            if (destinatarioSocketId) {
                io.to(destinatarioSocketId).emit('chat message', reply);

                // Guardar el mensaje en el historial del cliente
                saveMessageToHistory(clientId, reply);
            }
        }
    }

    res.sendStatus(200);
});

// Servir los archivos estáticos desde la carpeta 'public'
app.use(express.static(__dirname + '/public'));

// Manejar nuevas conexiones de Socket.IO
io.on('connection', (socket) => {
    console.log('Un usuario se ha conectado');

    // Leer el historial de chat desde el archivo
    let chatHistory = readChatHistory();

    // Almacenar el nombre y CI del usuario cuando se envía la información
    socket.on('user data', (data) => {
        clients[socket.id] = data;
        console.log(`Usuario conectado: ${data.nombre}, CI: ${data.ci}`);

        // Enviar el historial al usuario cuando se conecta, usando su CI
        if (chatHistory[data.ci]) {
            console.log(`Enviando historial de mensajes para el CI: ${data.ci}`);
            socket.emit('load history', chatHistory[data.ci]);
        } else {
            console.log(`No se encontró historial para el CI: ${data.ci}`);
        }
    });

    // Manejar los mensajes del chat
    socket.on('chat message', (msg) => {
        const user = clients[socket.id];
        const message = `${user.nombre} (${user.ci}): ${msg}`;
        console.log(message);

        // Enviar el mensaje a Telegram
        sendToTelegram(message, user.ci);

        // Guardar el mensaje enviado en el historial
        saveMessageToHistory(user.ci, message);

        // (Opcional) Si quieres seguir enviando a todos para pruebas o desarrollo
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

// Función para guardar un mensaje en el historial (ahora usando CI en vez de socketId)
const saveMessageToHistory = (clientId, message) => {
    let chatHistory = readChatHistory();
    if (!chatHistory[clientId]) {
        chatHistory[clientId] = [];
    }
    chatHistory[clientId].push(message);
    saveChatHistory(chatHistory); // Guardar el historial actualizado
};

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
