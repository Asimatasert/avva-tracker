#!/usr/bin/env node
require('dotenv').config();

const telegram = require('../services/telegram');

async function main() {
  console.log('📱 Telegram Bot Test\n');

  // Ayarları kontrol et
  console.log('Ayarlar:');
  console.log(`  BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✓ Ayarlı' : '✗ Eksik'}`);
  console.log(`  CHAT_ID: ${process.env.TELEGRAM_CHAT_ID ? '✓ Ayarlı' : '✗ Eksik'}`);
  console.log(`  Aktif: ${telegram.isEnabled() ? '✓ Evet' : '✗ Hayır'}\n`);

  if (!telegram.isEnabled()) {
    console.log('❌ Telegram ayarları eksik!');
    console.log('\n.env dosyasına ekleyin:');
    console.log('  TELEGRAM_BOT_TOKEN=your_bot_token');
    console.log('  TELEGRAM_CHAT_ID=your_chat_id');
    console.log('\nBot token almak için: @BotFather');
    console.log('Chat ID almak için: @userinfobot');
    process.exit(1);
  }

  console.log('Test mesajları gönderiliyor...\n');

  // Test mesajı
  const testResult = await telegram.send('🧪 <b>Test Mesajı</b>\n\nAVVA Tracker bağlantısı başarılı!');
  console.log(`1. Basit mesaj: ${testResult ? '✓' : '✗'}`);

  // Fiyat düşüşü testi
  const priceDropResult = await telegram.notifyPriceDrop(
    { name: 'Test Ürün - Beyaz T-Shirt', url: '/test-urun-123' },
    799.99,
    599.99
  );
  console.log(`2. Fiyat düşüşü: ${priceDropResult ? '✓' : '✗'}`);

  // Stok bildirimi testi
  const stockResult = await telegram.notifyBackInStock({
    name: 'Test Ürün - Siyah Gömlek',
    url: '/test-urun-456',
    current_price: 1299.99,
    total_stock: 150
  });
  console.log(`3. Stok bildirimi: ${stockResult ? '✓' : '✗'}`);

  // Özet testi
  const summaryResult = await telegram.notifyScrapeComplete({
    categoriesProcessed: 5,
    productsFound: 500,
    productsNew: 25,
    productsUpdated: 475,
    priceChanges: [
      { name: 'Ürün 1', oldPrice: 100, newPrice: 80, change: -20 },
      { name: 'Ürün 2', oldPrice: 200, newPrice: 220, change: 20 }
    ],
    errors: []
  });
  console.log(`4. Tarama özeti: ${summaryResult ? '✓' : '✗'}`);

  console.log('\n✅ Test tamamlandı!');
}

main().catch(console.error);
