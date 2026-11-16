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
  AuthSession,
  MerchantAccount,
  AdminAuditLogEntry,
  PreDestructiveBackup,
} from '../types';
import {
  STORAGE_KEYS,
  SYSTEM_STORAGE_KEYS,
  DEFAULT_MERCHANT_ID,
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
  allocateStockToPlatformPure,
  applyManualStockAdjustmentPure,
  computePriceChangeMetrics,
  normalizeProductCustody,
  releasePlatformAllocationPure,
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
import { saveSmartImportOrdersPure, SmartImportRejectedOrder } from '../domain/smartImportCustody';

const DEVELOPER_PASSCODE = 'INGOBIA-DEV-2026';

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

  private getScopedKey(baseKey: string, merchantId?: string): string {
    const mId = merchantId || this.getActiveMerchantId();
    if (!mId || mId === DEFAULT_MERCHANT_ID) {
      return baseKey;
    }
    return `ingobia_m_${mId}_${baseKey}`;
  }

  private filterOwned<T extends { merchantId?: string }>(items: T[]): T[] {
    const activeMerchantId = this.getActiveMerchantId();
    return items.filter((item) => !item.merchantId || item.merchantId === activeMerchantId);
  }

  private stampOwned<T extends { merchantId?: string }>(items: T[], merchantId?: string): T[] {
    const mId = merchantId || this.getActiveMerchantId();
    return items.map((item) => (item.merchantId ? item : { ...item, merchantId: mId }));
  }

  public getAuthSession(): AuthSession {
    return this.get<AuthSession>(SYSTEM_STORAGE_KEYS.AUTH_SESSION, {
      activeMerchantId: DEFAULT_MERCHANT_ID,
      role: 'merchant',
    });
  }

  public getActiveMerchantId(): string {
    return this.getAuthSession().activeMerchantId || DEFAULT_MERCHANT_ID;
  }

  public isDeveloperMode(): boolean {
    return this.getAuthSession().role === 'developer';
  }

  public unlockDeveloperMode(passcode: string): { success: boolean; error?: string } {
    const normalized = String(passcode || '').trim();
    if (normalized !== DEVELOPER_PASSCODE) {
      this.appendAdminAuditLog(
        'developer_unlock_failed',
        'محاولة فاشلة لفتح وضع المطور برمز غير مطابق.',
        false
      );
      return { success: false, error: 'رمز المطور غير صحيح.' };
    }

    const session = this.getAuthSession();
    const nextSession: AuthSession = {
      ...session,
      role: 'developer',
      developerUnlockedAt: new Date().toISOString(),
    };
    const writeRes = this.set(SYSTEM_STORAGE_KEYS.AUTH_SESSION, nextSession);
    if (!writeRes.success) {
      return { success: false, error: writeRes.error || 'تعذر حفظ جلسة المطور.' };
    }
    this.appendAdminAuditLog('developer_mode_unlocked', 'تم تفعيل وضع المطور المصرح به في الجلسة.');
    return { success: true };
  }

  public lockDeveloperMode(): StorageWriteResult {
    const session = this.getAuthSession();
    const nextSession: AuthSession = {
      ...session,
      role: 'merchant',
      developerUnlockedAt: undefined,
    };
    const res = this.set(SYSTEM_STORAGE_KEYS.AUTH_SESSION, nextSession);
    if (res.success) {
      this.appendAdminAuditLog('developer_mode_locked', 'تم إغلاق وضع المطور والعودة لصلاحيات التاجر.');
    }
    return res;
  }

  public getAdminAuditLog(): AdminAuditLogEntry[] {
    return this.get<AdminAuditLogEntry[]>(SYSTEM_STORAGE_KEYS.ADMIN_AUDIT_LOG, []);
  }

  public appendAdminAuditLog(
    action: AdminAuditLogEntry['action'],
    details: string,
    success: boolean = true
  ): void {
    if (!this.hasStorage()) return;
    const existing = this.getAdminAuditLog();
    const profile = this.getMerchantProfile();
    const entry: AdminAuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      actorRole: this.getAuthSession().role,
      actorName: profile.merchantName || profile.name || 'Merchant Session',
      merchantId: this.getActiveMerchantId(),
      action,
      details,
      success,
    };
    this.set(SYSTEM_STORAGE_KEYS.ADMIN_AUDIT_LOG, [entry, ...existing.slice(0, 199)]);
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
   * Safely snapshots legacy pre-migration records once without erasing existing browser stores,
   * and NEVER auto-seeds demo/fake products on general startup.
   */
  public init(): StorageWriteResult {
    if (!this.hasStorage()) return { success: true };

    // One-time reversible migration snapshot for legacy unscoped browser stores
    try {
      if (globalThis.localStorage.getItem(SYSTEM_STORAGE_KEYS.MIGRATION_BACKUP) === null) {
        const legacySnapshot: Record<string, string | null> = {};
        let hasLegacy = false;
        for (const key of Object.values(STORAGE_KEYS)) {
          const val = globalThis.localStorage.getItem(key);
          if (val !== null) {
            legacySnapshot[key] = val;
            hasLegacy = true;
          }
        }
        if (hasLegacy) {
          globalThis.localStorage.setItem(
            SYSTEM_STORAGE_KEYS.MIGRATION_BACKUP,
            JSON.stringify({
              capturedAt: new Date().toISOString(),
              keys: legacySnapshot,
            })
          );
        }
      }
    } catch {
      // Ignore snapshot errors on quota-constrained devices
    }

    const activeMerchantId = this.getActiveMerchantId();
    const entries: Array<{ key: string; value: unknown }> = [];
    const queueIfMissing = (key: string, emptyValue: unknown) => {
      if (globalThis.localStorage.getItem(key) === null) {
        entries.push({ key, value: emptyValue });
      }
    };

    queueIfMissing(this.getScopedKey(STORAGE_KEYS.PRODUCTS, activeMerchantId), []);
    queueIfMissing(this.getScopedKey(STORAGE_KEYS.ORDERS, activeMerchantId), []);
    queueIfMissing(this.getScopedKey(STORAGE_KEYS.MOVEMENTS, activeMerchantId), []);
    queueIfMissing(this.getScopedKey(STORAGE_KEYS.RETURNS, activeMerchantId), []);
    queueIfMissing(this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY, activeMerchantId), []);
    queueIfMissing(this.getScopedKey(STORAGE_KEYS.SETTINGS, activeMerchantId), DEFAULT_SETTINGS);
    queueIfMissing(this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, activeMerchantId), []);

    // Ensure merchant accounts registry contains active account
    const accounts = this.get<MerchantAccount[]>(SYSTEM_STORAGE_KEYS.MERCHANT_ACCOUNTS, []);
    if (accounts.length === 0) {
      const profile = this.getMerchantProfile();
      const settings = this.getSettings();
      entries.push({
        key: SYSTEM_STORAGE_KEYS.MERCHANT_ACCOUNTS,
        value: [
          {
            id: activeMerchantId,
            storeName: profile.storeName || settings.storeName || '',
            merchantName: profile.merchantName || profile.name || settings.sellerName || '',
            email: profile.email || '',
            role: this.getAuthSession().role,
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
          } satisfies MerchantAccount,
        ],
      });
    }

    if (entries.length === 0) return { success: true };
    return this.commitMultiKeyWrites(entries);
  }

  // --- Multi-Merchant Account Isolation & Switching ---
  public getMerchantAccounts(): MerchantAccount[] {
    return this.get<MerchantAccount[]>(SYSTEM_STORAGE_KEYS.MERCHANT_ACCOUNTS, []);
  }

  public createMerchantAccount(params: {
    storeName: string;
    merchantName: string;
    email?: string;
    language?: 'ar' | 'en';
    currency?: string;
    switchTo?: boolean;
  }): StorageWriteResult & { account?: MerchantAccount } {
    const storeName = String(params.storeName || '').trim();
    const merchantName = String(params.merchantName || '').trim();
    if (!storeName || !merchantName) {
      return { success: false, error: 'يجب إدخال اسم المتجر واسم التاجر لإنشاء حساب مستقل.' };
    }

    const nowIso = new Date().toISOString();
    const accountId = `merch-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const account: MerchantAccount = {
      id: accountId,
      storeName,
      merchantName,
      email: params.email?.trim() || '',
      role: 'merchant',
      createdAt: nowIso,
      lastAccessedAt: nowIso,
    };

    const existingAccounts = this.getMerchantAccounts();
    const nextAccounts = [...existingAccounts, account];

    const newProfile: MerchantProfile = {
      ...DEFAULT_MERCHANT_PROFILE,
      merchantId: accountId,
      role: 'merchant',
      name: merchantName,
      merchantName,
      email: account.email || '',
      storeName,
      isOnboarded: true,
      onboardedAt: nowIso,
      selectedMarketplaceIds: DEFAULT_MARKETPLACES.map((m) => m.id),
    };

    const newSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      language: params.language || this.getSettings().language || 'ar',
      currency: params.currency || this.getSettings().currency || 'SAR',
      sellerName: merchantName,
      storeName,
      marketplaces: DEFAULT_MARKETPLACES.map((m) => ({ ...m, isActive: true })),
    };

    const writes: Array<{ key: string; value: unknown }> = [
      { key: SYSTEM_STORAGE_KEYS.MERCHANT_ACCOUNTS, value: nextAccounts },
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.ORDERS, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.RETURNS, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.SMART_IMPORT_HISTORY, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.RECOMMENDATIONS, accountId), value: [] },
      { key: this.getScopedKey(STORAGE_KEYS.SETTINGS, accountId), value: newSettings },
      { key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE, accountId), value: newProfile },
    ];

    if (params.switchTo !== false) {
      writes.push({
        key: SYSTEM_STORAGE_KEYS.AUTH_SESSION,
        value: {
          ...this.getAuthSession(),
          activeMerchantId: accountId,
        } satisfies AuthSession,
      });
    }

    const res = this.commitMultiKeyWrites(writes);
    if (!res.success) return res;

    this.appendAdminAuditLog('merchant_switched', `إنشاء وعزل حساب متجر جديد (${storeName}) [${accountId}].`);
    return { ...res, account };
  }

  public switchMerchantAccount(merchantId: string): StorageWriteResult {
    const accounts = this.getMerchantAccounts();
    if (merchantId !== DEFAULT_MERCHANT_ID && !accounts.some((a) => a.id === merchantId)) {
      return { success: false, error: 'حساب التاجر المطلوب غير موجود.' };
    }

    const nowIso = new Date().toISOString();
    const updatedAccounts = accounts.map((a) =>
      a.id === merchantId ? { ...a, lastAccessedAt: nowIso } : a
    );
    const currentSession = this.getAuthSession();
    const writeRes = this.commitMultiKeyWrites([
      {
        key: SYSTEM_STORAGE_KEYS.AUTH_SESSION,
        value: {
          ...currentSession,
          activeMerchantId: merchantId,
        } satisfies AuthSession,
      },
      { key: SYSTEM_STORAGE_KEYS.MERCHANT_ACCOUNTS, value: updatedAccounts },
    ]);

    if (!writeRes.success) return writeRes;
    this.init();
    this.appendAdminAuditLog('merchant_switched', `التبديل إلى مساحة التاجر المعزولة (${merchantId}).`);
    return { success: true };
  }

  // --- Backups & Safe Restore ---
  public createPreDestructiveBackup(reason: string): PreDestructiveBackup {
    const merchantId = this.getActiveMerchantId();
    const backup: PreDestructiveBackup = {
      id: `bkp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
      merchantId,
      reason,
      data: {
        products: this.getProducts(),
        orders: this.getOrders(),
        returns: this.getReturns(),
        movements: this.getMovements(),
        priceHistory: this.getPriceHistory(),
        financialTransactions: this.getFinancialTransactions(),
        settings: this.getSettings(),
        merchantProfile: this.getMerchantProfile(),
      },
    };

    if (this.hasStorage()) {
      const existing = this.get<PreDestructiveBackup[]>(SYSTEM_STORAGE_KEYS.PRE_DESTRUCTIVE_BACKUPS, []);
      this.set(SYSTEM_STORAGE_KEYS.PRE_DESTRUCTIVE_BACKUPS, [backup, ...existing.slice(0, 4)]);
      this.appendAdminAuditLog('backup_created', `إنشاء نسخة احتياطية قبل تنفيذ (${reason}) لمتجر ${merchantId}.`);
    }
    return backup;
  }

  public getPreDestructiveBackups(): PreDestructiveBackup[] {
    const all = this.get<PreDestructiveBackup[]>(SYSTEM_STORAGE_KEYS.PRE_DESTRUCTIVE_BACKUPS, []);
    const activeId = this.getActiveMerchantId();
    return all.filter((b) => b.merchantId === activeId);
  }

  public restorePreDestructiveBackup(backupId: string): StorageWriteResult {
    const all = this.get<PreDestructiveBackup[]>(SYSTEM_STORAGE_KEYS.PRE_DESTRUCTIVE_BACKUPS, []);
    const backup = all.find((b) => b.id === backupId);
    if (!backup) {
      return { success: false, error: 'النسخة الاحتياطية المطلوبة غير موجودة.' };
    }
    const targetMerchantId = backup.merchantId || this.getActiveMerchantId();
    const writeRes = this.commitMultiKeyWrites(
      [
        { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS, targetMerchantId), value: backup.data.products || [] },
        { key: this.getScopedKey(STORAGE_KEYS.ORDERS, targetMerchantId), value: backup.data.orders || [] },
        { key: this.getScopedKey(STORAGE_KEYS.RETURNS, targetMerchantId), value: backup.data.returns || [] },
        { key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS, targetMerchantId), value: backup.data.movements || [] },
        { key: this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY, targetMerchantId), value: backup.data.priceHistory || [] },
        {
          key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, targetMerchantId),
          value: backup.data.financialTransactions || [],
        },
        { key: this.getScopedKey(STORAGE_KEYS.SETTINGS, targetMerchantId), value: backup.data.settings || DEFAULT_SETTINGS },
        {
          key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE, targetMerchantId),
          value: backup.data.merchantProfile || DEFAULT_MERCHANT_PROFILE,
        },
      ],
      { allowOverwriteCorrupted: true }
    );
    if (writeRes.success) {
      this.appendAdminAuditLog('backup_restored', `استعادة النسخة الاحتياطية (${backupId}) لمتجر ${targetMerchantId}.`);
    }
    return writeRes;
  }

  public exportMerchantBackupJson(): string {
    const payload = {
      schemaVersion: 'ingobia_backup_v1',
      exportedAt: new Date().toISOString(),
      merchantId: this.getActiveMerchantId(),
      data: {
        products: this.getProducts(),
        orders: this.getOrders(),
        returns: this.getReturns(),
        movements: this.getMovements(),
        priceHistory: this.getPriceHistory(),
        financialTransactions: this.getFinancialTransactions(),
        settings: this.getSettings(),
        merchantProfile: this.getMerchantProfile(),
      },
    };
    return JSON.stringify(payload, null, 2);
  }

  public importMerchantBackupJson(rawJson: string): StorageWriteResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return { success: false, error: 'صيغة ملف النسخة الاحتياطية JSON غير صالحة.' };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'بنية النسخة الاحتياطية غير صالحة.' };
    }
    const obj = parsed as { schemaVersion?: string; data?: PreDestructiveBackup['data'] };
    if (obj.schemaVersion !== 'ingobia_backup_v1' || !obj.data || typeof obj.data !== 'object') {
      return { success: false, error: 'ملف النسخة الاحتياطية لا يطابق مخطط Ingobia المعتمد (ingobia_backup_v1).' };
    }

    const d = obj.data;
    if (
      !Array.isArray(d.products) ||
      !Array.isArray(d.orders) ||
      !Array.isArray(d.returns) ||
      !Array.isArray(d.movements) ||
      !Array.isArray(d.financialTransactions)
    ) {
      return { success: false, error: 'النسخة الاحتياطية ناقصة الحقول الأساسية؛ تم إلغاء الاستيراد دون مساس بالبيانات الحالية.' };
    }

    this.createPreDestructiveBackup('قبل استيراد نسخة احتياطية JSON');
    const activeId = this.getActiveMerchantId();
    const res = this.commitMultiKeyWrites(
      [
        { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS, activeId), value: this.stampOwned(d.products, activeId) },
        { key: this.getScopedKey(STORAGE_KEYS.ORDERS, activeId), value: this.stampOwned(d.orders, activeId) },
        { key: this.getScopedKey(STORAGE_KEYS.RETURNS, activeId), value: this.stampOwned(d.returns, activeId) },
        { key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS, activeId), value: this.stampOwned(d.movements, activeId) },
        {
          key: this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY, activeId),
          value: this.stampOwned(Array.isArray(d.priceHistory) ? d.priceHistory : [], activeId),
        },
        {
          key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, activeId),
          value: this.stampOwned(d.financialTransactions, activeId),
        },
        ...(d.settings ? [{ key: this.getScopedKey(STORAGE_KEYS.SETTINGS, activeId), value: d.settings }] : []),
        ...(d.merchantProfile
          ? [
              {
                key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE, activeId),
                value: { ...d.merchantProfile, merchantId: activeId },
              },
            ]
          : []),
      ],
      { allowOverwriteCorrupted: true }
    );
    if (res.success) {
      this.appendAdminAuditLog('backup_restored', `استيراد نسخة احتياطية JSON بنجاح لمتجر ${activeId}.`);
    }
    return res;
  }

  /**
   * Developer-only action: creates a pre-destructive backup first (if data exists),
   * then populates the realistic demo catalog, orders, returns, and ledger for sandbox testing.
   */
  public loadDemoSampleData(): StorageWriteResult {
    const activeId = this.getActiveMerchantId();
    if (this.getProducts().length > 0 || this.getOrders().length > 0) {
      this.createPreDestructiveBackup('قبل تحميل بيانات التجربة الافتراضية');
    }

    const demoSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      marketplaces: DEFAULT_MARKETPLACES.map((m) => ({ ...m, isActive: true })),
    };

    const res = this.commitMultiKeyWrites(
      [
        { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS, activeId), value: this.stampOwned(DEFAULT_PRODUCTS, activeId) },
        { key: this.getScopedKey(STORAGE_KEYS.ORDERS, activeId), value: this.stampOwned(DEFAULT_ORDERS, activeId) },
        { key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS, activeId), value: this.stampOwned(DEFAULT_MOVEMENTS, activeId) },
        { key: this.getScopedKey(STORAGE_KEYS.RETURNS, activeId), value: this.stampOwned(DEFAULT_RETURNS, activeId) },
        {
          key: this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY, activeId),
          value: this.stampOwned(DEFAULT_PRICE_HISTORY, activeId),
        },
        { key: this.getScopedKey(STORAGE_KEYS.SETTINGS, activeId), value: demoSettings },
        {
          key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, activeId),
          value: this.stampOwned(DEFAULT_FINANCIAL_TRANSACTIONS, activeId),
        },
      ],
      { allowOverwriteCorrupted: true }
    );
    if (res.success) {
      this.appendAdminAuditLog('demo_data_seeded', `تهيئة بيانات التجربة الافتراضية في مساحة التاجر (${activeId}).`);
    }
    return res;
  }

  /**
   * Alias retained for Developer Center and automated tests.
   * NEVER invoked automatically during runtime or error recovery.
   */
  public resetToSample(): StorageWriteResult {
    return this.loadDemoSampleData();
  }

  /**
   * Developer-only / destructive action: captures pre-destructive backup (if data exists),
   * then wipes operational entities back to clean empty arrays ([]) while preserving storefront settings.
   */
  public clearAllStoreData(): StorageWriteResult {
    const activeId = this.getActiveMerchantId();
    if (this.getProducts().length > 0 || this.getOrders().length > 0) {
      this.createPreDestructiveBackup('قبل مسح بيانات المتجر');
    }

    const res = this.commitMultiKeyWrites(
      [
        { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS, activeId), value: [] },
        { key: this.getScopedKey(STORAGE_KEYS.ORDERS, activeId), value: [] },
        { key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS, activeId), value: [] },
        { key: this.getScopedKey(STORAGE_KEYS.RETURNS, activeId), value: [] },
        { key: this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY, activeId), value: [] },
        { key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS, activeId), value: [] },
        { key: this.getScopedKey(STORAGE_KEYS.SMART_IMPORT_HISTORY, activeId), value: [] },
        { key: this.getScopedKey(STORAGE_KEYS.RECOMMENDATIONS, activeId), value: [] },
      ],
      { allowOverwriteCorrupted: true }
    );
    if (res.success) {
      this.appendAdminAuditLog('store_data_cleared', `مسح بيانات المتجر في المساحة (${activeId}).`);
    }
    return res;
  }

  // --- Internal Deduplication Helpers ---
  private prepareMovementsAppend(
    existing: StockMovement[],
    incoming: StockMovement[]
  ): StockMovement[] {
    if (!incoming || incoming.length === 0) return existing;
    const activeId = this.getActiveMerchantId();
    const existingIds = new Set(existing.map((m) => m.id));
    const existingEventKeys = new Set(existing.filter((m) => m.eventKey).map((m) => m.eventKey!));
    const existingLifecycleKeys = new Set(
      existing
        .filter((m) => !m.eventKey && LIFECYCLE_DEDUP_MOVEMENT_TYPES.has(m.type))
        .map((m) => `${m.type}|${m.productId}|${m.referenceOrderId || ''}|${m.referenceReturnId || ''}`)
    );

    const uniqueToAdd: StockMovement[] = [];
    for (const m of incoming) {
      if (m.id && existingIds.has(m.id)) continue;
      if (m.eventKey) {
        if (existingEventKeys.has(m.eventKey)) continue;
        existingEventKeys.add(m.eventKey);
      } else if (LIFECYCLE_DEDUP_MOVEMENT_TYPES.has(m.type)) {
        const sig = `${m.type}|${m.productId}|${m.referenceOrderId || ''}|${m.referenceReturnId || ''}`;
        if (existingLifecycleKeys.has(sig)) continue;
        existingLifecycleKeys.add(sig);
      }
      if (m.id) existingIds.add(m.id);
      uniqueToAdd.push(m.merchantId ? m : { ...m, merchantId: activeId });
    }

    if (uniqueToAdd.length === 0) return existing;
    return [...uniqueToAdd, ...existing];
  }

  private prepareTransactionsAppend(
    existing: FinancialTransaction[],
    incoming: Array<Omit<FinancialTransaction, 'id' | 'date'> & { id?: string; date?: string }>
  ): { list: FinancialTransaction[]; added: FinancialTransaction[] } {
    if (!incoming || incoming.length === 0) return { list: existing, added: [] };
    const activeId = this.getActiveMerchantId();
    const existingIds = new Set(existing.map((t) => t.id));
    const existingEventRefs = new Set(
      existing
        .filter((t) => t.status !== 'cancelled' && t.eventRef)
        .map((t) => t.eventRef!)
    );
    const existingAutoSignatures = new Set(
      existing
        .filter((t) => t.status !== 'cancelled' && !t.eventRef && t.source === 'automatic' && t.type !== 'adjustment')
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
      if (tx.status !== 'cancelled') {
        if (tx.eventRef) {
          if (existingEventRefs.has(tx.eventRef)) continue;
          existingEventRefs.add(tx.eventRef);
        } else if (tx.source === 'automatic' && tx.type !== 'adjustment') {
          const sig =
            tx.type === 'damage_writeoff'
              ? `auto|${tx.orderId}|${tx.returnId || ''}|${tx.type}|${tx.status}|${tx.amount}|${tx.notes || ''}`
              : `auto|${tx.orderId}|${tx.returnId || ''}|${tx.type}|${tx.status}`;
          if (existingAutoSignatures.has(sig)) continue;
          existingAutoSignatures.add(sig);
        }
      }

      const fullTx: FinancialTransaction = {
        id: tx.id || `tx-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
        date: tx.date || new Date().toISOString(),
        merchantId: tx.merchantId || activeId,
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
    const key = this.getScopedKey(STORAGE_KEYS.PRODUCTS);
    const raw = this.filterOwned(this.get<Product[]>(key, []));
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
    const key = this.getScopedKey(STORAGE_KEYS.PRODUCTS);
    const products = this.getProducts();
    if (this.corruptedKeys.has(key)) {
      return {
        success: false,
        error: 'بيانات المنتجات المخزنة تالفة ولا يمكن الكتابة فوقها تلقائياً.',
      };
    }

    const activeId = this.getActiveMerchantId();
    const normalized = normalizeProductCustody({ ...product, merchantId: product.merchantId || activeId });
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
    return this.set(key, products);
  }

  public saveProductsBatch(
    nextProducts: Product[],
    newMovements: StockMovement[] = []
  ): StorageWriteResult {
    const prodKey = this.getScopedKey(STORAGE_KEYS.PRODUCTS);
    const movKey = this.getScopedKey(STORAGE_KEYS.MOVEMENTS);
    const existingMovements = this.getMovements();
    const writes: Array<{ key: string; value: unknown }> = [
      { key: prodKey, value: this.stampOwned(nextProducts.map(normalizeProductCustody)) },
    ];
    if (newMovements.length > 0) {
      writes.push({
        key: movKey,
        value: this.prepareMovementsAppend(existingMovements, newMovements),
      });
    }
    return this.commitMultiKeyWrites(writes);
  }

  public deleteProduct(id: string): StorageWriteResult {
    const key = this.getScopedKey(STORAGE_KEYS.PRODUCTS);
    const current = this.getProducts();
    if (this.corruptedKeys.has(key)) {
      return {
        success: false,
        error: 'بيانات المنتجات المخزنة تالفة ولا يمكن تعديلها تلقائياً.',
      };
    }
    const products = current.filter((p) => p.id !== id);
    return this.set(key, products);
  }

  public allocateStockToPlatform(
    productId: string,
    marketplaceId: MarketplaceId,
    quantity: number,
    operator: string = 'مدير العمليات'
  ): StorageWriteResult {
    const isMarketplaceActive = this.getActiveMarketplaces().some((m) => m.id === marketplaceId);
    const res = allocateStockToPlatformPure({
      products: this.getProducts(),
      productId,
      marketplaceId,
      quantity,
      isMarketplaceActive,
      operator,
      merchantId: this.getActiveMerchantId(),
    });
    if (!res.success) {
      return { success: false, error: res.error };
    }
    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
    ];
    if (res.movement) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
        value: this.prepareMovementsAppend(this.getMovements(), [res.movement]),
      });
    }
    return this.commitMultiKeyWrites(writes);
  }

  public releasePlatformAllocation(
    productId: string,
    marketplaceId: MarketplaceId,
    quantity: number,
    operator: string = 'مدير العمليات'
  ): StorageWriteResult {
    const res = releasePlatformAllocationPure({
      products: this.getProducts(),
      productId,
      marketplaceId,
      quantity,
      operator,
      merchantId: this.getActiveMerchantId(),
    });
    if (!res.success) {
      return { success: false, error: res.error };
    }
    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
    ];
    if (res.movement) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
        value: this.prepareMovementsAppend(this.getMovements(), [res.movement]),
      });
    }
    return this.commitMultiKeyWrites(writes);
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
      merchantId: this.getActiveMerchantId(),
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
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: products },
      { key: this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY), value: nextHistory },
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
    return this.filterOwned(this.get<Order[]>(this.getScopedKey(STORAGE_KEYS.ORDERS), []));
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
    const activeMarketplaceIds = this.getActiveMarketplaces().map((m) => m.id);
    const activeMerchantId = this.getActiveMerchantId();

    const res = createOrderPure({
      orderData,
      products: existingProducts,
      existingOrders,
      activeMarketplaceIds,
      merchantId: activeMerchantId,
      customId,
      operator,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
      { key: this.getScopedKey(STORAGE_KEYS.ORDERS), value: res.orders },
    ];
    if (res.movements.length > 0) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
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
      merchantId: this.getActiveMerchantId(),
      shipmentDetails,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.ORDERS), value: res.orders },
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
      { key: this.getScopedKey(STORAGE_KEYS.RETURNS), value: res.returns },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    if (res.newTransactions.length > 0) {
      const txPrep = this.prepareTransactionsAppend(existingTransactions, res.newTransactions);
      if (txPrep.added.length > 0) {
        writes.push({
          key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS),
          value: txPrep.list,
        });
      }
    }

    return this.commitMultiKeyWrites(writes);
  }

  // --- Returns Management ---
  public getReturns(): ReturnRecord[] {
    const raw = this.filterOwned(
      this.get<ReturnRecord[]>(this.getScopedKey(STORAGE_KEYS.RETURNS), [])
    );
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
      merchantId: this.getActiveMerchantId(),
      notes,
      shipment,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.RETURNS), value: res.returns },
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
    ];
    if (res.newMovements.length > 0) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
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
    operator: string = 'مدير العمليات',
    restockTarget?: 'central' | MarketplaceId
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
      restockTarget,
      activeMarketplaceIds: this.getActiveMarketplaces().map((m) => m.id),
      returns: existingReturns,
      products: existingProducts,
      orders: existingOrders,
      currency: settings.currency || 'SAR',
      operator,
      merchantId: this.getActiveMerchantId(),
    });

    if (!res.success) {
      return { success: false, message: res.message };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.RETURNS), value: res.returns },
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
      { key: this.getScopedKey(STORAGE_KEYS.ORDERS), value: res.orders },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    if (res.newTransactions.length > 0) {
      const txPrep = this.prepareTransactionsAppend(existingTransactions, res.newTransactions);
      if (txPrep.added.length > 0) {
        writes.push({
          key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS),
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
    notes?: string,
    selectedItems?: Array<{ productId: string; productSku?: string; quantity: number }>
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
      selectedItems,
      orders: existingOrders,
      returns: existingReturns,
      products: existingProducts,
      currency: settings.currency || 'SAR',
      operator: settings.sellerName || 'مدير العمليات',
      merchantId: this.getActiveMerchantId(),
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
      { key: this.getScopedKey(STORAGE_KEYS.RETURNS), value: res.returns },
      { key: this.getScopedKey(STORAGE_KEYS.ORDERS), value: res.orders },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
        value: this.prepareMovementsAppend(existingMovements, res.newMovements),
      });
    }

    if (res.newTransactions.length > 0) {
      const txPrep = this.prepareTransactionsAppend(existingTransactions, res.newTransactions);
      if (txPrep.added.length > 0) {
        writes.push({
          key: this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS),
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

    const writeRes = this.set(this.getScopedKey(STORAGE_KEYS.RETURNS), res.returns);
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
    return this.filterOwned(
      this.get<FinancialTransaction[]>(
        this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS),
        []
      )
    );
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
          (tx.eventRef && existing.eventRef === tx.eventRef) ||
          (!tx.eventRef &&
            existing.source === 'automatic' &&
            tx.source === 'automatic' &&
            existing.orderId === tx.orderId &&
            (existing.returnId || '') === (tx.returnId || '') &&
            existing.type === tx.type &&
            existing.status === tx.status)
      );
      return { success: true, transaction: existingMatch, deduplicated: true };
    }

    const writeRes = this.set(
      this.getScopedKey(STORAGE_KEYS.FINANCIAL_TRANSACTIONS),
      prep.list
    );
    if (!writeRes.success) {
      return writeRes;
    }
    return { success: true, transaction: prep.added[0], deduplicated: false };
  }

  public recordFinancialTransaction(
    tx: Omit<FinancialTransaction, 'id' | 'date'> & { id?: string; date?: string }
  ): FinancialTransaction {
    const res = this.recordFinancialTransactionWithResult(tx);
    if (!res.success || !res.transaction) {
      throw new Error(res.error || 'تعذر حفظ المعاملة المالية في التخزين المحلي.');
    }
    return res.transaction;
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

    const savedRecs = this.get<MerchantRecommendation[]>(
      this.getScopedKey(STORAGE_KEYS.RECOMMENDATIONS),
      []
    );
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
    const key = this.getScopedKey(STORAGE_KEYS.RECOMMENDATIONS);
    const list = this.get<MerchantRecommendation[]>(key, []);
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
    return this.set(key, list).success;
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
    return this.filterOwned(
      this.get<StockMovement[]>(this.getScopedKey(STORAGE_KEYS.MOVEMENTS), [])
    );
  }

  public recordStockMovements(newMovements: StockMovement[]): StorageWriteResult {
    if (!newMovements || newMovements.length === 0) return { success: true };
    const existing = this.getMovements();
    const merged = this.prepareMovementsAppend(existing, newMovements);
    if (merged === existing) return { success: true };
    return this.set(this.getScopedKey(STORAGE_KEYS.MOVEMENTS), merged);
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
      operator,
      new Date().toISOString(),
      this.getActiveMerchantId()
    );

    if (!res.success) {
      return { success: false, error: res.error };
    }

    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
    ];
    if (res.movement) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
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
    return this.filterOwned(
      this.get<PriceHistoryRecord[]>(this.getScopedKey(STORAGE_KEYS.PRICE_HISTORY), [])
    );
  }

  // --- Settings ---
  public getSettings(): AppSettings {
    const settings = this.get<AppSettings>(this.getScopedKey(STORAGE_KEYS.SETTINGS), DEFAULT_SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      marketplaces: (settings.marketplaces || []).map((m) => ({
        ...m,
        isActive: m.isActive !== false,
      })),
    };
  }

  public saveSettings(settings: AppSettings): StorageWriteResult {
    const writeRes = this.set(this.getScopedKey(STORAGE_KEYS.SETTINGS), settings);
    if (writeRes.success) {
      this.syncActiveAccountMetadata(settings.storeName, settings.sellerName);
    }
    return writeRes;
  }

  private syncActiveAccountMetadata(storeName?: string, merchantName?: string, email?: string): void {
    const activeId = this.getActiveMerchantId();
    const accounts = this.getMerchantAccounts();
    const idx = accounts.findIndex((a) => a.id === activeId);
    if (idx !== -1) {
      accounts[idx] = {
        ...accounts[idx],
        storeName: storeName ?? accounts[idx].storeName,
        merchantName: merchantName ?? accounts[idx].merchantName,
        email: email ?? accounts[idx].email,
      };
      this.set(SYSTEM_STORAGE_KEYS.MERCHANT_ACCOUNTS, accounts);
    }
  }

  public addMarketplace(marketplace: MarketplaceConfig): StorageWriteResult {
    const settings = this.getSettings();
    const normalized: MarketplaceConfig = { ...marketplace, isActive: marketplace.isActive !== false };
    const existingIdx = settings.marketplaces.findIndex((m) => m.id === normalized.id);
    if (existingIdx === -1) {
      settings.marketplaces.push(normalized);
    } else {
      settings.marketplaces[existingIdx] = {
        ...settings.marketplaces[existingIdx],
        ...normalized,
        isActive: true,
      };
    }

    const profile = this.getMerchantProfile();
    const nextSelected = normalized.isActive
      ? Array.from(new Set([...(profile.selectedMarketplaceIds || []), normalized.id]))
      : profile.selectedMarketplaceIds;

    return this.commitMultiKeyWrites([
      { key: this.getScopedKey(STORAGE_KEYS.SETTINGS), value: settings },
      {
        key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE),
        value: { ...profile, selectedMarketplaceIds: nextSelected },
      },
    ]);
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
    return this.filterOwned(
      this.get<SmartImportHistory[]>(this.getScopedKey(STORAGE_KEYS.SMART_IMPORT_HISTORY), [])
    );
  }

  public saveSmartImportHistory(record: SmartImportHistory): StorageWriteResult {
    const key = this.getScopedKey(STORAGE_KEYS.SMART_IMPORT_HISTORY);
    const history = this.getSmartImportHistory();
    history.unshift({ ...record, merchantId: record.merchantId || this.getActiveMerchantId() });
    return this.set(key, history);
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
    rejectedCount?: number;
    rejectedOrders?: SmartImportRejectedOrder[];
  } {
    const existingOrders = this.getOrders();
    const existingProducts = this.getProducts();
    const existingReturns = this.getReturns();
    const existingMovements = this.getMovements();
    const existingHistory = this.getSmartImportHistory();
    const activeMarketplaceIds = this.getActiveMarketplaces().map((m) => m.id);
    const activeMerchantId = this.getActiveMerchantId();

    const res = saveSmartImportOrdersPure({
      ordersToImport,
      isHistoricalDeducted,
      existingOrders,
      products: existingProducts,
      returns: existingReturns,
      activeMarketplaceIds,
      merchantId: activeMerchantId,
      operator,
    });

    const historyRecord: SmartImportHistory = {
      id: `smi-${Date.now()}`,
      merchantId: activeMerchantId,
      marketplaceId: ordersToImport[0]?.marketplaceId || activeMarketplaceIds[0] || 'custom',
      fileName,
      importedAt: new Date().toISOString(),
      totalImported: res.importedCount + res.historicalCount,
      historicalCount: res.historicalCount,
      operator,
    };

    const writes: Array<{ key: string; value: unknown }> = [
      { key: this.getScopedKey(STORAGE_KEYS.ORDERS), value: res.orders },
      { key: this.getScopedKey(STORAGE_KEYS.PRODUCTS), value: res.products },
      { key: this.getScopedKey(STORAGE_KEYS.RETURNS), value: res.returns },
      { key: this.getScopedKey(STORAGE_KEYS.SMART_IMPORT_HISTORY), value: [historyRecord, ...existingHistory] },
    ];

    if (res.newMovements.length > 0) {
      writes.push({
        key: this.getScopedKey(STORAGE_KEYS.MOVEMENTS),
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
        rejectedCount: res.rejectedCount,
        rejectedOrders: res.rejectedOrders,
      };
    }

    return {
      success: true,
      importedCount: res.importedCount,
      historicalCount: res.historicalCount,
      duplicateCount: res.duplicateCount,
      rejectedCount: res.rejectedCount,
      rejectedOrders: res.rejectedOrders,
    };
  }

  // --- Merchant Profile & Onboarding ---
  public getMerchantProfile(): MerchantProfile {
    const activeId = this.getActiveMerchantId();
    const profile = this.get<MerchantProfile>(
      this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE, activeId),
      { ...DEFAULT_MERCHANT_PROFILE, merchantId: activeId }
    );
    if (!profile.merchantName && profile.name) {
      profile.merchantName = profile.name;
    }
    return {
      ...profile,
      merchantId: profile.merchantId || activeId,
      role: this.getAuthSession().role,
    };
  }

  public saveMerchantProfile(profile: MerchantProfile): StorageWriteResult {
    const activeId = this.getActiveMerchantId();
    const nextProfile: MerchantProfile = {
      ...profile,
      merchantId: activeId,
    };
    if (nextProfile.merchantName && !nextProfile.name) {
      nextProfile.name = nextProfile.merchantName;
    }
    const settings = this.getSettings();
    settings.storeName = nextProfile.storeName;
    settings.sellerName = nextProfile.merchantName || nextProfile.name;

    const writeRes = this.commitMultiKeyWrites([
      { key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE, activeId), value: nextProfile },
      { key: this.getScopedKey(STORAGE_KEYS.SETTINGS, activeId), value: settings },
    ]);
    if (writeRes.success) {
      this.syncActiveAccountMetadata(
        nextProfile.storeName,
        nextProfile.merchantName || nextProfile.name,
        nextProfile.email
      );
    }
    return writeRes;
  }

  public completeOnboarding(
    param1: MarketplaceConfig[] | string,
    param2: string,
    param3?: string | string[] | MarketplaceConfig[]
  ): StorageWriteResult {
    const profile = this.getMerchantProfile();
    const settings = this.getSettings();

    let merchantName = profile.merchantName || profile.name || settings.sellerName || '';
    let storeName = profile.storeName || settings.storeName || '';
    let marketplaces: MarketplaceConfig[] = this.getAllMarketplaces();

    if (Array.isArray(param1)) {
      marketplaces = (param1 as MarketplaceConfig[]).map((m) => ({
        ...m,
        isActive: m.isActive !== false,
      }));
      merchantName = typeof param2 === 'string' && param2.trim() ? param2.trim() : merchantName;
      storeName = typeof param3 === 'string' && param3.trim() ? param3.trim() : storeName;
    } else if (typeof param1 === 'string') {
      if (param1.trim()) merchantName = param1.trim();
      if (typeof param2 === 'string' && param2.trim()) storeName = param2.trim();
      if (Array.isArray(param3) && param3.length > 0 && typeof param3[0] === 'object') {
        marketplaces = (param3 as MarketplaceConfig[]).map((m) => ({
          ...m,
          isActive: m.isActive !== false,
        }));
      }
    }

    settings.marketplaces = marketplaces;
    settings.storeName = storeName;
    settings.sellerName = merchantName;

    profile.name = merchantName;
    profile.merchantName = merchantName;
    profile.storeName = storeName;
    profile.isOnboarded = true;
    profile.selectedMarketplaceIds = marketplaces.filter((m) => m.isActive !== false).map((m) => m.id);
    profile.onboardedAt = new Date().toISOString();

    const activeId = this.getActiveMerchantId();
    const writeRes = this.commitMultiKeyWrites([
      { key: this.getScopedKey(STORAGE_KEYS.SETTINGS, activeId), value: settings },
      { key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE, activeId), value: profile },
    ]);
    if (writeRes.success) {
      this.syncActiveAccountMetadata(storeName, merchantName, profile.email);
    }
    return writeRes;
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

  // --- Dynamic Marketplace Management (Single Source of Truth) ---
  public getAllMarketplaces(): MarketplaceConfig[] {
    return this.getSettings().marketplaces.map((m) => ({
      ...m,
      isActive: m.isActive !== false,
    }));
  }

  public getActiveMarketplaces(): MarketplaceConfig[] {
    return this.getAllMarketplaces().filter((m) => m.isActive !== false);
  }

  public getMarketplaces(): MarketplaceConfig[] {
    return this.getAllMarketplaces();
  }

  public getMarketplaceById(id: string): MarketplaceConfig | undefined {
    return this.getAllMarketplaces().find((m) => m.id === id);
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

  public setMarketplaceActive(id: string, isActive: boolean): StorageWriteResult {
    const settings = this.getSettings();
    const idx = settings.marketplaces.findIndex((m) => m.id === id);
    if (idx === -1) {
      return { success: false, error: 'المنصة المطلوبة غير موجودة.' };
    }
    settings.marketplaces[idx] = {
      ...settings.marketplaces[idx],
      isActive,
    };

    const profile = this.getMerchantProfile();
    const nextSelected = settings.marketplaces
      .filter((m) => m.isActive !== false)
      .map((m) => m.id);

    return this.commitMultiKeyWrites([
      { key: this.getScopedKey(STORAGE_KEYS.SETTINGS), value: settings },
      {
        key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE),
        value: { ...profile, selectedMarketplaceIds: nextSelected },
      },
    ]);
  }

  public removeMarketplace(id: string): StorageWriteResult {
    const hasOrders = this.getOrders().some((o) => o.marketplaceId === id);
    const hasReturns = this.getReturns().some((r) => r.marketplaceId === id);
    const hasPriceHistory = this.getPriceHistory().some((ph) => ph.marketplaceId === id);
    const hasActiveAlloc = this.getProducts().some(
      (p) => (p.platformAllocations?.[id]?.allocatedQty || 0) > 0
    );

    if (hasOrders || hasReturns || hasPriceHistory || hasActiveAlloc) {
      return {
        success: false,
        error:
          'لا يمكن حذف منصة مرتبطة بطلبات أو مرتجعات أو تخصيص مخزون تاريخي حفاظاً على السجلات؛ يمكنك تعطيلها (إيقاف التفعيل) بدلاً من الحذف.',
      };
    }

    const settings = this.getSettings();
    settings.marketplaces = settings.marketplaces.filter((m) => m.id !== id);
    const profile = this.getMerchantProfile();
    profile.selectedMarketplaceIds = (profile.selectedMarketplaceIds || []).filter((mId) => mId !== id);

    return this.commitMultiKeyWrites([
      { key: this.getScopedKey(STORAGE_KEYS.SETTINGS), value: settings },
      { key: this.getScopedKey(STORAGE_KEYS.MERCHANT_PROFILE), value: profile },
    ]);
  }
}

export const storageService = new StorageService();
storageService.init();
