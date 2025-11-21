const avvaApi = require('./avvaApi');
const productService = require('./productService');
const telegram = require('./telegram');

class Scraper {
  constructor(options = {}) {
    this.options = {
      verbose: true,
      recordVariants: false,
      notifyPriceDrops: true,      // Fiyat düşüşü bildirimi
      notifyPriceIncreases: false, // Fiyat artışı bildirimi
      notifyNewProducts: false,    // Yeni ürün bildirimi
      notifyStockChanges: true,    // Stok değişikliği bildirimi
      priceDropThreshold: 5,       // Minimum % düşüş bildirimi için
      sendSummary: true,           // Tarama özeti gönder
      ...options
    };
    this.stats = {
      categoriesProcessed: 0,
      productsFound: 0,
      productsNew: 0,
      productsUpdated: 0,
      priceChanges: [],
      stockChanges: [],
      errors: []
    };
  }

  log(message) {
    if (this.options.verbose) {
      console.log(message);
    }
  }

  // Tek bir kategoriyi scrape et
  async scrapeCategory(category) {
    const startTime = Date.now();
    const { categoryId, slug, name } = category;

    this.log(`\n📁 ${name || slug} (ID: ${categoryId})`);

    // Scrape log başlat
    const scrapeLog = await productService.startScrapeLog(categoryId);

    // Kategoriyi DB'ye kaydet
    let categoryDbId = await productService.getCategoryDbId(categoryId);
    if (!categoryDbId) {
      const cat = await productService.upsertCategory({
        categoryId,
        slug,
        name: name || slug,
        url: `https://www.avva.com.tr/${slug}`
      });
      categoryDbId = cat.id;
    }

    const categoryStats = { found: 0, new: 0, updated: 0, error: null };

    try {
      // Ürünleri çek
      const products = await avvaApi.fetchAllProductsInCategory(
        categoryId,
        (page, count, total) => {
          process.stdout.write(`   Sayfa ${page}: +${count} (toplam: ${total})\r`);
        }
      );

      console.log(`   ✓ ${products.length} ürün bulundu`);
      categoryStats.found = products.length;

      // Her ürünü işle
      for (const product of products) {
        try {
          const result = await this.processProduct(product, categoryDbId);

          if (result.isNew) {
            categoryStats.new++;
            this.stats.productsNew++;
          } else {
            categoryStats.updated++;
            this.stats.productsUpdated++;

            // Fiyat değişimi kontrolü
            if (result.priceChanged) {
              this.stats.priceChanges.push({
                productId: product.productId,
                name: product.name,
                oldPrice: result.previousPrice,
                newPrice: product.productCartPrice,
                change: product.productCartPrice - result.previousPrice
              });
            }
          }
        } catch (err) {
          this.stats.errors.push({
            productId: product.productId,
            error: err.message
          });
        }
      }

      this.stats.productsFound += products.length;
      this.stats.categoriesProcessed++;

    } catch (error) {
      categoryStats.error = error.message;
      this.stats.errors.push({
        categoryId,
        error: error.message
      });
      this.log(`   ❌ Hata: ${error.message}`);
    }

    // Scrape log tamamla
    const duration = Date.now() - startTime;
    await productService.completeScrapeLog(scrapeLog.id, {
      ...categoryStats,
      duration
    });

    this.log(`   ⏱️  ${(duration / 1000).toFixed(1)}s - Yeni: ${categoryStats.new}, Güncellenen: ${categoryStats.updated}`);

    return categoryStats;
  }

  // Tek bir ürünü işle
  async processProduct(product, categoryDbId) {
    const result = await productService.upsertProduct(product, categoryDbId);
    const productDbId = result.product.id;

    // Fiyat değişimi var mı? (2 kuruşluk tolerans)
    const oldPrice = parseFloat(result.previousPrice || 0);
    const newPrice = parseFloat(product.productCartPrice || 0);
    const priceChanged = !result.isNew &&
      result.previousPrice !== null &&
      Math.abs(oldPrice - newPrice) > 0.01;

    // Fiyat geçmişine kaydet
    await productService.recordPriceHistory(
      productDbId,
      product.productCartPrice,
      product.productPriceOriginal || product.productCartPrice,
      product.discountRate
    );

    // Stok geçmişine kaydet
    await productService.recordStockHistory(
      productDbId,
      product.totalStockAmount || 0,
      product.inStock
    );

    // Varyant stokları (opsiyonel - çok veri üretir)
    if (this.options.recordVariants && product.variantTypeValues) {
      await productService.recordVariantStocks(productDbId, product.variantTypeValues);
    }

    // Telegram bildirimleri
    await this.sendNotifications(product, result, oldPrice, newPrice, priceChanged);

    return {
      ...result,
      priceChanged
    };
  }

