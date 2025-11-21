const express = require('express');
const path = require('path');
const db = require('../config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

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
      sort = 'discount',
      minDiscount = 0,
      maxPrice = 0,
      category = '',
      search = '',
      page = 1
    } = req.query;

    const limit = 48;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];

    // İndirim filtresi
    if (minDiscount > 0) {
      whereClause += ' AND discount_rate >= ?';
      params.push(minDiscount);
    }

    // Fiyat filtresi
    if (maxPrice > 0) {
      whereClause += ' AND current_price <= ?';
      params.push(maxPrice);
    }

    // Kategori filtresi
    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }

    // Arama
    if (search) {
      whereClause += ' AND (name LIKE ? OR stock_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Sıralama
    let orderBy = 'ORDER BY ';
    switch (sort) {
      case 'discount':
        orderBy += 'discount_rate DESC';
        break;
      case 'price_asc':
        orderBy += 'current_price ASC';
        break;
      case 'price_desc':
        orderBy += 'current_price DESC';
        break;
      case 'newest':
        orderBy += 'updated_at DESC';
        break;
      default:
        orderBy += 'discount_rate DESC';
    }

    // Toplam sayı
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM products ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Ürünler
    const products = await db.query(
      `SELECT * FROM products ${whereClause} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Kategoriler
    const categories = await db.query(
      'SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category'
    );

    // İstatistikler
    const stats = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN discount_rate > 0 THEN 1 END) as discounted,
        AVG(discount_rate) as avg_discount,
        MAX(discount_rate) as max_discount
      FROM products
    `);

    res.render('index', {
      products,
      categories: categories.map(c => c.category),
      stats: stats[0],
      filters: { sort, minDiscount, maxPrice, category, search },
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

    // Ürün bilgisi
    const products = await db.query('SELECT * FROM products WHERE id = ?', [id]);
    if (products.length === 0) {
      return res.status(404).render('error', { message: 'Ürün bulunamadı' });
    }
    const product = products[0];

    // Fiyat geçmişi
    const priceHistory = await db.query(
      `SELECT price, recorded_at FROM price_history
       WHERE product_id = ?
       ORDER BY recorded_at ASC`,
      [id]
    );

    // İstatistikler
    const priceStats = await db.query(
      `SELECT
        MIN(price) as min_price,
        MAX(price) as max_price,
        AVG(price) as avg_price
       FROM price_history WHERE product_id = ?`,
      [id]
    );

    res.render('product', {
      product,
      priceHistory,
      priceStats: priceStats[0] || {},
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
    const products = await db.query(
      'SELECT * FROM products ORDER BY discount_rate DESC LIMIT 100'
    );
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Fiyat geçmişi
app.get('/api/price-history/:id', async (req, res) => {
  try {
    const history = await db.query(
      'SELECT price, recorded_at FROM price_history WHERE product_id = ? ORDER BY recorded_at',
      [req.params.id]
    );
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🌐 AVVA Tracker Web`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   http://localhost:${PORT}/product/1\n`);
});
