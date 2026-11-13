/**
 * Central storage and business rules engine for Seller Operations.
 * Manages products, marketplace listings, orders, inventory movements, returns, and price history.
 * Enforces strict single-source-of-truth inventory logic, non-overlapping order closures, and idempotent stock operations.
 */

import {
  Product,
  Order,
  OrderStatus,
  StockMovement,
  ReturnRecord,
  ReturnStatus,
  InspectionOutcome,
  PriceHistoryRecord,
  AppSettings,
  MarketplaceConfig,
  MarketplaceId,
  SmartImportHistory,
  MerchantProfile,
  FinancialTransaction,
  OrderFinancialBreakdown,
  MerchantRecommendation,
  RecommendationStatus,
  ShipmentRecord,
  OrderActivityEvent,
  OrderFinancialAdjustment,
} from '../types';

const STORAGE_KEYS = {
  PRODUCTS: 'seller_ops_products_v2',
  ORDERS: 'seller_ops_orders_v2',
  MOVEMENTS: 'seller_ops_movements_v2',
  RETURNS: 'seller_ops_returns_v2',
  PRICE_HISTORY: 'seller_ops_price_history_v2',
  SETTINGS: 'seller_ops_settings_v2',
  SMART_IMPORT_HISTORY: 'seller_ops_smart_import_history_v2',
  MERCHANT_PROFILE: 'ingobia_merchant_profile_v3',
  FINANCIAL_TRANSACTIONS: 'seller_ops_financial_tx_v2',
  RECOMMENDATIONS: 'seller_ops_recommendations_v2',
};

export const DEFAULT_MERCHANT_PROFILE: MerchantProfile = {
  name: 'أحمد إبراهيم',
  merchantName: 'أحمد إبراهيم',
  email: 'a7med3bker@gmail.com',
  storeName: 'روابي إكسبريس للتجارة الإلكترونية',
  isOnboarded: false,
  selectedMarketplaceIds: [],
  completedTutorials: [],
  exploredFeatures: [],
};

// Initial default marketplaces
export const DEFAULT_MARKETPLACES: MarketplaceConfig[] = [
  {
    id: 'noon',
    nameEn: 'Noon',
    nameAr: 'نون',
    color: '#FEEC00',
    badgeBg: '#FEF9C3',
    badgeText: '#854D0E',
    isActive: true,
  },
  {
    id: 'amazon',
    nameEn: 'Amazon',
    nameAr: 'أمازون',
    color: '#FF9900',
    badgeBg: '#FFEDD5',
    badgeText: '#9A3412',
    isActive: true,
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ar',
  currency: 'SAR',
  sellerName: 'أحمد إبراهيم (مدير العمليات)',
  storeName: 'روابي إكسبريس للتجارة الإلكترونية',
  marketplaces: DEFAULT_MARKETPLACES,
};

const sampleImages = {
  smartWatch: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=160&auto=format&fit=crop&q=80',
  headphones: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=160&auto=format&fit=crop&q=80',
  backpack: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=160&auto=format&fit=crop&q=80',
  coffeeMaker: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=160&auto=format&fit=crop&q=80',
  sneakers: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=160&auto=format&fit=crop&q=80',
  powerbank: 'https://images.unsplash.com/photo-1609592424361-9c60e36511a0?w=160&auto=format&fit=crop&q=80',
  sunglasses: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=160&auto=format&fit=crop&q=80',
  keyboard: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=160&auto=format&fit=crop&q=80',
};

// Initial realistic products dataset
export const DEFAULT_PRODUCTS: Product[] = [
  {
    id: 'prod-001',
    sku: 'ELEC-WATCH-01',
    name: 'Smart Watch Series 8 Ultra - 49mm Titanium',
    nameAr: 'ساعة ذكية ألترا سيريز 8 - هيكل تيتانيوم 49 مم',
    imageUrl: sampleImages.smartWatch,
    category: 'Electronics',
    baseCost: 180,
    currentPrice: 289,
    physicalStock: 65,
    availableStock: 52,
    reservedStock: 13,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 289,
        quantity: 25,
        listingStatus: 'active',
        lastUpdated: '2026-11-10T14:30:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 299,
        quantity: 27,
        listingStatus: 'active',
        lastUpdated: '2026-11-09T10:15:00Z',
      },
    },
    createdAt: '2026-10-15T09:00:00Z',
    updatedAt: '2026-11-10T14:30:00Z',
  },
  {
    id: 'prod-002',
    sku: 'AUDIO-HEAD-02',
    name: 'Wireless ANC Headphones Pro - Matte Black',
    nameAr: 'سماعات رأس لاسلكية بخاصية إلغاء الضوضاء - أسود مطفي',
    imageUrl: sampleImages.headphones,
    category: 'Audio',
    baseCost: 95,
    currentPrice: 165,
    physicalStock: 40,
    availableStock: 34,
    reservedStock: 6,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 165,
        quantity: 18,
        listingStatus: 'active',
        lastUpdated: '2026-11-11T08:00:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 169,
        quantity: 16,
        listingStatus: 'active',
        lastUpdated: '2026-11-08T12:00:00Z',
      },
    },
    createdAt: '2026-10-18T11:00:00Z',
    updatedAt: '2026-11-11T08:00:00Z',
  },
  {
    id: 'prod-003',
    sku: 'BAG-EXP-03',
    name: 'Waterproof Travel Laptop Backpack 15.6"',
    nameAr: 'حقيبة ظهر للابتوب مقاومة للماء 15.6 بوصة',
    imageUrl: sampleImages.backpack,
    category: 'Bags & Luggage',
    baseCost: 45,
    currentPrice: 89,
    physicalStock: 80,
    availableStock: 74,
    reservedStock: 6,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 89,
        quantity: 40,
        listingStatus: 'active',
        lastUpdated: '2026-11-05T09:00:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 92,
        quantity: 34,
        listingStatus: 'active',
        lastUpdated: '2026-11-07T16:20:00Z',
      },
    },
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-11-07T16:20:00Z',
  },
  {
    id: 'prod-004',
    sku: 'HOME-COFFEE-04',
    name: 'Espresso Maker Portable Stainless Steel',
    nameAr: 'ماكينة إسبريسو محمولة من الستانلس ستيل',
    imageUrl: sampleImages.coffeeMaker,
    category: 'Home & Kitchen',
    baseCost: 65,
    currentPrice: 119,
    physicalStock: 25,
    availableStock: 21,
    reservedStock: 4,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 119,
        quantity: 10,
        listingStatus: 'active',
        lastUpdated: '2026-11-01T10:00:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 125,
        quantity: 11,
        listingStatus: 'active',
        lastUpdated: '2026-11-04T11:00:00Z',
      },
    },
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-11-04T11:00:00Z',
  },
  {
    id: 'prod-005',
    sku: 'FASH-SNEAK-05',
    name: 'Performance Running Shoes Air Cushion - Red',
    nameAr: 'حذاء ركض رياضي مع وسادة هوائية - أحمر',
    imageUrl: sampleImages.sneakers,
    category: 'Footwear',
    baseCost: 80,
    currentPrice: 145,
    physicalStock: 18,
    availableStock: 14,
    reservedStock: 4,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 145,
        quantity: 8,
        listingStatus: 'active',
        lastUpdated: '2026-11-06T15:00:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 149,
        quantity: 6,
        listingStatus: 'active',
        lastUpdated: '2026-11-08T09:30:00Z',
      },
    },
    createdAt: '2026-10-25T12:00:00Z',
    updatedAt: '2026-11-08T09:30:00Z',
  },
  {
    id: 'prod-006',
    sku: 'TECH-PWR-06',
    name: 'Magnetic Fast Charge Power Bank 20000mAh',
    nameAr: 'شاحن متنقل مغناطيسي شحن سريع 20000 ملي أمبير',
    imageUrl: sampleImages.powerbank,
    category: 'Electronics',
    baseCost: 40,
    currentPrice: 79,
    physicalStock: 90,
    availableStock: 82,
    reservedStock: 8,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 79,
        quantity: 42,
        listingStatus: 'active',
        lastUpdated: '2026-11-02T13:00:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 82,
        quantity: 40,
        listingStatus: 'active',
        lastUpdated: '2026-11-09T18:00:00Z',
      },
    },
    createdAt: '2026-10-28T14:00:00Z',
    updatedAt: '2026-11-09T18:00:00Z',
  },
  {
    id: 'prod-007',
    sku: 'ACC-SUN-07',
    name: 'Polarized Aviator Sunglasses UV400',
    nameAr: 'نظارات شمسية بولارايزد لحماية من الأشعة فوق البنفسجية',
    imageUrl: sampleImages.sunglasses,
    category: 'Accessories',
    baseCost: 25,
    currentPrice: 59,
    physicalStock: 12,
    availableStock: 4,
    reservedStock: 8,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 59,
        quantity: 2,
        listingStatus: 'active',
        lastUpdated: '2026-11-10T11:00:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 65,
        quantity: 2,
        listingStatus: 'active',
        lastUpdated: '2026-11-09T14:00:00Z',
      },
    },
    createdAt: '2026-10-30T10:00:00Z',
    updatedAt: '2026-11-10T11:00:00Z',
  },
  {
    id: 'prod-008',
    sku: 'TECH-KEY-08',
    name: 'Mechanical RGB Gaming Keyboard Hot-Swappable',
    nameAr: 'لوحة مفاتيح ميكانيكية بإضاءة RGB مفاتيح قابلة للتبديل',
    imageUrl: sampleImages.keyboard,
    category: 'Gaming',
    baseCost: 110,
    currentPrice: 199,
    physicalStock: 30,
    availableStock: 25,
    reservedStock: 5,
    marketplaceListings: {
      noon: {
        marketplaceId: 'noon',
        price: 199,
        quantity: 13,
        listingStatus: 'active',
        lastUpdated: '2026-11-04T12:00:00Z',
      },
      amazon: {
        marketplaceId: 'amazon',
        price: 209,
        quantity: 12,
        listingStatus: 'active',
        lastUpdated: '2026-11-07T10:00:00Z',
      },
    },
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-07T10:00:00Z',
  },
];

