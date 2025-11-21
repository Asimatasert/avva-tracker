require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'https://www.avva.com.tr';
const API_URL = `${BASE_URL}/api/product/GetProductList`;

// Config
const CONFIG = {
  delay: 1500,           // İstekler arası bekleme (ms)
  maxRetries: 3,         // Hata durumunda tekrar deneme
  pageItemCount: 48,     // Sayfa başına ürün
  testCategoryId: 1154,  // Test için erkek-t-shirt
  timeout: 10000         // Request timeout
};

// Utility: Sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility: Retry with exponential backoff
async function fetchWithRetry(url, options = {}, retries = CONFIG.maxRetries) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        timeout: CONFIG.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          ...options.headers
        },
        ...options
      });
      return response;
    } catch (error) {
      const status = error.response?.status;
      console.log(`  [!] İstek hatası (deneme ${i + 1}/${retries}): ${status || error.message}`);

      if (status === 429 || status === 503) {
        const waitTime = CONFIG.delay * Math.pow(2, i);
        console.log(`  [!] Rate limit - ${waitTime}ms bekleniyor...`);
        await sleep(waitTime);
      } else if (i === retries - 1) {
        throw error;
      }
      await sleep(CONFIG.delay);
    }
  }
}

// 1. Sitemap'ten kategori URL'lerini çek
async function fetchCategoryUrls() {
  console.log('\n📁 Sitemap\'ten kategoriler çekiliyor...');

  try {
    const response = await fetchWithRetry(`${BASE_URL}/sitemap/categories/0.xml`);
    const $ = cheerio.load(response.data, { xmlMode: true });

    const categories = [];
    $('url').each((_, el) => {
      const loc = $(el).find('loc').text();
      // Sadece Türkçe URL'leri al (en/ içermeyenler)
      if (loc && !loc.includes('/en/')) {
        const slug = loc.replace(BASE_URL + '/', '');
        categories.push({ url: loc, slug });
      }
    });

    console.log(`  ✓ ${categories.length} kategori URL'si bulundu`);
    return categories;
  } catch (error) {
    console.log(`  ✗ Sitemap hatası: ${error.message}`);
    return [];
  }
}

