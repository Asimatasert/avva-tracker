const TelegramBot = require('node-telegram-bot-api');

class TelegramService {
  constructor() {
    this.bot = null;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.enabled = false;

    if (process.env.TELEGRAM_BOT_TOKEN && this.chatId) {
      this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
      this.enabled = true;
    }
  }

  isEnabled() {
    return this.enabled;
  }

  // Basit mesaj gönder
  async send(message) {
    if (!this.enabled) {
      console.log('[Telegram disabled]', message);
      return false;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      console.error('Telegram hatası:', error.message);
      return false;
    }
  }

  // Fiyat düşüşü bildirimi
  async notifyPriceDrop(product, oldPrice, newPrice) {
    const change = oldPrice - newPrice;
    const percent = ((change / oldPrice) * 100).toFixed(1);

    const message = `
🔻 <b>FİYAT DÜŞTÜ!</b>

📦 ${this.escapeHtml(product.name)}
💰 <s>${oldPrice.toFixed(2)} TL</s> → <b>${newPrice.toFixed(2)} TL</b>
📉 ${change.toFixed(2)} TL (%${percent}) indirim

🔗 <a href="https://www.avva.com.tr${product.url}">Ürüne Git</a>
    `.trim();

    return this.send(message);
  }

  // Fiyat artışı bildirimi
  async notifyPriceIncrease(product, oldPrice, newPrice) {
    const change = newPrice - oldPrice;
    const percent = ((change / oldPrice) * 100).toFixed(1);

    const message = `
🔺 <b>FİYAT ARTTI</b>

📦 ${this.escapeHtml(product.name)}
💰 ${oldPrice.toFixed(2)} TL → <b>${newPrice.toFixed(2)} TL</b>
📈 +${change.toFixed(2)} TL (%${percent}) artış

🔗 <a href="https://www.avva.com.tr${product.url}">Ürüne Git</a>
    `.trim();

    return this.send(message);
  }

  // Stok bildirimi
  async notifyBackInStock(product) {
    const message = `
✅ <b>STOK GELDİ!</b>

📦 ${this.escapeHtml(product.name)}
💰 ${parseFloat(product.current_price).toFixed(2)} TL
📊 Stok: ${product.total_stock} adet

🔗 <a href="https://www.avva.com.tr${product.url}">Ürüne Git</a>
    `.trim();

    return this.send(message);
  }

  // Stok tükendi bildirimi
  async notifyOutOfStock(product) {
    const message = `
❌ <b>STOK TÜKENDİ</b>

📦 ${this.escapeHtml(product.name)}
💰 ${parseFloat(product.current_price).toFixed(2)} TL

🔗 <a href="https://www.avva.com.tr${product.url}">Ürüne Git</a>
    `.trim();

    return this.send(message);
  }

  // Düşük stok uyarısı
  async notifyLowStock(product, stockAmount) {
    const message = `
⚠️ <b>DÜŞÜK STOK</b>

📦 ${this.escapeHtml(product.name)}
💰 ${parseFloat(product.current_price).toFixed(2)} TL
📊 Kalan stok: <b>${stockAmount}</b> adet

🔗 <a href="https://www.avva.com.tr${product.url}">Ürüne Git</a>
    `.trim();

    return this.send(message);
  }

  // Scrape özeti bildirimi
  async notifyScrapeComplete(stats) {
    const priceDrops = stats.priceChanges.filter(c => c.change < 0).length;
    const priceIncreases = stats.priceChanges.filter(c => c.change > 0).length;

    const message = `
📊 <b>TARAMA TAMAMLANDI</b>

🕐 ${new Date().toLocaleString('tr-TR')}
📁 Kategori: ${stats.categoriesProcessed}
📦 Toplam ürün: ${stats.productsFound}
🆕 Yeni ürün: ${stats.productsNew}
🔄 Güncellenen: ${stats.productsUpdated}

💰 Fiyat değişimi: ${stats.priceChanges.length}
   🔻 Düşen: ${priceDrops}
   🔺 Artan: ${priceIncreases}

❌ Hata: ${stats.errors.length}
    `.trim();

    return this.send(message);
  }

