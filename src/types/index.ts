/**
 * Core domain types for Seller Operations Multi-Platform Management
 */

export type MarketplaceId = 'noon' | 'amazon' | string;

export interface MarketplaceConfig {
  id: MarketplaceId;
  nameEn: string;
  nameAr: string;
  color: string;
  badgeBg: string;
  badgeText: string;
  isActive: boolean;
}

export interface MarketplaceListing {
  marketplaceId: MarketplaceId;
  price: number;
  quantity: number; // quantity listed on this marketplace
  listingStatus: 'active' | 'inactive' | 'out_of_stock';
  lastUpdated: string;
}

export interface Product {
  id: string;
  sku: string; // optional or auto-generated
  name: string;
  nameAr?: string;
  imageUrl: string;
  category?: string;
  baseCost?: number;
  currentPrice: number; // reference selling price
  // --- Inventory Custody Model ---
  // Merchant-owned Warehouse custody
  physicalStock: number; // actual warehouse count = available + reserved + awaitingInspection + damaged
  availableStock: number; // physically present in warehouse, inspected, sellable for new orders
  reservedStock: number; // allocated to active orders awaiting shipment handover
  awaitingInspectionStock?: number; // physically received in warehouse, pending quality inspection
  damagedStock?: number; // physically present in warehouse, confirmed damaged/unsellable
  // Outside Warehouse custody (merchant-owned but in transit)
  outboundInTransitStock?: number; // handed to courier, travelling to customer
  returnInTransitStock?: number; // returning from customer/courier back to warehouse
  marketplaceListings: Record<MarketplaceId, MarketplaceListing>;
  createdAt: string;
  updatedAt: string;
}

export interface PriceHistoryRecord {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  marketplaceId: MarketplaceId;
  previousPrice: number;
  newPrice: number;
  percentageDiff: number;
  changeType: 'increase' | 'decrease' | 'no_change';
  reason?: string;
  changedBy: string;
  timestamp: string;
}

export type OrderStatus =
  | 'preparing' // قيد التجهيز بالمستودع
  | 'with_delivery' // تم التسليم لشركة الشحن / مع المندوب
  | 'delivered' // تم التوصيل بنجاح للعميل
  | 'rejected' // مرفوض عند الاستلام / راجع
  | 'cancelled'; // ملغي قبل الشحن

export interface OrderItem {
  productId: string;
  productSku: string;
  productName: string; // snapshot at order time
  imageUrl: string;
  unitPrice: number; // snapshot at order time
  unitCostSnapshot?: number; // COGS snapshot at order/import time so catalog edits don't rewrite historical profits
  quantity: number;
}

export interface ShipmentRecord {
  courierName: string;
  trackingNumber: string;
  originalReference?: string;
  returnReference?: string;
  serviceType?: string;
  courierContact?: string;
  shippedDate?: string;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  shippingCost?: number;
  returnShippingCost?: number;
  costPayer?: 'seller' | 'marketplace' | 'customer';
  paymentStatus?: 'paid' | 'pending' | 'deducted_by_marketplace';
  notes?: string;
}

export interface OrderActivityEvent {
  id: string;
  timestamp: string;
  type: 'system' | 'manual';
  action: string;
  actionAr: string;
  operator: string;
  previousState?: string;
  newState?: string;
  notes?: string;
}

export interface OrderFinancialAdjustment {
  id: string;
  description: string;
  amount: number;
  type: 'extra_shipping' | 'return_shipping' | 'packaging' | 'handling' | 'discount' | 'fee_adjustment';
  payer: 'seller' | 'marketplace' | 'customer';
  notes?: string;
}

export interface StorageWriteResult {
  success: boolean;
  error?: string;
  quotaExceeded?: boolean;
  rolledBack?: boolean;
  rollbackError?: string;
}

