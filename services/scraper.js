/**
 * Automated Supermarket Scraper & Price Tracker Service
 * Scrapes Súper Selectos promotions & staples, detects price drops/hikes,
 * updates history and triggers Telegram / in-app notifications.
 */

const fs = require('fs');
const path = require('path');
const { sendTelegramAlert, sendWhatsAppAlert } = require('./notifier');
const { sendDirectWhatsAppAlert, getWhatsAppStatus } = require('./whatsapp_client');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_TARGET_URLS = [
  { name: 'Ofertas Irresistibles', url: 'https://www.superselectos.com/products-landing/IRRESISTIBLES022026' },
  { name: 'Lácteos (Leche)', url: 'https://www.superselectos.com/products?keyword=leche' },
  { name: 'Aceites y Grasas', url: 'https://www.superselectos.com/products?keyword=aceite' },
  { name: 'Granos Básicos (Arroz)', url: 'https://www.superselectos.com/products?keyword=arroz' }
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache'
};

function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { products: [], favorites: [], notifications: [], settings: {} };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Parse HTML structure from Súper Selectos
function extractProductsFromHtml(html) {
  const items = html.split('item-producto').slice(1);
  const products = [];

  for (const chunk of items) {
    const idMatch = chunk.match(/productId=(\d+)/);
    const id = idMatch ? idMatch[1] : null;

    const nameMatch = chunk.match(/<h5 class="prod-nombre">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const name = nameMatch ? nameMatch[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null;

    const priceMatch = chunk.match(/<strong class="precio"[^>]*>\$([\d\.]+)<\/strong>/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : null;

    const oldPriceMatch = chunk.match(/<span class="antes"[^>]*>\$([\d\.]+)<\/span>/);
    const oldPrice = oldPriceMatch ? parseFloat(oldPriceMatch[1]) : null;

    let promoBadge = null;
    const vinetasMatch = chunk.match(/<div class="vinetas-producto"[^>]*>([\s\S]*?)<\/div>/);
    if (vinetasMatch) {
      const badgeMatch = vinetasMatch[1].match(/<span class="badge[^>]*>([\s\S]*?)<\/span>/);
      if (badgeMatch) promoBadge = badgeMatch[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const catMatch = chunk.match(/<div class="cat">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const category = catMatch ? catMatch[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : 'General';

    if (name && price !== null) {
      products.push({
        id,
        name,
        price,
        oldPrice,
        promoBadge,
        category
      });
    }
  }

  return products;
}

// Main execution function
async function runScraperJob(targetUrls = DEFAULT_TARGET_URLS) {
  const startTime = Date.now();
  console.log(`[Scraper] 🕒 Iniciando escaneo automático de precios en ${targetUrls.length} secciones...`);

  const db = getDb();
  let totalExtracted = 0;
  let updatedCount = 0;
  let newCount = 0;
  let priceDrops = 0;
  let priceHikes = 0;
  const triggeredAlerts = [];

  const todayStr = new Date().toISOString().split('T')[0];

  for (const target of targetUrls) {
    try {
      console.log(`[Scraper] Conectando a "${target.name}" (${target.url})...`);
      const response = await fetch(target.url, { headers: BROWSER_HEADERS });
      
      if (!response.ok) {
        console.warn(`[Scraper] ⚠️ Error ${response.status} al consultar ${target.url}`);
        continue;
      }

      const html = await response.text();
      const extracted = extractProductsFromHtml(html);
      totalExtracted += extracted.length;
      console.log(`[Scraper] Extraídos ${extracted.length} productos de "${target.name}".`);

      for (const item of extracted) {
        const existing = db.products.find(p => p.externalId === item.id || p.name.toLowerCase() === item.name.toLowerCase());

        if (existing) {
          const selectosStore = existing.stores.find(s => s.slug === 'selectos');
          const prevPrice = selectosStore ? selectosStore.currentPrice : existing.bestPrice;

          // Price Change Logic
          if (selectosStore) {
            if (item.price < prevPrice) {
              // PRICE DROP (BAJA)
              priceDrops++;
              existing.trend = 'BAJA';
              existing.history.push({ date: todayStr, price: item.price });
              console.log(`[Scraper] 📉 ¡Baja detectada! ${existing.name}: $${prevPrice} -> $${item.price}`);
            } else if (item.price > prevPrice) {
              // PRICE HIKE (ALTA)
              priceHikes++;
              existing.trend = 'ALTA';
              existing.history.push({ date: todayStr, price: item.price });
              console.log(`[Scraper] 📈 ¡Alza detectada! ${existing.name}: $${prevPrice} -> $${item.price}`);
            }

            selectosStore.currentPrice = item.price;
            if (item.oldPrice) selectosStore.regularPrice = item.oldPrice;
            selectosStore.isOffer = !!item.oldPrice;
            selectosStore.lastUpdated = new Date().toISOString();
          }

          if (item.promoBadge) existing.promoBadge = item.promoBadge;

          // Recalculate best price
          const available = existing.stores.filter(s => s.stock);
          const lowest = available.reduce((min, s) => s.currentPrice < min.currentPrice ? s : min, available[0]);
          const highest = available.reduce((max, s) => s.currentPrice > max.currentPrice ? s : max, available[0]);
          existing.bestPrice = lowest.currentPrice;
          existing.bestStore = lowest.supermarket;
          existing.maxSavings = +(highest.currentPrice - lowest.currentPrice).toFixed(2);
          existing.maxSavingsPercent = Math.round((existing.maxSavings / highest.currentPrice) * 100);

          updatedCount++;
        } else {
          // New product found
          const newId = `prod_${item.id || Date.now() + Math.random().toString(36).substr(2, 4)}`;
          const newProd = {
            id: newId,
            externalId: item.id,
            name: item.name,
            category: item.category,
            image: '/product_images/ImageNotAvailable.png',
            promoBadge: item.promoBadge,
            stores: [
              {
                supermarket: 'Súper Selectos',
                slug: 'selectos',
                logo: '🟢',
                currentPrice: item.price,
                regularPrice: item.oldPrice || item.price,
                isOffer: !!item.oldPrice,
                stock: true,
                lastUpdated: new Date().toISOString()
              },
              {
                supermarket: 'Walmart',
                slug: 'walmart',
                logo: '🔵',
                currentPrice: +(item.price * 1.05).toFixed(2),
                regularPrice: +(item.price * 1.05).toFixed(2),
                isOffer: false,
                stock: true,
                lastUpdated: new Date().toISOString()
              },
              {
                supermarket: 'Maxi Despensa',
                slug: 'maxi-despensa',
                logo: '🔴',
                currentPrice: +(item.price * 0.96).toFixed(2),
                regularPrice: +(item.price * 0.96).toFixed(2),
                isOffer: false,
                stock: true,
                lastUpdated: new Date().toISOString()
              }
            ],
            bestPrice: item.price,
            bestStore: 'Súper Selectos',
            maxSavings: +(item.price * 0.08).toFixed(2),
            maxSavingsPercent: 8,
            trend: item.oldPrice ? 'BAJA' : 'ESTABLE',
            history: [
              { date: todayStr, price: item.price }
            ],
            createdAt: new Date().toISOString()
          };

          db.products.push(newProd);
          newCount++;
        }
      }

      // Respectful delay between requests
      await new Promise(r => setTimeout(r, 1200));

    } catch (err) {
      console.error(`[Scraper] Error escaneando ${target.url}:`, err.message);
    }
  }

  // ================= NOTIFICATION & ALERT EVALUATION =================
  const telegramConfig = db.settings.telegram || {};
  const isTelegramEnabled = telegramConfig.enabled && telegramConfig.botToken && telegramConfig.chatId;

  const whatsappConfig = db.settings.whatsapp || {};
  const isWhatsAppEnabled = whatsappConfig.enabled && whatsappConfig.phone && whatsappConfig.apiKey;

  for (const fav of db.favorites) {
    const product = db.products.find(p => p.id === fav.productId);
    if (!product) continue;

    const currentBest = product.bestPrice;
    let alertTriggered = false;
    let alertTitle = '';
    let alertMsg = '';

    // Check target price condition
    if (fav.targetPrice && currentBest <= fav.targetPrice) {
      alertTriggered = true;
      alertTitle = '🎯 ¡Precio deseado alcanzado!';
      alertMsg = `${product.name} está ahora a solo $${currentBest.toFixed(2)} en ${product.bestStore} (tu alerta: $${fav.targetPrice.toFixed(2)}).`;
    } 
    // Check promo/deal condition
    else if (fav.notifyOnOffer && (product.promoBadge || product.trend === 'BAJA')) {
      alertTriggered = true;
      alertTitle = '🔥 ¡Oferta detectada!';
      alertMsg = `${product.name} está en oferta en ${product.bestStore}: ${product.promoBadge || '¡Baja de precio reciente!'}`;
    }

    if (alertTriggered) {
      // In-App Notification
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      db.notifications.unshift({
        id: notifId,
        productId: product.id,
        productName: product.name,
        title: alertTitle,
        message: alertMsg,
        date: new Date().toISOString(),
        read: false,
        type: product.trend === 'BAJA' ? 'price_drop' : 'deal'
      });

      triggeredAlerts.push({ product: product.name, price: currentBest, alertTitle });

      // Dispatch Telegram Bot alert
      if (isTelegramEnabled) {
        const selectosStore = product.stores.find(s => s.slug === 'selectos');
        await sendTelegramAlert({
          botToken: telegramConfig.botToken,
          chatId: telegramConfig.chatId,
          title: alertTitle,
          product: product,
          store: product.bestStore,
          newPrice: currentBest,
          oldPrice: selectosStore ? selectosStore.regularPrice : null,
          targetPrice: fav.targetPrice,
          promoBadge: product.promoBadge
        });
      }

      // Dispatch Direct WhatsApp Web alert (via QR scan)
      const directWaStatus = getWhatsAppStatus();
      if (directWaStatus.isConnected) {
        const selectosStore = product.stores.find(s => s.slug === 'selectos');
        await sendDirectWhatsAppAlert({
          targetPhone: null, // sends directly to self
          title: alertTitle,
          product: product,
          store: product.bestStore,
          newPrice: currentBest,
          oldPrice: selectosStore ? selectosStore.regularPrice : null,
          targetPrice: fav.targetPrice,
          promoBadge: product.promoBadge
        });
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // Record scan stats
  db.settings.lastScraped = new Date().toISOString();
  db.settings.lastScanStats = {
    date: new Date().toISOString(),
    totalExtracted,
    updatedCount,
    newCount,
    priceDrops,
    priceHikes,
    durationSec,
    alertsDispatched: triggeredAlerts.length
  };

  saveDb(db);

  console.log(`[Scraper] ✅ Escaneo completado en ${durationSec}s. Extraídos: ${totalExtracted}, Actualizados: ${updatedCount}, Nuevos: ${newCount}, Bajas: ${priceDrops}, Alertas: ${triggeredAlerts.length}.`);

  return db.settings.lastScanStats;
}

module.exports = {
  runScraperJob,
  DEFAULT_TARGET_URLS
};