  // En iyi fiyat düşüşleri özeti
  async notifyTopPriceDrops(priceChanges, limit = 5) {
    const drops = priceChanges
      .filter(c => c.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, limit);

    if (drops.length === 0) return;

    let message = `🏆 <b>EN ÇOK DÜŞEN FİYATLAR</b>\n\n`;

    for (const drop of drops) {
      const oldPrice = parseFloat(drop.oldPrice);
      const newPrice = parseFloat(drop.newPrice);
      const change = Math.abs(drop.change);
      const percent = ((change / oldPrice) * 100).toFixed(0);

      message += `• ${this.escapeHtml(drop.name.substring(0, 35))}...\n`;
      message += `  <s>${oldPrice.toFixed(2)}</s> → <b>${newPrice.toFixed(2)} TL</b> (-%${percent})\n\n`;
    }

    return this.send(message);
  }

  // Yeni ürün bildirimi
  async notifyNewProduct(product) {
    const message = `
🆕 <b>YENİ ÜRÜN</b>

📦 ${this.escapeHtml(product.name)}
💰 ${parseFloat(product.productCartPrice).toFixed(2)} TL
📊 Stok: ${product.totalStockAmount} adet

🔗 <a href="https://www.avva.com.tr${product.url}">Ürüne Git</a>
    `.trim();

    return this.send(message);
  }

  // Trendyol'da daha ucuz bildirimi
  async notifyCheaperOnTrendyol(product, avvaPrice, trendyolPrice) {
    const diff = avvaPrice - trendyolPrice;
    const percent = ((diff / avvaPrice) * 100).toFixed(1);

    const message = `
🛒 <b>TRENDYOL'DA DAHA UCUZ!</b>

📦 ${this.escapeHtml(product.name)}

💰 AVVA: ${avvaPrice.toFixed(2)} TL
💰 Trendyol: <b>${trendyolPrice.toFixed(2)} TL</b>
📉 Fark: ${diff.toFixed(2)} TL (%${percent})

🔗 <a href="https://www.avva.com.tr${product.avva_url}">AVVA</a> | <a href="https://www.trendyol.com${product.trendyol_url}">Trendyol</a>
    `.trim();

    return this.send(message);
  }

  // AVVA'da daha ucuz bildirimi
  async notifyCheaperOnAvva(product, avvaPrice, trendyolPrice) {
    const diff = trendyolPrice - avvaPrice;
    const percent = ((diff / trendyolPrice) * 100).toFixed(1);

    const message = `
🏷️ <b>AVVA'DA DAHA UCUZ!</b>

📦 ${this.escapeHtml(product.name)}

💰 AVVA: <b>${avvaPrice.toFixed(2)} TL</b>
💰 Trendyol: ${trendyolPrice.toFixed(2)} TL
📉 Fark: ${diff.toFixed(2)} TL (%${percent})

🔗 <a href="https://www.avva.com.tr${product.avva_url}">AVVA</a>
    `.trim();

    return this.send(message);
  }

  // Fiyat karşılaştırma özeti
  async notifyPriceComparisonSummary(stats) {
    const message = `
📊 <b>FİYAT KARŞILAŞTIRMA ÖZETİ</b>

🕐 ${new Date().toLocaleString('tr-TR')}
📦 Karşılaştırılan: ${stats.total}
🛒 Trendyol ucuz: ${stats.cheaperOnTrendyol}
🏷️ AVVA ucuz: ${stats.cheaperOnAvva}
⚖️ Eşit: ${stats.equal}

💰 Ortalama fark: ${stats.avgDiff.toFixed(2)} TL
    `.trim();

    return this.send(message);
  }

  // HTML escape
  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Singleton instance
const telegramService = new TelegramService();

module.exports = telegramService;
