#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const Scraper = require('../services/scraper');
const productService = require('../services/productService');

// Komut satırı argümanları
const args = process.argv.slice(2);
const isQuick = args.includes('--quick');      // Sadece birkaç kategori
const isTest = args.includes('--test');        // Tek kategori test
const categoryArg = args.find(a => a.startsWith('--category='));

async function loadCategories() {
  // Önce DB'den dene
  const dbCategories = await productService.getAllCategories();
  if (dbCategories.length > 0) {
    return dbCategories.map(c => ({
      categoryId: c.category_id,
      slug: c.slug,
      name: c.name
    }));
  }

  // DB'de yoksa JSON dosyasından yükle
  const jsonPath = path.join(__dirname, '..', 'data', 'categories.json');
  try {
    const data = await fs.readFile(jsonPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('❌ Kategori listesi bulunamadı!');
    console.log('   Önce "npm run analyze" çalıştırın.');
    process.exit(1);
  }
}

async function main() {
  console.log('🚀 AVVA Scraper başlatılıyor...\n');

  try {
    // Kategorileri yükle
    let categories = await loadCategories();

    // Filtreler
    if (categoryArg) {
      const categoryId = parseInt(categoryArg.split('=')[1]);
      categories = categories.filter(c => c.categoryId === categoryId);
      if (categories.length === 0) {
        console.error(`❌ Kategori bulunamadı: ${categoryId}`);
        process.exit(1);
      }
    } else if (isTest) {
      // Test modu - sadece T-shirt
      categories = categories.filter(c => c.categoryId === 1154).slice(0, 1);
      if (categories.length === 0) {
        categories = [{ categoryId: 1154, slug: 'erkek-t-shirt', name: 'T-Shirt' }];
      }
    } else if (isQuick) {
      // Hızlı mod - ilk 5 kategori
      categories = categories.slice(0, 5);
    }

    console.log(`📋 ${categories.length} kategori taranacak\n`);

    // Scraper'ı başlat
    const scraper = new Scraper({
      verbose: true,
      recordVariants: false
    });

    const stats = await scraper.scrapeAll(categories);

    // Sonuçları JSON olarak kaydet
    const resultPath = path.join(__dirname, '..', 'data', 'last-scrape.json');
    await fs.writeFile(resultPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      stats: {
        categoriesProcessed: stats.categoriesProcessed,
        productsFound: stats.productsFound,
        productsNew: stats.productsNew,
        productsUpdated: stats.productsUpdated,
        priceChanges: stats.priceChanges.length,
        errors: stats.errors.length
      },
      priceChanges: stats.priceChanges,
      errors: stats.errors
    }, null, 2));

    console.log(`\n✅ Sonuçlar kaydedildi: data/last-scrape.json`);

    // DB istatistikleri
    const dbStats = await productService.getStats();
    console.log('\n📊 Veritabanı Durumu:');
    console.log(`   Toplam ürün: ${dbStats.totalProducts}`);
    console.log(`   Toplam kategori: ${dbStats.totalCategories}`);
    console.log(`   Fiyat kayıtları: ${dbStats.totalPriceRecords}`);

  } catch (error) {
    console.error('\n❌ Scraper hatası:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

main();
