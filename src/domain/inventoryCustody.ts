/**
 * Pure inventory custody, centralized warehouse vs platform allocation math,
 * stock validation, and price calculation helpers.
 * Enforces non-negative stock invariants and prevents double-counting or
 * quarantine/damaged stock leakage into sellable availability.
 */

import {
  MarketplaceId,
  PlatformInventoryAllocation,
  Product,
  StockMovement,
} from '../types';
import { resolveSafeProductImage } from '../utils/productVisual';

export function normalizeProductCustody(p: Product): Product {
  const avail =
    typeof p.availableStock === 'number' && Number.isFinite(p.availableStock)
      ? Math.max(0, Math.floor(p.availableStock))
      : 0;
  const res =
    typeof p.reservedStock === 'number' && Number.isFinite(p.reservedStock)
      ? Math.max(0, Math.floor(p.reservedStock))
      : 0;
  const awaitInsp =
    typeof p.awaitingInspectionStock === 'number' && Number.isFinite(p.awaitingInspectionStock)
      ? Math.max(0, Math.floor(p.awaitingInspectionStock))
      : 0;
  const dmg =
    typeof p.damagedStock === 'number' && Number.isFinite(p.damagedStock)
      ? Math.max(0, Math.floor(p.damagedStock))
      : 0;
  const outTransit =
    typeof p.outboundInTransitStock === 'number' && Number.isFinite(p.outboundInTransitStock)
      ? Math.max(0, Math.floor(p.outboundInTransitStock))
      : 0;
  const retTransit =
    typeof p.returnInTransitStock === 'number' && Number.isFinite(p.returnInTransitStock)
      ? Math.max(0, Math.floor(p.returnInTransitStock))
      : 0;
  const phys =
    typeof p.physicalStock === 'number' && Number.isFinite(p.physicalStock)
      ? Math.max(0, Math.floor(p.physicalStock))
      : avail + res + awaitInsp + dmg + outTransit + retTransit;

  // Normalize explicit platform allocations safely without exceeding sellable + reserved bounds
  const nextAllocations: Record<MarketplaceId, PlatformInventoryAllocation> = {};
  const rawAllocations = p.platformAllocations || {};
  let sumPlatformAllocated = 0;
  let sumPlatformReserved = 0;
  let sumPlatformAvailable = 0;

  for (const [mktId, alloc] of Object.entries(rawAllocations)) {
    if (!alloc) continue;
    const allocQty = Math.max(0, Math.floor(Number(alloc.allocatedQty) || 0));
    const resQty = Math.min(allocQty, Math.max(0, Math.floor(Number(alloc.reservedQty) || 0)));
    const mktAvail = Math.max(0, allocQty - resQty);
    nextAllocations[mktId] = {
      marketplaceId: mktId,
      allocatedQty: allocQty,
      reservedQty: resQty,
      availableQty: mktAvail,
      lastUpdated: alloc.lastUpdated || p.updatedAt,
    };
    sumPlatformAllocated += allocQty;
    sumPlatformReserved += resQty;
    sumPlatformAvailable += mktAvail;
  }

  // Clamp platform allocations proportionally if legacy edit/corruption pushed sum(platformAvailable) > avail
  if (sumPlatformAvailable > avail && sumPlatformAvailable > 0) {
    let remainingAvailBudget = avail;
    sumPlatformAllocated = 0;
    sumPlatformAvailable = 0;
    for (const mktId of Object.keys(nextAllocations)) {
      const alloc = nextAllocations[mktId];
      const clampedMktAvail = Math.min(alloc.availableQty, remainingAvailBudget);
      remainingAvailBudget -= clampedMktAvail;
      alloc.availableQty = clampedMktAvail;
      alloc.allocatedQty = clampedMktAvail + alloc.reservedQty;
      sumPlatformAllocated += alloc.allocatedQty;
      sumPlatformAvailable += alloc.availableQty;
    }
  }

  // Keep total reserved = centralReserved + sumPlatformReserved
  const centralReserved = Math.max(0, res - sumPlatformReserved);
  // Central available = total sellable available - sumPlatformAvailable
  // (Equivalently: physicalStock - centralReserved - sumPlatformAllocated - awaitingInspection - damaged - outTransit - retTransit)
  const centralAvailable = Math.max(0, avail - sumPlatformAvailable);

  // Sync marketplaceListings[id].quantity with explicit allocation when present
  const nextListings = { ...(p.marketplaceListings || {}) };
  for (const [mktId, alloc] of Object.entries(nextAllocations)) {
    if (nextListings[mktId]) {
      nextListings[mktId] = {
        ...nextListings[mktId],
        quantity: alloc.availableQty,
        listingStatus:
          alloc.availableQty > 0
            ? nextListings[mktId].listingStatus === 'inactive'
              ? 'inactive'
              : 'active'
            : 'out_of_stock',
      };
    }
  }

  return {
    ...p,
    imageUrl: resolveSafeProductImage(p.imageUrl, p.name, p.category),
    availableStock: centralAvailable + sumPlatformAvailable,
    centralAvailableStock: centralAvailable,
    centralReservedStock: centralReserved,
    reservedStock: centralReserved + sumPlatformReserved,
    platformAllocations: nextAllocations,
    awaitingInspectionStock: awaitInsp,
    damagedStock: dmg,
    rejectedResaleStock: p.rejectedResaleStock ?? dmg,
    outboundInTransitStock: outTransit,
    returnInTransitStock: retTransit,
    physicalStock: phys,
    marketplaceListings: nextListings,
  };
}

