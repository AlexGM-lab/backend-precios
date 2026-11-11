const fs = require('fs');
const path = require('path');

const rawProducts = JSON.parse(fs.readFileSync('superselectos_extracted.json', 'utf8'));

// Helper to sanitize image path
function getLocalImagePath(imgSrc) {
  if (!imgSrc) return null;
  // Match content(X) or content
  const match = imgSrc.match(/content(?:\((\d+)\))?/);
  if (match) {
    const num = match[1];
    return num ? `/product_images/content_${num}.jpg` : '/product_images/content.jpg';
  }
  return null;
}

// Generate realistic comparative prices for other supermarkets (Walmart, Maxi Despensa)
// based on typical Salvadoran market margins
function generateSupermarketPrices(selectosPrice, selectosOldPrice, index) {
  const basePrice = selectosOldPrice || selectosPrice;

  // Store 1: Súper Selectos (using actual extracted data)
  const selectos = {
    supermarket: 'Súper Selectos',
    slug: 'selectos',
    logo: '🟢',
    currentPrice: selectosPrice,
    regularPrice: selectosOldPrice || selectosPrice,
    isOffer: !!selectosOldPrice || false,
    discountPercent: selectosOldPrice ? Math.round(((selectosOldPrice - selectosPrice) / selectosOldPrice) * 100) : 0,
    stock: true,
    lastUpdated: new Date().toISOString()
  };

  // Store 2: Walmart El Salvador (often competitive on staples, sometimes higher on snacks)
  // Slight variance: -6% to +8%
  const walmartDelta = (index % 3 === 0) ? -0.10 : (index % 3 === 1 ? 0.05 : -0.05);
  let walmartPrice = +(basePrice * (1 + walmartDelta)).toFixed(2);
  const walmartIsOffer = index % 4 === 0;
  const walmartRegularPrice = walmartIsOffer ? +(walmartPrice * 1.15).toFixed(2) : walmartPrice;
  if (walmartIsOffer) walmartPrice = +(walmartRegularPrice * 0.85).toFixed(2);

  const walmart = {
    supermarket: 'Walmart',
    slug: 'walmart',
    logo: '🔵',
    currentPrice: Math.max(0.35, walmartPrice),
    regularPrice: Math.max(0.35, walmartRegularPrice),
    isOffer: walmartIsOffer,
    discountPercent: walmartIsOffer ? 15 : 0,
    stock: true,
    lastUpdated: new Date().toISOString()
  };

  // Store 3: Maxi Despensa (discount store, usually competitive)
  const maxiDelta = (index % 2 === 0) ? -0.08 : 0.03;
  let maxiPrice = +(basePrice * (1 + maxiDelta)).toFixed(2);
  const maxiIsOffer = index % 5 === 0;
  const maxiRegularPrice = maxiIsOffer ? +(maxiPrice * 1.12).toFixed(2) : maxiPrice;
  if (maxiIsOffer) maxiPrice = +(maxiRegularPrice * 0.88).toFixed(2);

  const maxiDespensa = {
    supermarket: 'Maxi Despensa',
    slug: 'maxi-despensa',
    logo: '🔴',
    currentPrice: Math.max(0.30, maxiPrice),
    regularPrice: Math.max(0.30, maxiRegularPrice),
    isOffer: maxiIsOffer,
    discountPercent: maxiIsOffer ? 12 : 0,
    stock: index % 7 !== 0, // occasional out of stock
    lastUpdated: new Date().toISOString()
  };

  return [selectos, walmart, maxiDespensa];
}

// Generate 30-day price history to display "Altas y Bajas" charts
function generatePriceHistory(currentPrice, regularPrice) {
  const history = [];
  const today = new Date();
  
  // 6 sample points over the past 30 days: 30d ago, 24d ago, 18d ago, 12d ago, 6d ago, today
  const intervals = [30, 24, 18, 12, 6, 0];
  
  for (let i = 0; i < intervals.length; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - intervals[i]);
    const dateStr = d.toISOString().split('T')[0];

    let p = regularPrice;
    if (i === intervals.length - 1) {
      // Today
      p = currentPrice;
    } else if (i === intervals.length - 2 && currentPrice < regularPrice) {
      // 6 days ago maybe started drop
      p = +(currentPrice * 1.05).toFixed(2);
    } else {
      // Random historical fluctuation of +/- 3%
      const jitter = (Math.sin(i) * 0.04);
      p = +(regularPrice * (1 + jitter)).toFixed(2);
    }

    history.push({
      date: dateStr,
      price: Math.max(0.25, p)
    });
  }

  return history;
}

