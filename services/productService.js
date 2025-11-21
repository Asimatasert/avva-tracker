const db = require('../config/db');

// Kategori kaydet veya güncelle
async function upsertCategory(categoryData) {
  const { categoryId, slug, name, url } = categoryData;

  const existing = await db.findOne('categories', { category_id: categoryId });

  if (existing) {
    return await db.update('categories',
      { slug, name, url },
      { category_id: categoryId }
    );
  }

  return await db.create('categories', {
    category_id: categoryId,
    slug,
    name,
    url
  });
}

// Ürün kaydet veya güncelle
async function upsertProduct(productData, categoryDbId) {
  const {
    productId,
    stockCode,
    barcode,
    name,
    brand,
    url,
    imageThumbPath,
    productCartPrice,
    productPriceOriginal,
    discountRate,
    inStock,
    totalStockAmount,
    variantCount
  } = productData;

  const existing = await db.findOne('products', { product_id: productId });

  const productRecord = {
    stock_code: stockCode,
    barcode: barcode,
    name: name,
    brand: brand || 'AVVA',
    category_id: categoryDbId,
    url: url,
    image_url: imageThumbPath,
    current_price: productCartPrice,
    original_price: productPriceOriginal || productCartPrice,
    discount_rate: discountRate || 0,
    in_stock: inStock,
    total_stock: totalStockAmount || 0,
    variant_count: variantCount || 0,
    last_seen_at: new Date()
  };

  if (existing) {
    // Ürün mevcut - güncelle
    const updated = await db.update('products', productRecord, { product_id: productId });
    return {
      product: updated,
      isNew: false,
      previousPrice: existing.current_price,
      previousInStock: existing.in_stock
    };
  }

  // Yeni ürün
  productRecord.product_id = productId;
  productRecord.first_seen_at = new Date();
  const created = await db.create('products', productRecord);
  return { product: created, isNew: true, previousPrice: null };
}

// Fiyat geçmişine kaydet
async function recordPriceHistory(productDbId, price, originalPrice, discountRate) {
  // Son kaydı kontrol et - aynı fiyatsa kaydetme
  const lastRecord = await db.query(
    `SELECT price FROM price_history
     WHERE product_id = $1
     ORDER BY recorded_at DESC LIMIT 1`,
    [productDbId]
  );

  if (lastRecord.length > 0 && parseFloat(lastRecord[0].price) === parseFloat(price)) {
    return null; // Fiyat değişmemiş
  }

  return await db.create('price_history', {
    product_id: productDbId,
    price,
    original_price: originalPrice,
    discount_rate: discountRate || 0
  });
}

// Stok geçmişine kaydet
async function recordStockHistory(productDbId, totalStock, inStock) {
  // Son kaydı kontrol et
  const lastRecord = await db.query(
    `SELECT total_stock, in_stock FROM stock_history
     WHERE product_id = $1
     ORDER BY recorded_at DESC LIMIT 1`,
    [productDbId]
  );

  if (lastRecord.length > 0 &&
      parseInt(lastRecord[0].total_stock) === parseInt(totalStock) &&
      lastRecord[0].in_stock === inStock) {
    return null; // Stok değişmemiş
  }

  return await db.create('stock_history', {
    product_id: productDbId,
    total_stock: totalStock,
    in_stock: inStock
  });
}

// Varyant stoklarını kaydet
async function recordVariantStocks(productDbId, variantTypeValues) {
  if (!variantTypeValues || variantTypeValues.length === 0) return;

  for (const variant of variantTypeValues) {
    const color = variant.name;
    const subVariants = variant.subVariantValues || [];

    for (const sub of subVariants) {
      await db.create('variant_stocks', {
        product_id: productDbId,
        color: color,
        size: sub.name,
        stock_amount: sub.stockAmount || 0
      });
    }
  }
}

// Scrape log başlat
async function startScrapeLog(categoryId) {
  return await db.create('scrape_logs', {
    category_id: categoryId,
    status: 'running'
  });
}

// Scrape log tamamla
async function completeScrapeLog(logId, stats) {
  return await db.update('scrape_logs', {
    products_found: stats.found,
    products_updated: stats.updated,
    products_new: stats.new,
    duration_ms: stats.duration,
    status: stats.error ? 'error' : 'success',
    error_message: stats.error || null,
    completed_at: new Date()
  }, { id: logId });
}