export function getPlatformAllocationSummary(
  product: Product,
  marketplaceId: MarketplaceId
): {
  allocatedQty: number;
  reservedQty: number;
  availableQty: number;
  hasExplicitAllocation: boolean;
} {
  const norm = normalizeProductCustody(product);
  const alloc = norm.platformAllocations?.[marketplaceId];
  if (!alloc || alloc.allocatedQty <= 0) {
    return {
      allocatedQty: 0,
      reservedQty: 0,
      availableQty: 0,
      hasExplicitAllocation: false,
    };
  }
  return {
    allocatedQty: alloc.allocatedQty,
    reservedQty: alloc.reservedQty,
    availableQty: alloc.availableQty,
    hasExplicitAllocation: true,
  };
}

export function getTotalPlatformAllocatedStock(product: Product): number {
  const norm = normalizeProductCustody(product);
  return Object.values(norm.platformAllocations || {}).reduce(
    (sum, a) => sum + (a?.allocatedQty || 0),
    0
  );
}

export function getTotalPlatformAvailableStock(product: Product): number {
  const norm = normalizeProductCustody(product);
  return Object.values(norm.platformAllocations || {}).reduce(
    (sum, a) => sum + (a?.availableQty || 0),
    0
  );
}

/**
 * Computes effective orderable capacity for a marketplace on a product:
 * - If explicit platform allocation exists (allocatedQty > 0), strictly bounded to platform availableQty.
 * - If NO explicit allocation is set on that platform (0 allocated), draws from centralAvailableStock.
 */
export function getSellableCapacityForMarketplace(
  product: Product,
  marketplaceId: MarketplaceId
): { sellable: number; source: 'platform' | 'central' } {
  const norm = normalizeProductCustody(product);
  const alloc = norm.platformAllocations?.[marketplaceId];
  if (alloc && alloc.allocatedQty > 0) {
    return { sellable: alloc.availableQty, source: 'platform' };
  }
  return { sellable: norm.centralAvailableStock ?? 0, source: 'central' };
}

/**
 * Returns the minimum physicalStock required so that locked warehouse buckets,
 * active platform allocations, and transit units cannot go negative.
 */
export function getLockedCustodyFloor(product: Product): number {
  const warehouseLocked =
    (product.reservedStock || 0) +
    (product.awaitingInspectionStock || 0) +
    (product.damagedStock || 0);
  const currentNonAvailable = Math.max(0, product.physicalStock - product.availableStock);
  return Math.max(0, warehouseLocked, currentNonAvailable);
}

