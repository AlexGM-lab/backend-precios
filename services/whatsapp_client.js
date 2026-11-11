/**
 * WhatsApp Multi-Device Direct Client (via Baileys)
 * Connects directly using WhatsApp Web QR Code - Zero third party bots needed!
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, '..', 'data', 'whatsapp_auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

let sock = null;
let currentQrDataUrl = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'QR_READY' | 'CONNECTING' | 'CONNECTED'
let connectedUser = null;
let qrTimeout = null;

async function initWhatsApp(forceNewSession = false) {
  if (forceNewSession) {
    if (sock) {
      try { sock.logout(); } catch (e) {}
      sock = null;
    }
    // Clear auth dir
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  connectionStatus = 'CONNECTING';

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state,
    browser: ['Preciazo SV', 'Chrome', '122.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('[WhatsApp] 📱 Nuevo código QR generado. Listo para escanear.');
      try {
        currentQrDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
        connectionStatus = 'QR_READY';
      } catch (err) {
        console.error('[WhatsApp] Error convirtiendo QR a imagen:', err);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[WhatsApp] Conexión cerrada. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);

      connectionStatus = 'DISCONNECTED';
      currentQrDataUrl = null;
      connectedUser = null;

      if (shouldReconnect) {
        // Auto-reconnect after 3 seconds
        setTimeout(() => initWhatsApp(false), 3000);
      }
    } else if (connection === 'open') {
      console.log('[WhatsApp] 🟢 ¡Conectado exitosamente con WhatsApp Web!');
      connectionStatus = 'CONNECTED';
      currentQrDataUrl = null;

      const userJid = sock.user?.id || '';
      const phoneNumber = userJid.split(':')[0].replace('@s.whatsapp.net', '');
      connectedUser = {
        jid: userJid,
        phone: phoneNumber,
        name: sock.user?.name || 'Mi WhatsApp'
      };
      console.log(`[WhatsApp] Sesión activa como: +${phoneNumber}`);
    }
  });

  return sock;
}

function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    isConnected: connectionStatus === 'CONNECTED',
    hasQr: connectionStatus === 'QR_READY' && !!currentQrDataUrl,
    qrDataUrl: currentQrDataUrl,
    user: connectedUser
  };
}

async function sendDirectWhatsAppMessage(targetPhone, text) {
  if (connectionStatus !== 'CONNECTED' || !sock) {
    return { ok: false, error: 'WhatsApp no está vinculado. Por favor escanea el código QR primero.' };
  }

  try {
    let jid;
    if (!targetPhone || targetPhone.trim() === '') {
      // Send to self (Notes to self chat)
      jid = sock.user.id;
      if (jid.includes(':')) {
        const parts = jid.split(':');
        jid = parts[0] + '@s.whatsapp.net';
      }
    } else {
      // Clean phone number
      const cleanPhone = targetPhone.replace(/[^\d]/g, '');
      jid = `${cleanPhone}@s.whatsapp.net`;
    }

    const sent = await sock.sendMessage(jid, { text });
    return { ok: true, messageId: sent?.key?.id, jid };
  } catch (err) {
    console.error('[WhatsApp] Error enviando mensaje directo:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendDirectWhatsAppAlert({ targetPhone, title, product, store, newPrice, oldPrice, targetPrice, promoBadge }) {
  const savings = oldPrice && newPrice ? (oldPrice - newPrice).toFixed(2) : null;
  const savingsPercent = oldPrice && newPrice ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : null;

  let text = `*🚨 ${title || '¡ALERTA DE PRECIO BAJO!'} 🚨*\n\n`;
  text += `*Producto:* ${product.name}\n`;
  text += `*Supermercado:* ${store || 'Súper Selectos'}\n`;
  text += `*Nuevo Precio:* $${parseFloat(newPrice).toFixed(2)}\n`;

  if (oldPrice && oldPrice > newPrice) {
    text += `*Precio Anterior:* ~$${parseFloat(oldPrice).toFixed(2)}~\n`;
    text += `*Ahorro:* $${savings} (${savingsPercent}% descuento)\n`;
  }

  if (targetPrice) {
    text += `*Tu Precio Objetivo:* $${parseFloat(targetPrice).toFixed(2)}\n`;
  }

  if (promoBadge) {
    text += `*Promoción:* ${promoBadge}\n`;
  }

  text += `\n⏱️ _Detectado por Preciazo SV a las ${new Date().toLocaleTimeString()}_`;

  return await sendDirectWhatsAppMessage(targetPhone, text);
}

async function disconnectWhatsApp() {
  if (sock) {
    try { await sock.logout(); } catch (e) {}
    sock = null;
  }
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
  connectionStatus = 'DISCONNECTED';
  currentQrDataUrl = null;
  connectedUser = null;
  return { ok: true };
}

module.exports = {
  initWhatsApp,
  getWhatsAppStatus,
  sendDirectWhatsAppMessage,
  sendDirectWhatsAppAlert,
  disconnectWhatsApp
};

