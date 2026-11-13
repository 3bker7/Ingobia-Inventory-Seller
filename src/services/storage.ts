/**
 * Central storage and business rules facade for Seller Operations.
 * Persists state to localStorage while delegating all business invariants,
 * state machines, financial calculations, and custody checks to pure domain engines.
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
} from '../types';
import {
  STORAGE_KEYS,
  DEFAULT_MERCHANT_PROFILE,
  DEFAULT_MARKETPLACES,
  DEFAULT_SETTINGS,
  DEFAULT_PRODUCTS,
  DEFAULT_ORDERS,
  DEFAULT_RETURNS,
  DEFAULT_PRICE_HISTORY,
  DEFAULT_MOVEMENTS,
  DEFAULT_FINANCIAL_TRANSACTIONS,
} from './seedData';
import {
  applyManualStockAdjustmentPure,
  computePriceChangeMetrics,
  normalizeProductCustody,
} from '../domain/inventoryCustody';
import {
  createOrderPure,
  updateOrderStatusPure,
} from '../domain/orderLifecycle';
import {
  addReturnNotePure,
  advanceReturnStatusPure,
  processReturnInspectionPure,
  registerPostDeliveryReturnPure,
} from '../domain/returnLifecycle';
import {
  computeFinancialSummary,
  computeOrderFinancialBreakdown,
  resolveOrderItemUnitCost,
} from '../domain/financialLedger';
import { saveSmartImportOrdersPure } from '../domain/smartImportCustody';

export {
  STORAGE_KEYS,
  DEFAULT_MERCHANT_PROFILE,
  DEFAULT_MARKETPLACES,
  DEFAULT_SETTINGS,
  DEFAULT_PRODUCTS,
  DEFAULT_ORDERS,
  DEFAULT_RETURNS,
  DEFAULT_PRICE_HISTORY,
  DEFAULT_MOVEMENTS,
  DEFAULT_FINANCIAL_TRANSACTIONS,
};

class StorageService {
  private hasStorage(): boolean {
    return typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
  }

  private get<T>(key: string, defaultVal: T): T {
    if (!this.hasStorage()) return defaultVal;
    try {
      const data = globalThis.localStorage.getItem(key);
      if (!data) return defaultVal;
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`Failed to read ${key} from storage:`, e);
      return defaultVal;
    }
  }

  private set<T>(key: string, value: T): void {
    if (!this.hasStorage()) return;
    try {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Failed to write ${key} to storage:`, e);
    }
  }

  public init(): void {
    if (!this.hasStorage()) return;
    if (!globalThis.localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
      this.set(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
    }
    if (!globalThis.localStorage.getItem(STORAGE_KEYS.ORDERS)) {
      this.set(STORAGE_KEYS.ORDERS, DEFAULT_ORDERS);
    }
    if (!globalThis.localStorage.getItem(STORAGE_KEYS.MOVEMENTS)) {
      this.set(STORAGE_KEYS.MOVEMENTS, DEFAULT_MOVEMENTS);
    }
    if (!globalThis.localStorage.getItem(STORAGE_KEYS.RETURNS)) {
      this.set(STORAGE_KEYS.RETURNS, DEFAULT_RETURNS);
    }
    if (!globalThis.localStorage.getItem(STORAGE_KEYS.PRICE_HISTORY)) {
      this.set(STORAGE_KEYS.PRICE_HISTORY, DEFAULT_PRICE_HISTORY);
    }
    if (!globalThis.localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
      this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    }
    if (!globalThis.localStorage.getItem(STORAGE_KEYS.FINANCIAL_TRANSACTIONS)) {
      this.set(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, DEFAULT_FINANCIAL_TRANSACTIONS);
    }
  }

  public resetToSample(): void {
    this.set(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
    this.set(STORAGE_KEYS.ORDERS, DEFAULT_ORDERS);
    this.set(STORAGE_KEYS.MOVEMENTS, DEFAULT_MOVEMENTS);
    this.set(STORAGE_KEYS.RETURNS, DEFAULT_RETURNS);
    this.set(STORAGE_KEYS.PRICE_HISTORY, DEFAULT_PRICE_HISTORY);
    this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    this.set(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, DEFAULT_FINANCIAL_TRANSACTIONS);
  }

  // --- Products ---
  public getProducts(): Product[] {
    const raw = this.get<Product[]>(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
    return raw.map(normalizeProductCustody);
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
    const normalized = normalizeProductCustody(product);
    const index = products.findIndex((p) => p.id === normalized.id);
    const nowIso = new Date().toISOString();

    if (index >= 0) {
      products[index] = { ...normalized, updatedAt: nowIso };
    } else {
      products.unshift({
        ...normalized,
        createdAt: normalized.createdAt || nowIso,
        updatedAt: nowIso,
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

    const existingListingPrice = product.marketplaceListings[marketplaceId]?.price;
    const previousPrice =
      typeof existingListingPrice === 'number' ? existingListingPrice : product.currentPrice;

    const metrics = computePriceChangeMetrics(previousPrice, newPrice);
    if (!metrics.valid || previousPrice === newPrice) return null;

    const nowIso = new Date().toISOString();
    if (!product.marketplaceListings[marketplaceId]) {
      product.marketplaceListings[marketplaceId] = {
        marketplaceId,
        price: newPrice,
        quantity: 0,
        listingStatus: 'active',
        lastUpdated: nowIso,
      };
    } else {
      product.marketplaceListings[marketplaceId].price = newPrice;
      product.marketplaceListings[marketplaceId].lastUpdated = nowIso;
    }

    product.currentPrice = newPrice;
    product.updatedAt = nowIso;
    this.set(STORAGE_KEYS.PRODUCTS, products);

    const historyRecord: PriceHistoryRecord = {
      id: `ph-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      productId: product.id,
      productSku: product.sku || product.name,
      productName: product.name,
      marketplaceId,
      previousPrice,
      newPrice,
      percentageDiff: metrics.percentageDiff,
      changeType: metrics.changeType,
      reason: reason || undefined,
      changedBy,
      timestamp: nowIso,
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

  public getActiveOrders(): Order[] {
    return this.getOrders().filter((o) => !o.isClosed);
  }

  public getCompletedOrders(): Order[] {
    return this.getOrders().filter((o) => o.isClosed === true);
  }

  public createOrder(
    orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'stockDeducted' | 'isClosed'>,
    customId?: string,
    operator: string = 'مدير العمليات'
  ): { success: boolean; order?: Order; error?: string } {
    const res = createOrderPure({
      orderData,
      products: this.getProducts(),
      existingOrders: this.getOrders(),
      customId,
      operator,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    this.set(STORAGE_KEYS.PRODUCTS, res.products);
    this.set(STORAGE_KEYS.ORDERS, res.orders);
    if (res.movements.length > 0) {
      this.recordStockMovements(res.movements);
    }

    return { success: true, order: res.order };
  }

  public updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    operator: string = 'مدير العمليات',
    shipmentDetails?: Partial<ShipmentRecord>
  ): { success: boolean; error?: string } {
    const settings = this.getSettings();
    const res = updateOrderStatusPure({
      orderId,
      newStatus,
      orders: this.getOrders(),
      products: this.getProducts(),
      returns: this.getReturns(),
      currency: settings.currency || 'SAR',
      operator,
      shipmentDetails,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    this.set(STORAGE_KEYS.ORDERS, res.orders);
    this.set(STORAGE_KEYS.PRODUCTS, res.products);
    this.set(STORAGE_KEYS.RETURNS, res.returns);

    if (res.newMovements.length > 0) {
      this.recordStockMovements(res.newMovements);
    }
    for (const tx of res.newTransactions) {
      this.recordFinancialTransaction(tx);
    }

    return { success: true };
  }

  // --- Returns Management ---
  public getReturns(): ReturnRecord[] {
    const raw = this.get<ReturnRecord[]>(STORAGE_KEYS.RETURNS, DEFAULT_RETURNS);
    return raw.map((r) => {
      let status: ReturnStatus = r.returnStatus;
      let isCompleted = r.isCompleted;
      let inspectionOutcome = r.inspectionOutcome;

      if (status === 'delivery_rejected') status = 'return_initiated';
      if (status === 'product_received') status = 'received_at_warehouse';
      if (status === 'restocked') {
        status = 'closed';
        isCompleted = true;
        inspectionOutcome = inspectionOutcome || 'restockable';
      }
      if (status === 'damaged') {
        status = 'closed';
        isCompleted = true;
        inspectionOutcome = inspectionOutcome || 'damaged';
      }

      return {
        ...r,
        returnStatus: status,
        isCompleted,
        inspectionOutcome,
        activities: r.activities || [],
      };
    });
  }

  public getActiveReturns(): ReturnRecord[] {
    return this.getReturns().filter((r) => !r.isCompleted && r.returnStatus !== 'closed');
  }

  public advanceReturnStatus(
    returnId: string,
    targetStatus: ReturnStatus,
    operator: string = 'مدير العمليات',
    notes?: string,
    shipment?: Partial<ShipmentRecord>
  ): { success: boolean; error?: string } {
    const res = advanceReturnStatusPure({
      returnId,
      targetStatus,
      returns: this.getReturns(),
      products: this.getProducts(),
      orders: this.getOrders(),
      operator,
      notes,
      shipment,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    this.set(STORAGE_KEYS.RETURNS, res.returns);
    this.set(STORAGE_KEYS.PRODUCTS, res.products);

    if (res.newMovements.length > 0) {
      this.recordStockMovements(res.newMovements);
    }

    return { success: true };
  }

  public processReturnInspection(
    returnId: string,
    outcome: InspectionOutcome,
    condition: 'like_new' | 'opened_good' | 'damaged' | 'lost',
    notes: string,
    operator: string = 'مدير العمليات'
  ): { success: boolean; message: string } {
    const settings = this.getSettings();
    const res = processReturnInspectionPure({
      returnId,
      outcome,
      condition,
      notes,
      returns: this.getReturns(),
      products: this.getProducts(),
      orders: this.getOrders(),
      currency: settings.currency || 'SAR',
      operator,
    });

    if (!res.success) {
      return { success: false, message: res.message };
    }

    this.set(STORAGE_KEYS.RETURNS, res.returns);
    this.set(STORAGE_KEYS.PRODUCTS, res.products);
    this.set(STORAGE_KEYS.ORDERS, res.orders);

    if (res.newMovements.length > 0) {
      this.recordStockMovements(res.newMovements);
    }
    for (const tx of res.newTransactions) {
      this.recordFinancialTransaction(tx);
    }

    return { success: true, message: res.message };
  }

  public registerPostDeliveryReturn(
    orderId: string,
    reason: string,
    notes?: string
  ): { success: boolean; returnRecord?: ReturnRecord; error?: string } {
    const settings = this.getSettings();
    const res = registerPostDeliveryReturnPure({
      orderId,
      reason,
      notes,
      orders: this.getOrders(),
      returns: this.getReturns(),
      products: this.getProducts(),
      currency: settings.currency || 'SAR',
      operator: settings.sellerName || 'مدير العمليات',
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    this.set(STORAGE_KEYS.PRODUCTS, res.products);
    this.set(STORAGE_KEYS.RETURNS, res.returns);
    this.set(STORAGE_KEYS.ORDERS, res.orders);

    if (res.newMovements.length > 0) {
      this.recordStockMovements(res.newMovements);
    }
    for (const tx of res.newTransactions) {
      this.recordFinancialTransaction(tx);
    }

    return { success: true, returnRecord: res.returnRecord };
  }

  public addReturnNote(
    returnId: string,
    note: string,
    operator: string = 'مدير العمليات'
  ): { success: boolean; returnRecord?: ReturnRecord; error?: string } {
    const res = addReturnNotePure({
      returnId,
      note,
      returns: this.getReturns(),
      operator,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    this.set(STORAGE_KEYS.RETURNS, res.returns);
    return { success: true, returnRecord: res.returnRecord };
  }

  // --- Financial Transaction Ledger & Auditable Accounting ---
  public getFinancialTransactions(): FinancialTransaction[] {
    return this.get<FinancialTransaction[]>(
      STORAGE_KEYS.FINANCIAL_TRANSACTIONS,
      DEFAULT_FINANCIAL_TRANSACTIONS
    );
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

  public getOrderFinancialBreakdown(orderId: string): OrderFinancialBreakdown | null {
    const order = this.getOrders().find((o) => o.id === orderId);
    if (!order) return null;
    return computeOrderFinancialBreakdown(order, this.getProducts());
  }

  public getFinancialSummary(
    dateRange?: { start: Date; end: Date },
    marketplace?: MarketplaceId
  ) {
    const orders = this.getFilteredOrders(dateRange, marketplace);
    return computeFinancialSummary(
      orders,
      this.getFinancialTransactions(),
      this.getProducts(),
      dateRange,
      marketplace
    );
  }

  // --- Internal Deterministic Merchant Guidance (Store Advisor) ---
  public getMerchantRecommendations(): MerchantRecommendation[] {
    const orders = this.getOrders();
    const returns = this.getReturns();
    const products = this.getProducts();
    const settings = this.getSettings();
    const currency = settings.currency || 'SAR';
    const recs: MerchantRecommendation[] = [];

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
            measurableImpactAr: `${ret.items.reduce((s, i) => s + i.quantity, 0)} قطعة معلقة خارج المستودع بقيمة ${ret.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)} ${currency}`,
            measurableImpactEn: `${ret.items.reduce((s, i) => s + i.quantity, 0)} units pending outside warehouse worth ${ret.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)} ${currency}`,
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

    const awaitingInspectionReturns = returns.filter(
      (r) =>
        (r.returnStatus === 'received_at_warehouse' || r.returnStatus === 'under_inspection') &&
        !r.isCompleted
    );
    if (awaitingInspectionReturns.length > 0) {
      const totalUnits = awaitingInspectionReturns.reduce(
        (sum, r) => sum + r.items.reduce((s, i) => s + i.quantity, 0),
        0
      );
      recs.push({
        id: 'rec-returns-awaiting-inspection',
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

    const deliveredWithoutCost = orders.filter((o) => {
      if (o.status !== 'delivered') return false;
      return o.items.some((item) => resolveOrderItemUnitCost(item, products).unitCost === null);
    });

    if (deliveredWithoutCost.length > 0) {
      const uncalculatedTotal = deliveredWithoutCost.reduce((s, o) => s + o.totalAmount, 0);
      recs.push({
        id: 'rec-missing-costs',
        titleAr: `تعذر حساب صافي الربح لـ ${deliveredWithoutCost.length} طلب مكتمل`,
        titleEn: `Profit Uncalculated for ${deliveredWithoutCost.length} Delivered Orders`,
        whatHappenedAr: `تم تسليم ${deliveredWithoutCost.length} طلب بنجاح، لكن سعر التكلفة الأساسي (Base Cost) للمنتجات غير مسجل.`,
        whatHappenedEn: `${deliveredWithoutCost.length} orders delivered successfully, but product base costs are missing.`,
        whyItMattersAr: 'حسب المعايير المالية الدقيقة، لا يتم إظهار أرباح تقديرية وهمية دون وجود تكلفة الشراء الحقيقية.',
        whyItMattersEn: 'Strict financial integrity prevents displaying speculative profits without verified cost of goods.',
        measurableImpactAr: `إجمالي مبيعات ${uncalculatedTotal} ${currency} بدون تكلفة مسجلة`,
        measurableImpactEn: `${uncalculatedTotal} ${currency} in sales uncalculated`,
        recommendedActionAr: 'تحديث سعر التكلفة من صفحة المنتجات ليتم حساب الأرباح الحقيقية فوراً',
        recommendedActionEn: 'Enter base purchase cost in Products to enable net profit calculations',
        actionTab: 'products',
        category: 'financial',
        priority: 'medium',
        status: 'new',
        createdAt: new Date().toISOString(),
      });
    }

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
          measurableImpactAr: `قيمة الطلب: ${o.totalAmount} ${currency}`,
          measurableImpactEn: `Order value: ${o.totalAmount} ${currency}`,
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
    const currency = this.getSettings().currency || 'SAR';
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

    const prices = Object.values(product.marketplaceListings || {}).map((m) => m.price);
    if (prices.length > 1) {
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      if (maxPrice - minPrice > 10) {
        issues.push({
          type: 'info',
          messageAr: `فارق سعر ملحوظ بين المنصات (${minPrice} مقابل ${maxPrice} ${currency}).`,
          messageEn: `Noticeable price gap across channels (${minPrice} vs ${maxPrice} ${currency}).`,
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

  public recordStockMovements(newMovements: StockMovement[]): void {
    if (!newMovements || newMovements.length === 0) return;
    const movements = this.getMovements();
    movements.unshift(...newMovements);
    this.set(STORAGE_KEYS.MOVEMENTS, movements);
  }

  public manualStockAdjustmentWithResult(
    productId: string,
    newPhysicalStock: number,
    reason: string,
    operator: string = 'مدير العمليات'
  ): { success: boolean; error?: string } {
    const res = applyManualStockAdjustmentPure(
      this.getProducts(),
      productId,
      newPhysicalStock,
      reason,
      operator
    );

    if (!res.success) {
      return { success: false, error: res.error };
    }

    this.set(STORAGE_KEYS.PRODUCTS, res.products);
    if (res.movement) {
      this.recordStockMovements([res.movement]);
    }
    return { success: true };
  }

  public manualStockAdjustment(
    productId: string,
    newPhysicalStock: number,
    reason: string,
    operator: string = 'مدير العمليات'
  ): boolean {
    return this.manualStockAdjustmentWithResult(productId, newPhysicalStock, reason, operator).success;
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
      if (marketplace && marketplace !== 'all' && order.marketplaceId !== marketplace) {
        return false;
      }
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
    const res = saveSmartImportOrdersPure({
      ordersToImport,
      isHistoricalDeducted,
      existingOrders: this.getOrders(),
      products: this.getProducts(),
      returns: this.getReturns(),
      operator,
    });

    this.set(STORAGE_KEYS.ORDERS, res.orders);
    this.set(STORAGE_KEYS.PRODUCTS, res.products);
    this.set(STORAGE_KEYS.RETURNS, res.returns);
    if (res.newMovements.length > 0) {
      this.recordStockMovements(res.newMovements);
    }

    this.saveSmartImportHistory({
      id: `smi-${Date.now()}`,
      marketplaceId: ordersToImport[0]?.marketplaceId || 'noon',
      fileName,
      importedAt: new Date().toISOString(),
      totalImported: res.importedCount + res.historicalCount,
      historicalCount: res.historicalCount,
      operator,
    });

    return {
      importedCount: res.importedCount,
      historicalCount: res.historicalCount,
      duplicateCount: res.duplicateCount,
    };
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
    if (settings.marketplaces.length <= 1) {
      return { success: false, error: 'يجب الإبقاء على منصة بيع واحدة على الأقل.' };
    }

    settings.marketplaces = settings.marketplaces.filter((m) => m.id !== id);
    this.saveSettings(settings);

    const profile = this.getMerchantProfile();
    profile.selectedMarketplaceIds = profile.selectedMarketplaceIds.filter((mId) => mId !== id);
    this.saveMerchantProfile(profile);

    return { success: true };
  }
}

export const storageService = new StorageService();
storageService.init();
