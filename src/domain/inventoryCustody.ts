/**
 * Pure inventory custody, stock validation, and price calculation helpers.
 * Enforces non-negative stock invariants and prevents quarantine/damaged stock leakage.
 */

import { Product, StockMovement } from '../types';

export function normalizeProductCustody(p: Product): Product {
  const avail = typeof p.availableStock === 'number' && Number.isFinite(p.availableStock) ? p.availableStock : 0;
  const res = typeof p.reservedStock === 'number' && Number.isFinite(p.reservedStock) ? p.reservedStock : 0;
  const awaitInsp =
    typeof p.awaitingInspectionStock === 'number' && Number.isFinite(p.awaitingInspectionStock)
      ? p.awaitingInspectionStock
      : 0;
  const dmg = typeof p.damagedStock === 'number' && Number.isFinite(p.damagedStock) ? p.damagedStock : 0;
  const outTransit =
    typeof p.outboundInTransitStock === 'number' && Number.isFinite(p.outboundInTransitStock)
      ? p.outboundInTransitStock
      : 0;
  const retTransit =
    typeof p.returnInTransitStock === 'number' && Number.isFinite(p.returnInTransitStock)
      ? p.returnInTransitStock
      : 0;
  const phys =
    typeof p.physicalStock === 'number' && Number.isFinite(p.physicalStock)
      ? p.physicalStock
      : avail + res + awaitInsp + dmg;

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
}

/**
 * Returns the minimum physicalStock required so that locked warehouse buckets
 * (reserved + awaitingInspection + damaged + existing locked delta) cannot go negative.
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

export function applyManualStockAdjustmentPure(
  products: Product[],
  productId: string,
  newPhysicalStock: number,
  reason: string,
  operator: string = 'مدير العمليات',
  nowIso: string = new Date().toISOString()
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

  const updatedProduct: Product = {
    ...existing,
    physicalStock: newPhysicalStock,
    availableStock: edited.newAvailable,
    updatedAt: nowIso,
  };

  const nextProducts = [...products];
  nextProducts[idx] = updatedProduct;

  const movement: StockMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    productId: updatedProduct.id,
    productSku: updatedProduct.sku || updatedProduct.name,
    productName: updatedProduct.name,
    type: 'manual_adjustment',
    quantityChange: diff,
    previousPhysical: prevPhysical,
    newPhysical: updatedProduct.physicalStock,
    previousAvailable: prevAvailable,
    newAvailable: updatedProduct.availableStock,
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

  // Fallback with timestamp + random suffix guaranteed unique
  let suffix = Date.now().toString().slice(-6);
  let candidate = `${prefix}-${suffix}`;
  while (existingIds.has(candidate)) {
    suffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
    candidate = `${prefix}-${suffix}`;
  }
  return candidate;
}