export function validateManualStockAdjustment(
  product: Product,
  newPhysicalStock: number
): { valid: boolean; minAllowed: number; error?: string } {
  const minAllowed = getLockedCustodyFloor(product);

  if (!Number.isFinite(newPhysicalStock) || !Number.isInteger(newPhysicalStock) || newPhysicalStock < 0) {
    return {
      valid: false,
      minAllowed,
      error: 'يجب أن يكون إجمالي المخزون الفعلي رقماً صحيحاً أكبر من أو يساوي 0.',
    };
  }

  if (newPhysicalStock < minAllowed) {
    return {
      valid: false,
      minAllowed,
      error: `لا يمكن خفض المخزون الفعلي عن (${minAllowed}) لأن هناك وحدات محجوزة أو بانتظار الفحص أو تالفة أو قيد التوصيل.`,
    };
  }

  return { valid: true, minAllowed };
}

export function computeEditedAvailableStock(
  existing: Product,
  newPhysicalStock: number
): { valid: boolean; newAvailable: number; minAllowed: number; error?: string } {
  const check = validateManualStockAdjustment(existing, newPhysicalStock);
  if (!check.valid) {
    return {
      valid: false,
      newAvailable: existing.availableStock,
      minAllowed: check.minAllowed,
      error: check.error,
    };
  }

  const diff = newPhysicalStock - existing.physicalStock;
  const newAvailable = Math.max(0, existing.availableStock + diff);

  return {
    valid: true,
    newAvailable,
    minAllowed: check.minAllowed,
  };
}

/**
 * Transfers sellable stock from Central Available Pool -> Specific Active Platform Allocation.
 * Does NOT alter physicalStock or total availableStock (prevents double counting).
 */
export function allocateStockToPlatformPure(params: {
  products: Product[];
  productId: string;
  marketplaceId: MarketplaceId;
  quantity: number;
  isMarketplaceActive?: boolean;
  operator?: string;
  merchantId?: string;
  nowIso?: string;
}): {
  success: boolean;
  error?: string;
  products: Product[];
  movement?: StockMovement;
} {
  const {
    products: rawProducts,
    productId,
    marketplaceId,
    quantity,
    isMarketplaceActive = true,
    operator = 'مدير العمليات',
    merchantId,
    nowIso = new Date().toISOString(),
  } = params;

  if (!isMarketplaceActive) {
    return {
      success: false,
      error: 'لا يمكن تخصيص مخزون لمنصة معطلة أو غير مفعلة في حساب التاجر.',
      products: rawProducts,
    };
  }

  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    return {
      success: false,
      error: 'يجب أن تكون الكمية المراد تخصيصها عدداً صحيحاً موجباً أكبر من صفر.',
      products: rawProducts,
    };
  }

  const idx = rawProducts.findIndex((p) => p.id === productId);
  if (idx === -1) {
    return { success: false, error: 'المنتج غير موجود.', products: rawProducts };
  }

  const existing = normalizeProductCustody(rawProducts[idx]);
  const centralAvail = existing.centralAvailableStock ?? 0;

  if (quantity > centralAvail) {
    return {
      success: false,
      error: `الكمية المطلوبة (${quantity}) تتجاوز الرصيد غير المخصص المتاح في المستودع المركزي (${centralAvail} قطعة).`,
      products: rawProducts,
    };
  }

  const prevAlloc = existing.platformAllocations?.[marketplaceId] || {
    marketplaceId,
    allocatedQty: 0,
    reservedQty: 0,
    availableQty: 0,
    lastUpdated: nowIso,
  };

  const nextAllocQty = prevAlloc.allocatedQty + quantity;
  const nextMktAvail = Math.max(0, nextAllocQty - prevAlloc.reservedQty);

  const nextAllocations = {
    ...(existing.platformAllocations || {}),
    [marketplaceId]: {
      marketplaceId,
      allocatedQty: nextAllocQty,
      reservedQty: prevAlloc.reservedQty,
      availableQty: nextMktAvail,
      lastUpdated: nowIso,
    },
  };

  const nextListings = { ...(existing.marketplaceListings || {}) };
  nextListings[marketplaceId] = {
    marketplaceId,
    price: nextListings[marketplaceId]?.price ?? existing.currentPrice ?? 0,
    quantity: nextMktAvail,
    listingStatus: nextMktAvail > 0 ? 'active' : 'out_of_stock',
    lastUpdated: nowIso,
  };

  const updated = normalizeProductCustody({
    ...existing,
    centralAvailableStock: centralAvail - quantity,
    platformAllocations: nextAllocations,
    marketplaceListings: nextListings,
    updatedAt: nowIso,
  });

  const nextProducts = [...rawProducts];
  nextProducts[idx] = updated;

  const movement: StockMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    merchantId: merchantId || updated.merchantId,
    productId: updated.id,
    productSku: updated.sku || updated.name,
    productName: updated.name,
    marketplaceId,
    platformId: marketplaceId,
    source: 'central_available',
    destination: 'platform_allocation',
    type: 'allocation_to_platform',
    quantityChange: 0,
    previousPhysical: existing.physicalStock,
    newPhysical: updated.physicalStock,
    previousAvailable: existing.availableStock,
    newAvailable: updated.availableStock,
    beforeQty: prevAlloc.allocatedQty,
    afterQty: nextAllocQty,
    fromCustody: `المستودع المركزي (${centralAvail} متاح)`,
    toCustody: `تخصيص منصة ${marketplaceId} (${nextAllocQty} مخصص)`,
    reason: `تخصيص ${quantity} وحدة من المستودع المركزي إلى منصة (${marketplaceId})`,
    operator,
    timestamp: nowIso,
  };

  return { success: true, products: nextProducts, movement };
}