export interface OrderFinancialBreakdown {
  orderId: string;
  sellingPriceTotal: number;
  itemCount: number;
  marketplaceCommission: number; // strictly recorded commission (0 if unrecorded)
  commissionStatus?: 'recorded' | 'missing';
  estimatedMarketplaceCommission?: number; // informational reference only, never inside confirmedNet
  serviceFees: number;
  originalShippingFee: number;
  returnShippingFee: number;
  packagingCost: number;
  extraAdjustments: number;
  productCostOfGoods: number | null; // null if missing
  cogsSource?: 'snapshot' | 'catalog' | 'mixed' | 'missing';
  refundAmount: number;
  recordedCostMargin: number | null; // Margin from recorded costs only (excludes missing marketplace fees); null if COGS missing or not delivered
  confirmedNet: number | null; // Strictly non-null ONLY when delivered, non-cancelled, all COGS exist, AND marketplaceCommission is recorded
  estimatedNet: number | null; // Informational estimate using documented 12% estimated commission when unrecorded; null if COGS missing or not delivered
  isProfitCalculable: boolean;
  uncalculatedReason?: string;
  missingCostReasons?: string[];
}

export interface Order {
  id: string; // Order ID e.g. "ORD-9821"
  marketplaceId: MarketplaceId;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  customerName?: string;
  customerPhone?: string;
  shippingAddress?: string;
  notes?: string;
  orderDate: string;
  deliveredDate?: string;
  // Shipping details
  shipment?: ShipmentRecord;
  courierName?: string;
  trackingNumber?: string;
  shippingCost?: number;
  packagingCost?: number;
  marketplaceCommission?: number;
  // Adjustments & Activities
  adjustments?: OrderFinancialAdjustment[];
  activities?: OrderActivityEvent[];
  // Guards & Flags
  stockDeducted: boolean; // Flag to prevent duplicate deductions at creation
  deliveredProcessed?: boolean; // Flag ensuring delivered physical deduction happens only once
  isClosed?: boolean; // Set to true when successfully completed or return cycle completed
  closedReason?: 'delivered' | 'return_completed' | 'cancelled';
  closedAt?: string;
  hasPostDeliveryReturn?: boolean; // Tracks if a return was filed after successful delivery
  createdAt: string;
  updatedAt: string;
}

export type MovementType =
  | 'order_created' // stock reserved & deducted from available
  | 'handover_to_courier' // reserved moved to outbound in transit
  | 'order_delivered' // stock finalized from outbound transit and deducted from physical
  | 'order_cancelled' // reserved stock returned to available
  | 'return_initiated' // outbound moved to return in transit
  | 'return_received_warehouse' // return in transit moved to awaiting inspection
  | 'return_restocked' // inspected return approved -> returned to available physical stock
  | 'return_damaged' // inspected return marked damaged -> moved to damagedStock (unsellable)
  | 'return_missing' // returned item missing -> written off
  | 'manual_adjustment' // manual stock count adjustment
  | 'excel_import'; // batch update

export interface StockMovement {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  marketplaceId?: MarketplaceId;
  type: MovementType;
  quantityChange: number; // + or -
  previousPhysical: number;
  newPhysical: number;
  previousAvailable: number;
  newAvailable: number;
  fromCustody?: string;
  toCustody?: string;
  referenceOrderId?: string;
  referenceReturnId?: string;
  reason: string;
  operator: string;
  timestamp: string;
}

// Full 7-stage return workflow (with backward compatibility)
export type ReturnStatus =
  | 'return_initiated' // 1. تم بدء طلب الإرجاع
  | 'pickup_pending' // 2. بانتظار استلام المندوب
  | 'in_transit_back' // 3. مرتجع في طريق العودة للمستودع
  | 'received_at_warehouse' // 4. تم الاستلام الفعلي في المستودع
  | 'under_inspection' // 5. قيد الفحص والتقييم
  | 'inspection_completed' // 6. اكتمل الفحص
  | 'closed' // 7. مغلق نهائياً
  // Legacy aliases
  | 'delivery_rejected'
  | 'product_received'
  | 'restocked'
  | 'damaged';