// Initial realistic orders
export const DEFAULT_ORDERS: Order[] = [
  // --- Today (2026-11-11) ---
  {
    id: 'ORD-9825',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-002',
        productSku: 'AUDIO-HEAD-02',
        productName: 'Wireless ANC Headphones Pro - Matte Black',
        imageUrl: sampleImages.headphones,
        unitPrice: 169,
        quantity: 1,
      },
    ],
    totalAmount: 169,
    status: 'delivered',
    customerName: 'فيصل الغامدي',
    shippingAddress: 'جدة - حي الروضة',
    notes: 'تم التسليم السريع بنجاح',
    orderDate: '2026-11-11T06:30:00Z',
    deliveredDate: '2026-11-11T08:30:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-11-11T08:30:00Z',
    createdAt: '2026-11-11T06:30:00Z',
    updatedAt: '2026-11-11T08:30:00Z',
  },
  {
    id: 'ORD-9821',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-001',
        productSku: 'ELEC-WATCH-01',
        productName: 'Smart Watch Series 8 Ultra - 49mm Titanium',
        imageUrl: sampleImages.smartWatch,
        unitPrice: 289,
        quantity: 2,
      },
    ],
    totalAmount: 578,
    status: 'preparing',
    customerName: 'فهد السبيعي',
    shippingAddress: 'الرياض - حي الياسمين',
    notes: 'توصيل عاجل - نون إكسبريس',
    orderDate: '2026-11-11T07:15:00Z',
    stockDeducted: true,
    isClosed: false,
    createdAt: '2026-11-11T07:15:00Z',
    updatedAt: '2026-11-11T07:15:00Z',
  },

  // --- Last 7 Days (2026-11-05 to 2026-11-10) ---
  {
    id: 'ORD-9820',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-002',
        productSku: 'AUDIO-HEAD-02',
        productName: 'Wireless ANC Headphones Pro - Matte Black',
        imageUrl: sampleImages.headphones,
        unitPrice: 169,
        quantity: 1,
      },
      {
        productId: 'prod-006',
        productSku: 'TECH-PWR-06',
        productName: 'Magnetic Fast Charge Power Bank 20000mAh',
        imageUrl: sampleImages.powerbank,
        unitPrice: 82,
        quantity: 1,
      },
    ],
    totalAmount: 251,
    status: 'with_delivery',
    customerName: 'سارة الدوسري',
    shippingAddress: 'جدة - حي الشاطئ',
    notes: 'شحن أمازون برايم',
    orderDate: '2026-11-10T16:20:00Z',
    stockDeducted: true,
    isClosed: false,
    createdAt: '2026-11-10T16:20:00Z',
    updatedAt: '2026-11-11T06:00:00Z',
  },
  {
    id: 'ORD-9818',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-003',
        productSku: 'BAG-EXP-03',
        productName: 'Waterproof Travel Laptop Backpack 15.6"',
        imageUrl: sampleImages.backpack,
        unitPrice: 89,
        quantity: 1,
      },
    ],
    totalAmount: 89,
    status: 'delivered',
    customerName: 'خالد المطيري',
    shippingAddress: 'الدمام - حي الفيصلية',
    notes: 'تم التسليم بنجاح للعميل',
    orderDate: '2026-11-09T11:00:00Z',
    deliveredDate: '2026-11-10T18:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-11-10T18:00:00Z',
    createdAt: '2026-11-09T11:00:00Z',
    updatedAt: '2026-11-10T18:00:00Z',
  },
  {
    id: 'ORD-9817',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-004',
        productSku: 'HOME-COFFEE-04',
        productName: 'Espresso Maker Portable Stainless Steel',
        imageUrl: sampleImages.coffeeMaker,
        unitPrice: 125,
        quantity: 2,
      },
    ],
    totalAmount: 250,
    status: 'delivered',
    customerName: 'ماجد الشمري',
    shippingAddress: 'حائل - حي النقرة',
    notes: 'تم الاستلام والدفع الإلكتروني',
    orderDate: '2026-11-08T10:00:00Z',
    deliveredDate: '2026-11-09T16:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-11-09T16:00:00Z',
    createdAt: '2026-11-08T10:00:00Z',
    updatedAt: '2026-11-09T16:00:00Z',
  },
  {
    id: 'ORD-9815',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-007',
        productSku: 'ACC-SUN-07',
        productName: 'Polarized Aviator Sunglasses UV400',
        imageUrl: sampleImages.sunglasses,
        unitPrice: 59,
        quantity: 1,
      },
    ],
    totalAmount: 59,
    status: 'rejected',
    customerName: 'تركي العتيبي',
    shippingAddress: 'مكة المكرمة - الشوقية',
    notes: 'رفض استلام COD - عدم تواجد العميل',
    orderDate: '2026-11-09T14:00:00Z',
    stockDeducted: true,
    isClosed: false,
    createdAt: '2026-11-09T14:00:00Z',
    updatedAt: '2026-11-10T12:00:00Z',
  },
  {
    id: 'ORD-9812',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-004',
        productSku: 'HOME-COFFEE-04',
        productName: 'Espresso Maker Portable Stainless Steel',
        imageUrl: sampleImages.coffeeMaker,
        unitPrice: 125,
        quantity: 1,
      },
    ],
    totalAmount: 125,
    status: 'rejected',
    customerName: 'عبدالعزيز العمري',
    shippingAddress: 'المدينة المنورة - حي الخالدية',
    notes: 'طلب إرجاع بعد الفتح - قيد الفحص بالمستودع',
    orderDate: '2026-11-07T12:00:00Z',
    stockDeducted: true,
    isClosed: false,
    createdAt: '2026-11-07T12:00:00Z',
    updatedAt: '2026-11-09T15:30:00Z',
  },
  {
    id: 'ORD-9810',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-008',
        productSku: 'TECH-KEY-08',
        productName: 'Mechanical RGB Gaming Keyboard Hot-Swappable',
        imageUrl: sampleImages.keyboard,
        unitPrice: 209,
        quantity: 1,
      },
    ],
    totalAmount: 209,
    status: 'delivered',
    customerName: 'عمر باوزير',
    shippingAddress: 'الرياض - حي الملز',
    notes: 'تم الاستلام والتوقيع',
    orderDate: '2026-11-05T10:00:00Z',
    deliveredDate: '2026-11-07T14:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-11-07T14:00:00Z',
    createdAt: '2026-11-05T10:00:00Z',
    updatedAt: '2026-11-07T14:00:00Z',
  },
  {
    id: 'ORD-9808',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-005',
        productSku: 'FOOT-RUN-05',
        productName: 'Pro Cushion Running Sneakers Lightweight',
        imageUrl: sampleImages.sneakers,
        unitPrice: 249,
        quantity: 2,
      },
    ],
    totalAmount: 498,
    status: 'delivered',
    customerName: 'ريان الحربي',
    shippingAddress: 'الخبر - حي الحزام الذهبي',
    notes: 'توصيل شاحنة أمازون برايم',
    orderDate: '2026-11-05T15:30:00Z',
    deliveredDate: '2026-11-07T11:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-11-07T11:00:00Z',
    createdAt: '2026-11-05T15:30:00Z',
    updatedAt: '2026-11-07T11:00:00Z',
  },
  {
    id: 'ORD-9805',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-007',
        productSku: 'ACC-SUN-07',
        productName: 'Polarized Aviator Sunglasses UV400',
        imageUrl: sampleImages.sunglasses,
        unitPrice: 59,
        quantity: 1,
      },
    ],
    totalAmount: 59,
    status: 'rejected',
    customerName: 'عبدالرحمن العتيبي',
    shippingAddress: 'مكة المكرمة - العزيزية',
    notes: 'اكتملت دورة المرتجع وتم إغلاق الطلب نهائياً',
    orderDate: '2026-11-04T09:30:00Z',
    stockDeducted: true,
    isClosed: true,
    closedReason: 'return_completed',
    closedAt: '2026-11-08T15:00:00Z',
    createdAt: '2026-11-04T09:30:00Z',
    updatedAt: '2026-11-08T15:00:00Z',
  },

  // --- Earlier in Month / Last 30 Days (2026-10-15 to 2026-11-04) ---
  {
    id: 'ORD-9801',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-001',
        productSku: 'ELEC-WATCH-01',
        productName: 'Smart Watch Series 8 Ultra - 49mm Titanium',
        imageUrl: sampleImages.smartWatch,
        unitPrice: 289,
        quantity: 3,
      },
    ],
    totalAmount: 867,
    status: 'delivered',
    customerName: 'ياسر القحطاني',
    shippingAddress: 'أبها - حي المنسك',
    notes: 'شحنة نون إكسبريس مؤمنة',
    orderDate: '2026-11-01T11:00:00Z',
    deliveredDate: '2026-11-03T17:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-11-03T17:00:00Z',
    createdAt: '2026-11-01T11:00:00Z',
    updatedAt: '2026-11-03T17:00:00Z',
  },
  {
    id: 'ORD-9795',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-003',
        productSku: 'BAG-EXP-03',
        productName: 'Waterproof Travel Laptop Backpack 15.6"',
        imageUrl: sampleImages.backpack,
        unitPrice: 89,
        quantity: 2,
      },
    ],
    totalAmount: 178,
    status: 'delivered',
    customerName: 'سلطان العنزي',
    shippingAddress: 'تبوك - حي المروج',
    notes: 'تسليم برايم',
    orderDate: '2026-10-28T09:00:00Z',
    deliveredDate: '2026-10-30T13:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-10-30T13:00:00Z',
    createdAt: '2026-10-28T09:00:00Z',
    updatedAt: '2026-10-30T13:00:00Z',
  },
  {
    id: 'ORD-9790',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-006',
        productSku: 'TECH-PWR-06',
        productName: 'Magnetic Fast Charge Power Bank 20000mAh',
        imageUrl: sampleImages.powerbank,
        unitPrice: 79,
        quantity: 3,
      },
    ],
    totalAmount: 237,
    status: 'delivered',
    customerName: 'بندر الشهري',
    shippingAddress: 'الطائف - حي شهار',
    notes: 'تسليم بنجاح',
    orderDate: '2026-10-26T14:00:00Z',
    deliveredDate: '2026-10-28T16:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-10-28T16:00:00Z',
    createdAt: '2026-10-26T14:00:00Z',
    updatedAt: '2026-10-28T16:00:00Z',
  },

  // --- Previous Month (2026-10-01 to 2026-10-31) ---
  {
    id: 'ORD-9750',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-001',
        productSku: 'ELEC-WATCH-01',
        productName: 'Smart Watch Series 8 Ultra - 49mm Titanium',
        imageUrl: sampleImages.smartWatch,
        unitPrice: 289,
        quantity: 2,
      },
    ],
    totalAmount: 578,
    status: 'delivered',
    customerName: 'سعود المالكي',
    shippingAddress: 'جدة - حي الحمراء',
    notes: 'طلب من الشهر السابق',
    orderDate: '2026-10-15T11:00:00Z',
    deliveredDate: '2026-10-17T15:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-10-17T15:00:00Z',
    createdAt: '2026-10-15T11:00:00Z',
    updatedAt: '2026-10-17T15:00:00Z',
  },
  {
    id: 'ORD-9740',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-005',
        productSku: 'FOOT-RUN-05',
        productName: 'Pro Cushion Running Sneakers Lightweight',
        imageUrl: sampleImages.sneakers,
        unitPrice: 249,
        quantity: 1,
      },
    ],
    totalAmount: 249,
    status: 'delivered',
    customerName: 'عبدالله باحميد',
    shippingAddress: 'الرياض - حي العليا',
    notes: 'طلب مكتمل',
    orderDate: '2026-10-10T10:00:00Z',
    deliveredDate: '2026-10-12T14:00:00Z',
    stockDeducted: true,
    deliveredProcessed: true,
    isClosed: true,
    closedReason: 'delivered',
    closedAt: '2026-10-12T14:00:00Z',
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-12T14:00:00Z',
  },
  {
    id: 'ORD-9730',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-002',
        productSku: 'AUDIO-HEAD-02',
        productName: 'Wireless ANC Headphones Pro - Matte Black',
        imageUrl: sampleImages.headphones,
        unitPrice: 169,
        quantity: 1,
      },
    ],
    totalAmount: 169,
    status: 'rejected',
    customerName: 'مشعل الرويلي',
    shippingAddress: 'عرعر - حي المحمدية',
    notes: 'مرتجع تالف تم شطبه',
    orderDate: '2026-10-08T12:00:00Z',
    stockDeducted: true,
    isClosed: true,
    closedReason: 'return_completed',
    closedAt: '2026-10-14T10:00:00Z',
    createdAt: '2026-10-08T12:00:00Z',
    updatedAt: '2026-10-14T10:00:00Z',
  },
];