/**
 * Returns unreserved units from Platform Allocation -> Central Available Pool.
 * Fails if requested quantity exceeds unreserved platform availableQty.
 */
export function releasePlatformAllocationPure(params: {
  products: Product[];
  productId: string;
  marketplaceId: MarketplaceId;
  quantity: number;
  operator?: string;
  merchantId?: string;
  nowIso?: string;
}): {
  success: boolean;
  error?: string;
  products: Product[];
  movement?: StockMovement;
} {
  const {
    products: rawProducts,
    productId,
    marketplaceId,
    quantity,
    operator = 'مدير العمليات',
    merchantId,
    nowIso = new Date().toISOString(),
  } = params;

  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    return {
      success: false,
      error: 'يجب أن تكون الكمية المراد استرجاعها للمركز عدداً صحيحاً موجباً.',
      products: rawProducts,
    };
  }

  const idx = rawProducts.findIndex((p) => p.id === productId);
  if (idx === -1) {
    return { success: false, error: 'المنتج غير موجود.', products: rawProducts };
  }

  const existing = normalizeProductCustody(rawProducts[idx]);
  const prevAlloc = existing.platformAllocations?.[marketplaceId];
  const mktAvail = prevAlloc?.availableQty || 0;

  if (!prevAlloc || quantity > mktAvail) {
    return {
      success: false,
      error: `الكمية المطلوب استرجاعها (${quantity}) تتجاوز الرصيد غير المحجوز المتاح على المنصة (${mktAvail} قطعة).`,
      products: rawProducts,
    };
  }

  const nextAllocQty = Math.max(prevAlloc.reservedQty, prevAlloc.allocatedQty - quantity);
  const nextMktAvail = Math.max(0, nextAllocQty - prevAlloc.reservedQty);

  const nextAllocations = { ...(existing.platformAllocations || {}) };
  if (nextAllocQty === 0) {
    delete nextAllocations[marketplaceId];
  } else {
    nextAllocations[marketplaceId] = {
      marketplaceId,
      allocatedQty: nextAllocQty,
      reservedQty: prevAlloc.reservedQty,
      availableQty: nextMktAvail,
      lastUpdated: nowIso,
    };
  }

  const nextListings = { ...(existing.marketplaceListings || {}) };
  if (nextListings[marketplaceId]) {
    nextListings[marketplaceId] = {
      ...nextListings[marketplaceId],
      quantity: nextMktAvail,
      listingStatus: nextMktAvail > 0 ? 'active' : 'out_of_stock',
      lastUpdated: nowIso,
    };
  }

  const centralAvail = existing.centralAvailableStock ?? 0;
  const updated = normalizeProductCustody({
    ...existing,
    centralAvailableStock: centralAvail + quantity,
    platformAllocations: nextAllocations,
    marketplaceListings: nextListings,
    updatedAt: nowIso,
  });

  const nextProducts = [...rawProducts];
  nextProducts[idx] = updated;

  const movement: StockMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    merchantId: merchantId || updated.merchantId,
    productId: updated.id,
    productSku: updated.sku || updated.name,
    productName: updated.name,
    marketplaceId,
    platformId: marketplaceId,
    source: 'platform_allocation',
    destination: 'central_available',
    type: 'allocation_returned_central',
    quantityChange: 0,
    previousPhysical: existing.physicalStock,
    newPhysical: updated.physicalStock,
    previousAvailable: existing.availableStock,
    newAvailable: updated.availableStock,
    beforeQty: prevAlloc.allocatedQty,
    afterQty: nextAllocQty,
    fromCustody: `تخصيص منصة ${marketplaceId} (${prevAlloc.allocatedQty})`,
    toCustody: `المستودع المركزي (${centralAvail + quantity} متاح)`,
    reason: `إرجاع ${quantity} وحدة غير محجوزة من منصة (${marketplaceId}) إلى المستودع المركزي`,
    operator,
    timestamp: nowIso,
  };

  return { success: true, products: nextProducts, movement };
}