const masterProducts = rawProducts.map((p, index) => {
  const imageLocal = getLocalImagePath(p.image);
  const storePrices = generateSupermarketPrices(p.price, p.oldPrice, index);

  // Find lowest price among supermarkets
  const availableStores = storePrices.filter(s => s.stock);
  const lowestStore = availableStores.reduce((min, s) => s.currentPrice < min.currentPrice ? s : min, availableStores[0]);
  const highestStore = availableStores.reduce((max, s) => s.currentPrice > max.currentPrice ? s : max, availableStores[0]);
  const maxSavings = +(highestStore.currentPrice - lowestStore.currentPrice).toFixed(2);
  const maxSavingsPercent = Math.round((maxSavings / highestStore.currentPrice) * 100);

  // Determine trend: "BAJA" if current < oldPrice or lowest is on offer, "ALTA" if current > regular, else "ESTABLE"
  let trend = 'ESTABLE';
  if (p.oldPrice && p.price < p.oldPrice) {
    trend = 'BAJA';
  } else if (index % 8 === 0) {
    trend = 'ALTA';
  }

  // Price history
  const priceHistory = generatePriceHistory(p.price, p.oldPrice || p.price);

  return {
    id: `prod_${p.id || index + 1}`,
    externalId: p.id,
    name: p.name,
    category: p.category || 'General',
    image: imageLocal || '/product_images/ImageNotAvailable.png',
    promoBadge: p.promoBadge || null,
    stores: storePrices,
    bestPrice: lowestStore.currentPrice,
    bestStore: lowestStore.supermarket,
    maxSavings,
    maxSavingsPercent,
    trend,
    history: priceHistory,
    createdAt: new Date().toISOString()
  };
});

// Initial sample favorites and alerts
const favorites = [
  {
    productId: masterProducts[0]?.id || 'prod_3267',
    targetPrice: 2.00,
    notifyOnOffer: true,
    addedAt: new Date().toISOString()
  },
  {
    productId: masterProducts[15]?.id || 'prod_14785',
    targetPrice: 1.40,
    notifyOnOffer: true,
    addedAt: new Date().toISOString()
  }
];

// Initial notifications generated for user
const notifications = [
  {
    id: 'notif_1',
    productId: masterProducts[15]?.id || 'prod_14785',
    productName: masterProducts[15]?.name || 'Platanos Con Chile Limon Y Sal Zambos Yummies',
    title: '🎉 ¡Baja de precio detectada!',
    message: 'Bajó a $1.35 en Súper Selectos (Antes $1.68, ahorro de 20%). ¡Cumple tu alerta de $1.40!',
    date: new Date().toISOString(),
    read: false,
    type: 'price_drop'
  },
  {
    id: 'notif_2',
    productId: masterProducts[11]?.id || 'prod_101682',
    productName: masterProducts[11]?.name || 'Leche Liquida Dos Pinos Con Avena 1 L Uht',
    title: '🏷️ Oferta especial activa',
    message: 'Nueva promoción disponible: "Seleccione 2X$3.25" en Súper Selectos.',
    date: new Date(Date.now() - 3600000 * 4).toISOString(),
    read: false,
    type: 'deal'
  }
];

const db = {
  products: masterProducts,
  favorites,
  notifications,
  settings: {
    alertThresholdPercent: 10,
    supermarkets: ['Súper Selectos', 'Walmart', 'Maxi Despensa'],
    lastScraped: new Date().toISOString()
  }
};

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db, null, 2));
console.log(`Successfully generated database with ${masterProducts.length} master products in data/db.json!`);

