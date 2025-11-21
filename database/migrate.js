#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function migrate() {
  console.log('🗄️  Database Migration\n');

  const client = await pool.connect();

  try {
    console.log(`✓ PostgreSQL bağlantısı başarılı`);
    console.log(`  Host: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`  Database: ${process.env.DB_NAME || 'avva_tracker'}\n`);

    // database/ dizinindeki tüm .sql dosyalarını bul ve sırala
    // schema.sql önce, sonra migration-XXX dosyaları
    const sqlFiles = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => {
        if (a === 'schema.sql') return -1;
        if (b === 'schema.sql') return 1;
        return a.localeCompare(b);
      });

    console.log(`📂 ${sqlFiles.length} SQL dosyası bulundu\n`);

    for (const file of sqlFiles) {
      const filePath = path.join(__dirname, file);

      console.log(`📝 ${file} çalıştırılıyor...`);
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        await client.query(sql);
        console.log(`   ✓ Tamamlandı`);
      } catch (err) {
        // "already exists" hatalarını yoksay
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`   ⚠️  Zaten mevcut (atlandı)`);
        } else {
          throw err;
        }
      }
    }

    // Tablo listesi
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' ORDER BY tablename
    `);

    console.log('\n📋 Tablolar:');
    tables.rows.forEach(r => console.log(`   - ${r.tablename}`));

    console.log('\n✅ Migration tamamlandı!');

  } catch (error) {
    console.error('\n❌ Hata:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