// 2. Kategori sayfasından ID'yi çek
async function fetchCategoryId(categoryUrl) {
  try {
    const response = await fetchWithRetry(categoryUrl, {
      headers: { 'Accept': 'text/html' }
    });

    const html = response.data;

    // PageId veya CategoryId'yi HTML'den çıkar
    // Pattern 1: PageId=1154 URL'de
    let match = html.match(/PageId['":\s]+(\d+)/i);
    if (match) return parseInt(match[1]);

    // Pattern 2: categoryId değişkeni
    match = html.match(/categoryId['":\s]+(\d+)/i);
    if (match) return parseInt(match[1]);

    // Pattern 3: data-category-id attribute
    match = html.match(/data-category-id=['"](\d+)['"]/i);
    if (match) return parseInt(match[1]);

    return null;
  } catch (error) {
    return null;
  }
}

// 3. Ürün listesi API'sini çağır
async function fetchProducts(categoryId, pageNumber = 1) {
  const filterJson = {
    CategoryIdList: [categoryId],
    BrandIdList: [],
    SupplierIdList: [],
    TagIdList: [],
    TagId: -1,
    FilterObject: [],
    MinStockAmount: -1,
    IsShowcaseProduct: -1,
    IsOpportunityProduct: -1,
    FastShipping: -1,
    IsNewProduct: -1,
    IsDiscountedProduct: -1,
    IsShippingFree: -1,
    IsProductCombine: -1,
    MinPrice: 0,
    MaxPrice: 0,
    Point: -1,
    SearchKeyword: "",
    StrProductIds: "",
    IsSimilarProduct: false,
    RelatedProductId: 0,
    ProductKeyword: "",
    PageContentId: 0,
    StrProductIDNotEqual: "",
    IsVariantList: -1,
    IsVideoProduct: -1,
    ShowBlokVideo: -1,
    VideoSetting: { ShowProductVideo: -1, AutoPlayVideo: -1 },
    ShowList: 1,
    VisibleImageCount: 0,
    ShowCounterProduct: -1,
    ImageSliderActive: true,
    ProductListPageId: 0,
    ShowGiftHintActive: false,
    IsInStock: false,
    IsPriceRequest: true,
    IsProductListPage: true,
    NonStockShowEnd: 0
  };

  const pagingJson = {
    PageItemCount: CONFIG.pageItemCount,
    PageNumber: pageNumber,
    OrderBy: "KATEGORISIRA",
    OrderDirection: "ASC"
  };

  const params = new URLSearchParams({
    c: 'trtry0000',
    FilterJson: JSON.stringify(filterJson),
    PagingJson: JSON.stringify(pagingJson),
    CreateFilter: 'false',
    TransitionOrder: '0',
    PageType: '1',
    PageId: categoryId.toString()
  });

  const response = await fetchWithRetry(`${API_URL}?${params.toString()}`);
  return response.data;
}

// 4. Tüm ürünleri pagination ile çek
async function fetchAllProducts(categoryId, maxPages = 10) {
  console.log(`\n📦 Kategori ${categoryId} için ürünler çekiliyor...`);

  let allProducts = [];
  let pageNumber = 1;
  let hasMore = true;

  while (hasMore && pageNumber <= maxPages) {
    process.stdout.write(`  Sayfa ${pageNumber}...`);

    try {
      const data = await fetchProducts(categoryId, pageNumber);
      const products = data.products || [];

      if (products.length === 0) {
        hasMore = false;
        console.log(' (boş - son sayfa)');
      } else {
        allProducts = allProducts.concat(products);
        console.log(` ${products.length} ürün`);
        pageNumber++;
        await sleep(CONFIG.delay);
      }
    } catch (error) {
      console.log(` HATA: ${error.message}`);
      hasMore = false;
    }
  }

  console.log(`  ✓ Toplam: ${allProducts.length} ürün`);
  return allProducts;
}

// 5. Ürün verilerini analiz et
function analyzeProducts(products) {
  console.log('\n📊 Ürün Analizi:');
  console.log('─'.repeat(50));

  if (products.length === 0) {
    console.log('  Analiz edilecek ürün yok.');
    return;
  }

  // Fiyat analizi
  const prices = products.map(p => p.productCartPrice).filter(p => p > 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  console.log(`\n  💰 Fiyat Aralığı:`);
  console.log(`     Min: ${minPrice.toFixed(2)} TL`);
  console.log(`     Max: ${maxPrice.toFixed(2)} TL`);
  console.log(`     Ort: ${avgPrice.toFixed(2)} TL`);

  // Stok analizi
  const inStock = products.filter(p => p.inStock).length;
  const outOfStock = products.length - inStock;
  const totalStock = products.reduce((sum, p) => sum + (p.totalStockAmount || 0), 0);

  console.log(`\n  📦 Stok Durumu:`);
  console.log(`     Stokta: ${inStock} ürün`);
  console.log(`     Tükendi: ${outOfStock} ürün`);
  console.log(`     Toplam stok adedi: ${totalStock}`);

  // İndirim analizi
  const discounted = products.filter(p => p.discountRate > 0);
  const discountRates = discounted.map(p => p.discountRate);

  console.log(`\n  🏷️  İndirimler:`);
  console.log(`     İndirimli: ${discounted.length} ürün`);
  if (discountRates.length > 0) {
    console.log(`     İndirim oranları: %${Math.min(...discountRates)} - %${Math.max(...discountRates)}`);
  }

  // Alan analizi
  console.log(`\n  🔍 Veri Alanları:`);
  const sampleProduct = products[0];
  const fields = Object.keys(sampleProduct);
  console.log(`     Toplam alan sayısı: ${fields.length}`);

  // Önemli alanların doluluğu
  const importantFields = ['stockCode', 'name', 'productCartPrice', 'totalStockAmount', 'category', 'brand'];
  console.log(`\n  ✓ Önemli alanların doluluğu:`);
  importantFields.forEach(field => {
    const filled = products.filter(p => p[field] != null && p[field] !== '').length;
    const percent = ((filled / products.length) * 100).toFixed(0);
    console.log(`     ${field}: ${percent}%`);
  });

  // Varyant analizi
  const withVariants = products.filter(p => p.variantTypeValues && p.variantTypeValues.length > 0);
  console.log(`\n  🎨 Varyantlar:`);
  console.log(`     Varyantlı ürün: ${withVariants.length}`);

  if (withVariants.length > 0) {
    const sample = withVariants[0];
    const colors = sample.variantTypeValues?.length || 0;
    const sizes = sample.variantTypeValues?.[0]?.subVariantValues?.length || 0;
    console.log(`     Örnek ürün: ${colors} renk, ${sizes} beden`);
  }

  return {
    count: products.length,
    priceRange: { min: minPrice, max: maxPrice, avg: avgPrice },
    stock: { inStock, outOfStock, total: totalStock },
    discounted: discounted.length
  };
}

// 6. Örnek ürün yapısını göster
function showSampleProduct(product) {
  console.log('\n📋 Örnek Ürün Yapısı:');
  console.log('─'.repeat(50));

  const important = {
    productId: product.productId,
    stockCode: product.stockCode,
    name: product.name,
    brand: product.brand,
    category: product.category,
    categoryId: product.categoryId,
    productCartPrice: product.productCartPrice,
    productCartPriceStr: product.productCartPriceStr,
    productSellPrice: product.productSellPrice,
    discountRate: product.discountRate,
    totalStockAmount: product.totalStockAmount,
    inStock: product.inStock,
    url: product.url,
    variantCount: product.variantCount
  };

  console.log(JSON.stringify(important, null, 2));

  if (product.variantTypeValues?.[0]) {
    console.log('\n  Varyant örneği (ilk renk):');
    const variant = product.variantTypeValues[0];
    console.log(`    Renk: ${variant.name}`);
    console.log(`    Bedenler: ${variant.subVariantValues?.map(s => `${s.name}(${s.stockAmount})`).join(', ')}`);
  }
}

// 7. Kategorileri keşfet - ürün bazlı yöntem
async function discoverCategories(limit = 100) {
  console.log('\n🔍 Kategori ID\'leri keşfediliyor (ürün bazlı)...');

  const categoryUrls = await fetchCategoryUrls();
  const categories = [];
  const seenIds = new Set();

  // Tüm kategorileri tara
  const testUrls = categoryUrls.slice(0, limit);
  let found = 0;
  let notFound = 0;

  for (const cat of testUrls) {
    process.stdout.write(`  ${cat.slug}...`);

    try {
      // Kategori sayfasından PageId'yi bulmak için HTML'i çek
      const response = await fetchWithRetry(cat.url, {
        headers: { 'Accept': 'text/html' }
      });

      const html = response.data;

      // targetId pattern'i ile kategori ID'sini bul
      let pageId = null;

      // Pattern 1: targetId (en güvenilir)
      const targetMatch = html.match(/targetId["'\s:]+(\d+)/i);
      if (targetMatch) pageId = parseInt(targetMatch[1]);

      // Pattern 2: Alternatif olarak "id" ve sayfa tipi kontrolü
      if (!pageId) {
        const idMatch = html.match(/"id"\s*:\s*(\d{3,4})/);
        if (idMatch) pageId = parseInt(idMatch[1]);
      }

      if (pageId && !seenIds.has(pageId)) {
        // Doğrulama: Bu ID ile ürün çekilebiliyor mu?
        const testData = await fetchProducts(pageId, 1);
        if (testData.products && testData.products.length > 0) {
          const sampleProduct = testData.products[0];
          categories.push({
            slug: cat.slug,
            url: cat.url,
            categoryId: pageId,
            name: sampleProduct.category,
            productCount: '?'
          });
          seenIds.add(pageId);
          found++;
          console.log(` ✓ ID: ${pageId} (${sampleProduct.category})`);
        } else {
          console.log(` ID: ${pageId} ama ürün yok`);
          notFound++;
        }
      } else if (pageId) {
        console.log(` (duplicate ID: ${pageId})`);
      } else {
        console.log(' ID bulunamadı');
        notFound++;
      }

    } catch (error) {
      console.log(` hata: ${error.message}`);
      notFound++;
    }

    await sleep(CONFIG.delay);
  }

  console.log(`\n  📊 Sonuç: ${found} kategori bulundu, ${notFound} bulunamadı`);
  return categories;
}

// Ana fonksiyon
async function main() {
  console.log('═'.repeat(50));
  console.log('  AVVA API Analyzer');
  console.log('═'.repeat(50));
  console.log(`  Tarih: ${new Date().toLocaleString('tr-TR')}`);
  console.log(`  Delay: ${CONFIG.delay}ms`);
  console.log(`  Page Size: ${CONFIG.pageItemCount}`);

  try {
    // 1. Test kategorisi ile ürünleri çek
    const products = await fetchAllProducts(CONFIG.testCategoryId, 5);

    // 2. Analiz yap
    if (products.length > 0) {
      analyzeProducts(products);
      showSampleProduct(products[0]);

      // 3. Örnek veriyi kaydet
      const dataDir = path.join(__dirname, '..', 'data');
      await fs.mkdir(dataDir, { recursive: true });

      await fs.writeFile(
        path.join(dataDir, 'sample-products.json'),
        JSON.stringify(products.slice(0, 10), null, 2)
      );
      console.log('\n  ✓ Örnek ürünler data/sample-products.json\'a kaydedildi');
    }

    // 4. Kategorileri keşfet (ilk 30)
    const categories = await discoverCategories(30);

    if (categories.length > 0) {
      await fs.writeFile(
        path.join(__dirname, '..', 'data', 'categories.json'),
        JSON.stringify(categories, null, 2)
      );
      console.log('  ✓ Kategoriler data/categories.json\'a kaydedildi');
    }

    console.log('\n═'.repeat(50));
    console.log('  Analiz tamamlandı!');
    console.log('═'.repeat(50));

  } catch (error) {
    console.error('\n❌ Hata:', error.message);
    process.exit(1);
  }
}

// Çalıştır
main();
