/**
 * Central storage and business rules facade for Seller Operations.
 * Persists state to localStorage while delegating all business invariants,
 * state machines, financial calculations, and custody checks to pure domain engines.
 *
 * RELIABILITY & LIMITATIONS NOTE:
 * Browser localStorage does NOT provide true ACID transactions, isolation locks across tabs,
 * or two-phase commit. To prevent partial multi-key corruption on QuotaExceededError or
 * mid-operation write failures, multi-key mutations use `commitMultiKeyWrites`, which
 * pre-serializes payloads, snapshots prior raw key values, and executes synchronous best-effort
 * reverse rollback if any write throws. Corrupted JSON keys are preserved intact rather than
 * overwritten or silently reset to sample data.
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
  StorageWriteResult,
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
  FinancialSummaryResult,
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

const LIFECYCLE_DEDUP_MOVEMENT_TYPES = new Set([
  'order_created',
  'handover_to_courier',
  'order_delivered',
  'order_cancelled',
  'return_initiated',
  'return_received_warehouse',
  'return_restocked',
  'return_damaged',
  'return_missing',
]);

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { name?: string; code?: number; message?: string };
  if (
    anyErr.name === 'QuotaExceededError' ||
    anyErr.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    anyErr.code === 22 ||
    anyErr.code === 1014
  ) {
    return true;
  }
  return typeof anyErr.message === 'string' && /quota/i.test(anyErr.message);
}

function formatWriteError(err: unknown): string {
  if (isQuotaExceededError(err)) {
    return 'مساحة التخزين المحلية (localStorage) ممتلئة؛ لم يتم حفظ التغييرات وتم استرجاع الحالة السابقة.';
  }
  if (err instanceof Error && err.message) {
    return `فشل الحفظ في التخزين المحلي: ${err.message}`;
  }
  return 'تعذر حفظ البيانات في التخزين المحلي.';
}

class StorageService {
  private corruptedKeys = new Set<string>();

  private hasStorage(): boolean {
    return typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
  }

  public getCorruptedKeys(): string[] {
    return Array.from(this.corruptedKeys);
  }

  public hasCorruptedData(): boolean {
    return this.corruptedKeys.size > 0;
  }

  public clearCorruptedKeyWarning(key?: string): void {
    if (key) {
      this.corruptedKeys.delete(key);
    } else {
      this.corruptedKeys.clear();
    }
  }

  private get<T>(key: string, defaultVal: T): T {
    if (!this.hasStorage()) return defaultVal;
    try {
      const data = globalThis.localStorage.getItem(key);
      if (data === null || data === '') {
        this.corruptedKeys.delete(key);
        return defaultVal;
      }
      const parsed = JSON.parse(data) as T;
      this.corruptedKeys.delete(key);
      return parsed;
    } catch (e) {
      // Preserve corrupted raw data intact instead of overwriting or silently resetting.
      this.corruptedKeys.add(key);
      console.error(`Failed to read ${key} from storage (raw data preserved):`, e);
      return defaultVal;
    }
  }

  private set<T>(key: string, value: T): StorageWriteResult {
    return this.commitMultiKeyWrites([{ key, value }]);
  }

  /**
   * Executes multi-key writes with pre-write serialization and synchronous best-effort
   * rollback upon any failure (e.g., QuotaExceededError).
   *
   * Limitation: localStorage does not support native ACID transactions, multi-tab locking,
   * or isolated snapshots across browser contexts; if rollback itself hits a storage lock,
   * `rollbackError` is returned alongside `rolledBack: false`.
   */
  public commitMultiKeyWrites(
    entries: Array<{ key: string; value: unknown }>,
    options: { allowOverwriteCorrupted?: boolean } = {}
  ): StorageWriteResult {
    if (!this.hasStorage()) return { success: true };
    if (entries.length === 0) return { success: true };

    // Deduplicate target keys keeping the last payload if caller included duplicates
    const dedupMap = new Map<string, unknown>();
    for (const entry of entries) {
      dedupMap.set(entry.key, entry.value);
    }
    const targetKeys = Array.from(dedupMap.keys());

    if (!options.allowOverwriteCorrupted) {
      const blocked = targetKeys.filter((k) => this.corruptedKeys.has(k));
      if (blocked.length > 0) {
        return {
          success: false,
          error: `تم إيقاف الكتابة لحماية بيانات تالفة في التخزين (${blocked.join(', ')}) من الكتابة فوقها.`,
        };
      }
    }

    // 1. Pre-serialize every payload before mutating localStorage
    const serializedEntries: Array<{ key: string; raw: string }> = [];
    try {
      for (const [key, value] of dedupMap.entries()) {
        serializedEntries.push({ key, raw: JSON.stringify(value) });
      }
    } catch (e) {
      console.error('Failed to serialize storage payload:', e);
      return {
        success: false,
        error: formatWriteError(e),
        quotaExceeded: isQuotaExceededError(e),
        rolledBack: true,
      };
    }

    // 2. Capture raw pre-write snapshots of every target key
    const snapshots: Array<{ key: string; existed: boolean; rawValue: string | null }> = [];
    try {
      for (const { key } of serializedEntries) {
        const rawValue = globalThis.localStorage.getItem(key);
        snapshots.push({
          key,
          existed: rawValue !== null,
          rawValue,
        });
      }
    } catch (e) {
      console.error('Failed to snapshot prior localStorage keys:', e);
      return {
        success: false,
        error: formatWriteError(e),
        quotaExceeded: isQuotaExceededError(e),
        rolledBack: false,
      };
    }

    // 3. Apply writes sequentially; roll back previously touched keys on first error
    let failedIndex = -1;
    let writeErr: unknown = null;

    for (let i = 0; i < serializedEntries.length; i++) {
      const { key, raw } = serializedEntries[i];
      try {
        globalThis.localStorage.setItem(key, raw);
      } catch (e) {
        failedIndex = i;
        writeErr = e;
        console.error(`Failed to write ${key} to storage:`, e);
        break;
      }
    }

    if (failedIndex === -1) {
      if (options.allowOverwriteCorrupted) {
        for (const k of targetKeys) {
          this.corruptedKeys.delete(k);
        }
      }
      return { success: true };
    }

    // 4. Synchronous best-effort reverse rollback of already-written keys (failedIndex itself never wrote)
    let rollbackError: string | undefined;
    for (let j = failedIndex - 1; j >= 0; j--) {
      const snap = snapshots[j];
      try {
        if (snap.existed && snap.rawValue !== null) {
          globalThis.localStorage.setItem(snap.key, snap.rawValue);
        } else {
          globalThis.localStorage.removeItem(snap.key);
        }
      } catch (rbErr) {
        console.error(`Rollback failed for ${snap.key}:`, rbErr);
        rollbackError = rbErr instanceof Error ? rbErr.message : String(rbErr);
      }
    }

    return {
      success: false,
      error: formatWriteError(writeErr),
      quotaExceeded: isQuotaExceededError(writeErr),
      rolledBack: rollbackError === undefined,
      rollbackError,
    };
  }

  /**
   * Initializes missing keys to an EMPTY production store ([]).
   * Preserves existing stored records and NEVER auto-seeds demo/fake products on general startup.
   */
  public init(): StorageWriteResult {
    if (!this.hasStorage()) return { success: true };
    const entries: Array<{ key: string; value: unknown }> = [];
    const queueIfMissing = (key: string, emptyValue: unknown) => {
      if (globalThis.localStorage.getItem(key) === null) {
        entries.push({ key, value: emptyValue });
      }
    };
    queueIfMissing(STORAGE_KEYS.PRODUCTS, []);
    queueIfMissing(STORAGE_KEYS.ORDERS, []);
    queueIfMissing(STORAGE_KEYS.MOVEMENTS, []);
    queueIfMissing(STORAGE_KEYS.RETURNS, []);
    queueIfMissing(STORAGE_KEYS.PRICE_HISTORY, []);
    queueIfMissing(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    queueIfMissing(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, []);

    if (entries.length === 0) return { success: true };
    return this.commitMultiKeyWrites(entries);
  }

  /**
   * Developer-only action: populates the realistic demo catalog, orders, returns, and ledger
   * exclusively for pre-launch testing from Developer Center.
   */
  public loadDemoSampleData(): StorageWriteResult {
    return this.commitMultiKeyWrites(
      [
        { key: STORAGE_KEYS.PRODUCTS, value: DEFAULT_PRODUCTS },
        { key: STORAGE_KEYS.ORDERS, value: DEFAULT_ORDERS },
        { key: STORAGE_KEYS.MOVEMENTS, value: DEFAULT_MOVEMENTS },
        { key: STORAGE_KEYS.RETURNS, value: DEFAULT_RETURNS },
        { key: STORAGE_KEYS.PRICE_HISTORY, value: DEFAULT_PRICE_HISTORY },
        { key: STORAGE_KEYS.SETTINGS, value: DEFAULT_SETTINGS },
        { key: STORAGE_KEYS.FINANCIAL_TRANSACTIONS, value: DEFAULT_FINANCIAL_TRANSACTIONS },
      ],
      { allowOverwriteCorrupted: true }
    );
  }

  /**
   * Alias retained for Developer Center and automated tests.
   * NEVER invoked automatically during runtime or error recovery.
   */
  public resetToSample(): StorageWriteResult {
    return this.loadDemoSampleData();
  }

  /**
   * Developer-only action: wipes all demo/operational entities back to clean empty arrays ([])
   * while keeping storefront settings intact.
   */
  public clearAllStoreData(): StorageWriteResult {
    return this.commitMultiKeyWrites(
      [
        { key: STORAGE_KEYS.PRODUCTS, value: [] },
        { key: STORAGE_KEYS.ORDERS, value: [] },
        { key: STORAGE_KEYS.MOVEMENTS, value: [] },
        { key: STORAGE_KEYS.RETURNS, value: [] },
        { key: STORAGE_KEYS.PRICE_HISTORY, value: [] },
        { key: STORAGE_KEYS.FINANCIAL_TRANSACTIONS, value: [] },
        { key: STORAGE_KEYS.SMART_IMPORT_HISTORY, value: [] },
        { key: STORAGE_KEYS.RECOMMENDATIONS, value: [] },
      ],
      { allowOverwriteCorrupted: true }
    );
  }

  // --- Internal Deduplication Helpers ---
  private prepareMovementsAppend(
    existing: StockMovement[],
    incoming: StockMovement[]
  ): StockMovement[] {
    if (!incoming || incoming.length === 0) return existing;
    const existingIds = new Set(existing.map((m) => m.id));
    const existingLifecycleKeys = new Set(
      existing
        .filter((m) => LIFECYCLE_DEDUP_MOVEMENT_TYPES.has(m.type))
        .map((m) => `${m.type}|${m.productId}|${m.referenceOrderId || ''}|${m.referenceReturnId || ''}`)
    );

    const uniqueToAdd: StockMovement[] = [];
    for (const m of incoming) {
      if (m.id && existingIds.has(m.id)) continue;
      if (LIFECYCLE_DEDUP_MOVEMENT_TYPES.has(m.type)) {
        const sig = `${m.type}|${m.productId}|${m.referenceOrderId || ''}|${m.referenceReturnId || ''}`;
        if (existingLifecycleKeys.has(sig)) continue;
      }
      if (m.id) existingIds.add(m.id);
      uniqueToAdd.push(m);
    }

    if (uniqueToAdd.length === 0) return existing;
    return [...uniqueToAdd, ...existing];
  }

  private prepareTransactionsAppend(
    existing: FinancialTransaction[],
    incoming: Array<Omit<FinancialTransaction, 'id' | 'date'> & { id?: string; date?: string }>
  ): { list: FinancialTransaction[]; added: FinancialTransaction[] } {
    if (!incoming || incoming.length === 0) return { list: existing, added: [] };
    const existingIds = new Set(existing.map((t) => t.id));
    const existingAutoSignatures = new Set(
      existing
        .filter((t) => t.status !== 'cancelled' && t.source === 'automatic' && t.type !== 'adjustment')
        .map((t) =>
          t.type === 'damage_writeoff'
            ? `auto|${t.orderId}|${t.returnId || ''}|${t.type}|${t.status}|${t.amount}|${t.notes || ''}`
            : `auto|${t.orderId}|${t.returnId || ''}|${t.type}|${t.status}`
        )
    );

    const added: FinancialTransaction[] = [];
    for (let i = 0; i < incoming.length; i++) {
      const tx = incoming[i];
      if (tx.id && existingIds.has(tx.id)) continue;
      if (tx.status !== 'cancelled' && tx.source === 'automatic' && tx.type !== 'adjustment') {
        const sig =
          tx.type === 'damage_writeoff'
            ? `auto|${tx.orderId}|${tx.returnId || ''}|${tx.type}|${tx.status}|${tx.amount}|${tx.notes || ''}`
            : `auto|${tx.orderId}|${tx.returnId || ''}|${tx.type}|${tx.status}`;
        if (existingAutoSignatures.has(sig)) continue;
        existingAutoSignatures.add(sig);
      }

      const fullTx: FinancialTransaction = {
        id: tx.id || `tx-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
        date: tx.date || new Date().toISOString(),
        ...tx,
      };
      existingIds.add(fullTx.id);
      added.push(fullTx);
    }

    if (added.length === 0) return { list: existing, added: [] };
    return { list: [...added, ...existing], added };
  }

  // --- Products ---
  public getProducts(): Product[] {
    const raw = this.get<Product[]>(STORAGE_KEYS.PRODUCTS, []);
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

  public saveProduct(product: Product): StorageWriteResult {
    const products = this.getProducts();
    if (this.corruptedKeys.has(STORAGE_KEYS.PRODUCTS)) {
      return {
        success: false,
        error: 'بيانات المنتجات المخزنة تالفة ولا يمكن الكتابة فوقها تلقائياً.',
      };
    }

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
    return this.set(STORAGE_KEYS.PRODUCTS, products);
  }

  public saveProductsBatch(
    nextProducts: Product[],
    newMovements: StockMovement[] = []
  ): StorageWriteResult {
    const existingMovements = this.getMovements();
    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.PRODUCTS, value: nextProducts.map(normalizeProductCustody) },
    ];
    if (newMovements.length > 0) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(existingMovements, newMovements),
      });
    }
    return this.commitMultiKeyWrites(writes);
  }

  public deleteProduct(id: string): StorageWriteResult {
    const current = this.getProducts();
    if (this.corruptedKeys.has(STORAGE_KEYS.PRODUCTS)) {
      return {
        success: false,
        error: 'بيانات المنتجات المخزنة تالفة ولا يمكن تعديلها تلقائياً.',
      };
    }
    const products = current.filter((p) => p.id !== id);
    return this.set(STORAGE_KEYS.PRODUCTS, products);
  }

  public updateProductPriceWithResult(
    productId: string,
    marketplaceId: MarketplaceId,
    newPrice: number,
    reason?: string,
    changedBy: string = 'مدير العمليات'
  ): StorageWriteResult & { record?: PriceHistoryRecord | null } {
    const products = this.getProducts();
    const history = this.getPriceHistory();
    const product = products.find((p) => p.id === productId);
    if (!product) {
      return { success: false, error: 'المنتج غير موجود.' };
    }

    const existingListingPrice = product.marketplaceListings[marketplaceId]?.price;
    const previousPrice =
      typeof existingListingPrice === 'number' ? existingListingPrice : product.currentPrice;

    const metrics = computePriceChangeMetrics(previousPrice, newPrice);
    if (!metrics.valid || previousPrice === newPrice) {
      return { success: true, record: null };
    }

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

    const nextHistory = [historyRecord, ...history];
    const writeRes = this.commitMultiKeyWrites([
      { key: STORAGE_KEYS.PRODUCTS, value: products },
      { key: STORAGE_KEYS.PRICE_HISTORY, value: nextHistory },
    ]);

    if (!writeRes.success) {
      return { ...writeRes, record: null };
    }

    return { success: true, record: historyRecord };
  }

  public updateProductPrice(
    productId: string,
    marketplaceId: MarketplaceId,
    newPrice: number,
    reason?: string,
    changedBy: string = 'مدير العمليات'
  ): PriceHistoryRecord | null {
    const res = this.updateProductPriceWithResult(
      productId,
      marketplaceId,
      newPrice,
      reason,
      changedBy
    );
    return res.success ? res.record || null : null;
  }

  // --- Orders & Strict Inventory Logic ---
  public getOrders(): Order[] {
    return this.get<Order[]>(STORAGE_KEYS.ORDERS, []);
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
  ): {
    success: boolean;
    order?: Order;
    error?: string;
    quotaExceeded?: boolean;
    rolledBack?: boolean;
  } {
    const existingProducts = this.getProducts();
    const existingOrders = this.getOrders();
    const existingMovements = this.getMovements();

    const res = createOrderPure({
      orderData,
      products: existingProducts,
      existingOrders,
      customId,
      operator,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.PRODUCTS, value: res.products },
      { key: STORAGE_KEYS.ORDERS, value: res.orders },
    ];
    if (res.movements.length > 0) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(existingMovements, res.movements),
      });
    }

    const writeRes = this.commitMultiKeyWrites(writes);
    if (!writeRes.success) {
      return {
        success: false,
        error: writeRes.error,
        quotaExceeded: writeRes.quotaExceeded,
        rolledBack: writeRes.rolledBack,
      };
    }

    return { success: true, order: res.order };
  }

  public updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    operator: string = 'مدير العمليات',
    shipmentDetails?: Partial<ShipmentRecord>
  ): StorageWriteResult {
    const settings = this.getSettings();
    const existingOrders = this.getOrders();
    const existingProducts = this.getProducts();
    const existingReturns = this.getReturns();
    const existingMovements = this.getMovements();
    const existingTransactions = this.getFinancialTransactions();

    const res = updateOrderStatusPure({
      orderId,
      newStatus,
      orders: existingOrders,
      products: existingProducts,
      returns: existingReturns,
      currency: settings.currency || 'SAR',
      operator,
      shipmentDetails,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.ORDERS, value: res.orders },
      { key: STORAGE_KEYS.PRODUCTS, value: res.products },
      { key: STORAGE_KEYS.RETURNS, value: res.returns },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    if (res.newTransactions.length > 0) {
      const txPrep = this.prepareTransactionsAppend(existingTransactions, res.newTransactions);
      if (txPrep.added.length > 0) {
        writes.push({
          key: STORAGE_KEYS.FINANCIAL_TRANSACTIONS,
          value: txPrep.list,
        });
      }
    }

    return this.commitMultiKeyWrites(writes);
  }

  // --- Returns Management ---
  public getReturns(): ReturnRecord[] {
    const raw = this.get<ReturnRecord[]>(STORAGE_KEYS.RETURNS, []);
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
  ): StorageWriteResult {
    const existingReturns = this.getReturns();
    const existingProducts = this.getProducts();
    const existingOrders = this.getOrders();
    const existingMovements = this.getMovements();

    const res = advanceReturnStatusPure({
      returnId,
      targetStatus,
      returns: existingReturns,
      products: existingProducts,
      orders: existingOrders,
      operator,
      notes,
      shipment,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.RETURNS, value: res.returns },
      { key: STORAGE_KEYS.PRODUCTS, value: res.products },
    ];
    if (res.newMovements.length > 0) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    return this.commitMultiKeyWrites(writes);
  }

  public processReturnInspection(
    returnId: string,
    outcome: InspectionOutcome,
    condition: 'like_new' | 'opened_good' | 'damaged' | 'lost',
    notes: string,
    operator: string = 'مدير العمليات'
  ): {
    success: boolean;
    message: string;
    quotaExceeded?: boolean;
    rolledBack?: boolean;
  } {
    const settings = this.getSettings();
    const existingReturns = this.getReturns();
    const existingProducts = this.getProducts();
    const existingOrders = this.getOrders();
    const existingMovements = this.getMovements();
    const existingTransactions = this.getFinancialTransactions();

    const res = processReturnInspectionPure({
      returnId,
      outcome,
      condition,
      notes,
      returns: existingReturns,
      products: existingProducts,
      orders: existingOrders,
      currency: settings.currency || 'SAR',
      operator,
    });

    if (!res.success) {
      return { success: false, message: res.message };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.RETURNS, value: res.returns },
      { key: STORAGE_KEYS.PRODUCTS, value: res.products },
      { key: STORAGE_KEYS.ORDERS, value: res.orders },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    if (res.newTransactions.length > 0) {
      const txPrep = this.prepareTransactionsAppend(existingTransactions, res.newTransactions);
      if (txPrep.added.length > 0) {
        writes.push({
          key: STORAGE_KEYS.FINANCIAL_TRANSACTIONS,
          value: txPrep.list,
        });
      }
    }

    const writeRes = this.commitMultiKeyWrites(writes);
    if (!writeRes.success) {
      return {
        success: false,
        message: writeRes.error || 'تعذر حفظ نتيجة فحص المرتجع.',
        quotaExceeded: writeRes.quotaExceeded,
        rolledBack: writeRes.rolledBack,
      };
    }

    return { success: true, message: res.message };
  }

  public registerPostDeliveryReturn(
    orderId: string,
    reason: string,
    notes?: string
  ): {
    success: boolean;
    returnRecord?: ReturnRecord;
    error?: string;
    quotaExceeded?: boolean;
    rolledBack?: boolean;
  } {
    const settings = this.getSettings();
    const existingOrders = this.getOrders();
    const existingReturns = this.getReturns();
    const existingProducts = this.getProducts();
    const existingMovements = this.getMovements();
    const existingTransactions = this.getFinancialTransactions();

    const res = registerPostDeliveryReturnPure({
      orderId,
      reason,
      notes,
      orders: existingOrders,
      returns: existingReturns,
      products: existingProducts,
      currency: settings.currency || 'SAR',
      operator: settings.sellerName || 'مدير العمليات',
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.PRODUCTS, value: res.products },
      { key: STORAGE_KEYS.RETURNS, value: res.returns },
      { key: STORAGE_KEYS.ORDERS, value: res.orders },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    if (res.newTransactions.length > 0) {
      const txPrep = this.prepareTransactionsAppend(existingTransactions, res.newTransactions);
      if (txPrep.added.length > 0) {
        writes.push({
          key: STORAGE_KEYS.FINANCIAL_TRANSACTIONS,
          value: txPrep.list,
        });
      }
    }

    const writeRes = this.commitMultiKeyWrites(writes);
    if (!writeRes.success) {
      return {
        success: false,
        error: writeRes.error,
        quotaExceeded: writeRes.quotaExceeded,
        rolledBack: writeRes.rolledBack,
      };
    }

    return { success: true, returnRecord: res.returnRecord };
  }

  public addReturnNote(
    returnId: string,
    note: string,
    operator: string = 'مدير العمليات'
  ): { success: boolean; returnRecord?: ReturnRecord; error?: string; quotaExceeded?: boolean } {
    const res = addReturnNotePure({
      returnId,
      note,
      returns: this.getReturns(),
      operator,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writeRes = this.set(STORAGE_KEYS.RETURNS, res.returns);
    if (!writeRes.success) {
      return {
        success: false,
        error: writeRes.error,
        quotaExceeded: writeRes.quotaExceeded,
      };
    }
    return { success: true, returnRecord: res.returnRecord };
  }

  // --- Financial Transaction Ledger & Auditable Accounting ---
  public getFinancialTransactions(): FinancialTransaction[] {
    return this.get<FinancialTransaction[]>(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, []);
  }

  public recordFinancialTransactionWithResult(
    tx: Omit<FinancialTransaction, 'id' | 'date'> & { id?: string; date?: string }
  ): StorageWriteResult & { transaction?: FinancialTransaction; deduplicated?: boolean } {
    const list = this.getFinancialTransactions();
    const prep = this.prepareTransactionsAppend(list, [tx]);
    if (prep.added.length === 0) {
      const existingMatch = list.find(
        (existing) =>
          (tx.id && existing.id === tx.id) ||
          (existing.source === 'automatic' &&
            tx.source === 'automatic' &&
            existing.orderId === tx.orderId &&
            (existing.returnId || '') === (tx.returnId || '') &&
            existing.type === tx.type &&
            existing.status === tx.status)
      );
      return { success: true, transaction: existingMatch, deduplicated: true };
    }

    const writeRes = this.set(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, prep.list);
    if (!writeRes.success) {
      return writeRes;
    }
    return { success: true, transaction: prep.added[0], deduplicated: false };
  }

  public recordFinancialTransaction(
    tx: Omit<FinancialTransaction, 'id' | 'date'> & { id?: string; date?: string }
  ): FinancialTransaction {
    const res = this.recordFinancialTransactionWithResult(tx);
    if (res.transaction) return res.transaction;
    return {
      id: tx.id || `tx-unsaved-${Date.now()}`,
      date: tx.date || new Date().toISOString(),
      ...tx,
    };
  }

  public getOrderFinancialBreakdown(orderId: string): OrderFinancialBreakdown | null {
    const order = this.getOrders().find((o) => o.id === orderId);
    if (!order) return null;
    return computeOrderFinancialBreakdown(order, this.getProducts());
  }

  public getFinancialSummary(
    dateRange?: { start: Date; end: Date },
    marketplace?: MarketplaceId
  ): FinancialSummaryResult {
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
    return this.set(STORAGE_KEYS.RECOMMENDATIONS, list).success;
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
    return this.get<StockMovement[]>(STORAGE_KEYS.MOVEMENTS, []);
  }

  public recordStockMovements(newMovements: StockMovement[]): StorageWriteResult {
    if (!newMovements || newMovements.length === 0) return { success: true };
    const existing = this.getMovements();
    const merged = this.prepareMovementsAppend(existing, newMovements);
    if (merged === existing) return { success: true };
    return this.set(STORAGE_KEYS.MOVEMENTS, merged);
  }

  public manualStockAdjustmentWithResult(
    productId: string,
    newPhysicalStock: number,
    reason: string,
    operator: string = 'مدير العمليات'
  ): StorageWriteResult {
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

    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.PRODUCTS, value: res.products },
    ];
    if (res.movement) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(this.getMovements(), [res.movement]),
      });
    }

    return this.commitMultiKeyWrites(writes);
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
    return this.get<PriceHistoryRecord[]>(STORAGE_KEYS.PRICE_HISTORY, []);
  }

  // --- Settings ---
  public getSettings(): AppSettings {
    return this.get<AppSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }

  public saveSettings(settings: AppSettings): StorageWriteResult {
    return this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  public addMarketplace(marketplace: MarketplaceConfig): StorageWriteResult {
    const settings = this.getSettings();
    if (!settings.marketplaces.some((m) => m.id === marketplace.id)) {
      settings.marketplaces.push(marketplace);
      return this.saveSettings(settings);
    }
    return { success: true };
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

  public saveSmartImportHistory(record: SmartImportHistory): StorageWriteResult {
    const history = this.getSmartImportHistory();
    history.unshift(record);
    return this.set(STORAGE_KEYS.SMART_IMPORT_HISTORY, history);
  }

  public saveSmartImportOrders(
    ordersToImport: Order[],
    isHistoricalDeducted: boolean,
    fileName: string,
    operator: string = 'مدير العمليات'
  ): {
    success: boolean;
    error?: string;
    quotaExceeded?: boolean;
    rolledBack?: boolean;
    importedCount: number;
    historicalCount: number;
    duplicateCount: number;
  } {
    const existingOrders = this.getOrders();
    const existingProducts = this.getProducts();
    const existingReturns = this.getReturns();
    const existingMovements = this.getMovements();
    const existingHistory = this.getSmartImportHistory();

    const res = saveSmartImportOrdersPure({
      ordersToImport,
      isHistoricalDeducted,
      existingOrders,
      products: existingProducts,
      returns: existingReturns,
      operator,
    });

    const historyRecord: SmartImportHistory = {
      id: `smi-${Date.now()}`,
      marketplaceId: ordersToImport[0]?.marketplaceId || 'noon',
      fileName,
      importedAt: new Date().toISOString(),
      totalImported: res.importedCount + res.historicalCount,
      historicalCount: res.historicalCount,
      operator,
    };

    const writes: Array<{ key: string; value: unknown }> = [
      { key: STORAGE_KEYS.ORDERS, value: res.orders },
      { key: STORAGE_KEYS.PRODUCTS, value: res.products },
      { key: STORAGE_KEYS.RETURNS, value: res.returns },
      { key: STORAGE_KEYS.SMART_IMPORT_HISTORY, value: [historyRecord, ...existingHistory] },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: STORAGE_KEYS.MOVEMENTS,
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    const writeRes = this.commitMultiKeyWrites(writes);
    if (!writeRes.success) {
      return {
        success: false,
        error: writeRes.error,
        quotaExceeded: writeRes.quotaExceeded,
        rolledBack: writeRes.rolledBack,
        importedCount: 0,
        historicalCount: 0,
        duplicateCount: res.duplicateCount,
      };
    }

    return {
      success: true,
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

  public saveMerchantProfile(profile: MerchantProfile): StorageWriteResult {
    const nextProfile = { ...profile };
    if (nextProfile.merchantName && !nextProfile.name) {
      nextProfile.name = nextProfile.merchantName;
    }
    const settings = this.getSettings();
    settings.storeName = nextProfile.storeName;
    settings.sellerName = nextProfile.merchantName || nextProfile.name;

    return this.commitMultiKeyWrites([
      { key: STORAGE_KEYS.MERCHANT_PROFILE, value: nextProfile },
      { key: STORAGE_KEYS.SETTINGS, value: settings },
    ]);
  }

  public completeOnboarding(
    param1: MarketplaceConfig[] | string,
    param2: string,
    param3?: string | string[] | MarketplaceConfig[]
  ): StorageWriteResult {
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

    const profile = this.getMerchantProfile();
    profile.name = merchantName;
    profile.merchantName = merchantName;
    profile.storeName = storeName;
    profile.isOnboarded = true;
    profile.selectedMarketplaceIds = marketplaces.map((m) => m.id);
    profile.onboardedAt = new Date().toISOString();

    return this.commitMultiKeyWrites([
      { key: STORAGE_KEYS.SETTINGS, value: settings },
      { key: STORAGE_KEYS.MERCHANT_PROFILE, value: profile },
    ]);
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
    return this.saveSettings(settings).success;
  }

  public removeMarketplace(id: string): StorageWriteResult {
    const settings = this.getSettings();
    if (settings.marketplaces.length <= 1) {
      return { success: false, error: 'يجب الإبقاء على منصة بيع واحدة على الأقل.' };
    }

    settings.marketplaces = settings.marketplaces.filter((m) => m.id !== id);
    const profile = this.getMerchantProfile();
    profile.selectedMarketplaceIds = profile.selectedMarketplaceIds.filter((mId) => mId !== id);

    return this.commitMultiKeyWrites([
      { key: STORAGE_KEYS.SETTINGS, value: settings },
      { key: STORAGE_KEYS.MERCHANT_PROFILE, value: profile },
    ]);
  }
}

export const storageService = new StorageService();
storageService.init();
