-- AVVA Fiyat Takip Botu - Veritabanı Şeması
-- PostgreSQL

-- Kategoriler tablosu
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    category_id INTEGER UNIQUE NOT NULL,      -- AVVA'daki kategori ID
    slug VARCHAR(100) NOT NULL,               -- URL slug (erkek-gomlek)
    name VARCHAR(100) NOT NULL,               -- Kategori adı (Gömlek)
    url VARCHAR(255),                         -- Tam URL
    product_count INTEGER DEFAULT 0,          -- Kategorideki ürün sayısı
    is_active BOOLEAN DEFAULT true,           -- Takip edilsin mi?
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ürünler tablosu
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    product_id INTEGER UNIQUE NOT NULL,       -- AVVA'daki ürün ID
    stock_code VARCHAR(50),                   -- SKU kodu
    barcode VARCHAR(50),                      -- Barkod
    name VARCHAR(255) NOT NULL,               -- Ürün adı
    brand VARCHAR(100) DEFAULT 'AVVA',        -- Marka
    category_id INTEGER REFERENCES categories(id),
    url VARCHAR(500),                         -- Ürün URL'i
    image_url VARCHAR(500),                   -- Resim URL
    current_price DECIMAL(10,2),              -- Güncel fiyat
    original_price DECIMAL(10,2),             -- Liste fiyatı
    discount_rate INTEGER DEFAULT 0,          -- İndirim oranı (%)
    in_stock BOOLEAN DEFAULT true,            -- Stokta var mı?
    total_stock INTEGER DEFAULT 0,            -- Toplam stok
    variant_count INTEGER DEFAULT 0,          -- Varyant sayısı
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fiyat geçmişi tablosu
CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    price DECIMAL(10,2) NOT NULL,             -- Fiyat
    original_price DECIMAL(10,2),             -- Liste fiyatı
    discount_rate INTEGER DEFAULT 0,          -- İndirim oranı
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stok geçmişi tablosu
CREATE TABLE IF NOT EXISTS stock_history (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    total_stock INTEGER NOT NULL,             -- Toplam stok
    in_stock BOOLEAN DEFAULT true,            -- Stokta var mı?
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Varyant stokları (beden/renk bazında)
CREATE TABLE IF NOT EXISTS variant_stocks (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    color VARCHAR(50),                        -- Renk
    size VARCHAR(20),                         -- Beden (XS, S, M, L, XL, XXL, 3XL)
    stock_amount INTEGER DEFAULT 0,           -- Stok miktarı
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Renk kodları tablosu
CREATE TABLE IF NOT EXISTS color_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,         -- Renk kodu (05, 11, 101 vb.)
    name VARCHAR(50) NOT NULL,                -- Renk adı (Beyaz, Lacivert vb.)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fiyat alarmları tablosu
CREATE TABLE IF NOT EXISTS price_alerts (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    alert_type VARCHAR(20) NOT NULL,          -- 'price_drop', 'back_in_stock', 'low_stock'
    target_price DECIMAL(10,2),               -- Hedef fiyat (price_drop için)
    is_active BOOLEAN DEFAULT true,
    triggered_at TIMESTAMP,                   -- Tetiklendiğinde
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Telegram bildirimleri log
CREATE TABLE IF NOT EXISTS notification_logs (
    id SERIAL PRIMARY KEY,
    alert_id INTEGER REFERENCES price_alerts(id),
    product_id INTEGER REFERENCES products(id),
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_sent BOOLEAN DEFAULT false
);

-- Scrape işlemleri log
CREATE TABLE IF NOT EXISTS scrape_logs (
    id SERIAL PRIMARY KEY,
    category_id INTEGER,
    products_found INTEGER DEFAULT 0,
    products_updated INTEGER DEFAULT 0,
    products_new INTEGER DEFAULT 0,
    duration_ms INTEGER,
    status VARCHAR(20) DEFAULT 'success',     -- 'success', 'error', 'partial'
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_products_product_id ON products(product_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_code ON products(stock_code);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_stock_history_product ON stock_history(product_id);
CREATE INDEX IF NOT EXISTS idx_variant_stocks_product ON variant_stocks(product_id);

-- Updated_at trigger fonksiyonu
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger'ları oluştur
DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;
CREATE TRIGGER update_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Faydalı view'lar

-- Fiyat değişim özeti
CREATE OR REPLACE VIEW price_changes AS
SELECT
    p.id,
    p.name,
    p.stock_code,
    p.current_price,
    ph_prev.price as previous_price,
    p.current_price - ph_prev.price as price_change,
    ROUND(((p.current_price - ph_prev.price) / ph_prev.price * 100)::numeric, 2) as change_percent,
    p.updated_at
FROM products p
LEFT JOIN LATERAL (
    SELECT price
    FROM price_history
    WHERE product_id = p.id
    ORDER BY recorded_at DESC
    OFFSET 1 LIMIT 1
) ph_prev ON true
WHERE ph_prev.price IS NOT NULL
  AND ph_prev.price != p.current_price;

-- Ürün istatistikleri
CREATE OR REPLACE VIEW product_stats AS
SELECT
    p.id,
    p.name,
    p.stock_code,
    p.current_price,
    MIN(ph.price) as min_price,
    MAX(ph.price) as max_price,
    ROUND(AVG(ph.price)::numeric, 2) as avg_price,
    COUNT(ph.id) as price_records,
    p.first_seen_at,
    p.last_seen_at
FROM products p
LEFT JOIN price_history ph ON p.id = ph.product_id
GROUP BY p.id;

-- Kategori özeti
CREATE OR REPLACE VIEW category_summary AS
SELECT
    c.id,
    c.name,
    c.slug,
    COUNT(p.id) as product_count,
    ROUND(AVG(p.current_price)::numeric, 2) as avg_price,
    SUM(p.total_stock) as total_stock,
    COUNT(CASE WHEN p.discount_rate > 0 THEN 1 END) as discounted_count
FROM categories c
LEFT JOIN products p ON c.id = p.category_id
GROUP BY c.id;
