/**
 * Notification Service
 * Dispatches alerts via Telegram Bot and WhatsApp (CallMeBot API)
 */

// ==================== TELEGRAM ====================

async function sendTelegramAlert({ botToken, chatId, title, product, store, newPrice, oldPrice, targetPrice, promoBadge }) {
  if (!botToken || !chatId) {
    return { success: false, reason: 'Telegram credentials missing' };
  }

  const savings = oldPrice && newPrice ? (oldPrice - newPrice).toFixed(2) : null;
  const savingsPercent = oldPrice && newPrice ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : null;

  let text = `🚨 *${title || '¡ALERTA DE PRECIO BAJO!'}* 🚨\n\n`;
  text += `📦 *Producto:* ${product.name}\n`;
  text += `🛒 *Supermercado:* ${store || 'Súper Selectos'}\n`;
  text += `💰 *Nuevo Precio:* *$${parseFloat(newPrice).toFixed(2)}*\n`;
  
  if (oldPrice && oldPrice > newPrice) {
    text += `🏷️ *Precio Anterior:* ~$${parseFloat(oldPrice).toFixed(2)}~\n`;
    text += `📉 *Ahorro:* $${savings} (${savingsPercent}% descuento)\n`;
  }
  
  if (targetPrice) {
    text += `🎯 *Tu Precio Objetivo:* $${parseFloat(targetPrice).toFixed(2)}\n`;
  }

  if (promoBadge) {
    text += `🔥 *Promoción:* ${promoBadge}\n`;
  }

  text += `\n⏱️ _Detectado por Preciazo SV a las ${new Date().toLocaleTimeString()}_`;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('[Notifier:Telegram] Error:', data.description);
      return { success: false, error: data.description };
    }

    console.log(`[Notifier:Telegram] Mensaje enviado a chat ${chatId}`);
    return { success: true };
  } catch (err) {
    console.error('[Notifier:Telegram] Error de red:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendTestTelegramMessage(botToken, chatId) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const text = `🎉 *¡Conexión Exitosa con Preciazo SV!* 🛒\n\n` +
               `Tu bot de Telegram ha sido configurado correctamente.\n` +
               `Recibirás alertas en cuanto tus productos favoritos de Súper Selectos y supermercados bajen de precio.\n\n` +
               `_Probado el ${new Date().toLocaleString()}_`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });

    const data = await response.json();
    return data;
  } catch (err) {
    return { ok: false, description: err.message };
  }
}

// ==================== WHATSAPP (CallMeBot API) ====================

function sanitizePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    // If user typed 503XXXXXXXX or 7XXXXXXX
    if (cleaned.startsWith('503')) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 8) {
      // Default to El Salvador (+503) if 8 digits
      cleaned = '+503' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

async function sendWhatsAppAlert({ phone, apiKey, title, product, store, newPrice, oldPrice, targetPrice, promoBadge }) {
  const sanitizedPhone = sanitizePhoneNumber(phone);
  if (!sanitizedPhone || !apiKey) {
    return { success: false, reason: 'WhatsApp credentials missing' };
  }

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

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(sanitizedPhone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey.trim())}`;

  try {
    const res = await fetch(url);
    const bodyText = await res.text();

    if (bodyText.includes('Message Queued') || bodyText.includes('Message Sent') || res.status === 200) {
      console.log(`[Notifier:WhatsApp] Alerta enviada a ${sanitizedPhone}`);
      return { success: true };
    } else {
      console.warn(`[Notifier:WhatsApp] Respuesta inesperada:`, bodyText);
      return { success: false, error: bodyText };
    }
  } catch (err) {
    console.error('[Notifier:WhatsApp] Error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendTestWhatsAppMessage(phone, apiKey) {
  const sanitizedPhone = sanitizePhoneNumber(phone);
  if (!sanitizedPhone || !apiKey) {
    return { ok: false, error: 'Por favor ingresa un número de teléfono válido y la API Key' };
  }

  const text = `*🎉 ¡Conexión Exitosa con Preciazo SV!* 🛒\n\n` +
               `Tu WhatsApp ha sido configurado correctamente para recibir alertas.\n` +
               `A partir de ahora te notificaremos cuando tus productos favoritos bajen de precio o entren en oferta.\n\n` +
               `_Probado el ${new Date().toLocaleString()}_`;

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(sanitizedPhone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey.trim())}`;

  try {
    const res = await fetch(url);
    const bodyText = await res.text();

    if (bodyText.includes('Message Queued') || bodyText.includes('Message Sent') || (res.ok && !bodyText.toLowerCase().includes('error'))) {
      return { ok: true, phone: sanitizedPhone };
    } else {
      return { ok: false, error: bodyText || 'No se pudo enviar el mensaje a WhatsApp' };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendTelegramAlert,
  sendTestTelegramMessage,
  sendWhatsAppAlert,
  sendTestWhatsAppMessage,
  sanitizePhoneNumber
};