export function applyManualStockAdjustmentPure(
  products: Product[],
  productId: string,
  newPhysicalStock: number,
  reason: string,
  operator: string = 'مدير العمليات',
  nowIso: string = new Date().toISOString(),
  merchantId?: string
): {
  success: boolean;
  error?: string;
  products: Product[];
  movement?: StockMovement;
} {
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1) {
    return { success: false, error: 'المنتج غير موجود.', products };
  }

  const existing = normalizeProductCustody(products[idx]);
  const edited = computeEditedAvailableStock(existing, newPhysicalStock);
  if (!edited.valid) {
    return { success: false, error: edited.error, products };
  }

  const prevPhysical = existing.physicalStock;
  const prevAvailable = existing.availableStock;
  const diff = newPhysicalStock - prevPhysical;

  const updatedProduct = normalizeProductCustody({
    ...existing,
    physicalStock: newPhysicalStock,
    availableStock: edited.newAvailable,
    updatedAt: nowIso,
  });

  const nextProducts = [...products];
  nextProducts[idx] = updatedProduct;

  const movement: StockMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    merchantId: merchantId || updatedProduct.merchantId,
    productId: updatedProduct.id,
    productSku: updatedProduct.sku || updatedProduct.name,
    productName: updatedProduct.name,
    source: diff >= 0 ? 'external' : 'central_available',
    destination: diff >= 0 ? 'central_available' : 'external',
    type: 'manual_adjustment',
    quantityChange: diff,
    previousPhysical: prevPhysical,
    newPhysical: updatedProduct.physicalStock,
    previousAvailable: prevAvailable,
    newAvailable: updatedProduct.availableStock,
    beforeQty: prevPhysical,
    afterQty: updatedProduct.physicalStock,
    reason: `تسوية جردية يدوية: ${reason}`,
    operator,
    timestamp: nowIso,
  };

  return {
    success: true,
    products: nextProducts,
    movement,
  };
}

export function computePriceChangeMetrics(
  previousPrice: number,
  newPrice: number
): {
  valid: boolean;
  percentageDiff: number;
  changeType: 'increase' | 'decrease' | 'no_change';
  error?: string;
} {
  if (!Number.isFinite(newPrice) || newPrice < 0) {
    return {
      valid: false,
      percentageDiff: 0,
      changeType: 'no_change',
      error: 'يجب أن يكون السعر الجديد رقماً صحيحاً أكبر من أو يساوي 0.',
    };
  }

  const diff = newPrice - previousPrice;
  const changeType = diff > 0 ? 'increase' : diff < 0 ? 'decrease' : 'no_change';
  const percentageDiff =
    previousPrice > 0 ? Number(((diff / previousPrice) * 100).toFixed(2)) : 0;

  return {
    valid: true,
    percentageDiff,
    changeType,
  };
}

export function generateUniqueId(
  prefix: string,
  existingIds: Set<string>,
  digits: number = 4
): string {
  const min = Math.pow(10, digits - 1);
  const span = Math.pow(10, digits) - min;

  for (let attempt = 0; attempt < 50; attempt++) {
    const num = Math.floor(min + Math.random() * span);
    const candidate = `${prefix}-${num}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  let suffix = Date.now().toString().slice(-6);
  let candidate = `${prefix}-${suffix}`;
  while (existingIds.has(candidate)) {
    suffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
    candidate = `${prefix}-${suffix}`;
  }
  return candidate;
}
