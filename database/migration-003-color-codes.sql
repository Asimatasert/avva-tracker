-- Migration 003: Renk kodları tablosu
-- color_codes tablosu - renk kodlarını adlara eşler

CREATE TABLE IF NOT EXISTS color_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,         -- Renk kodu (05, 11, 101 vb.)
    name VARCHAR(50) NOT NULL,                -- Renk adı (Beyaz, Lacivert vb.)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- İndeks
CREATE INDEX IF NOT EXISTS idx_color_codes_code ON color_codes(code);

-- Seed Data: Renk kodları
INSERT INTO color_codes (code, name) VALUES
  ('01', 'Beyaz'),
  ('02', 'Mavi'),
  ('03', 'Siyah'),
  ('04', 'Kırmızı'),
  ('05', 'Beyaz'),
  ('06', 'Turuncu'),
  ('07', 'Kahve'),
  ('08', 'Bej'),
  ('11', 'Lacivert'),
  ('12', 'Yeşil'),
  ('19', 'Kamel'),
  ('20', 'Gri'),
  ('21', 'Taş'),
  ('28', 'Koyu Gri'),
  ('41', 'Bordo'),
  ('44', 'Antrasit'),
  ('47', 'Ekru'),
  ('67', 'Haki'),
  ('68', 'Açık Gri'),
  ('76', 'Gri-Yeşil'),
  ('78', 'Açık Mavi'),
  ('85', 'Vizon'),
  ('101', 'İndigo'),
  ('132', 'Nil Yeşili'),
  ('133', 'Antrasit-Siyah'),
  ('163', 'Su Yeşili'),
  ('236', 'Açık Haki'),
  ('258', 'Ekru-Gri'),
  ('269', 'Kırık Beyaz'),
  ('270', 'Petrol Mavi'),
  ('284', 'Sage')
ON CONFLICT (code) DO NOTHING;
