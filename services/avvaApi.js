const axios = require('axios');

const BASE_URL = 'https://www.avva.com.tr';
const API_URL = `${BASE_URL}/api/product/GetProductList`;

const CONFIG = {
  delay: 1500,
  maxRetries: 3,
  pageItemCount: 48,
  timeout: 15000
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry mekanizması ile fetch
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

      if (status === 429 || status === 503) {
        const waitTime = CONFIG.delay * Math.pow(2, i);
        console.log(`  ⚠️  Rate limit, ${waitTime}ms bekleniyor...`);
        await sleep(waitTime);
      } else if (i === retries - 1) {
        throw error;
      }
      await sleep(CONFIG.delay);
    }
  }
}

// Kategori sayfasından targetId çek
async function fetchCategoryId(categoryUrl) {
  try {
    const response = await fetchWithRetry(categoryUrl, {
      headers: { 'Accept': 'text/html' }
    });
    const html = response.data;
    const match = html.match(/targetId["'\s:]+(\d+)/i);
    return match ? parseInt(match[1]) : null;
  } catch (error) {
    return null;
  }
}

// Ürün listesi çek
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

// Kategorideki tüm ürünleri çek
async function fetchAllProductsInCategory(categoryId, onProgress) {
  const allProducts = [];
  let pageNumber = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const data = await fetchProducts(categoryId, pageNumber);
      const products = data.products || [];

      if (products.length === 0) {
        hasMore = false;
      } else {
        allProducts.push(...products);
        if (onProgress) onProgress(pageNumber, products.length, allProducts.length);
        pageNumber++;
        await sleep(CONFIG.delay);
      }
    } catch (error) {
      console.error(`  ❌ Sayfa ${pageNumber} hatası:`, error.message);
      hasMore = false;
    }
  }

  return allProducts;
}

module.exports = {
  fetchWithRetry,
  fetchCategoryId,
  fetchProducts,
  fetchAllProductsInCategory,
  sleep,
  CONFIG,
  BASE_URL
};