// Kategori ID'sini DB ID'sine çevir
async function getCategoryDbId(categoryId) {
  const cat = await db.findOne('categories', { category_id: categoryId });
  return cat ? cat.id : null;
}

// Fiyat değişikliklerini getir
async function getPriceChanges(since = null) {
  let query = `
    SELECT
      p.id, p.name, p.stock_code, p.current_price, p.url,
      ph.price as previous_price,
      p.current_price - ph.price as price_change,
      ROUND(((p.current_price - ph.price) / ph.price * 100)::numeric, 2) as change_percent
    FROM products p
    INNER JOIN LATERAL (
      SELECT price FROM price_history
      WHERE product_id = p.id
      ORDER BY recorded_at DESC
      OFFSET 1 LIMIT 1
    ) ph ON true
    WHERE p.current_price != ph.price
  `;

  if (since) {
    query += ` AND p.updated_at > $1`;
    return await db.query(query, [since]);
  }

  return await db.query(query);
}

// Tüm kategorileri getir
async function getAllCategories() {
  return await db.findAll('categories', { is_active: true });
}

// İstatistikler
async function getStats() {
  const [products, categories, priceRecords] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM products'),
    db.query('SELECT COUNT(*) as count FROM categories'),
    db.query('SELECT COUNT(*) as count FROM price_history')
  ]);

  return {
    totalProducts: parseInt(products[0].count),
    totalCategories: parseInt(categories[0].count),
    totalPriceRecords: parseInt(priceRecords[0].count)
  };
}

// Trendyol fiyatını güncelle
async function updateTrendyolPrice(productId, trendyolData) {
  const { url, price, productId: trendyolProductId, inStock, stockAmount } = trendyolData;

  // Ürünü güncelle
  await db.update('products', {
    trendyol_url: url,
    trendyol_product_id: trendyolProductId,
    trendyol_price: price,
    trendyol_stock: stockAmount || 0,
    trendyol_last_seen: new Date()
  }, { id: productId });

  // Site fiyat geçmişine kaydet
  await db.create('site_prices', {
    product_id: productId,
    site: 'trendyol',
    price: price,
    in_stock: inStock !== false,
    stock_amount: stockAmount || 0
  });

  return true;
}

// Base code ile ürün bul
async function findByBaseCode(baseCode) {
  return await db.query(
    `SELECT * FROM products WHERE base_code = $1`,
    [baseCode]
  );
}

// Fiyat karşılaştırması yap
async function getPriceComparison() {
  return await db.query(`
    SELECT * FROM price_comparison
    WHERE trendyol_price IS NOT NULL
    ORDER BY price_diff DESC
  `);
}

// Trendyol'da daha ucuz ürünler
async function getCheaperOnTrendyol() {
  return await db.query(`
    SELECT * FROM price_comparison
    WHERE cheapest_site = 'trendyol'
    ORDER BY price_diff DESC
  `);
}

// AVVA'da daha ucuz ürünler
async function getCheaperOnAvva() {
  return await db.query(`
    SELECT * FROM price_comparison
    WHERE cheapest_site = 'avva'
    ORDER BY price_diff ASC
  `);
}

// Trendyol fiyatı olmayan ürünler
async function getProductsWithoutTrendyol(limit = 100) {
  return await db.query(`
    SELECT id, product_id, stock_code, base_code, color_code, name, current_price
    FROM products
    WHERE trendyol_price IS NULL AND base_code IS NOT NULL
    LIMIT $1
  `, [limit]);
}

module.exports = {
  upsertCategory,
  upsertProduct,
  recordPriceHistory,
  recordStockHistory,
  recordVariantStocks,
  startScrapeLog,
  completeScrapeLog,
  getCategoryDbId,
  getPriceChanges,
  getAllCategories,
  getStats,
  // Trendyol
  updateTrendyolPrice,
  findByBaseCode,
  getPriceComparison,
  getCheaperOnTrendyol,
  getCheaperOnAvva,
  getProductsWithoutTrendyol
};