  // Bildirimleri gönder
  async sendNotifications(product, result, oldPrice, newPrice, priceChanged) {
    if (!telegram.isEnabled()) return;

    const productData = {
      name: product.name,
      url: product.url,
      current_price: newPrice,
      total_stock: product.totalStockAmount
    };

    // Yeni ürün bildirimi
    if (result.isNew && this.options.notifyNewProducts) {
      await telegram.notifyNewProduct(product);
    }

    // Fiyat değişimi bildirimi
    if (priceChanged) {
      const changePercent = Math.abs((newPrice - oldPrice) / oldPrice * 100);

      if (newPrice < oldPrice && this.options.notifyPriceDrops) {
        // Fiyat düştü - eşik kontrolü
        if (changePercent >= this.options.priceDropThreshold) {
          await telegram.notifyPriceDrop(productData, oldPrice, newPrice);
        }
      } else if (newPrice > oldPrice && this.options.notifyPriceIncreases) {
        // Fiyat arttı
        await telegram.notifyPriceIncrease(productData, oldPrice, newPrice);
      }
    }

    // Stok değişikliği bildirimi
    if (this.options.notifyStockChanges && !result.isNew) {
      const wasInStock = result.previousInStock;
      const nowInStock = product.inStock;

      if (!wasInStock && nowInStock) {
        await telegram.notifyBackInStock(productData);
      } else if (wasInStock && !nowInStock) {
        await telegram.notifyOutOfStock(productData);
      }
    }
  }

  // Tüm kategorileri scrape et
  async scrapeAll(categories) {
    const startTime = Date.now();

    this.log('═'.repeat(50));
    this.log('  AVVA Scraper - Tam Tarama');
    this.log('═'.repeat(50));
    this.log(`  Tarih: ${new Date().toLocaleString('tr-TR')}`);
    this.log(`  Kategori sayısı: ${categories.length}`);

    for (const category of categories) {
      await this.scrapeCategory(category);
      await avvaApi.sleep(1000); // Kategoriler arası bekleme
    }

    const totalDuration = Date.now() - startTime;

    this.log('\n' + '═'.repeat(50));
    this.log('  ÖZET');
    this.log('═'.repeat(50));
    this.log(`  Süre: ${(totalDuration / 1000 / 60).toFixed(1)} dakika`);
    this.log(`  Kategoriler: ${this.stats.categoriesProcessed}`);
    this.log(`  Toplam ürün: ${this.stats.productsFound}`);
    this.log(`  Yeni ürün: ${this.stats.productsNew}`);
    this.log(`  Güncellenen: ${this.stats.productsUpdated}`);
    this.log(`  Fiyat değişimi: ${this.stats.priceChanges.length}`);
    this.log(`  Hatalar: ${this.stats.errors.length}`);

    if (this.stats.priceChanges.length > 0) {
      this.log('\n📉 Fiyat Değişimleri:');
      for (const change of this.stats.priceChanges.slice(0, 10)) {
        const oldPrice = parseFloat(change.oldPrice);
        const newPrice = parseFloat(change.newPrice);
        const diff = newPrice - oldPrice;
        const sign = diff > 0 ? '↑' : '↓';
        const percent = ((diff / oldPrice) * 100).toFixed(1);
        this.log(`   ${sign} ${change.name.substring(0, 40)}...`);
        this.log(`      ${oldPrice.toFixed(2)} → ${newPrice.toFixed(2)} TL (${percent}%)`);
      }
      if (this.stats.priceChanges.length > 10) {
        this.log(`   ... ve ${this.stats.priceChanges.length - 10} değişiklik daha`);
      }
    }

    // Telegram özet bildirimi
    if (this.options.sendSummary && telegram.isEnabled()) {
      await telegram.notifyScrapeComplete(this.stats);

      // En çok düşen fiyatları bildir
      if (this.stats.priceChanges.length > 0) {
        await telegram.notifyTopPriceDrops(this.stats.priceChanges, 5);
      }
    }

    return this.stats;
  }

  // Belirli kategorileri scrape et
  async scrapeCategories(categoryIds) {
    const categories = categoryIds.map(id => ({
      categoryId: id,
      slug: `category-${id}`,
      name: null
    }));
    return this.scrapeAll(categories);
  }

  getStats() {
    return this.stats;
  }
}

module.exports = Scraper;
