require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'web/views'));

// Static files
app.use(express.static(path.join(__dirname, 'web/public')));

// Helpers
function formatPrice(price) {
  if (!price) return '0,00 TL';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price) + ' TL';
}

function calculateDiscount(original, current) {
  if (!original || !current || original <= current) return 0;
  return Math.round(((original - current) / original) * 100);
}

// Ana sayfa - Fırsat Merkezi
app.get('/', async (req, res) => {
  try {
    const {
      sort = 'newest',
      maxPrice = 0,
      category = '',
      search = '',
      page = 1
    } = req.query;

    const limit = 48;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Fiyat filtresi
    if (maxPrice > 0) {
      whereClause += ` AND p.current_price <= $${paramIndex++}`;
      params.push(maxPrice);
    }

    // Kategori filtresi
    if (category) {
      whereClause += ` AND p.category_id = $${paramIndex++}`;
      params.push(category);
    }

    // Arama
    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.stock_code ILIKE $${paramIndex + 1})`;
      params.push(`%${search}%`, `%${search}%`);
      paramIndex += 2;
    }

    // Sıralama
    let orderBy = 'ORDER BY ';
    switch (sort) {
      case 'price_asc':
        orderBy += 'p.current_price ASC';
        break;
      case 'price_desc':
        orderBy += 'p.current_price DESC';
        break;
      case 'newest':
        orderBy += 'p.updated_at DESC';
        break;
      default:
        orderBy += 'p.updated_at DESC';
    }

    // Toplam sayı (gruplu)
    const countResult = await db.query(
      `SELECT COUNT(DISTINCT SPLIT_PART(p.stock_code, '-', 1)) as total FROM products p ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total || 0);
    const totalPages = Math.ceil(total / limit);

    // Ürünler - base_code'a göre grupla
    const productsResult = await db.query(
      `SELECT
        SPLIT_PART(p.stock_code, '-', 1) as base_code,
        MIN(p.id) as id,
        MIN(p.name) as name,
        MIN(p.current_price) as current_price,
        MIN(p.image_url) as image_url,
        MIN(p.in_stock::int)::boolean as in_stock,
        MIN(c.name) as category_name,
        COUNT(*) as variant_count,
        json_agg(json_build_object(
          'id', p.id,
          'stock_code', p.stock_code,
          'color_code', SPLIT_PART(p.stock_code, '-', 2),
          'name', p.name,
          'current_price', p.current_price,
          'image_url', p.image_url
        ) ORDER BY p.stock_code) as variants
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}
       GROUP BY SPLIT_PART(p.stock_code, '-', 1)
       ${orderBy.replace('p.current_price', 'MIN(p.current_price)').replace('p.updated_at', 'MAX(p.updated_at)')}
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );
    const products = productsResult.rows;

    // Kategoriler
    const categoriesResult = await db.query(
      'SELECT id, name FROM categories WHERE is_active = true ORDER BY name'
    );
    const categories = categoriesResult.rows;

    // İstatistikler
    const statsResult = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN discount_rate > 0 THEN 1 END) as discounted,
        AVG(discount_rate) as avg_discount,
        MAX(discount_rate) as max_discount
      FROM products
    `);

    res.render('index', {
      products,
      categories,
      stats: statsResult.rows[0],
      filters: { sort, maxPrice, category, search },
      pagination: { page: parseInt(page), totalPages, total },
      formatPrice,
      calculateDiscount
    });

  } catch (error) {
    console.error('Hata:', error);
    res.status(500).render('error', { message: error.message });
  }
});

// Ürün detay sayfası
app.get('/product/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Ürün bilgisi - id veya base_code ile ara
    let productsResult;
    if (/^\d+$/.test(id)) {
      // Numeric ID
      productsResult = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    } else {
      // Base code (A41Y2087 gibi)
      productsResult = await db.query(
        `SELECT * FROM products WHERE SPLIT_PART(stock_code, '-', 1) = $1 LIMIT 1`,
        [id]
      );
    }

    if (productsResult.rows.length === 0) {
      return res.status(404).render('error', { message: 'Ürün bulunamadı' });
    }
    const product = productsResult.rows[0];
    const baseCode = product.stock_code.split('-')[0];

    // Aynı ürünün diğer renkleri
    const colorVariantsResult = await db.query(
      `SELECT id, stock_code, SPLIT_PART(stock_code, '-', 2) as color_code,
              name, current_price, image_url, in_stock
       FROM products
       WHERE SPLIT_PART(stock_code, '-', 1) = $1
       ORDER BY stock_code`,
      [baseCode]
    );

    // Beden stokları - base_code bazlı tüm renkler
    const sizesResult = await db.query(
      `SELECT vs.color, vs.size, vs.stock_amount
       FROM variant_stocks vs
       JOIN products p ON vs.product_id = p.id
       WHERE SPLIT_PART(p.stock_code, '-', 1) = $1
       ORDER BY
         CASE vs.size
           WHEN 'XS' THEN 1
           WHEN 'S' THEN 2
           WHEN 'M' THEN 3
           WHEN 'L' THEN 4
           WHEN 'XL' THEN 5
           WHEN 'XXL' THEN 6
           WHEN '3XL' THEN 7
           ELSE 8
         END`,
      [baseCode]
    );

    // Fiyat geçmişi - tüm renklerin (base_code bazlı)
    const priceHistoryResult = await db.query(
      `SELECT ph.price, ph.recorded_at,
              SPLIT_PART(p.stock_code, '-', 2) as color_code,
              p.stock_code
       FROM price_history ph
       JOIN products p ON ph.product_id = p.id
       WHERE SPLIT_PART(p.stock_code, '-', 1) = $1
       ORDER BY ph.recorded_at DESC`,
      [baseCode]
    );

    // İstatistikler - base_code bazlı
    const priceStatsResult = await db.query(
      `SELECT
        MIN(ph.price) as min_price,
        MAX(ph.price) as max_price,
        AVG(ph.price) as avg_price
       FROM price_history ph
       JOIN products p ON ph.product_id = p.id
       WHERE SPLIT_PART(p.stock_code, '-', 1) = $1`,
      [baseCode]
    );

    res.render('product', {
      product,
      baseCode,
      colorVariants: colorVariantsResult.rows,
      sizes: sizesResult.rows,
      priceHistory: priceHistoryResult.rows,
      priceStats: priceStatsResult.rows[0] || {},
      formatPrice,
      calculateDiscount
    });

  } catch (error) {
    console.error('Hata:', error);
    res.status(500).render('error', { message: error.message });
  }
});

// API: Ürünler JSON
app.get('/api/products', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM products ORDER BY discount_rate DESC NULLS LAST LIMIT 100'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Fiyat geçmişi
app.get('/api/price-history/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT price, recorded_at FROM price_history WHERE product_id = $1 ORDER BY recorded_at',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🌐 AVVA Tracker Web`);
  console.log(`   http://localhost:${PORT}`);
});

module.exports = app;