export type InspectionOutcome =
  | 'restockable' // سليم وصالح للبيع -> يُعاد للمخزون المتاح
  | 'damaged' // تالف وغير صالح -> يُنقل للمخزون التالف ولا يعود للمتاح
  | 'missing' // مفقود / لم يتم استلامه
  | 'requires_action'; // يحتاج إجراء إضافي أو توثيق

export interface ReturnRecord {
  id: string;
  orderId: string;
  marketplaceId: MarketplaceId;
  items: OrderItem[];
  returnReason: string;
  returnStatus: ReturnStatus;
  inspectionOutcome?: InspectionOutcome;
  physicalCondition?: 'like_new' | 'opened_good' | 'damaged' | 'lost';
  stockRestored: boolean; // safeguard against multiple restocks
  isCompleted?: boolean; // Marked true once inspected and closed
  isPostDeliveryReturn?: boolean; // True if created after successful delivery
  // Shipping & Custody details
  shipment?: ShipmentRecord;
  courierName?: string;
  trackingNumber?: string;
  returnShippingCost?: number;
  returnCostPayer?: 'seller' | 'marketplace' | 'customer';
  receivedAtWarehouseDate?: string;
  physicalRestoredAtReceipt?: boolean; // tracks whether post-delivery receipt already added quantity back to physicalStock
  inspectionDate?: string;
  notes?: string;
  activities?: OrderActivityEvent[];
  createdAt: string;
  updatedAt: string;
}

// Financial Transaction Ledger
export type FinancialTransactionType =
  | 'sale_revenue'
  | 'courier_shipping'
  | 'return_shipping'
  | 'packaging_fee'
  | 'marketplace_commission'
  | 'damage_writeoff'
  | 'customer_refund'
  | 'adjustment';

export interface FinancialTransaction {
  id: string;
  orderId: string;
  returnId?: string;
  marketplaceId: MarketplaceId;
  type: FinancialTransactionType;
  amount: number; // positive for income, positive for expense (discriminated by type)
  currency: string;
  status: 'confirmed' | 'pending' | 'settled' | 'cancelled';
  date: string;
  source: 'automatic' | 'manual' | 'imported';
  notes?: string;
}

// Merchant Guidance / Store Advisor
export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'info';
export type RecommendationCategory =
  | 'orders'
  | 'returns'
  | 'shipping'
  | 'inventory'
  | 'products'
  | 'financial'
  | 'urgent'
  | 'opportunities';

export type RecommendationStatus = 'new' | 'in_progress' | 'resolved' | 'dismissed';

export interface MerchantRecommendation {
  id: string;
  titleAr: string;
  titleEn: string;
  whatHappenedAr: string;
  whatHappenedEn: string;
  whyItMattersAr: string;
  whyItMattersEn: string;
  measurableImpactAr?: string;
  measurableImpactEn?: string;
  recommendedActionAr: string;
  recommendedActionEn: string;
  actionTab?: string;
  actionFilter?: Record<string, string>;
  category: RecommendationCategory;
  priority: RecommendationPriority;
  status: RecommendationStatus;
  relatedOrderId?: string;
  relatedReturnId?: string;
  relatedProductId?: string;
  relatedMarketplaceId?: MarketplaceId;
  createdAt: string;
  updatedAt?: string;
}

export interface ExcelImportRow {
  productName: string;
  sku: string;
  imageUrl: string;
  physicalStock: number;
  noonPrice: number;
  noonQuantity: number;
  amazonPrice: number;
  amazonQuantity: number;
  marketplaceData?: Record<string, { price: number; quantity: number }>;
}

export interface ExcelValidationResult {
  isValid: boolean;
  rows: {
    rowNumber: number;
    raw: Record<string, unknown>;
    data?: ExcelImportRow;
    status: 'new' | 'existing' | 'duplicate_in_file' | 'invalid';
    errors: string[];
  }[];
  totalRows: number;
  validCount: number;
  newProductsCount: number;
  existingProductsCount: number;
  duplicateCount: number;
  invalidCount: number;
}

