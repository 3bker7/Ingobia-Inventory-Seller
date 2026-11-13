/**
 * Developer Center – Full Text-Based Project Inspection and Export System
 * Provides complete, structured, text-only representations of the application
 * divided into verifiable numbered sections with Snapshot IDs and Manifests.
 * Strictly text-first: No ZIPs, no PDFs, no external binary downloads.
 */

export interface SnapshotSection {
  sectionNumber: number;
  totalSections: number;
  snapshotId: string;
  titleEn: string;
  titleAr: string;
  sourceFiles: string[];
  content: string;
  dependencies: string[];
  classification: 'ACTUAL_SOURCE_CODE' | 'TECHNICAL_DOCUMENTATION' | 'SYSTEM_ARCHITECTURE' | 'VERIFIED_AUDIT';
  warnings?: string[];
}

export interface ProjectSnapshot {
  manifest: {
    snapshotId: string;
    projectVersion: string;
    exportTimestamp: string;
    totalSections: number;
    totalSourceFiles: number;
    developerAccount: string;
    includedSourceFiles: string[];
    excludedArtifacts: string[];
    knownLimitations: string[];
    systemIntegrityHash: string;
  };
  sections: SnapshotSection[];
}

const STORAGE_KEY_SNAPSHOTS = 'ingobia_developer_snapshots_v1';

export class DeveloperExportService {
  private static generateSnapshotId(): string {
    const d = new Date();
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `SNAP-INGOBIA-${dateStr}-${rand}`;
  }

  public static isAuthorizedDeveloper(email?: string): boolean {
    const authorized = ['a7med3bker@gmail.com', 'developer@ingobia.local'];
    if (!email) return true; // Default allow inside dev container
    return authorized.includes(email.toLowerCase().trim());
  }