// Initial realistic returns records
export const DEFAULT_RETURNS: ReturnRecord[] = [
  // Active Return (In Transit Back)
  {
    id: 'RET-001',
    orderId: 'ORD-9815',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-007',
        productSku: 'ACC-SUN-07',
        productName: 'Polarized Aviator Sunglasses UV400',
        imageUrl: sampleImages.sunglasses,
        unitPrice: 59,
        quantity: 1,
      },
    ],
    returnReason: 'رفض استلام عند الباب (COD Rejected) - عدم تواجد العميل',
    returnStatus: 'in_transit_back',
    physicalCondition: undefined,
    stockRestored: false,
    isCompleted: false,
    notes: 'الشحنة مع مندوب شركة الشحن في طريق العودة إلى المستودع',
    createdAt: '2026-11-10T12:00:00Z',
    updatedAt: '2026-11-10T12:00:00Z',
  },
  // Active Return (Awaiting Inspection)
  {
    id: 'RET-002',
    orderId: 'ORD-9812',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-004',
        productSku: 'HOME-COFFEE-04',
        productName: 'Espresso Maker Portable Stainless Steel',
        imageUrl: sampleImages.coffeeMaker,
        unitPrice: 125,
        quantity: 1,
      },
    ],
    returnReason: 'العميل قام بفتح العبوة وطلب الاسترجاع بدون استخدام',
    returnStatus: 'under_inspection',
    physicalCondition: 'opened_good',
    stockRestored: false,
    isCompleted: false,
    notes: 'تم استلام الطرد في مستودع البائع وجاري تقييم حالة العبوة الداخلية',
    createdAt: '2026-11-09T15:30:00Z',
    updatedAt: '2026-11-11T07:00:00Z',
  },
  // Completed Return (Restocked)
  {
    id: 'RET-003',
    orderId: 'ORD-9805',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-007',
        productSku: 'ACC-SUN-07',
        productName: 'Polarized Aviator Sunglasses UV400',
        imageUrl: sampleImages.sunglasses,
        unitPrice: 59,
        quantity: 1,
      },
    ],
    returnReason: 'رفض استلام COD - تمت إعادة الفحص واعتماد الصلاحية للبيع',
    returnStatus: 'restocked',
    physicalCondition: 'like_new',
    stockRestored: true,
    isCompleted: true,
    notes: 'تم فحص المنتج والتأكد من سلامته وإعادته للمخزون المتاح',
    createdAt: '2026-11-05T12:00:00Z',
    updatedAt: '2026-11-08T15:00:00Z',
  },
  // Completed Return (Damaged / Written Off)
  {
    id: 'RET-004',
    orderId: 'ORD-9730',
    marketplaceId: 'amazon',
    items: [
      {
        productId: 'prod-002',
        productSku: 'AUDIO-HEAD-02',
        productName: 'Wireless ANC Headphones Pro - Matte Black',
        imageUrl: sampleImages.headphones,
        unitPrice: 169,
        quantity: 1,
      },
    ],
    returnReason: 'كسر في قوس السماعة أثناء الشحن - تالف وغير صالح للبيع',
    returnStatus: 'damaged',
    physicalCondition: 'damaged',
    stockRestored: false,
    isCompleted: true,
    notes: 'تم فحص الشحنة وتأكيد تلفها الكامل وشطبها من المخزون',
    createdAt: '2026-10-09T14:00:00Z',
    updatedAt: '2026-10-14T10:00:00Z',
  },
];

// Initial realistic price history
export const DEFAULT_PRICE_HISTORY: PriceHistoryRecord[] = [
  {
    id: 'ph-001',
    productId: 'prod-001',
    productSku: 'ELEC-WATCH-01',
    productName: 'Smart Watch Series 8 Ultra - 49mm Titanium',
    marketplaceId: 'noon',
    previousPrice: 319,
    newPrice: 289,
    percentageDiff: -9.4,
    changeType: 'decrease',
    reason: 'عروض الجمعة الصفراء / خصم تنافسي',
    changedBy: 'أحمد إبراهيم',
    timestamp: '2026-11-10T14:30:00Z',
  },
  {
    id: 'ph-002',
    productId: 'prod-002',
    productSku: 'AUDIO-HEAD-02',
    productName: 'Wireless ANC Headphones Pro - Matte Black',
    marketplaceId: 'amazon',
    previousPrice: 155,
    newPrice: 169,
    percentageDiff: 9.03,
    changeType: 'increase',
    reason: 'تعديل السعر بعد ارتفاع رسوم الشحن السريع FBA',
    changedBy: 'أحمد إبراهيم',
    timestamp: '2026-11-08T12:00:00Z',
  },
];

// Initial realistic movements
export const DEFAULT_MOVEMENTS: StockMovement[] = [
  {
    id: 'mov-001',
    productId: 'prod-001',
    productSku: 'ELEC-WATCH-01',
    productName: 'Smart Watch Series 8 Ultra - 49mm Titanium',
    marketplaceId: 'noon',
    type: 'order_created',
    quantityChange: -2,
    previousPhysical: 65,
    newPhysical: 65,
    previousAvailable: 54,
    newAvailable: 52,
    referenceOrderId: 'ORD-9821',
    reason: 'حجز مخزون للطلب الجديد #ORD-9821 عبر نون',
    operator: 'النظام الآلي',
    timestamp: '2026-11-11T07:15:00Z',
  },
  {
    id: 'mov-002',
    productId: 'prod-002',
    productSku: 'AUDIO-HEAD-02',
    productName: 'Wireless ANC Headphones Pro - Matte Black',
    marketplaceId: 'amazon',
    type: 'order_created',
    quantityChange: -1,
    previousPhysical: 40,
    newPhysical: 40,
    previousAvailable: 35,
    newAvailable: 34,
    referenceOrderId: 'ORD-9820',
    reason: 'حجز مخزون للطلب الجديد #ORD-9820 عبر أمازون',
    operator: 'النظام الآلي',
    timestamp: '2026-11-10T16:20:00Z',
  },
  {
    id: 'mov-003',
    productId: 'prod-003',
    productSku: 'BAG-EXP-03',
    productName: 'Waterproof Travel Laptop Backpack 15.6"',
    marketplaceId: 'noon',
    type: 'order_delivered',
    quantityChange: -1,
    previousPhysical: 81,
    newPhysical: 80,
    previousAvailable: 74,
    newAvailable: 74,
    referenceOrderId: 'ORD-9818',
    reason: 'تأكيد تسليم الطلب #ORD-9818 للعميل وخصم المخزون الفعلي نهائياً',
    operator: 'مندوب الشحن',
    timestamp: '2026-11-10T18:00:00Z',
  },
];