export interface AppSettings {
  language: 'ar' | 'en';
  currency: string;
  sellerName: string;
  storeName: string;
  marketplaces: MarketplaceConfig[];
}

export interface MerchantProfile {
  name: string;
  merchantName?: string;
  email: string;
  storeName: string;
  isOnboarded: boolean;
  selectedMarketplaceIds: string[];
  completedTutorials: string[];
  exploredFeatures: string[];
  onboardedAt?: string;
}

export interface TutorialStep {
  targetSelector?: string;
  titleAr: string;
  titleEn: string;
  instructionAr: string;
  instructionEn: string;
  actionRequired?: 'click' | 'input' | 'none';
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export interface TutorialGuide {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  section: string;
  steps: TutorialStep[];
}

// ==================== DASHBOARD & ANALYTICS TYPES ====================

export type DateFilterOption =
  | 'allTime'
  | 'today'
  | '7days'
  | '30days'
  | 'thisMonth'
  | 'prevMonth'
  | 'custom';

export interface DashboardDateRange {
  start: Date;
  end: Date;
  labelAr: string;
  labelEn: string;
}

export interface OperationalAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  titleEn: string;
  entity: string;
  reason: string;
  reasonEn: string;
  recommendedAction: string;
  recommendedActionEn: string;
  targetTab?: string;
  targetFilter?: Record<string, string>;
}

export interface TopSellingProductItem {
  product: Product;
  deliveredUnits: number;
  deliveredRevenue: number;
  totalOrdersCount: number;
  physicalStock: number;
  availableStock: number;
  healthStatus: 'healthy' | 'moderate' | 'low' | 'out_of_stock';
}

export interface InventoryHealthItem {
  product: Product;
  availableStock: number;
  physicalStock: number;
  dailySalesVelocity: number; // units per day
  estimatedDaysRemaining: number | null; // null if insufficient data
  status: 'out_of_stock' | 'critical_low' | 'low' | 'healthy' | 'excessive';
  alertNote?: string;
  alertNoteEn?: string;
}

export interface PlatformPerformanceStats {
  marketplaceId: MarketplaceId;
  nameAr: string;
  nameEn: string;
  totalOrders: number;
  deliveredOrders: number;
  successRate: number; // e.g. 88.5
  returnsCount: number;
  returnRate: number; // e.g. 7.2
  unitsSold: number;
  revenue: number;
  topProduct?: {
    name: string;
    units: number;
    revenue: number;
  };
}

// ==================== SMART IMPORT (BETA) TYPES ====================

export type DetectedFieldType =
  | 'orderId'
  | 'sku'
  | 'quantity'
  | 'price'
  | 'status'
  | 'orderDate'
  | 'customerName';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ColumnMappingItem {
  field: DetectedFieldType;
  fieldLabelAr: string;
  fieldLabelEn: string;
  required: boolean;
  detectedColumn: string | null;
  confidence: ConfidenceLevel;
  sampleValue: string;
  userConfirmedColumn?: string | null;
}

export interface SmartOrderItem {
  sku: string;
  productName: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
  productId: string;
}

export interface SmartOrderGroup {
  orderId: string;
  marketplaceId: MarketplaceId;
  items: SmartOrderItem[];
  totalAmount: number;
  orderDate: string;
  customerName?: string;
  rawStatus: string;
  normalizedStatus: OrderStatus;
  isDuplicate: boolean;
  isHistorical: boolean;
  hasErrors: boolean;
  errors: string[];
}

export interface SmartImportValidationResult {
  marketplace: MarketplaceId;
  fileName: string;
  totalRows: number;
  columns: string[];
  mappings: ColumnMappingItem[];
  orders: SmartOrderGroup[];
  totalOrdersDetected: number;
  newOrdersCount: number;
  historicalOrdersCount: number;
  duplicateOrdersCount: number;
  errorOrdersCount: number;
}

export interface SmartImportHistory {
  id: string;
  marketplaceId: MarketplaceId;
  fileName: string;
  importedAt: string;
  totalImported: number;
  historicalCount: number;
  operator: string;
}