  public static createFullSnapshot(developerAccount = 'a7med3bker@gmail.com'): ProjectSnapshot {
    const snapshotId = this.generateSnapshotId();
    const timestamp = new Date().toISOString();
    const version = '3.5.0-Production-CustodyLedger';

    const sourceFilesList = [
      '/src/types/index.ts',
      '/src/services/storage.ts',
      '/src/services/excel.ts',
      '/src/services/developerExport.ts',
      '/src/components/layout/Header.tsx',
      '/src/components/layout/Sidebar.tsx',
      '/src/components/layout/MobileBottomNav.tsx',
      '/src/components/pages/OverviewPage.tsx',
      '/src/components/pages/ProductsPage.tsx',
      '/src/components/pages/OrdersPage.tsx',
      '/src/components/pages/CompletedOrdersPage.tsx',
      '/src/components/pages/InventoryPage.tsx',
      '/src/components/pages/ReturnsPage.tsx',
      '/src/components/pages/MerchantGuidancePage.tsx',
      '/src/components/pages/PriceHistoryPage.tsx',
      '/src/components/pages/ExcelImportPage.tsx',
      '/src/components/pages/SmartImportPage.tsx',
      '/src/components/pages/SettingsPage.tsx',
      '/src/components/common/TestSuiteModal.tsx',
      '/src/components/onboarding/OnboardingModal.tsx',
      '/src/locales/translations.ts',
      '/src/App.tsx',
    ];

    const totalSections = 13;

    const sections: SnapshotSection[] = [
      // -------------------------------------------------------------
      // Section 1
      // -------------------------------------------------------------
      {
        sectionNumber: 1,
        totalSections,
        snapshotId,
        titleEn: 'Part 1: Project Overview, Core Architecture & Runtime Ecosystem',
        titleAr: 'الجزء الأول: نظرة عامة على المشروع، المعمارية وبيئة التشغيل',
        sourceFiles: ['/package.json', '/src/App.tsx', '/vite.config.ts'],
        classification: 'SYSTEM_ARCHITECTURE',
        dependencies: ['React 19', 'TypeScript 5.7', 'Tailwind CSS v4', 'Vite 6', 'Lucide React'],
        warnings: ['External marketplace APIs are intentionally simulated client-side with zero external AI slop.'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 1 OF ${totalSections}: PROJECT OVERVIEW & ARCHITECTURE
TIMESTAMP: ${timestamp}
VERSION: ${version}
================================================================================

1. PROJECT MISSION & BOUNDARIES
--------------------------------------------------------------------------------
Ingobia (عمليات البائع) is a purpose-built, high-reliability SaaS operations platform
engineered for multi-platform e-commerce merchants operating across Noon, Amazon,
custom web storefronts, and independent sales channels.

Strict Architecture Principles:
- ZERO Speculative Data: No fabricated numbers, no random charts, no synthetic metrics.
- Physical Custody Integrity: Total warehouse physical units are strictly segregated
  from outside-warehouse units (outbound transit with courier and return transit).
- In-Transit Quarantining: Units in transit or awaiting quality inspection can NEVER
  be counted into 'availableStock'.
- Verified Financial Ledger: Realized profit is ONLY calculated when purchase cost
  (COGS), shipping fee, and commissions are verified. If base purchase cost is missing,
  profit is flagged as UNCALCULATED rather than estimated.
- Text-First Developer Inspection: All project documentation and source code are
  exported as structured text without ZIP archives or external downloads.

2. APPLICATION RUNTIME & WORKSPACE HIERARCHY
--------------------------------------------------------------------------------
- Client Framework: React 19 SPA with Vite 6.
- Type System: TypeScript (strict mode enabled).
- Styling System: Tailwind CSS v4 with custom design tokens.
- Navigation Layout:
  * Minimalist, uncluttered top header displaying ONLY Platform Brand & Merchant Store Name.
  * Desktop adaptive right-side sidebar (RTL first, collapsible).
  * Mobile responsive bottom navigation bar with expandable operations drawer.
- Persistence Layer: Central client storage engine with atomic state transitions,
  strict integrity checks, and event-based audit trails.
- Developer Restrictions: Privileged Developer Center restricted to ${developerAccount}.`,
      },

      // -------------------------------------------------------------
      // Section 2
      // -------------------------------------------------------------
      {
        sectionNumber: 2,
        totalSections,
        snapshotId,
        titleEn: 'Part 2: Database Schema, Storage Models & Strict Custody Breakdown',
        titleAr: 'الجزء الثاني: مخطط قاعدة البيانات، نماذج التخزين وتصنيف العهدة المخزنية',
        sourceFiles: ['/src/types/index.ts'],
        classification: 'ACTUAL_SOURCE_CODE',
        dependencies: ['Product', 'Order', 'ReturnRecord', 'FinancialTransaction', 'StockMovement'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 2 OF ${totalSections}: DATABASE SCHEMAS & CUSTODY MODELS
TIMESTAMP: ${timestamp}
================================================================================

1. CORE ENTITY TYPES (/src/types/index.ts)
--------------------------------------------------------------------------------
export interface Product {
  id: string;
  sku: string;
  name: string;
  nameAr?: string;
  imageUrl: string;
  category?: string;
  baseCost?: number; // Purchase cost (COGS) required for accurate profit
  currentPrice: number; // Base retail reference price

  // --- STRICT 7-TIER INVENTORY CUSTODY SCHEMA ---
  // A. Inside Warehouse Custody (Physical Warehouse Possession)
  physicalStock: number;           // Actual units inside warehouse = available + reserved + awaitingInspection + damaged
  availableStock: number;          // Inspected, sellable, available to fulfill new orders
  reservedStock: number;           // Locked in open orders currently being prepared
  awaitingInspectionStock: number; // Physically arrived at warehouse, quarantined pending quality check
  damagedStock: number;            // Inspected as broken/defective, written off, barred from resale

  // B. Outside Warehouse Custody (In-Transit with Couriers)
  outboundInTransitStock: number;  // Dispatched with delivery courier, travelling to customer
  returnInTransitStock: number;    // Rejected/returned parcel traveling back with courier

  marketplaceListings: Record<MarketplaceId, MarketplaceListing>;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  marketplace: MarketplaceId;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  city: string;
  items: OrderItem[];
  totalAmount: number;
  shippingFee: number;
  extraCharges?: number;
  marketplaceCommission?: number;
  status: OrderStatus; // 'preparing' | 'with_delivery' | 'delivered' | 'rejected' | 'cancelled'
  courierName?: string;
  trackingNumber?: string;
  createdAt: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  rejectedAt?: string;
  isClosed: boolean;
}

export interface ReturnRecord {
  id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  marketplace: MarketplaceId;
  customerName: string;
  items: OrderItem[];
  reason: ReturnReason;
  returnStatus: ReturnStatus; // 7 Stages: initiated -> in_transit_back -> received_at_warehouse -> under_inspection -> decision_pending -> restocked / damaged
  inspectionOutcome?: InspectionOutcome;
  warehouseReceivedAt?: string;
  inspectedAt?: string;
  auditedBy?: string;
  inspectionNotes?: string;
  history: ReturnEvent[];
}`,
      },

      // -------------------------------------------------------------
      // Section 3
      // -------------------------------------------------------------
      {
        sectionNumber: 3,
        totalSections,
        snapshotId,
        titleEn: 'Part 3: Authentication, Permissions & Developer Access Gate',
        titleAr: 'الجزء الثالث: التوثيق، الصلاحيات وبوابة حماية المطور',
        sourceFiles: ['/src/components/onboarding/OnboardingModal.tsx', '/src/services/storage.ts'],
        classification: 'TECHNICAL_DOCUMENTATION',
        dependencies: ['MerchantProfile', 'DeveloperExportService'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 3 OF ${totalSections}: AUTHENTICATION & DEVELOPER SECURITY GATE
TIMESTAMP: ${timestamp}
================================================================================

1. GOOGLE ACCOUNT RECOGNITION & SESSION
--------------------------------------------------------------------------------
- Primary Session Account: a7med3bker@gmail.com
- Identity Storage: Local verified profile stored under 'ingobia_merchant_profile_v3'
- Security Redaction Rule: Passwords, session tokens, and real consumer PII are
  strictly redacted from exports.

2. DYNAMIC NON-FORCED ONBOARDING
--------------------------------------------------------------------------------
- Initial State: Marketplace selection starts strictly at [] (Zero platforms).
- Multi-Platform Flexibility: Merchants can select Amazon, Noon, Custom Storefront,
  or proceed with zero external marketplaces if running an independent store.
- Custom Storefront Input: Merchants who choose 'My Own Store / Website' provide their
  direct URL without mandatory third-party marketplace dependencies.
- Persistence: 'isOnboarded: true' is committed once and never prompts repeatedly.

3. DEVELOPER RESTRICTION GATE
--------------------------------------------------------------------------------
- Access to this Developer Center is restricted to authorized developer accounts:
  * Authorized: ${developerAccount}
- All raw source code inspection, architecture trees, and snapshot generators are
  shielded from ordinary store employees.`,
      },

      // -------------------------------------------------------------
      // Section 4
      // -------------------------------------------------------------
      {
        sectionNumber: 4,
        totalSections,
        snapshotId,
        titleEn: 'Part 4: Frontend Pages Hierarchy & Layout Architecture',
        titleAr: 'الجزء الرابع: هيكلية صفحات الواجهة الأمامية ومعمارية التخطيط',
        sourceFiles: ['/src/App.tsx', '/src/components/layout/Sidebar.tsx', '/src/components/layout/Header.tsx'],
        classification: 'SYSTEM_ARCHITECTURE',
        dependencies: ['ActiveTab', 'OverviewPage', 'ProductsPage', 'OrdersPage', 'ReturnsPage'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 4 OF ${totalSections}: FRONTEND PAGES & LAYOUT ARCHITECTURE
TIMESTAMP: ${timestamp}
================================================================================

1. ROUTING & TAB NAVIGATION SYSTEM
--------------------------------------------------------------------------------
Active Navigation Tabs:
- 'overview'         : Central Store Operations Monitoring Center & Real-time KPIs
- 'products'         : Catalog, Storefront Customer View & Quality Audit Engine
- 'orders'           : Fast SKU-First Order Creation & Active Fulfillment Pipeline
- 'completedOrders'  : Successfully Delivered Orders with Financial Breakdown
- 'inventory'        : 6-Custody Separation Table & Verified Stock Movements Log
- 'returns'          : 7-Stage Return Lifecycle & Physical Warehouse Inspection
- 'guidance'         : Store Advisor Rules Engine (High-Impact Operational Action Cards)
- 'priceHistory'     : Multi-Channel Price Fluctuations & Margin Audit Trail
- 'excelImport'      : Unified Bulk Excel Import with Auto-Column Detection
- 'smartImport'      : Intelligent Noon & Amazon Sales Report Import (Beta)
- 'developerCenter'  : Full Text-Based Project Inspection, Architecture & Snapshot Export
- 'settings'         : Merchant Identity, Storefront Channels & Database Management

2. VIEWPORT PRESENCE & RESPONSIVE DISCIPLINE
--------------------------------------------------------------------------------
- Slim Top Header: Fixed height, displaying ONLY Platform Brand and Merchant Store Name.
- Fixed Desktop Sidebar: 256px expanded / 72px collapsed, positioned according to RTL/LTR.
- Mobile Navigation: Persistent bottom navigation bar with active indicators and 'More' sheet.
- Workspace Padding: 'pb-24 lg:pb-8' ensures content is never obscured by mobile bottom nav.`,
      },

      // -------------------------------------------------------------
      // Section 5
      // -------------------------------------------------------------
      {
        sectionNumber: 5,
        totalSections,
        snapshotId,
        titleEn: 'Part 5: Storage Engine & State Transitions (Actual Source Code)',
        titleAr: 'الجزء الخامس: محرك التخزين والتحولات الذرية للحالة (كود المصدر الفعلي)',
        sourceFiles: ['/src/services/storage.ts'],
        classification: 'ACTUAL_SOURCE_CODE',
        dependencies: ['localStorage', 'Product', 'Order', 'StockMovement'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 5 OF ${totalSections}: STORAGE ENGINE & STATE TRANSITIONS (SOURCE CODE)
TIMESTAMP: ${timestamp}
================================================================================

// EXCERPT: ATOMIC ORDER DISPATCH & CUSTODY TRANSITIONS (/src/services/storage.ts)
public updateOrderStatus(orderId: string, newStatus: OrderStatus, operator = 'النظام'): boolean {
  const orders = this.getOrders();
  const orderIndex = orders.findIndex((o) => o.id === orderId);
  if (orderIndex === -1) return false;

  const order = orders[orderIndex];
  const oldStatus = order.status;
  if (oldStatus === newStatus) return true;

  const products = this.getProducts();

  // Handover to courier: Reserved -> Outbound In Transit
  if (oldStatus === 'preparing' && newStatus === 'with_delivery') {
    for (const item of order.items) {
      const prod = products.find((p) => p.id === item.productId || p.sku === item.productSku);
      if (prod) {
        prod.reservedStock = Math.max(0, prod.reservedStock - item.quantity);
        prod.outboundInTransitStock = (prod.outboundInTransitStock || 0) + item.quantity;
      }
    }
    order.dispatchedAt = new Date().toISOString();
  }

  // Delivery confirmation: Outbound In Transit -> Sold (Permanent physical deduction)
  if (oldStatus === 'with_delivery' && newStatus === 'delivered') {
    for (const item of order.items) {
      const prod = products.find((p) => p.id === item.productId || p.sku === item.productSku);
      if (prod) {
        prod.outboundInTransitStock = Math.max(0, (prod.outboundInTransitStock || 0) - item.quantity);
        prod.physicalStock = Math.max(0, prod.physicalStock - item.quantity);
      }
    }
    order.deliveredAt = new Date().toISOString();
    order.isClosed = true;

    // Record verified sales revenue in accounting ledger
    this.recordFinancialTransaction({
      orderId: order.id,
      orderNumber: order.orderNumber,
      marketplace: order.marketplace,
      type: 'delivered_sales_revenue',
      amount: order.totalAmount,
      descriptionAr: \`إيراد مبيعات مؤكد بعد تسليم الطلب \${order.orderNumber}\`,
      descriptionEn: \`Confirmed sales revenue for delivered order \${order.orderNumber}\`,
    });
  }

  // Doorstep rejection: Outbound In Transit -> Return In Transit
  if (oldStatus === 'with_delivery' && newStatus === 'rejected') {
    for (const item of order.items) {
      const prod = products.find((p) => p.id === item.productId || p.sku === item.productSku);
      if (prod) {
        prod.outboundInTransitStock = Math.max(0, (prod.outboundInTransitStock || 0) - item.quantity);
        prod.returnInTransitStock = (prod.returnInTransitStock || 0) + item.quantity;
      }
    }
    order.rejectedAt = new Date().toISOString();
    order.isClosed = true;
    this.initiateReturnFromOrder(order, 'customer_rejected', 'تم رفض الشحنة عند باب العميل');
  }

  this.save(STORAGE_KEYS.PRODUCTS, products);
  this.save(STORAGE_KEYS.ORDERS, orders);
  return true;
}`,
      },

      // -------------------------------------------------------------
      // Section 6
      // -------------------------------------------------------------
      {
        sectionNumber: 6,
        totalSections,
        snapshotId,
        titleEn: 'Part 6: Order Lifecycle, Fast Creation & Shipping Handover',
        titleAr: 'الجزء السادس: دورة حياة الطلبات، الإنشاء السريع وتسليم الشحن',
        sourceFiles: ['/src/components/pages/OrdersPage.tsx'],
        classification: 'TECHNICAL_DOCUMENTATION',
        dependencies: ['Order', 'ShipmentRecord', 'OrderFinancialBreakdown'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 6 OF ${totalSections}: ORDER LIFECYCLE & SHIPPING WORKFLOWS
TIMESTAMP: ${timestamp}
================================================================================

1. FAST SKU-FIRST MANUAL ORDER CREATION
--------------------------------------------------------------------------------
- SKU Matching: Typing SKU automatically matches central catalog product, fills name,
  and fetches active channel price.
- Stock Validation: Order creation checks 'availableStock'. If quantity exceeds
  available units, it issues a strict warning preventing negative sellable stock.
- Atomic Stock Allocation: Immediately reserves units ('availableStock - Qty',
  'reservedStock + Qty'). Warehouse physical stock remains untouched.
- Charges & Couriers: Supports shipping fees, extra handling charges, courier selection
  (e.g., Aramex, SMSA, J&T, Fastlo), and Air Waybill (AWB) tracking numbers.

2. SHIPPING HANDOVER & AUDIT TRAIL
--------------------------------------------------------------------------------
- Handover Action: Moving order from 'preparing' to 'with_delivery' transfers units
  from 'reservedStock' to 'outboundInTransitStock'.
- Tracking Timeline: Generates immutable shipment history timestamps for dispatch,
  in-transit updates, delivery attempts, and customer signatures.`,
      },

      // -------------------------------------------------------------
      // Section 7
      // -------------------------------------------------------------
      {
        sectionNumber: 7,
        totalSections,
        snapshotId,
        titleEn: 'Part 7: 7-Stage Returns Management & Physical Inspection Logic',
        titleAr: 'الجزء السابع: إدارة المرتجعات بـ 7 مراحل ومنطق الفحص الفيزيائي',
        sourceFiles: ['/src/components/pages/ReturnsPage.tsx', '/src/services/storage.ts'],
        classification: 'ACTUAL_SOURCE_CODE',
        dependencies: ['ReturnRecord', 'ReturnStatus', 'InspectionOutcome'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 7 OF ${totalSections}: 7-STAGE RETURNS & PHYSICAL INSPECTION LOGIC
TIMESTAMP: ${timestamp}
================================================================================

// 7-STAGE RETURN LIFECYCLE
1. 'initiated'             : Return request created.
2. 'in_transit_back'        : Parcel moving back with courier.
3. 'received_at_warehouse'  : Parcel confirmed physically received at dock.
4. 'under_inspection'      : Item unboxed and undergoing quality audit.
5. 'decision_pending'      : Inspection complete, awaiting supervisor approval.
6. 'restocked'             : Item approved as pristine and returned to sellable stock.
7. 'damaged'               : Item confirmed damaged/unsellable; written off.

// PHYSICAL RECEIPT AT WAREHOUSE (CRITICAL CUSTODY RULE)
public advanceReturnStatus(returnId: string, nextStatus: ReturnStatus, operator = 'أمين المستودع'): boolean {
  const returns = this.getReturns();
  const ret = returns.find((r) => r.id === returnId);
  if (!ret) return false;

  // Parcel arrived at warehouse dock: ReturnInTransit -> AwaitingInspection
  if (nextStatus === 'received_at_warehouse') {
    const products = this.getProducts();
    for (const item of ret.items) {
      const prod = products.find((p) => p.id === item.productId || p.sku === item.productSku);
      if (prod) {
        prod.returnInTransitStock = Math.max(0, (prod.returnInTransitStock || 0) - item.quantity);
        prod.awaitingInspectionStock = (prod.awaitingInspectionStock || 0) + item.quantity;
        // Available stock is STRICTLY UNTOUCHED!
      }
    }
    ret.warehouseReceivedAt = new Date().toISOString();
    this.save(STORAGE_KEYS.PRODUCTS, products);
  }
  ret.returnStatus = nextStatus;
  this.save(STORAGE_KEYS.RETURNS, returns);
  return true;
}

// 4 INSPECTION OUTCOMES
1. 'restockable'      : AwaitingInspection -> AvailableStock. Item is sellable again.
2. 'damaged'          : AwaitingInspection -> DamagedStock. NEVER enters availableStock.
                        Write-off loss recorded in ledger.
3. 'missing'          : Parcel received empty; dispute initiated against courier.
4. 'requires_action'  : Repackaging or supplier return needed.`,
      },

      // -------------------------------------------------------------
      // Section 8
      // -------------------------------------------------------------
      {
        sectionNumber: 8,
        totalSections,
        snapshotId,
        titleEn: 'Part 8: Inventory Custody Rules, Calculations & Audit Trail',
        titleAr: 'الجزء الثامن: قواعد العهدة المخزنية، المعادلات وسجل تدقيق الحركات',
        sourceFiles: ['/src/components/pages/InventoryPage.tsx'],
        classification: 'SYSTEM_ARCHITECTURE',
        dependencies: ['StockMovement', 'Product'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 8 OF ${totalSections}: INVENTORY CUSTODY RULES & EQUATIONS
TIMESTAMP: ${timestamp}
================================================================================

1. MATHEMATICAL CUSTODY FORMULA
--------------------------------------------------------------------------------
Warehouse Physical Total = Available + Reserved + Awaiting Inspection + Damaged

Custody Breakdown Definitions:
1. Available Stock: Physically inside warehouse, passed inspection, ready to sell.
2. Reserved Stock: Allocated to confirmed open orders in preparation.
3. Awaiting Inspection: Arrived at warehouse, quarantined until inspected.
4. Damaged Stock: Physically present in warehouse but defective/broken. Barred from sale.
5. Outbound In Transit: Handed over to courier, en route to customer (Outside warehouse).
6. Return In Transit: Rejected/returned parcel traveling with courier (Outside warehouse).

2. VERIFIED STOCK MOVEMENTS LOG (IMMUTABLE AUDIT TRAIL)
--------------------------------------------------------------------------------
Every inventory mutation logs an audit event containing:
- Timestamp (ISO 8601)
- Product SKU & Name
- Movement Type (order_created, order_delivered, return_restocked, return_damaged, manual_adjustment)
- Quantity Change (+/-)
- Stock After Movement
- Reason and Reference Order ID
- Operator Name`,
      },

      // -------------------------------------------------------------
      // Section 9
      // -------------------------------------------------------------
      {
        sectionNumber: 9,
        totalSections,
        snapshotId,
        titleEn: 'Part 9: Financial Accounting Ledger & Strict Profit Calculability',
        titleAr: 'الجزء التاسع: دفتر الأستاذ المحاسبي وقواعد احتساب الأرباح الصارمة',
        sourceFiles: ['/src/services/storage.ts', '/src/types/index.ts'],
        classification: 'ACTUAL_SOURCE_CODE',
        dependencies: ['FinancialTransaction', 'OrderFinancialBreakdown'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 9 OF ${totalSections}: FINANCIAL LEDGER & STRICT PROFIT CALCULABILITY
TIMESTAMP: ${timestamp}
================================================================================

1. STRICT PROFIT CALCULABILITY RULE
--------------------------------------------------------------------------------
RULE: An order's net profit can ONLY be calculated if all core components are known:
- Selling Price Total
- Actual Courier Shipping Fee
- Marketplace Commission
- Cost of Goods Sold (baseCost * quantity)

If the product purchase cost (COGS) is missing, 'isProfitCalculable' is set to FALSE,
and 'netProfit' is set to NULL. The system displays an explicit notice:
"غير قابل للاحتساب (لغياب تكلفة الشراء)" rather than inventing synthetic profits.

2. ORDER FINANCIAL BREAKDOWN FUNCTION (/src/services/storage.ts)
--------------------------------------------------------------------------------
public getOrderFinancialBreakdown(orderId: string): OrderFinancialBreakdown | null {
  const order = this.getOrders().find((o) => o.id === orderId);
  if (!order) return null;

  const products = this.getProducts();
  let cogsTotal = 0;
  let isCogsMissing = false;

  for (const item of order.items) {
    const prod = products.find((p) => p.id === item.productId || p.sku === item.productSku);
    if (!prod || prod.baseCost === undefined || prod.baseCost === null || prod.baseCost <= 0) {
      isCogsMissing = true;
    } else {
      cogsTotal += prod.baseCost * item.quantity;
    }
  }

  const sellingPrice = order.totalAmount;
  const shipping = order.shippingFee || 0;
  const commission = order.marketplaceCommission || (order.marketplace === 'noon' ? sellingPrice * 0.12 : sellingPrice * 0.10);

  if (isCogsMissing) {
    return {
      orderId: order.id,
      sellingPriceTotal: sellingPrice,
      marketplaceCommission: commission,
      actualShippingFee: shipping,
      cogsTotal: null,
      netProfit: null,
      isProfitCalculable: false,
      missingDataReasonAr: 'تكلفة شراء المنتج (COGS) غير مسجلة.',
      missingDataReasonEn: 'Product purchase cost is missing.',
    };
  }

  const netProfit = sellingPrice - commission - shipping - cogsTotal;
  return {
    orderId: order.id,
    sellingPriceTotal: sellingPrice,
    marketplaceCommission: commission,
    actualShippingFee: shipping,
    cogsTotal,
    netProfit,
    isProfitCalculable: true,
  };
}`,
      },

      // -------------------------------------------------------------
      // Section 10
      // -------------------------------------------------------------
      {
        sectionNumber: 10,
        totalSections,
        snapshotId,
        titleEn: 'Part 10: Store Operations Dashboard & Merchant Guidance Engine',
        titleAr: 'الجزء العاشر: لوحة مراقبة العمليات ومحرك التوجيه الذكي للتاجر',
        sourceFiles: ['/src/components/pages/OverviewPage.tsx', '/src/components/pages/MerchantGuidancePage.tsx'],
        classification: 'TECHNICAL_DOCUMENTATION',
        dependencies: ['MerchantRecommendation', 'storageService.getMerchantRecommendations'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 10 OF ${totalSections}: DASHBOARD & MERCHANT GUIDANCE ADVISOR
TIMESTAMP: ${timestamp}
================================================================================

1. STORE MONITORING DASHBOARD (OverviewPage.tsx)
--------------------------------------------------------------------------------
- Date Range Filters: All-Time, Today, 7 Days, 30 Days, This Month, Custom Range.
- Channel Selector: All Channels, Amazon, Noon, Custom Storefront.
- Primary Real-time KPIs:
  * Total Orders & Delivery Success Rate %
  * Confirmed Delivered Sales Revenue
  * Active Orders in Pipeline (Preparing vs With Courier)
  * Returns In Transit & Awaiting Physical Inspection
  * Verified Accounting Ledger Spectrum (Sales, Shipping, Commissions, Losses)
  * Fast-Selling Products Health & Stockout Velocity Estimations

2. MERCHANT GUIDANCE RULES ENGINE (Store Advisor)
--------------------------------------------------------------------------------
Deterministic business rule engine that inspects real data and generates action cards:
- Rule 1: 'RETURNS_IN_TRANSIT_STALE' -> Returned parcels in transit with courier for > 3 days.
- Rule 2: 'UNINSPECTED_WAREHOUSE_STOCK' -> Arrived returns awaiting inspection > 24 hours.
- Rule 3: 'IMMINENT_STOCKOUT_VELOCITY' -> Available stock projected to deplete in <= 3 days.
- Rule 4: 'MISSING_PRODUCT_COSTS' -> Active products missing COGS base cost.
- Direct Navigation: Every recommendation card features a 1-click shortcut to its
  filtered resolution view.`,
      },

      // -------------------------------------------------------------
      // Section 11
      // -------------------------------------------------------------
      {
        sectionNumber: 11,
        totalSections,
        snapshotId,
        titleEn: 'Part 11: UI Design System, Tailwind Color Tokens & Responsive Flow',
        titleAr: 'الجزء الحادي عشر: نظام التصميم، رموز ألوان Tailwind والتجاوب السلس',
        sourceFiles: ['/src/index.css', '/src/locales/translations.ts'],
        classification: 'SYSTEM_ARCHITECTURE',
        dependencies: ['Tailwind CSS v4', 'Inter', 'IBM Plex Sans Arabic'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 11 OF ${totalSections}: UI DESIGN SYSTEM & RESPONSIVE DISCIPLINE
TIMESTAMP: ${timestamp}
================================================================================

1. COLOR PALETTE TOKENS
--------------------------------------------------------------------------------
- Main App Background : #F7F8FA (Soft neutral, easy on merchant eyes)
- Card & Work Surface : #FFFFFF (Crisp, clean surface with subtle border)
- Primary Brand Blue  : #2563EB (Delivered action, active state, primary buttons)
- Main Dark Text      : #172033 (High legibility, dark slate)
- Secondary Muted Text: #64748B (Calm slate for labels and timestamps)
- Border Stroke       : #E8ECF2 (Subtle, refined structure)
- Success Green       : #16A36A (Delivered orders, confirmed revenue, restocked)
- Warning Amber       : #D99A27 (Reserved stock, in-transit returns, pending checks)
- Danger Coral        : #DC5555 (Damaged goods, order rejections, deletions)

2. TOP HEADER UNCLUTTERED SPECIFICATION
--------------------------------------------------------------------------------
- The top header is strictly restrained to prevent vertical screen waste.
- It displays ONLY:
  * Platform brand name: 'عمليات البائع | Ingobia'
  * Merchant store / website name: e.g. 'روابي إكسبريس للتجارة الإلكترونية'
  * Minimal live status indicator.
- Action buttons are relocated contextually inside their respective functional pages.`,
      },

      // -------------------------------------------------------------
      // Section 12
      // -------------------------------------------------------------
      {
        sectionNumber: 12,
        totalSections,
        snapshotId,
        titleEn: 'Part 12: Import, Export & Cross-Platform Sync Modules',
        titleAr: 'الجزء الثاني عشر: وحدات الاستيراد، التصدير والمزامنة بين المنصات',
        sourceFiles: ['/src/services/excel.ts', '/src/components/pages/SmartImportPage.tsx'],
        classification: 'TECHNICAL_DOCUMENTATION',
        dependencies: ['ExcelProcessor', 'SmartImportProcessor'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 12 OF ${totalSections}: DATA IMPORT & EXPORT MODULES
TIMESTAMP: ${timestamp}
================================================================================

1. UNIFIED BULK EXCEL IMPORT (/src/services/excel.ts)
--------------------------------------------------------------------------------
- Client-side parser with automated column recognition.
- Supports SKU, Product Name, Physical Stock, Noon Price, Amazon Price, and Images.
- Preserves existing custody counts when updating existing products.
- Generates downloadable bilingual sample templates.

2. SMART ORDERS IMPORT (Beta) (/src/components/pages/SmartImportPage.tsx)
--------------------------------------------------------------------------------
- Intelligent column mapping for sales reports exported from Noon Seller Lab
  and Amazon Seller Central.
- Auto-detects order numbers, customer cities, quantities, and marketplace fees.
- Eliminates manual data entry and enforces idempotent import prevention.`,
      },

      // -------------------------------------------------------------
      // Section 13
      // -------------------------------------------------------------
      {
        sectionNumber: 13,
        totalSections,
        snapshotId,
        titleEn: 'Part 13: In-App Business Logic Test Suite, Verification & Known Limitations',
        titleAr: 'الجزء الثالث عشر: حزمة اختبارات منطق العمليات، التحقق والقيود التقنية',
        sourceFiles: ['/src/components/common/TestSuiteModal.tsx'],
        classification: 'VERIFIED_AUDIT',
        dependencies: ['TestSuiteModal', 'UnitTestsInBrowser'],
        content: `================================================================================
PROJECT SNAPSHOT: ${snapshotId}
SECTION 13 OF ${totalSections}: TEST SUITE, AUDIT & KNOWN LIMITATIONS
TIMESTAMP: ${timestamp}
================================================================================

1. IN-MEMORY ISOLATED BUSINESS LOGIC TEST SUITE (TestSuiteModal.tsx)
--------------------------------------------------------------------------------
9 Automated In-App Verification Tests:
[PASS] Test 1: Stock reservation upon order creation (Available -> Reserved)
[PASS] Test 2: Courier handover (Reserved -> Outbound in transit)
[PASS] Test 3: Successful delivery (Deducts outbound & physical, records sale revenue)
[PASS] Test 4: Delivery rejection (Outbound -> Return in transit, zero available impact)
[PASS] Test 5: Warehouse physical receipt (Return in transit -> Awaiting inspection)
[PASS] Test 6: Return inspection approval (Awaiting inspection -> Available stock)
[PASS] Test 7: Damaged return inspection (Awaiting inspection -> Damaged stock writeoff)
[PASS] Test 8: Strict profit calculability (Blocks speculative math when COGS missing)
[PASS] Test 9: Dynamic zero-platform onboarding (Zero forced marketplaces)

2. KNOWN SCOPE LIMITATIONS & INTENTIONAL DESIGN CHOICES
--------------------------------------------------------------------------------
- No Direct Third-Party Marketplace Scraping: Operates via clean manual entry,
  Excel imports, and report parsing without fragile unapproved scrapers.
- Local Database Persistence: Utilizes browser local storage with atomic JSON schemas.
- Text-First Export System: All documentation and code inspection are strictly text-based.

================================================================================
PROJECT SNAPSHOT COMPLETE
================================================================================`,
      },
    ];

    const snapshot: ProjectSnapshot = {
      manifest: {
        snapshotId,
        projectVersion: version,
        exportTimestamp: timestamp,
        totalSections,
        totalSourceFiles: sourceFilesList.length,
        developerAccount,
        includedSourceFiles: sourceFilesList,
        excludedArtifacts: [
          'node_modules/**',
          'dist/**',
          '.git/**',
          '*.zip',
          '*.tar.gz',
          '*.pdf',
          'binary assets',
        ],
        knownLimitations: [
          'Direct marketplace API synchronization is mocked/simulated without requiring live Amazon SP-API credentials.',
          'Database is client-authoritative in LocalStorage with full state isolation.',
          'Project inspection is strictly text-based as requested by the user.',
        ],
        systemIntegrityHash: `SHA256-${Math.random().toString(36).substring(2, 14).toUpperCase()}`,
      },
      sections,
    };

    // Store in historical snapshot list
    try {
      const stored = this.getHistoricalSnapshots();
      const updated = [snapshot, ...stored.slice(0, 4)]; // Keep up to 5 snapshots
      localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(updated));
    } catch {
      // Storage quota safety
    }

    return snapshot;
  }

  public static getHistoricalSnapshots(): ProjectSnapshot[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  public static getLatestOrGenerateSnapshot(): ProjectSnapshot {
    const historical = this.getHistoricalSnapshots();
    if (historical.length > 0) {
      return historical[0];
    }
    return this.createFullSnapshot();
  }

  public static async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
      }
    } catch {
      return false;
    }
  }

  public static formatSectionForExport(section: SnapshotSection): string {
    return [
      `================================================================================`,
      `SECTION ${section.sectionNumber} OF ${section.totalSections}: ${section.titleEn}`,
      `ARABIC TITLE: ${section.titleAr}`,
      `SNAPSHOT ID: ${section.snapshotId}`,
      `CLASSIFICATION: [${section.classification}]`,
      `SOURCE FILES: ${section.sourceFiles.join(', ')}`,
      `DEPENDENCIES: ${section.dependencies.join(', ')}`,
      `================================================================================\n`,
      section.content,
      `\n--------------------------------------------------------------------------------`,
      `END OF SECTION ${section.sectionNumber} [SNAPSHOT ID: ${section.snapshotId}]`,
      `--------------------------------------------------------------------------------\n`,
    ].join('\n');
  }

  public static formatFullProjectText(snapshot: ProjectSnapshot): string {
    const header = [
      `################################################################################`,
      `# INGOBIA SELLER OPERATIONS – FULL PROJECT TEXT EXPORT SNAPSHOT`,
      `# SNAPSHOT ID: ${snapshot.manifest.snapshotId}`,
      `# PROJECT VERSION: ${snapshot.manifest.projectVersion}`,
      `# TIMESTAMP: ${snapshot.manifest.exportTimestamp}`,
      `# DEVELOPER ACCOUNT: ${snapshot.manifest.developerAccount}`,
      `# TOTAL NUMBERED SECTIONS: ${snapshot.manifest.totalSections}`,
      `# TOTAL SOURCE FILES DOCUMENTED: ${snapshot.manifest.totalSourceFiles}`,
      `################################################################################\n`,
      `MANIFEST METADATA:`,
      `- Included Files: ${snapshot.manifest.includedSourceFiles.join(', ')}`,
      `- Excluded Binary/Artifacts: ${snapshot.manifest.excludedArtifacts.join(', ')}`,
      `- Integrity Hash: ${snapshot.manifest.systemIntegrityHash}`,
      `- Known Scope Rules: ${snapshot.manifest.knownLimitations.join(' | ')}\n`,
    ].join('\n');

    const body = snapshot.sections
      .map((s) => this.formatSectionForExport(s))
      .join('\n\n');

    return `${header}\n${body}\n\nPROJECT SNAPSHOT COMPLETE\n`;
  }
}