class StorageService {
  private get<T>(key: string, defaultVal: T): T {
    try {
      const data = localStorage.getItem(key);
      if (!data) return defaultVal;
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`Failed to read ${key} from storage:`, e);
      return defaultVal;
    }
  }

  private set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Failed to write ${key} to storage:`, e);
    }
  }

  public init(): void {
    if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
      this.set(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.ORDERS)) {
      this.set(STORAGE_KEYS.ORDERS, DEFAULT_ORDERS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.MOVEMENTS)) {
      this.set(STORAGE_KEYS.MOVEMENTS, DEFAULT_MOVEMENTS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.RETURNS)) {
      this.set(STORAGE_KEYS.RETURNS, DEFAULT_RETURNS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.PRICE_HISTORY)) {
      this.set(STORAGE_KEYS.PRICE_HISTORY, DEFAULT_PRICE_HISTORY);
    }
    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
      this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    }
  }

  public resetToSample(): void {
    this.set(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
    this.set(STORAGE_KEYS.ORDERS, DEFAULT_ORDERS);
    this.set(STORAGE_KEYS.MOVEMENTS, DEFAULT_MOVEMENTS);
    this.set(STORAGE_KEYS.RETURNS, DEFAULT_RETURNS);
    this.set(STORAGE_KEYS.PRICE_HISTORY, DEFAULT_PRICE_HISTORY);
    this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }

  // --- Products ---
  public getProducts(): Product[] {
    const raw = this.get<Product[]>(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
    return raw.map((p) => {
      const avail = typeof p.availableStock === 'number' ? p.availableStock : 0;
      const res = typeof p.reservedStock === 'number' ? p.reservedStock : 0;
      const awaitInsp = typeof p.awaitingInspectionStock === 'number' ? p.awaitingInspectionStock : 0;
      const dmg = typeof p.damagedStock === 'number' ? p.damagedStock : 0;
      const outTransit = typeof p.outboundInTransitStock === 'number' ? p.outboundInTransitStock : 0;
      const retTransit = typeof p.returnInTransitStock === 'number' ? p.returnInTransitStock : 0;
      const phys = typeof p.physicalStock === 'number' ? p.physicalStock : avail + res + awaitInsp + dmg;
      return {
        ...p,
        availableStock: avail,
        reservedStock: res,
        awaitingInspectionStock: awaitInsp,
        damagedStock: dmg,
        outboundInTransitStock: outTransit,
        returnInTransitStock: retTransit,
        physicalStock: phys,
      };
    });
  }

  public getProductBySku(sku?: string): Product | undefined {
    if (!sku) return undefined;
    const trimmed = sku.trim().toLowerCase();
    return this.getProducts().find((p) => p.sku && p.sku.toLowerCase() === trimmed);
  }

  public getProductByName(name: string): Product | undefined {
    const trimmed = name.trim().toLowerCase();
    return this.getProducts().find(
      (p) =>
        p.name.toLowerCase() === trimmed ||
        (p.nameAr && p.nameAr.toLowerCase() === trimmed)
    );
  }

  public getProductById(id: string): Product | undefined {
    return this.getProducts().find((p) => p.id === id);
  }

  public saveProduct(product: Product): void {
    const products = this.getProducts();
    const index = products.findIndex((p) => p.id === product.id);
    if (index >= 0) {
      products[index] = { ...product, updatedAt: new Date().toISOString() };
    } else {
      products.unshift({
        ...product,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    this.set(STORAGE_KEYS.PRODUCTS, products);
  }

  public deleteProduct(id: string): boolean {
    const products = this.getProducts().filter((p) => p.id !== id);
    this.set(STORAGE_KEYS.PRODUCTS, products);
    return true;
  }

  public updateProductPrice(
    productId: string,
    marketplaceId: MarketplaceId,
    newPrice: number,
    reason?: string,
    changedBy: string = 'مدير العمليات'
  ): PriceHistoryRecord | null {
    const products = this.getProducts();
    const product = products.find((p) => p.id === productId);
    if (!product) return null;

    const previousPrice =
      product.marketplaceListings[marketplaceId]?.price || product.currentPrice;

    if (previousPrice === newPrice) return null;

    const diff = newPrice - previousPrice;
    const percentageDiff = Number(((diff / previousPrice) * 100).toFixed(2));
    const changeType =
      diff > 0 ? 'increase' : diff < 0 ? 'decrease' : 'no_change';

    if (!product.marketplaceListings[marketplaceId]) {
      product.marketplaceListings[marketplaceId] = {
        marketplaceId,
        price: newPrice,
        quantity: 0,
        listingStatus: 'active',
        lastUpdated: new Date().toISOString(),
      };
    } else {
      product.marketplaceListings[marketplaceId].price = newPrice;
      product.marketplaceListings[marketplaceId].lastUpdated =
        new Date().toISOString();
    }

    product.currentPrice = newPrice;
    product.updatedAt = new Date().toISOString();
    this.set(STORAGE_KEYS.PRODUCTS, products);

    const historyRecord: PriceHistoryRecord = {
      id: `ph-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      productId: product.id,
      productSku: product.sku || product.name,
      productName: product.name,
      marketplaceId,
      previousPrice,
      newPrice,
      percentageDiff,
      changeType,
      reason: reason || undefined,
      changedBy,
      timestamp: new Date().toISOString(),
    };

    const history = this.getPriceHistory();
    history.unshift(historyRecord);
    this.set(STORAGE_KEYS.PRICE_HISTORY, history);

    return historyRecord;
  }

  // --- Orders & Strict Inventory Logic ---
  public getOrders(): Order[] {
    return this.get<Order[]>(STORAGE_KEYS.ORDERS, DEFAULT_ORDERS);
  }

  /**
   * Returns active operational orders only (not closed).
   */
  public getActiveOrders(): Order[] {
    return this.getOrders().filter((o) => !o.isClosed);
  }

  /**
   * Returns closed/completed orders.
   */
  public getCompletedOrders(): Order[] {
    return this.getOrders().filter((o) => o.isClosed === true);
  }

  /**
   * Creates an order with strict stock deduction and reservation.
   * 1. Validate stock availability.
   * 2. Deduct ordered quantity from available stock.
   * 3. Increase reserved stock.
   * 4. Deduct ordered quantity from selected marketplace stock.
   * 5. Record stock movement and link with order ID.
   * 6. Prevent duplicate deductions.
   */
  public createOrder(
    orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'stockDeducted' | 'isClosed'>,
    customId?: string,
    operator: string = 'مدير العمليات'
  ): { success: boolean; order?: Order; error?: string } {
    const products = this.getProducts();

    // 1. Validate availability for all items first
    for (const item of orderData.items) {
      const product = products.find(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (!product) {
        return { success: false, error: `المنتج (${item.productName || item.productSku}) غير موجود في النظام.` };
      }
      if (product.availableStock < item.quantity) {
        return {
          success: false,
          error: `الكمية المطلوبة للمنتج (${product.name}) تتجاوز المخزون المتاح حالياً (${product.availableStock} قطعة متاحة).`,
        };
      }
    }

    const orderId =
      customId && customId.trim()
        ? customId.trim()
        : `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

    const existingOrders = this.getOrders();
    if (existingOrders.some((o) => o.id === orderId)) {
      return { success: false, error: `رقم الطلب ${orderId} مسجل مسبقاً في النظام.` };
    }

    const newMovements: StockMovement[] = [];

    // 2. Perform stock deductions & reservations
    for (const item of orderData.items) {
      const product = products.find(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      )!;
      const prevAvailable = product.availableStock;
      const prevPhysical = product.physicalStock;

      // Deduct from available, add to reserved
      product.availableStock = Math.max(0, product.availableStock - item.quantity);
      product.reservedStock += item.quantity;

      // Deduct from the selected marketplace listing only
      if (product.marketplaceListings[orderData.marketplaceId]) {
        const currentMktQty = product.marketplaceListings[orderData.marketplaceId].quantity;
        product.marketplaceListings[orderData.marketplaceId].quantity = Math.max(
          0,
          currentMktQty - item.quantity
        );
        product.marketplaceListings[orderData.marketplaceId].lastUpdated =
          new Date().toISOString();
      }

      product.updatedAt = new Date().toISOString();

      newMovements.push({
        id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        productId: product.id,
        productSku: product.sku || product.name,
        productName: product.name,
        marketplaceId: orderData.marketplaceId,
        type: 'order_created',
        quantityChange: -item.quantity,
        previousPhysical: prevPhysical,
        newPhysical: product.physicalStock,
        previousAvailable: prevAvailable,
        newAvailable: product.availableStock,
        referenceOrderId: orderId,
        reason: `حجز مخزون للطلب الجديد #${orderId} عبر ${orderData.marketplaceId}`,
        operator,
        timestamp: new Date().toISOString(),
      });
    }

    const newOrder: Order = {
      ...orderData,
      id: orderId,
      stockDeducted: true,
      deliveredProcessed: false,
      isClosed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.set(STORAGE_KEYS.PRODUCTS, products);

    existingOrders.unshift(newOrder);
    this.set(STORAGE_KEYS.ORDERS, existingOrders);

    const movements = this.getMovements();
    movements.unshift(...newMovements);
    this.set(STORAGE_KEYS.MOVEMENTS, movements);

    return { success: true, order: newOrder };
  }

  /**
  /**
   * Updates order status with strict custody lifecycle rules:
   * - with_delivery: moves stock from reservedStock to outboundInTransitStock.
   * - delivered: deducts from outboundInTransitStock and physicalStock once. Records financial revenue. Closes order.
   * - rejected: moves from outboundInTransitStock to returnInTransitStock. Initiates return record.
   * - cancelled: releases reservedStock back to availableStock. Closes order.
   */
  public updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    operator: string = 'مدير العمليات',
    shipmentDetails?: Partial<ShipmentRecord>
  ): { success: boolean; error?: string } {
    const orders = this.getOrders();
    const orderIndex = orders.findIndex((o) => o.id === orderId);
    if (orderIndex < 0) return { success: false, error: 'الطلب غير موجود.' };

    const order = orders[orderIndex];
    if (order.isClosed && newStatus !== 'delivered') {
      return {
        success: false,
        error: 'هذا الطلب مغلق ومكتمل مسبقاً، لا يمكن تعديل حالته من قائمة الطلبات النشطة.',
      };
    }

    const prevStatus = order.status;
    if (prevStatus === newStatus) return { success: true };

    const products = this.getProducts();
    const newMovements: StockMovement[] = [];
    const activities = order.activities || [];

    // 1. Handover to courier (with_delivery)
    if (newStatus === 'with_delivery' && prevStatus !== 'with_delivery') {
      for (const item of order.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          const prevAvail = product.availableStock;
          const prevPhys = product.physicalStock;

          // Transition: Reserved -> Outbound In Transit
          product.reservedStock = Math.max(0, product.reservedStock - item.quantity);
          product.outboundInTransitStock = (product.outboundInTransitStock || 0) + item.quantity;
          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            type: 'handover_to_courier',
            quantityChange: -item.quantity,
            previousPhysical: prevPhys,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'محجوز بالمستودع',
            toCustody: 'خارج المستودع (مع شركة الشحن)',
            referenceOrderId: order.id,
            reason: `تسليم الشحنة لشركة الشحن (${order.courierName || shipmentDetails?.courierName || 'المندوب'}) للطلب #${order.id}`,
            operator,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (shipmentDetails) {
        order.shipment = {
          courierName: shipmentDetails.courierName || order.courierName || 'شركة الشحن',
          trackingNumber: shipmentDetails.trackingNumber || order.trackingNumber || 'TRK-AUTO',
          ...order.shipment,
          ...shipmentDetails,
        };
        order.courierName = order.shipment.courierName;
        order.trackingNumber = order.shipment.trackingNumber;
      }

      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        action: 'handover_to_courier',
        actionAr: 'تم تسليم الشحنة لشركة التوصيل ونقل الحيازة خارج المستودع',
        operator,
        previousState: prevStatus,
        newState: newStatus,
        notes: `رقم التتبع: ${order.trackingNumber || 'غير محدد'}`,
      });
    }

    // 2. Order Delivered: Successful Delivery
    if (newStatus === 'delivered' && !order.deliveredProcessed) {
      for (const item of order.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;

          // Transition: deduct from outbound transit & deduct from physical stock
          if (product.outboundInTransitStock && product.outboundInTransitStock >= item.quantity) {
            product.outboundInTransitStock = Math.max(0, product.outboundInTransitStock - item.quantity);
          } else {
            product.reservedStock = Math.max(0, product.reservedStock - item.quantity);
          }

          product.physicalStock = Math.max(0, product.physicalStock - item.quantity);
          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            type: 'order_delivered',
            quantityChange: -item.quantity,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'في الطريق مع المندوب',
            toCustody: 'تم التسليم النهائي للعميل (مباع)',
            referenceOrderId: order.id,
            reason: `تأكيد تسليم الطلب #${order.id} للعميل وخصم المخزون الفعلي نهائياً`,
            operator,
            timestamp: new Date().toISOString(),
          });
        }
      }

      order.deliveredDate = new Date().toISOString();
      order.deliveredProcessed = true;
      order.isClosed = true;
      order.closedReason = 'delivered';
      order.closedAt = new Date().toISOString();

      // Record financial transactions
      this.recordFinancialTransaction({
        orderId: order.id,
        marketplaceId: order.marketplaceId,
        type: 'sale_revenue',
        amount: order.totalAmount,
        currency: 'SAR',
        status: 'confirmed',
        source: 'automatic',
        notes: `إيراد بيع مؤكد للطلب المكتمل #${order.id}`,
      });

      if (order.shippingCost && order.shippingCost > 0) {
        this.recordFinancialTransaction({
          orderId: order.id,
          marketplaceId: order.marketplaceId,
          type: 'courier_shipping',
          amount: order.shippingCost,
          currency: 'SAR',
          status: 'confirmed',
          source: 'automatic',
          notes: `رسوم شحن لشركة التوصيل للطلب #${order.id}`,
        });
      }

      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        action: 'delivered',
        actionAr: 'تم تأكيد التوصيل الناجح للعميل وإغلاق الطلب وتسجيل الإيراد',
        operator,
        previousState: prevStatus,
        newState: newStatus,
      });
    }

    // 3. Order Cancelled before shipping: release reserved stock back to available stock
    if (newStatus === 'cancelled' && prevStatus !== 'cancelled' && !order.deliveredProcessed) {
      for (const item of order.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;

          product.reservedStock = Math.max(0, product.reservedStock - item.quantity);
          product.availableStock += item.quantity;

          if (product.marketplaceListings[order.marketplaceId]) {
            product.marketplaceListings[order.marketplaceId].quantity += item.quantity;
          }

          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            type: 'order_cancelled',
            quantityChange: item.quantity,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'محجوز بالمستودع',
            toCustody: 'متاح للبيع بالمستودع',
            referenceOrderId: order.id,
            reason: `إلغاء الطلب #${order.id} وإعادة الكمية المحجوزة للمخزون المتاح`,
            operator,
            timestamp: new Date().toISOString(),
          });
        }
      }
      order.isClosed = true;
      order.closedReason = 'cancelled';
      order.closedAt = new Date().toISOString();

      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        action: 'cancelled',
        actionAr: 'تم إلغاء الطلب وإرجاع الكمية المحجوزة للمخزون المتاح للبيع',
        operator,
        previousState: prevStatus,
        newState: newStatus,
      });
    }

    // 4. Customer rejects delivery / Return Initiated
    if (newStatus === 'rejected' && prevStatus !== 'rejected') {
      for (const item of order.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          // Transition: Outbound in transit -> Return in transit
          if (product.outboundInTransitStock && product.outboundInTransitStock >= item.quantity) {
            product.outboundInTransitStock = Math.max(0, product.outboundInTransitStock - item.quantity);
          } else {
            product.reservedStock = Math.max(0, product.reservedStock - item.quantity);
          }
          product.returnInTransitStock = (product.returnInTransitStock || 0) + item.quantity;
          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            type: 'return_initiated',
            quantityChange: 0,
            previousPhysical: product.physicalStock,
            newPhysical: product.physicalStock,
            previousAvailable: product.availableStock,
            newAvailable: product.availableStock,
            fromCustody: 'مع مندوب التوصيل',
            toCustody: 'مرتجع في طريق العودة للمستودع',
            referenceOrderId: order.id,
            reason: `رفض استلام الطلب #${order.id} - نقل الشحنة إلى مسار العودة ولا تُعاد للمخزون المتاح إلا بعد الفحص`,
            operator,
            timestamp: new Date().toISOString(),
          });
        }
      }

      const returns = this.getReturns();
      const existingReturn = returns.find((r) => r.orderId === order.id);
      if (!existingReturn) {
        const returnId = `RET-${Math.floor(100 + Math.random() * 900)}`;
        const newReturn: ReturnRecord = {
          id: returnId,
          orderId: order.id,
          marketplaceId: order.marketplaceId,
          items: order.items,
          returnReason: 'رفض العميل استلام الشحنة عند الباب (Delivery Rejected)',
          returnStatus: 'in_transit_back',
          stockRestored: false,
          isCompleted: false,
          courierName: order.courierName || 'شركة الشحن',
          trackingNumber: order.trackingNumber || 'RET-AUTO',
          returnShippingCost: 15,
          returnCostPayer: 'seller',
          notes: 'الشحنة قيد العودة من شركة الشحن، لا تعود للمخزون المتاح إلا بعد الاستلام الفعلي والفحص الفني.',
          activities: [
            {
              id: `act-${Date.now()}`,
              timestamp: new Date().toISOString(),
              type: 'system',
              action: 'return_initiated',
              actionAr: 'تم فتح ملف مرتجع ونقل الحيازة إلى: مرتجع في طريق العودة',
              operator,
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        returns.unshift(newReturn);
        this.set(STORAGE_KEYS.RETURNS, returns);

        // Record return shipping fee
        this.recordFinancialTransaction({
          orderId: order.id,
          returnId,
          marketplaceId: order.marketplaceId,
          type: 'return_shipping',
          amount: 15,
          currency: 'SAR',
          status: 'pending',
          source: 'automatic',
          notes: `رسوم شحن العودة المقدرة للمرتجع #${returnId}`,
        });
      }

      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        action: 'rejected',
        actionAr: 'تم رفض الاستلام من العميل وفتح سجل مرتجع في طريق العودة',
        operator,
        previousState: prevStatus,
        newState: newStatus,
      });
    }

    order.status = newStatus;
    order.activities = activities;
    order.updatedAt = new Date().toISOString();
    orders[orderIndex] = order;

    this.set(STORAGE_KEYS.ORDERS, orders);
    this.set(STORAGE_KEYS.PRODUCTS, products);

    if (newMovements.length > 0) {
      const movements = this.getMovements();
      movements.unshift(...newMovements);
      this.set(STORAGE_KEYS.MOVEMENTS, movements);
    }

    return { success: true };
  }

  // --- Returns Management ---
  public getReturns(): ReturnRecord[] {
    const raw = this.get<ReturnRecord[]>(STORAGE_KEYS.RETURNS, DEFAULT_RETURNS);
    return raw.map((r) => {
      let status: ReturnStatus = r.returnStatus;
      if (status === 'delivery_rejected') status = 'return_initiated';
      if (status === 'product_received') status = 'received_at_warehouse';
      return {
        ...r,
        returnStatus: status,
        activities: r.activities || [],
      };
    });
  }

  public getActiveReturns(): ReturnRecord[] {
    return this.getReturns().filter((r) => !r.isCompleted && r.returnStatus !== 'closed');
  }

  /**
   * Advances return through the 7-stage lifecycle with custody preservation.
   * - return_initiated -> pickup_pending -> in_transit_back
   * - in_transit_back -> received_at_warehouse:
   *   Moves quantity from returnInTransitStock to awaitingInspectionStock.
   *   Available stock remains untouched!
   */
  public advanceReturnStatus(
    returnId: string,
    targetStatus: ReturnStatus,
    operator: string = 'مدير العمليات',
    notes?: string,
    shipment?: Partial<ShipmentRecord>
  ): { success: boolean; error?: string } {
    const returns = this.getReturns();
    const retIndex = returns.findIndex((r) => r.id === returnId);
    if (retIndex === -1) return { success: false, error: 'سجل المرتجع غير موجود.' };

    const ret = returns[retIndex];
    if (ret.isCompleted || ret.returnStatus === 'closed') {
      return { success: false, error: 'هذا المرتجع مغلق ومكتمل مسبقاً.' };
    }

    const prevStatus = ret.returnStatus;
    const products = this.getProducts();
    const newMovements: StockMovement[] = [];
    const activities = ret.activities || [];

    // Arrived at warehouse: returnInTransit -> awaitingInspectionStock
    if (targetStatus === 'received_at_warehouse' && prevStatus !== 'received_at_warehouse') {
      for (const item of ret.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          const prevAvail = product.availableStock;
          const prevPhys = product.physicalStock;

          // Deduct from in-transit, add to awaiting inspection
          product.returnInTransitStock = Math.max(0, (product.returnInTransitStock || 0) - item.quantity);
          product.awaitingInspectionStock = (product.awaitingInspectionStock || 0) + item.quantity;
          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: ret.marketplaceId,
            type: 'return_received_warehouse',
            quantityChange: 0,
            previousPhysical: prevPhys,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'مرتجع في طريق العودة',
            toCustody: 'بانتظار الفحص بالمستودع (غير متاح للبيع)',
            referenceOrderId: ret.orderId,
            referenceReturnId: ret.id,
            reason: `استلام الطرد المرتجع بالمستودع #${ret.id} - بانتظار الفحص الفني قبل تحديد الصلاحية`,
            operator,
            timestamp: new Date().toISOString(),
          });
        }
      }

      ret.receivedAtWarehouseDate = new Date().toISOString();
      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        action: 'received_at_warehouse',
        actionAr: 'تم استلام الطرد بالمستودع ونقل الحيازة إلى: بانتظار الفحص الفني (لا يزال غير متاح للبيع)',
        operator,
        notes,
      });
    }

    if (shipment) {
      ret.shipment = {
        courierName: shipment.courierName || ret.courierName || 'شركة الشحن',
        trackingNumber: shipment.trackingNumber || ret.trackingNumber || 'TRK-RET',
        ...ret.shipment,
        ...shipment,
      };
      ret.courierName = ret.shipment.courierName;
      ret.trackingNumber = ret.shipment.trackingNumber;
    }

    ret.returnStatus = targetStatus;
    if (notes) ret.notes = notes;
    ret.activities = activities;
    ret.updatedAt = new Date().toISOString();

    returns[retIndex] = ret;
    this.set(STORAGE_KEYS.RETURNS, returns);
    this.set(STORAGE_KEYS.PRODUCTS, products);

    if (newMovements.length > 0) {
      const movements = this.getMovements();
      movements.unshift(...newMovements);
      this.set(STORAGE_KEYS.MOVEMENTS, movements);
    }

    return { success: true };
  }

  /**
   * Completes Return Inspection (Restockable vs Damaged vs Missing vs Requires Action).
   * Explains consequences before execution:
   * - restockable: Moves from awaitingInspectionStock to availableStock. (If post-delivery return, also physicalStock).
   * - damaged: Moves from awaitingInspectionStock to damagedStock. NEVER enters availableStock. Records financial loss.
   * - missing: Written off.
   * - requires_action: Stays in awaitingInspectionStock.
   */
  public processReturnInspection(
    returnId: string,
    outcome: InspectionOutcome,
    condition: 'like_new' | 'opened_good' | 'damaged' | 'lost',
    notes: string,
    operator: string = 'مدير العمليات'
  ): { success: boolean; message: string } {
    const returns = this.getReturns();
    const ret = returns.find((r) => r.id === returnId);
    if (!ret) return { success: false, message: 'سجل المرتجع غير موجود.' };

    if (ret.isCompleted || ret.returnStatus === 'closed') {
      return { success: false, message: 'تم إكمال فحص هذا المرتجع وإغلاقه مسبقاً.' };
    }

    const products = this.getProducts();
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === ret.orderId);
    const newMovements: StockMovement[] = [];
    const activities = ret.activities || [];

    const isPostDelivery =
      ret.isPostDeliveryReturn === true || (order && order.deliveredProcessed === true);

    if (outcome === 'restockable') {
      for (const item of ret.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;

          // Deduct from awaiting inspection
          product.awaitingInspectionStock = Math.max(
            0,
            (product.awaitingInspectionStock || 0) - item.quantity
          );

          if (isPostDelivery) {
            // Restore both physical and available
            product.physicalStock += item.quantity;
            product.availableStock += item.quantity;
          } else {
            // Restore available stock only (was already in physical count)
            product.availableStock += item.quantity;
          }

          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: ret.marketplaceId,
            type: 'return_restocked',
            quantityChange: item.quantity,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'بانتظار الفحص بالمستودع',
            toCustody: 'المخزون المتاح للبيع بالمستودع',
            referenceOrderId: ret.orderId,
            referenceReturnId: ret.id,
            reason: `اعتماد المرتجع وإعادته للمخزون المتاح بعد الفحص (${condition})`,
            operator,
            timestamp: new Date().toISOString(),
          });
        }
      }

      ret.returnStatus = 'closed';
      ret.inspectionOutcome = 'restockable';
      ret.stockRestored = true;
      ret.isCompleted = true;

      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        action: 'inspection_restocked',
        actionAr: 'تم اعتماد المنتج كصالح للبيع وإعادته رسمياً للمخزون المتاح وإغلاق المرتجع',
        operator,
        notes,
      });
    } else if (outcome === 'damaged') {
      for (const item of ret.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;

          product.awaitingInspectionStock = Math.max(
            0,
            (product.awaitingInspectionStock || 0) - item.quantity
          );
          product.damagedStock = (product.damagedStock || 0) + item.quantity;

          if (isPostDelivery) {
            product.physicalStock += item.quantity;
          }
          // Available stock NEVER increases!

          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: ret.marketplaceId,
            type: 'return_damaged',
            quantityChange: 0,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'بانتظار الفحص بالمستودع',
            toCustody: 'المخزون التالف بالمستودع (غير صالح للبيع)',
            referenceOrderId: ret.orderId,
            referenceReturnId: ret.id,
            reason: `تسجيل مرتجع تالف (${condition}) - عزل في المخزون التالف دون زيادة المتاح للبيع`,
            operator,
            timestamp: new Date().toISOString(),
          });

          // Record damage write-off financial loss
          if (product.baseCost && product.baseCost > 0) {
            this.recordFinancialTransaction({
              orderId: ret.orderId,
              returnId: ret.id,
              marketplaceId: ret.marketplaceId,
              type: 'damage_writeoff',
              amount: product.baseCost * item.quantity,
              currency: 'SAR',
              status: 'confirmed',
              source: 'automatic',
              notes: `خسارة هالك مخزون لمنتج تالف (${product.name}) بسعر التكلفة ${product.baseCost} ر.س`,
            });
          }
        }
      }

      ret.returnStatus = 'closed';
      ret.inspectionOutcome = 'damaged';
      ret.stockRestored = false;
      ret.isCompleted = true;

      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'system',
        action: 'inspection_damaged',
        actionAr: 'تم تصنيف المرتجع كتالف وعزله في المخزون التالف مع قيد خسارة الهالك',
        operator,
        notes,
      });
    } else if (outcome === 'missing') {
      for (const item of ret.items) {
        const product = products.find(
          (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
        );
        if (product) {
          product.awaitingInspectionStock = Math.max(
            0,
            (product.awaitingInspectionStock || 0) - item.quantity
          );
          if (!isPostDelivery) {
            product.physicalStock = Math.max(0, product.physicalStock - item.quantity);
          }
          product.updatedAt = new Date().toISOString();

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: ret.marketplaceId,
            type: 'return_missing',
            quantityChange: -item.quantity,
            previousPhysical: product.physicalStock + item.quantity,
            newPhysical: product.physicalStock,
            previousAvailable: product.availableStock,
            newAvailable: product.availableStock,
            fromCustody: 'بانتظار الفحص بالمستودع',
            toCustody: 'شطب (طرد مفقود من شركة الشحن)',
            referenceOrderId: ret.orderId,
            referenceReturnId: ret.id,
            reason: `شطب طرد مرتجع مفقود أو غير مستلم`,
            operator,
            timestamp: new Date().toISOString(),
          });
        }
      }

      ret.returnStatus = 'closed';
      ret.inspectionOutcome = 'missing';
      ret.isCompleted = true;
    } else {
      // requires_action: remains under inspection
      ret.returnStatus = 'under_inspection';
      ret.inspectionOutcome = 'requires_action';
      ret.isCompleted = false;

      activities.push({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'manual',
        action: 'requires_action',
        actionAr: 'المرتجع يحتاج لإجراء إضافي أو فحص متخصص قبل الإغلاق',
        operator,
        notes,
      });
    }

    ret.physicalCondition = condition;
    ret.inspectionDate = new Date().toISOString();
    ret.notes = notes;
    ret.activities = activities;
    ret.updatedAt = new Date().toISOString();

    // Close associated order if inspection completed
    if (ret.isCompleted && order && !order.isClosed) {
      order.isClosed = true;
      order.closedReason = 'return_completed';
      order.closedAt = new Date().toISOString();
      this.set(STORAGE_KEYS.ORDERS, orders);
    }

    this.set(STORAGE_KEYS.RETURNS, returns);
    this.set(STORAGE_KEYS.PRODUCTS, products);

    if (newMovements.length > 0) {
      const movements = this.getMovements();
      movements.unshift(...newMovements);
      this.set(STORAGE_KEYS.MOVEMENTS, movements);
    }

    return {
      success: true,
      message:
        outcome === 'restockable'
          ? 'تم اعتماد المنتج وإعادته بنجاح إلى المخزون المتاح وإغلاق المرتجع.'
          : outcome === 'damaged'
          ? 'تم عزل المنتج في المخزون التالف وقيد الخسارة دون إضافة للمخزون المتاح.'
          : outcome === 'missing'
          ? 'تم تسجيل المرتجع كمفقود وشطبه.'
          : 'تم حفظ حالة المرتجع بانتظار إجراءات إضافية.',
    };
  }

  public registerPostDeliveryReturn(
    orderId: string,
    reason: string,
    notes?: string
  ): { success: boolean; returnRecord?: ReturnRecord; error?: string } {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return { success: false, error: 'الطلب غير موجود.' };

    const returns = this.getReturns();
    const newReturn: ReturnRecord = {
      id: `RET-${Math.floor(100 + Math.random() * 900)}`,
      orderId: order.id,
      marketplaceId: order.marketplaceId,
      items: order.items,
      returnReason: reason.trim() || 'طلب استرجاع بعد استلام الشحنة من العميل',
      returnStatus: 'in_transit_back',
      physicalCondition: undefined,
      stockRestored: false,
      isCompleted: false,
      isPostDeliveryReturn: true,
      courierName: order.courierName || 'شركة الشحن',
      trackingNumber: `RET-${order.trackingNumber || Math.floor(1000 + Math.random() * 9000)}`,
      returnShippingCost: 15,
      returnCostPayer: 'seller',
      notes: notes?.trim() || 'مرتجع لاحق لطلب مكتمل التسليم - في انتظار الاستلام والفحص بالمستودع.',
      activities: [
        {
          id: `act-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'system',
          action: 'post_delivery_return_opened',
          actionAr: 'تم فتح طلب إرجاع لطلب تم تسليمه مسبقاً وبدء دورة المرتجع',
          operator: 'مدير العمليات',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    order.hasPostDeliveryReturn = true;
    order.updatedAt = new Date().toISOString();

    // Increase product return in transit
    const products = this.getProducts();
    for (const item of order.items) {
      const p = products.find((prod) => prod.id === item.productId || prod.sku === item.productSku);
      if (p) {
        p.returnInTransitStock = (p.returnInTransitStock || 0) + item.quantity;
      }
    }
    this.set(STORAGE_KEYS.PRODUCTS, products);

    returns.unshift(newReturn);
    this.set(STORAGE_KEYS.RETURNS, returns);
    this.set(STORAGE_KEYS.ORDERS, orders);

    return { success: true, returnRecord: newReturn };
  }

  // --- Financial Transaction Ledger & Auditable Accounting ---
  public getFinancialTransactions(): FinancialTransaction[] {
    const defaultTx: FinancialTransaction[] = [
      {
        id: 'tx-001',
        orderId: 'ORD-9825',
        marketplaceId: 'amazon',
        type: 'sale_revenue',
        amount: 169,
        currency: 'SAR',
        status: 'confirmed',
        date: '2026-11-11T08:30:00Z',
        source: 'automatic',
        notes: 'إيراد تسليم طلب مكتمل #ORD-9825',
      },
      {
        id: 'tx-002',
        orderId: 'ORD-9818',
        marketplaceId: 'noon',
        type: 'sale_revenue',
        amount: 89,
        currency: 'SAR',
        status: 'confirmed',
        date: '2026-11-10T18:00:00Z',
        source: 'automatic',
        notes: 'إيراد تسليم طلب مكتمل #ORD-9818',
      },
      {
        id: 'tx-003',
        orderId: 'ORD-9818',
        marketplaceId: 'noon',
        type: 'courier_shipping',
        amount: 18,
        currency: 'SAR',
        status: 'confirmed',
        date: '2026-11-10T18:00:00Z',
        source: 'automatic',
        notes: 'رسوم شحن نون إكسبريس للطلب #ORD-9818',
      },
      {
        id: 'tx-004',
        orderId: 'ORD-9730',
        returnId: 'RET-004',
        marketplaceId: 'amazon',
        type: 'damage_writeoff',
        amount: 95,
        currency: 'SAR',
        status: 'confirmed',
        date: '2026-10-14T10:00:00Z',
        source: 'automatic',
        notes: 'خسارة هالك مخزون لسماعة رأس تالفة بسعر التكلفة',
      },
      {
        id: 'tx-005',
        orderId: 'ORD-9815',
        returnId: 'RET-001',
        marketplaceId: 'noon',
        type: 'return_shipping',
        amount: 15,
        currency: 'SAR',
        status: 'pending',
        date: '2026-11-10T12:00:00Z',
        source: 'automatic',
        notes: 'رسوم شحن المرتجع لطلب رفض الاستلام #ORD-9815',
      },
    ];

    return this.get<FinancialTransaction[]>(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, defaultTx);
  }

  public recordFinancialTransaction(
    tx: Omit<FinancialTransaction, 'id' | 'date'> & { id?: string; date?: string }
  ): FinancialTransaction {
    const list = this.getFinancialTransactions();
    const newTx: FinancialTransaction = {
      id: tx.id || `tx-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: tx.date || new Date().toISOString(),
      ...tx,
    };
    list.unshift(newTx);
    this.set(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, list);
    return newTx;
  }

  /**
   * Order Financial Breakdown:
   * STRICT RULE: Never calculate actual net profit if base product cost or required fees are missing.
   */
  public getOrderFinancialBreakdown(orderId: string): OrderFinancialBreakdown | null {
    const order = this.getOrders().find((o) => o.id === orderId);
    if (!order) return null;

    const products = this.getProducts();
    let totalSellingPrice = order.totalAmount;
    let totalCostOfGoods = 0;
    let hasAllCosts = true;
    const missingReasons: string[] = [];

    let totalItems = 0;
    for (const item of order.items) {
      totalItems += item.quantity;
      const product = products.find(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (product && typeof product.baseCost === 'number' && product.baseCost > 0) {
        totalCostOfGoods += product.baseCost * item.quantity;
      } else {
        hasAllCosts = false;
        missingReasons.push(`سعر التكلفة للمنتج (${item.productName}) غير مسجل.`);
      }
    }

    const shippingFee = order.shippingCost || (order.shipment?.shippingCost ?? 0);
    const returnShippingFee = order.shipment?.returnShippingCost ?? 0;
    const packagingCost = order.packagingCost ?? 0;
    const marketplaceCommission =
      order.marketplaceCommission ?? Math.round(totalSellingPrice * 0.12 * 100) / 100; // estimated 12% if not set
    const serviceFees = 0;

    let extraAdjustments = 0;
    if (order.adjustments) {
      for (const adj of order.adjustments) {
        if (adj.type === 'discount') {
          extraAdjustments -= adj.amount;
        } else {
          extraAdjustments += adj.amount;
        }
      }
    }

    const isDelivered = order.status === 'delivered';
    const isCancelled = order.status === 'cancelled';
    const refundAmount = order.hasPostDeliveryReturn || order.status === 'rejected' ? totalSellingPrice : 0;

    let confirmedNet: number | null = null;
    let isProfitCalculable = false;

    if (isDelivered && hasAllCosts && !isCancelled) {
      confirmedNet =
        totalSellingPrice -
        marketplaceCommission -
        shippingFee -
        packagingCost -
        totalCostOfGoods +
        extraAdjustments;
      isProfitCalculable = true;
    }

    return {
      orderId: order.id,
      sellingPriceTotal: totalSellingPrice,
      itemCount: totalItems,
      marketplaceCommission,
      serviceFees,
      originalShippingFee: shippingFee,
      returnShippingFee,
      packagingCost,
      extraAdjustments,
      productCostOfGoods: hasAllCosts ? totalCostOfGoods : null,
      refundAmount,
      confirmedNet,
      isProfitCalculable,
      uncalculatedReason: !isProfitCalculable
        ? missingReasons.length > 0
          ? missingReasons.join(' ')
          : !isDelivered
          ? 'الطلب لم يتم تسليمه نهائياً بعد.'
          : 'بيانات التكلفة غير مكتملة.'
        : undefined,
    };
  }

  public getFinancialSummary(
    dateRange?: { start: Date; end: Date },
    marketplace?: MarketplaceId
  ) {
    const orders = this.getFilteredOrders(dateRange, marketplace);
    const transactions = this.getFinancialTransactions();

    const deliveredOrders = orders.filter((o) => o.status === 'delivered');
    const deliveredRevenue = deliveredOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const relevantTx = transactions.filter((tx) => {
      if (marketplace && marketplace !== 'all' && tx.marketplaceId !== marketplace) return false;
      if (dateRange) {
        const time = new Date(tx.date).getTime();
        if (time < dateRange.start.getTime() || time > dateRange.end.getTime()) return false;
      }
      return true;
    });

    const courierShippingExpenses = relevantTx
      .filter((t) => t.type === 'courier_shipping')
      .reduce((sum, t) => sum + t.amount, 0);

    const returnShippingExpenses = relevantTx
      .filter((t) => t.type === 'return_shipping')
      .reduce((sum, t) => sum + t.amount, 0);

    const damageWriteoffs = relevantTx
      .filter((t) => t.type === 'damage_writeoff')
      .reduce((sum, t) => sum + t.amount, 0);

    const marketplaceCommissions = relevantTx
      .filter((t) => t.type === 'marketplace_commission')
      .reduce((sum, t) => sum + t.amount, 0);

    const confirmedRefunds = relevantTx
      .filter((t) => t.type === 'customer_refund')
      .reduce((sum, t) => sum + t.amount, 0);

    const products = this.getProducts();
    let ordersMissingCostCount = 0;
    for (const o of deliveredOrders) {
      const hasMissing = o.items.some((item) => {
        const p = products.find((prod) => prod.id === item.productId || prod.sku === item.productSku);
        return !p || typeof p.baseCost !== 'number' || p.baseCost <= 0;
      });
      if (hasMissing) ordersMissingCostCount++;
    }

    return {
      deliveredRevenue,
      deliveredOrdersCount: deliveredOrders.length,
      courierShippingExpenses,
      returnShippingExpenses,
      damageWriteoffs,
      marketplaceCommissions,
      confirmedRefunds,
      ordersMissingCostCount,
      estimatedSettlement:
        deliveredRevenue -
        marketplaceCommissions -
        courierShippingExpenses -
        returnShippingExpenses -
        damageWriteoffs,
    };
  }

  // --- Internal Deterministic Merchant Guidance (Store Advisor) ---
  public getMerchantRecommendations(): MerchantRecommendation[] {
    const orders = this.getOrders();
    const returns = this.getReturns();
    const products = this.getProducts();
    const transactions = this.getFinancialTransactions();
    const recs: MerchantRecommendation[] = [];

    // 1. Returns in transit delayed (> 48h)
    const now = Date.now();
    for (const ret of returns) {
      if (ret.returnStatus === 'in_transit_back' && !ret.isCompleted) {
        const ageHours = (now - new Date(ret.createdAt).getTime()) / (1000 * 3600);
        if (ageHours > 36) {
          recs.push({
            id: `rec-ret-delayed-${ret.id}`,
            titleAr: `تأخر عودة الشحنة المرتجعة #${ret.id}`,
            titleEn: `Delayed Return Shipment #${ret.id}`,
            whatHappenedAr: `المرتجع #${ret.id} مسجل في مسار العودة منذ أكثر من ${Math.round(ageHours)} ساعة مع شركة ${ret.courierName || 'الشحن'}.`,
            whatHappenedEn: `Return #${ret.id} has been in transit for over ${Math.round(ageHours)} hours with ${ret.courierName || 'courier'}.`,
            whyItMattersAr: 'المنتجات لا تزال خارج حيازة المستودع ولا يمكن إعادتها للبيع أو تقييمها قبل الاستلام الفعلي.',
            whyItMattersEn: 'Products remain outside warehouse custody and cannot be restocked or audited until physically received.',
            measurableImpactAr: `${ret.items.reduce((s, i) => s + i.quantity, 0)} قطعة معلقة خارج المستودع بقيمة ${ret.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)} ر.س`,
            measurableImpactEn: `${ret.items.reduce((s, i) => s + i.quantity, 0)} units pending outside warehouse worth ${ret.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)} SAR`,
            recommendedActionAr: 'تتبع الشحنة مع شركة التوصيل والتأكد من تاريخ وصولها للمستودع',
            recommendedActionEn: 'Track shipment with courier and verify expected arrival date',
            actionTab: 'returns',
            actionFilter: { status: 'in_transit_back', returnId: ret.id },
            category: 'returns',
            priority: 'high',
            status: 'new',
            relatedReturnId: ret.id,
            relatedOrderId: ret.orderId,
            relatedMarketplaceId: ret.marketplaceId,
            createdAt: ret.createdAt,
          });
        }
      }
    }

    // 2. Returns Awaiting Inspection in warehouse
    const awaitingInspectionReturns = returns.filter(
      (r) => (r.returnStatus === 'received_at_warehouse' || r.returnStatus === 'under_inspection') && !r.isCompleted
    );
    if (awaitingInspectionReturns.length > 0) {
      const totalUnits = awaitingInspectionReturns.reduce(
        (sum, r) => sum + r.items.reduce((s, i) => s + i.quantity, 0),
        0
      );
      recs.push({
        id: `rec-returns-awaiting-inspection`,
        titleAr: `يوجد ${totalUnits} قطعة بالمستودع بانتظار الفحص الفني`,
        titleEn: `${totalUnits} Units in Warehouse Awaiting Inspection`,
        whatHappenedAr: `تم استلام ${awaitingInspectionReturns.length} شحنة مرتجعة فيزيائياً في المستودع ولم يتم اتخاذ قرار الفحص النهائي بشأنها.`,
        whatHappenedEn: `${awaitingInspectionReturns.length} return shipments physically received at warehouse pending inspection decision.`,
        whyItMattersAr: 'هذه الوحدات محجوبة نظامياً عن المخزون المتاح للبيع لحين اعتماد سلامتها أو توثيق تلفها.',
        whyItMattersEn: 'These units are strictly excluded from available inventory until inspection verifies condition.',
        measurableImpactAr: `${totalUnits} قطعة معطلة عن البيع`,
        measurableImpactEn: `${totalUnits} units held from sale`,
        recommendedActionAr: 'إجراء الفحص الفني وتحديد صلاحية البيع (إعادة للمخزون أو تسجيل كتالف)',
        recommendedActionEn: 'Complete inspection to approve for resale or write off as damaged',
        actionTab: 'returns',
        actionFilter: { status: 'received_at_warehouse' },
        category: 'urgent',
        priority: 'critical',
        status: 'new',
        createdAt: new Date().toISOString(),
      });
    }

    // 3. Stockout Risk (Available stock <= 5 and positive sales)
    for (const p of products) {
      if (p.availableStock <= 5 && p.availableStock > 0) {
        recs.push({
          id: `rec-stockout-${p.id}`,
          titleAr: `مخزون منخفض وشيك على النفاد (${p.sku || p.name})`,
          titleEn: `Low Inventory Alert (${p.sku || p.name})`,
          whatHappenedAr: `المخزون المتاح للبيع للمنتج "${p.nameAr || p.name}" انخفض إلى ${p.availableStock} قطع فقط.`,
          whatHappenedEn: `Available stock for "${p.name}" has dropped to ${p.availableStock} units.`,
          whyItMattersAr: 'قد يؤدي نفاد المخزون إلى إيقاف العرض على المنصات وفقدان المبيعات وترتيب المتجر.',
          whyItMattersEn: 'Stockout causes listings to pause on marketplaces, losing sales velocity and ranking.',
          measurableImpactAr: `المتبقي ${p.availableStock} قطع فقط في المستودع`,
          measurableImpactEn: `Only ${p.availableStock} units remaining in warehouse`,
          recommendedActionAr: 'توريد دفعة جديدة للمستودع وتحديث كميات القوائم على المنصات',
          recommendedActionEn: 'Replenish stock in warehouse and update platform listings',
          actionTab: 'inventory',
          actionFilter: { productId: p.id },
          category: 'inventory',
          priority: 'high',
          status: 'new',
          relatedProductId: p.id,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 4. Delivered Orders with Missing Cost of Goods (Base Cost)
    const deliveredWithoutCost = orders.filter((o) => {
      if (o.status !== 'delivered') return false;
      return o.items.some((item) => {
        const prod = products.find((p) => p.id === item.productId || p.sku === item.productSku);
        return !prod || typeof prod.baseCost !== 'number' || prod.baseCost <= 0;
      });
    });

    if (deliveredWithoutCost.length > 0) {
      recs.push({
        id: `rec-missing-costs`,
        titleAr: `تعذر حساب صافي الربح لـ ${deliveredWithoutCost.length} طلب مكتمل`,
        titleEn: `Profit Uncalculated for ${deliveredWithoutCost.length} Delivered Orders`,
        whatHappenedAr: `تم تسليم ${deliveredWithoutCost.length} طلب بنجاح، لكن سعر التكلفة الأساسي (Base Cost) للمنتجات غير مسجل.`,
        whatHappenedEn: `${deliveredWithoutCost.length} orders delivered successfully, but product base costs are missing.`,
        whyItMattersAr: 'حسب المعايير المالية الدقيقة، لا يتم إظهار أرباح تقديرية وهمية دون وجود تكلفة الشراء الحقيقية.',
        whyItMattersEn: 'Strict financial integrity prevents displaying speculative profits without verified cost of goods.',
        measurableImpactAr: `إجمالي مبيعات ${deliveredWithoutCost.reduce((s, o) => s + o.totalAmount, 0)} ر.س بدون تكلفة مسجلة`,
        measurableImpactEn: `${deliveredWithoutCost.reduce((s, o) => s + o.totalAmount, 0)} SAR in sales uncalculated`,
        recommendedActionAr: 'تحديث سعر التكلفة من صفحة المنتجات ليتم حساب الأرباح الحقيقية فوراً',
        recommendedActionEn: 'Enter base purchase cost in Products to enable net profit calculations',
        actionTab: 'products',
        category: 'financial',
        priority: 'medium',
        status: 'new',
        createdAt: new Date().toISOString(),
      });
    }

    // 5. Orders stuck in preparing > 24 hours
    const preparingOrders = orders.filter((o) => o.status === 'preparing' && !o.isClosed);
    for (const o of preparingOrders) {
      const hoursInPrep = (now - new Date(o.orderDate || o.createdAt).getTime()) / (1000 * 3600);
      if (hoursInPrep > 24) {
        recs.push({
          id: `rec-stuck-prep-${o.id}`,
          titleAr: `طلب قيد التجهيز بالمستودع متأخر عن الشحن #${o.id}`,
          titleEn: `Order Delayed in Warehouse Preparation #${o.id}`,
          whatHappenedAr: `الطلب #${o.id} قيد التجهيز منذ ${Math.round(hoursInPrep)} ساعة ولم يُسلّم لمندوب شركة الشحن بعد.`,
          whatHappenedEn: `Order #${o.id} has been in preparation for ${Math.round(hoursInPrep)} hours without handover.`,
          whyItMattersAr: 'التأخير في تسليم الشحنة قد يسبب فرض غرامات من المنصة أو إلغاء العميل للطلب.',
          whyItMattersEn: 'Delay in courier handover risks marketplace late-dispatch penalties or customer cancellation.',
          measurableImpactAr: `قيمة الطلب: ${o.totalAmount} ر.س`,
          measurableImpactEn: `Order value: ${o.totalAmount} SAR`,
          recommendedActionAr: 'تجهيز الشحنة وتأكيد التسليم لشركة التوصيل عبر الإجراءات السريعة',
          recommendedActionEn: 'Pack and confirm handover to courier in quick actions',
          actionTab: 'orders',
          actionFilter: { orderId: o.id },
          category: 'orders',
          priority: 'high',
          status: 'new',
          relatedOrderId: o.id,
          relatedMarketplaceId: o.marketplaceId,
          createdAt: o.orderDate || o.createdAt,
        });
      }
    }

    // Merge with persisted overrides if any
    const savedRecs = this.get<MerchantRecommendation[]>(STORAGE_KEYS.RECOMMENDATIONS, []);
    const savedMap = new Map(savedRecs.map((r) => [r.id, r]));

    return recs.map((r) => {
      const existing = savedMap.get(r.id);
      if (existing) {
        return {
          ...r,
          status: existing.status,
          updatedAt: existing.updatedAt,
        };
      }
      return r;
    });
  }

  public updateRecommendationStatus(id: string, status: RecommendationStatus): boolean {
    const list = this.get<MerchantRecommendation[]>(STORAGE_KEYS.RECOMMENDATIONS, []);
    const existingIdx = list.findIndex((r) => r.id === id);
    if (existingIdx !== -1) {
      list[existingIdx].status = status;
      list[existingIdx].updatedAt = new Date().toISOString();
    } else {
      list.push({
        id,
        status,
        updatedAt: new Date().toISOString(),
      } as MerchantRecommendation);
    }
    this.set(STORAGE_KEYS.RECOMMENDATIONS, list);
    return true;
  }

  // --- Storefront Product Quality Audit ---
  public auditProduct(product: Product) {
    const issues: { type: 'critical' | 'warning' | 'info'; messageAr: string; messageEn: string }[] = [];

    if (!product.imageUrl || product.imageUrl.includes('placeholder')) {
      issues.push({
        type: 'critical',
        messageAr: 'المنتج يفتقر إلى صورة واضحة عالية الدقة تجذب المتسوقين.',
        messageEn: 'Product lacks a high-resolution hero image.',
      });
    }

    if (!product.sku || product.sku.trim() === '') {
      issues.push({
        type: 'critical',
        messageAr: 'المنتج لا يحتوي على رمز SKU معرف فريد لإدارة التوريد.',
        messageEn: 'Product lacks a unique SKU identifier for stock tracking.',
      });
    }

    if (!product.baseCost || product.baseCost <= 0) {
      issues.push({
        type: 'warning',
        messageAr: 'سعر التكلفة مفقود؛ لا يمكن احتساب صافي أرباح مبيعات هذا المنتج.',
        messageEn: 'Base purchase cost is missing; profit margins cannot be calculated.',
      });
    }

    if (product.availableStock <= 3) {
      issues.push({
        type: 'warning',
        messageAr: `المخزون المتاح شديد الانخفاض (${product.availableStock} قطع).`,
        messageEn: `Available stock is critically low (${product.availableStock} units).`,
      });
    }

    // Price comparison between marketplaces
    const prices = Object.values(product.marketplaceListings || {}).map((m) => m.price);
    if (prices.length > 1) {
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      if (maxPrice - minPrice > 10) {
        issues.push({
          type: 'info',
          messageAr: `فارق سعر ملحوظ بين المنصات (${minPrice} مقابل ${maxPrice} ر.س).`,
          messageEn: `Noticeable price gap across channels (${minPrice} vs ${maxPrice} SAR).`,
        });
      }
    }

    const qualityScore = Math.max(20, 100 - issues.length * 20);

    return {
      qualityScore,
      issues,
      isReadyForStorefront: issues.filter((i) => i.type === 'critical').length === 0,
    };
  }

  // --- Movements Log ---
  public getMovements(): StockMovement[] {
    return this.get<StockMovement[]>(STORAGE_KEYS.MOVEMENTS, DEFAULT_MOVEMENTS);
  }

  public manualStockAdjustment(
    productId: string,
    newPhysicalStock: number,
    reason: string,
    operator: string = 'مدير العمليات'
  ): boolean {
    const products = this.getProducts();
    const product = products.find((p) => p.id === productId);
    if (!product) return false;

    const prevPhysical = product.physicalStock;
    const prevAvailable = product.availableStock;
    const diff = newPhysicalStock - prevPhysical;

    product.physicalStock = newPhysicalStock;
    product.availableStock = Math.max(0, product.availableStock + diff);
    product.updatedAt = new Date().toISOString();

    const movement: StockMovement = {
      id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      productId: product.id,
      productSku: product.sku || product.name,
      productName: product.name,
      type: 'manual_adjustment',
      quantityChange: diff,
      previousPhysical: prevPhysical,
      newPhysical: product.physicalStock,
      previousAvailable: prevAvailable,
      newAvailable: product.availableStock,
      reason: `تسوية جردية يدوية: ${reason}`,
      operator,
      timestamp: new Date().toISOString(),
    };

    const movements = this.getMovements();
    movements.unshift(movement);

    this.set(STORAGE_KEYS.PRODUCTS, products);
    this.set(STORAGE_KEYS.MOVEMENTS, movements);
    return true;
  }

  // --- Price History ---
  public getPriceHistory(): PriceHistoryRecord[] {
    return this.get<PriceHistoryRecord[]>(STORAGE_KEYS.PRICE_HISTORY, DEFAULT_PRICE_HISTORY);
  }

  // --- Settings ---
  public getSettings(): AppSettings {
    return this.get<AppSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }

  public saveSettings(settings: AppSettings): void {
    this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  public addMarketplace(marketplace: MarketplaceConfig): void {
    const settings = this.getSettings();
    if (!settings.marketplaces.some((m) => m.id === marketplace.id)) {
      settings.marketplaces.push(marketplace);
      this.saveSettings(settings);
    }
  }

  // --- Filtered Analytics Helpers ---
  public getFilteredOrders(
    dateRange?: { start: Date; end: Date },
    marketplace?: MarketplaceId
  ): Order[] {
    const orders = this.getOrders();
    return orders.filter((order) => {
      // Marketplace filter
      if (marketplace && marketplace !== 'all' && order.marketplaceId !== marketplace) {
        return false;
      }

      // Date range filter
      if (dateRange) {
        const orderTime = new Date(order.orderDate || order.createdAt).getTime();
        if (orderTime < dateRange.start.getTime() || orderTime > dateRange.end.getTime()) {
          return false;
        }
      }

      return true;
    });
  }

  public getFilteredReturns(
    dateRange?: { start: Date; end: Date },
    marketplace?: MarketplaceId
  ): ReturnRecord[] {
    const returns = this.getReturns();
    return returns.filter((ret) => {
      if (marketplace && marketplace !== 'all' && ret.marketplaceId !== marketplace) {
        return false;
      }

      if (dateRange) {
        const returnTime = new Date(ret.createdAt).getTime();
        if (returnTime < dateRange.start.getTime() || returnTime > dateRange.end.getTime()) {
          return false;
        }
      }

      return true;
    });
  }

  // --- Smart Import (Beta) ---
  public getSmartImportHistory(): SmartImportHistory[] {
    return this.get<SmartImportHistory[]>(STORAGE_KEYS.SMART_IMPORT_HISTORY, []);
  }

  public saveSmartImportHistory(record: SmartImportHistory): void {
    const history = this.getSmartImportHistory();
    history.unshift(record);
    this.set(STORAGE_KEYS.SMART_IMPORT_HISTORY, history);
  }

  public saveSmartImportOrders(
    ordersToImport: Order[],
    isHistoricalDeducted: boolean,
    fileName: string,
    operator: string = 'مدير العمليات'
  ): {
    importedCount: number;
    historicalCount: number;
    duplicateCount: number;
  } {
    const existingOrders = this.getOrders();
    const existingKeySet = new Set(
      existingOrders.map((o) => `${o.marketplaceId.toLowerCase()}_${o.id.toLowerCase()}`)
    );

    const products = this.getProducts();
    const movements = this.getMovements();

    let importedCount = 0;
    let historicalCount = 0;
    let duplicateCount = 0;

    for (const order of ordersToImport) {
      const key = `${order.marketplaceId.toLowerCase()}_${order.id.toLowerCase()}`;
      if (existingKeySet.has(key)) {
        duplicateCount++;
        continue;
      }

      // If active order: reserve inventory from available stock
      if (!order.isClosed && order.status !== 'delivered' && order.status !== 'cancelled') {
        for (const item of order.items) {
          const product = products.find(
            (p) => p.id === item.productId || (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
          );
          if (product) {
            const prevAvail = product.availableStock;
            product.availableStock = Math.max(0, product.availableStock - item.quantity);
            product.reservedStock = (product.reservedStock || 0) + item.quantity;
            product.updatedAt = new Date().toISOString();

            movements.unshift({
              id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              productId: product.id,
              productSku: product.sku || product.name,
              productName: product.name,
              marketplaceId: order.marketplaceId,
              type: 'order_created',
              quantityChange: -item.quantity,
              previousPhysical: product.physicalStock,
              newPhysical: product.physicalStock,
              previousAvailable: prevAvail,
              newAvailable: product.availableStock,
              referenceOrderId: order.id,
              reason: `حجز مخزون عبر الاستيراد الذكي للطلب #${order.id} (${order.marketplaceId})`,
              operator,
              timestamp: new Date().toISOString(),
            });
          }
        }
        importedCount++;
      } else {
        // Historical / completed order
        if (isHistoricalDeducted) {
          for (const item of order.items) {
            const product = products.find(
              (p) => p.id === item.productId || (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
            );
            if (product) {
              const prevPhysical = product.physicalStock;
              product.physicalStock = Math.max(0, product.physicalStock - item.quantity);
              product.updatedAt = new Date().toISOString();

              movements.unshift({
                id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                productId: product.id,
                productSku: product.sku || product.name,
                productName: product.name,
                marketplaceId: order.marketplaceId,
                type: 'order_delivered',
                quantityChange: -item.quantity,
                previousPhysical: prevPhysical,
                newPhysical: product.physicalStock,
                previousAvailable: product.availableStock,
                newAvailable: product.availableStock,
                referenceOrderId: order.id,
                reason: `تسجيل تسليم سابق لطلب تاريخي #${order.id} عبر الاستيراد الذكي`,
                operator,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
        historicalCount++;
      }

      existingOrders.unshift(order);
      existingKeySet.add(key);
    }

    this.set(STORAGE_KEYS.ORDERS, existingOrders);
    this.set(STORAGE_KEYS.PRODUCTS, products);
    this.set(STORAGE_KEYS.MOVEMENTS, movements);

    // Save import history
    this.saveSmartImportHistory({
      id: `smi-${Date.now()}`,
      marketplaceId: ordersToImport[0]?.marketplaceId || 'noon',
      fileName,
      importedAt: new Date().toISOString(),
      totalImported: importedCount + historicalCount,
      historicalCount,
      operator,
    });

    return { importedCount, historicalCount, duplicateCount };
  }

  // --- Merchant Profile & Onboarding ---
  public getMerchantProfile(): MerchantProfile {
    const profile = this.get<MerchantProfile>(STORAGE_KEYS.MERCHANT_PROFILE, DEFAULT_MERCHANT_PROFILE);
    if (!profile.merchantName) {
      profile.merchantName = profile.name;
    }
    return profile;
  }

  public saveMerchantProfile(profile: MerchantProfile): void {
    if (profile.merchantName && !profile.name) {
      profile.name = profile.merchantName;
    }
    this.set(STORAGE_KEYS.MERCHANT_PROFILE, profile);
    // Sync store name and seller name with settings
    const settings = this.getSettings();
    settings.storeName = profile.storeName;
    settings.sellerName = profile.merchantName || profile.name;
    this.saveSettings(settings);
  }

  public completeOnboarding(
    param1: MarketplaceConfig[] | string,
    param2: string,
    param3?: string | string[] | MarketplaceConfig[]
  ): void {
    let merchantName = 'أحمد بكر';
    let storeName = 'متجر الأناقة الحديثة';
    let marketplaces: MarketplaceConfig[] = this.getMarketplaces();

    if (Array.isArray(param1)) {
      marketplaces = param1 as MarketplaceConfig[];
      merchantName = typeof param2 === 'string' ? param2 : merchantName;
      storeName = typeof param3 === 'string' ? param3 : storeName;
    } else if (typeof param1 === 'string') {
      merchantName = param1;
      storeName = param2;
      if (Array.isArray(param3) && param3.length > 0 && typeof param3[0] === 'object') {
        marketplaces = param3 as MarketplaceConfig[];
      }
    }

    const settings = this.getSettings();
    settings.marketplaces = marketplaces;
    settings.storeName = storeName;
    settings.sellerName = merchantName;
    this.saveSettings(settings);

    const profile = this.getMerchantProfile();
    profile.name = merchantName;
    profile.merchantName = merchantName;
    profile.storeName = storeName;
    profile.isOnboarded = true;
    profile.selectedMarketplaceIds = marketplaces.map((m) => m.id);
    profile.onboardedAt = new Date().toISOString();
    this.saveMerchantProfile(profile);
  }

  // --- Tutorial & Interactive Learning Progress ---
  public isTutorialCompleted(tutorialId: string): boolean {
    const profile = this.getMerchantProfile();
    return profile.completedTutorials.includes(tutorialId);
  }

  public completeTutorial(tutorialId: string): void {
    const profile = this.getMerchantProfile();
    if (!profile.completedTutorials.includes(tutorialId)) {
      profile.completedTutorials.push(tutorialId);
      this.saveMerchantProfile(profile);
    }
  }

  public resetTutorial(tutorialId?: string): void {
    const profile = this.getMerchantProfile();
    if (tutorialId) {
      profile.completedTutorials = profile.completedTutorials.filter((id) => id !== tutorialId);
    } else {
      profile.completedTutorials = [];
    }
    this.saveMerchantProfile(profile);
  }

  public markFeatureExplored(featureId: string): void {
    const profile = this.getMerchantProfile();
    if (!profile.exploredFeatures.includes(featureId)) {
      profile.exploredFeatures.push(featureId);
      this.saveMerchantProfile(profile);
    }
  }

  public isFeatureExplored(featureId: string): boolean {
    const profile = this.getMerchantProfile();
    return profile.exploredFeatures.includes(featureId);
  }

  // --- Dynamic Marketplace Management ---
  public getMarketplaces(): MarketplaceConfig[] {
    const settings = this.getSettings();
    return settings.marketplaces;
  }

  public updateMarketplace(id: string, updates: Partial<MarketplaceConfig>): boolean {
    const settings = this.getSettings();
    const idx = settings.marketplaces.findIndex((m) => m.id === id);
    if (idx === -1) return false;

    settings.marketplaces[idx] = {
      ...settings.marketplaces[idx],
      ...updates,
    };
    this.saveSettings(settings);
    return true;
  }

  public removeMarketplace(id: string): { success: boolean; error?: string } {
    const settings = this.getSettings();
    // Keep at least one marketplace
    if (settings.marketplaces.length <= 1) {
      return { success: false, error: 'يجب الإبقاء على منصة بيع واحدة على الأقل.' };
    }

    settings.marketplaces = settings.marketplaces.filter((m) => m.id !== id);
    this.saveSettings(settings);

    // Update merchant profile selected marketplaces
    const profile = this.getMerchantProfile();
    profile.selectedMarketplaceIds = profile.selectedMarketplaceIds.filter((mId) => mId !== id);
    this.saveMerchantProfile(profile);

    return { success: true };
  }
}

export const storageService = new StorageService();
storageService.init();
