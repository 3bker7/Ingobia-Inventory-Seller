/**
 * Pure Return & Technical Inspection State Machine.
 * Enforces strict custody isolation across return stages, blocks stage skipping/reversals,
 * supports partial returns bounded by ordered quantity, supports explicit restock target
 * (central warehouse or active platform), and handles pre/post delivery returns consistently.
 */

import {
  FinancialTransaction,
  InspectionOutcome,
  MarketplaceId,
  Order,
  OrderItem,
  Product,
  ReturnRecord,
  ReturnStatus,
  ShipmentRecord,
  StockMovement,
} from '../types';
import { resolveOrderItemUnitCost } from './financialLedger';
import { generateUniqueId, normalizeProductCustody } from './inventoryCustody';

export const ALLOWED_RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  return_initiated: ['pickup_pending', 'in_transit_back', 'received_at_warehouse'],
  pickup_pending: ['in_transit_back', 'received_at_warehouse'],
  in_transit_back: ['received_at_warehouse'],
  received_at_warehouse: ['under_inspection'],
  under_inspection: [],
  inspection_completed: [],
  closed: [],
  // Legacy aliases normalized via getReturns()
  delivery_rejected: ['pickup_pending', 'in_transit_back', 'received_at_warehouse'],
  product_received: ['under_inspection'],
  restocked: [],
  damaged: [],
};

export function isValidReturnTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  if (from === to) return true;
  return ALLOWED_RETURN_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Computes per-item remaining eligible return quantities for an order,
 * accounting for prior partial or full returns.
 */
export function getOrderReturnableItems(
  order: Order,
  returns: ReturnRecord[]
): Array<{
  item: OrderItem;
  orderedQty: number;
  alreadyReturnedQty: number;
  remainingQty: number;
}> {
  const orderReturns = returns.filter((r) => r.orderId === order.id);

  return order.items.map((item) => {
    let returned = 0;
    for (const r of orderReturns) {
      for (const rItem of r.items) {
        if (
          rItem.productId === item.productId ||
          (item.productSku && rItem.productSku === item.productSku)
        ) {
          returned += rItem.quantity;
        }
      }
    }
    const remainingQty = Math.max(0, item.quantity - returned);
    return {
      item,
      orderedQty: item.quantity,
      alreadyReturnedQty: returned,
      remainingQty,
    };
  });
}

function isReturnInspectionCompleted(ret: ReturnRecord): boolean {
  return Boolean(
    ret.isCompleted ||
      ret.returnStatus === 'closed' ||
      ret.returnStatus === 'inspection_completed' ||
      ret.returnStatus === 'restocked' ||
      ret.returnStatus === 'damaged'
  );
}

/**
 * Computes the refundable value of a post-delivery return strictly using
 * original order item unitPrice snapshots and bounding total refunded quantity
 * per order item against originally ordered quantities.
 */
export function computeReturnRefundAmount(
  ret: ReturnRecord,
  order?: Order,
  allReturnsForOrder: ReturnRecord[] = []
): number {
  if (!ret.items || ret.items.length === 0) return 0;

  if (!order || !order.items || order.items.length === 0) {
    const rawTotal = ret.items.reduce((sum, item) => {
      const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
      const price =
        typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
          ? item.unitPrice
          : 0;
      return sum + qty * price;
    }, 0);
    return Math.round(rawTotal * 100) / 100;
  }

  // Track remaining refundable quantity per original order line after accounting for
  // any previously completed refundable returns on the same order.
  const remainingByLine = order.items.map((it) => Math.max(0, Math.floor(Number(it.quantity) || 0)));
  const seenPriorIds = new Set<string>();

  for (const prior of allReturnsForOrder) {
    if (prior.orderId !== order.id || prior.id === ret.id) continue;
    if (prior.id && seenPriorIds.has(prior.id)) continue;
    if (prior.id) seenPriorIds.add(prior.id);
    if (!isReturnInspectionCompleted(prior)) continue;
    if (prior.inspectionOutcome === 'missing' || prior.physicalCondition === 'lost') continue;

    for (const pItem of prior.items || []) {
      let toConsume = Math.max(0, Math.floor(Number(pItem.quantity) || 0));
      for (let idx = 0; idx < order.items.length && toConsume > 0; idx++) {
        const oItem = order.items[idx];
        const matches =
          oItem.productId === pItem.productId ||
          (Boolean(oItem.productSku) && oItem.productSku === pItem.productSku);
        if (!matches || remainingByLine[idx] <= 0) continue;
        const used = Math.min(toConsume, remainingByLine[idx]);
        remainingByLine[idx] -= used;
        toConsume -= used;
      }
    }
  }

  let refundTotal = 0;
  for (const rItem of ret.items) {
    let qtyToRefund = Math.max(0, Math.floor(Number(rItem.quantity) || 0));
    for (let idx = 0; idx < order.items.length && qtyToRefund > 0; idx++) {
      const oItem = order.items[idx];
      const matches =
        oItem.productId === rItem.productId ||
        (Boolean(oItem.productSku) && oItem.productSku === rItem.productSku);
      if (!matches || remainingByLine[idx] <= 0) continue;
      const applied = Math.min(qtyToRefund, remainingByLine[idx]);
      const originalUnitPrice =
        typeof oItem.unitPrice === 'number' && Number.isFinite(oItem.unitPrice) && oItem.unitPrice >= 0
          ? oItem.unitPrice
          : 0;
      refundTotal += applied * originalUnitPrice;
      remainingByLine[idx] -= applied;
      qtyToRefund -= applied;
    }
  }

  return Math.round(refundTotal * 100) / 100;
}

export function advanceReturnStatusPure(params: {
  returnId: string;
  targetStatus: ReturnStatus;
  returns: ReturnRecord[];
  products: Product[];
  orders: Order[];
  operator?: string;
  merchantId?: string;
  notes?: string;
  shipment?: Partial<ShipmentRecord>;
  nowIso?: string;
}): {
  success: boolean;
  error?: string;
  returns: ReturnRecord[];
  products: Product[];
  newMovements: StockMovement[];
} {
  const {
    returnId,
    targetStatus,
    returns: rawReturns,
    products: rawProducts,
    orders = [],
    operator = 'مدير العمليات',
    merchantId,
    notes,
    shipment,
    nowIso = new Date().toISOString(),
  } = params;

  const retIndex = rawReturns.findIndex((r) => r.id === returnId);
  if (retIndex === -1) {
    return {
      success: false,
      error: 'سجل المرتجع غير موجود.',
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
    };
  }

  const existingRet = rawReturns[retIndex];
  if (existingRet.isCompleted || existingRet.returnStatus === 'closed') {
    return {
      success: false,
      error: 'هذا المرتجع مغلق ومكتمل مسبقاً.',
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
    };
  }

  const prevStatus = existingRet.returnStatus;
  if (prevStatus === targetStatus) {
    return {
      success: true,
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
    };
  }

  if (!isValidReturnTransition(prevStatus, targetStatus)) {
    return {
      success: false,
      error: `انتقال غير مسموح به للمرتجع من (${prevStatus}) إلى (${targetStatus}). يجب تأكيد الاستلام الفعلي بالمستودع قبل بدء الفحص.`,
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
    };
  }

  const returns = [...rawReturns];
  const ret: ReturnRecord = {
    ...existingRet,
    activities: [...(existingRet.activities || [])],
  };
  const products = rawProducts.map(normalizeProductCustody);
  const newMovements: StockMovement[] = [];
  const associatedOrder = orders.find((o) => o.id === ret.orderId);
  const isPostDelivery =
    ret.isPostDeliveryReturn === true || Boolean(associatedOrder && associatedOrder.deliveredProcessed);

  if (targetStatus === 'received_at_warehouse') {
    for (let i = 0; i < ret.items.length; i++) {
      const item = ret.items[i];
      const prodIdx = products.findIndex(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (prodIdx >= 0) {
        let product = products[prodIdx];
        const prevAvail = product.availableStock;
        const prevPhys = product.physicalStock;
        const prevAwait = product.awaitingInspectionStock || 0;

        product = normalizeProductCustody({
          ...product,
          returnInTransitStock: Math.max(0, (product.returnInTransitStock || 0) - item.quantity),
          awaitingInspectionStock: prevAwait + item.quantity,
          physicalStock:
            isPostDelivery && !ret.physicalRestoredAtReceipt
              ? prevPhys + item.quantity
              : prevPhys,
          updatedAt: nowIso,
        });
        products[prodIdx] = product;

        newMovements.push({
          id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
          merchantId: merchantId || ret.merchantId || product.merchantId,
          productId: product.id,
          productSku: product.sku || product.name,
          productName: product.name,
          marketplaceId: ret.marketplaceId,
          platformId: ret.marketplaceId,
          source: 'return_transit',
          destination: 'awaiting_inspection',
          type: 'return_received_warehouse',
          quantityChange: isPostDelivery && !ret.physicalRestoredAtReceipt ? item.quantity : 0,
          previousPhysical: prevPhys,
          newPhysical: product.physicalStock,
          previousAvailable: prevAvail,
          newAvailable: product.availableStock,
          beforeQty: prevAwait,
          afterQty: product.awaitingInspectionStock,
          fromCustody: 'مرتجع في طريق العودة',
          toCustody: 'بانتظار الفحص بالمستودع (غير متاح للبيع)',
          referenceOrderId: ret.orderId,
          referenceReturnId: ret.id,
          eventKey: `return_received_warehouse|${product.id}|${ret.id}|${i}`,
          reason: `استلام الطرد المرتجع بالمستودع #${ret.id} - بانتظار الفحص الفني قبل تحديد الصلاحية`,
          operator,
          timestamp: nowIso,
        });
      }
    }

    if (isPostDelivery) {
      ret.physicalRestoredAtReceipt = true;
    }
    ret.receivedAtWarehouseDate = nowIso;
    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'received_at_warehouse',
      actionAr:
        'تم استلام الطرد بالمستودع ونقل الحيازة إلى: بانتظار الفحص الفني (لا يزال غير متاح للبيع)',
      operator,
      notes,
    });
  } else if (targetStatus === 'under_inspection') {
    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'under_inspection',
      actionAr: 'تم بدء الفحص الفني وتقييم حالة المرتجع بالمستودع',
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
  ret.updatedAt = nowIso;
  returns[retIndex] = ret;

  return {
    success: true,
    returns,
    products,
    newMovements,
  };
}

export function processReturnInspectionPure(params: {
  returnId: string;
  outcome: InspectionOutcome;
  condition: 'like_new' | 'opened_good' | 'damaged' | 'lost';
  notes: string;
  returns: ReturnRecord[];
  products: Product[];
  orders: Order[];
  currency: string;
  restockTarget?: 'central' | MarketplaceId;
  activeMarketplaceIds?: string[];
  operator?: string;
  merchantId?: string;
  nowIso?: string;
}): {
  success: boolean;
  message: string;
  returns: ReturnRecord[];
  products: Product[];
  orders: Order[];
  newMovements: StockMovement[];
  newTransactions: Array<Omit<FinancialTransaction, 'id' | 'date'> & { date?: string }>;
} {
  const {
    returnId,
    outcome,
    condition,
    notes,
    returns: rawReturns,
    products: rawProducts,
    orders: rawOrders = [],
    currency,
    restockTarget = 'central',
    activeMarketplaceIds,
    operator = 'مدير العمليات',
    merchantId,
    nowIso = new Date().toISOString(),
  } = params;

  const retIndex = rawReturns.findIndex((r) => r.id === returnId);
  if (retIndex === -1) {
    return {
      success: false,
      message: 'سجل المرتجع غير موجود.',
      returns: rawReturns,
      products: rawProducts,
      orders: rawOrders,
      newMovements: [],
      newTransactions: [],
    };
  }

  const existingRet = rawReturns[retIndex];
  if (existingRet.isCompleted || existingRet.returnStatus === 'closed') {
    return {
      success: false,
      message: 'تم إكمال فحص هذا المرتجع وإغلاقه مسبقاً.',
      returns: rawReturns,
      products: rawProducts,
      orders: rawOrders,
      newMovements: [],
      newTransactions: [],
    };
  }

  if (
    existingRet.returnStatus !== 'received_at_warehouse' &&
    existingRet.returnStatus !== 'under_inspection' &&
    existingRet.returnStatus !== 'inspection_completed'
  ) {
    return {
      success: false,
      message: 'لا يمكن إجراء الفحص الفني قبل تأكيد استلام الطرد فعلياً في المستودع.',
      returns: rawReturns,
      products: rawProducts,
      orders: rawOrders,
      newMovements: [],
      newTransactions: [],
    };
  }

  if (outcome === 'restockable' && existingRet.stockRestored) {
    return {
      success: false,
      message: 'تمت إعادة هذه الوحدات للمخزون مسبقاً ولا يمكن تكرار الإرجاع.',
      returns: rawReturns,
      products: rawProducts,
      orders: rawOrders,
      newMovements: [],
      newTransactions: [],
    };
  }

  // Validate explicit platform restock target: cannot restock into a disabled platform
  const resolvedTarget: 'central' | MarketplaceId =
    restockTarget !== 'central' &&
    activeMarketplaceIds &&
    !activeMarketplaceIds.includes(restockTarget)
      ? 'central'
      : restockTarget;

  const returns = [...rawReturns];
  const ret: ReturnRecord = {
    ...existingRet,
    activities: [...(existingRet.activities || [])],
  };
  const products = rawProducts.map(normalizeProductCustody);
  const orders = [...rawOrders];
  const orderIndex = orders.findIndex((o) => o.id === ret.orderId);
  const order = orderIndex >= 0 ? { ...orders[orderIndex] } : undefined;

  const newMovements: StockMovement[] = [];
  const newTransactions: Array<Omit<FinancialTransaction, 'id' | 'date'> & { date?: string }> = [];

  const resolvedMerchantId = merchantId || ret.merchantId || order?.merchantId;
  const isPostDelivery =
    ret.isPostDeliveryReturn === true || Boolean(order && order.deliveredProcessed === true);

  if (outcome === 'restockable') {
    for (let i = 0; i < ret.items.length; i++) {
      const item = ret.items[i];
      const prodIdx = products.findIndex(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (prodIdx >= 0) {
        let product = products[prodIdx];
        const prevPhysical = product.physicalStock;
        const prevAvail = product.availableStock;

        const nextPhysical =
          isPostDelivery && !ret.physicalRestoredAtReceipt
            ? prevPhysical + item.quantity
            : prevPhysical;

        const nextAllocations = { ...(product.platformAllocations || {}) };
        let nextCentralAvail = product.centralAvailableStock ?? 0;

        if (resolvedTarget !== 'central') {
          const prevAlloc = nextAllocations[resolvedTarget] || {
            marketplaceId: resolvedTarget,
            allocatedQty: 0,
            reservedQty: 0,
            availableQty: 0,
            lastUpdated: nowIso,
          };
          const nextAllocQty = prevAlloc.allocatedQty + item.quantity;
          nextAllocations[resolvedTarget] = {
            ...prevAlloc,
            allocatedQty: nextAllocQty,
            availableQty: Math.max(0, nextAllocQty - prevAlloc.reservedQty),
            lastUpdated: nowIso,
          };
        } else {
          nextCentralAvail += item.quantity;
        }

        product = normalizeProductCustody({
          ...product,
          awaitingInspectionStock: Math.max(
            0,
            (product.awaitingInspectionStock || 0) - item.quantity
          ),
          physicalStock: nextPhysical,
          availableStock: prevAvail + item.quantity,
          centralAvailableStock: nextCentralAvail,
          platformAllocations: nextAllocations,
          updatedAt: nowIso,
        });
        products[prodIdx] = product;

        newMovements.push({
          id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
          merchantId: resolvedMerchantId || product.merchantId,
          productId: product.id,
          productSku: product.sku || product.name,
          productName: product.name,
          marketplaceId: resolvedTarget === 'central' ? ret.marketplaceId : resolvedTarget,
          platformId: resolvedTarget === 'central' ? undefined : resolvedTarget,
          source: 'awaiting_inspection',
          destination: resolvedTarget === 'central' ? 'central_available' : 'platform_allocation',
          type: 'return_restocked',
          quantityChange: item.quantity,
          previousPhysical: prevPhysical,
          newPhysical: product.physicalStock,
          previousAvailable: prevAvail,
          newAvailable: product.availableStock,
          beforeQty: prevAvail,
          afterQty: product.availableStock,
          fromCustody: 'بانتظار الفحص بالمستودع',
          toCustody:
            resolvedTarget === 'central'
              ? 'المخزون المتاح بالمستودع المركزي'
              : `مخزون منصة ${resolvedTarget} المتاح`,
          referenceOrderId: ret.orderId,
          referenceReturnId: ret.id,
          eventKey: `return_restocked|${product.id}|${ret.id}|${i}`,
          reason: `اعتماد المرتجع وإعادته إلى ${resolvedTarget === 'central' ? 'المستودع المركزي' : `منصة ${resolvedTarget}`} بعد الفحص (${condition})`,
          operator,
          timestamp: nowIso,
        });
      }
    }

    ret.returnStatus = 'closed';
    ret.inspectionOutcome = 'restockable';
    ret.stockRestored = true;
    ret.rejectedFromResale = false;
    ret.restockTarget = resolvedTarget;
    ret.isCompleted = true;

    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'inspection_restocked',
      actionAr: `تم اعتماد المنتج كصالح للبيع وإعادته رسمياً إلى (${resolvedTarget === 'central' ? 'المستودع المركزي' : resolvedTarget}) وإغلاق المرتجع`,
      operator,
      notes,
    });
  } else if (outcome === 'damaged') {
    for (let i = 0; i < ret.items.length; i++) {
      const item = ret.items[i];
      const prodIdx = products.findIndex(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (prodIdx >= 0) {
        let product = products[prodIdx];
        const prevPhysical = product.physicalStock;
        const prevAvail = product.availableStock;
        const prevDmg = product.damagedStock || 0;

        product = normalizeProductCustody({
          ...product,
          awaitingInspectionStock: Math.max(
            0,
            (product.awaitingInspectionStock || 0) - item.quantity
          ),
          damagedStock: prevDmg + item.quantity,
          rejectedResaleStock: (product.rejectedResaleStock || prevDmg) + item.quantity,
          physicalStock:
            isPostDelivery && !ret.physicalRestoredAtReceipt
              ? prevPhysical + item.quantity
              : prevPhysical,
          updatedAt: nowIso,
        });
        products[prodIdx] = product;

        newMovements.push({
          id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
          merchantId: resolvedMerchantId || product.merchantId,
          productId: product.id,
          productSku: product.sku || product.name,
          productName: product.name,
          marketplaceId: ret.marketplaceId,
          platformId: ret.marketplaceId,
          source: 'awaiting_inspection',
          destination: 'damaged',
          type: 'return_damaged',
          quantityChange: 0,
          previousPhysical: prevPhysical,
          newPhysical: product.physicalStock,
          previousAvailable: prevAvail,
          newAvailable: product.availableStock,
          beforeQty: prevDmg,
          afterQty: product.damagedStock,
          fromCustody: 'بانتظار الفحص بالمستودع',
          toCustody: 'المخزون التالف بالمستودع (مرفوض من إعادة البيع)',
          referenceOrderId: ret.orderId,
          referenceReturnId: ret.id,
          eventKey: `return_damaged|${product.id}|${ret.id}|${i}`,
          reason: `تسجيل مرتجع تالف (${condition}) - عزل في المخزون التالف دون زيادة المتاح للبيع`,
          operator,
          timestamp: nowIso,
        });

        const { unitCost } = resolveOrderItemUnitCost(item, products);
        if (unitCost !== null && unitCost > 0) {
          newTransactions.push({
            merchantId: resolvedMerchantId || product.merchantId,
            eventRef: `return_damaged|damage_writeoff|${ret.id}|${product.id}|${i}`,
            orderId: ret.orderId,
            returnId: ret.id,
            marketplaceId: ret.marketplaceId,
            type: 'damage_writeoff',
            amount: unitCost * item.quantity,
            currency,
            status: 'confirmed',
            source: 'automatic',
            date: nowIso,
            notes: `خسارة هالك مخزون لمنتج تالف (${product.name}) بسعر التكلفة ${unitCost} ${currency}`,
          });
        }
      }
    }

    ret.returnStatus = 'closed';
    ret.inspectionOutcome = 'damaged';
    ret.stockRestored = false;
    ret.rejectedFromResale = true;
    ret.isCompleted = true;

    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'inspection_damaged',
      actionAr: 'تم تصنيف المرتجع كتالف ومرفوض من إعادة البيع وعزله في المخزون التالف',
      operator,
      notes,
    });
  } else if (outcome === 'missing') {
    for (let i = 0; i < ret.items.length; i++) {
      const item = ret.items[i];
      const prodIdx = products.findIndex(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (prodIdx >= 0) {
        let product = products[prodIdx];
        const prevPhysical = product.physicalStock;
        const nextPhys =
          !isPostDelivery || ret.physicalRestoredAtReceipt
            ? Math.max(0, prevPhysical - item.quantity)
            : prevPhysical;

        product = normalizeProductCustody({
          ...product,
          awaitingInspectionStock: Math.max(
            0,
            (product.awaitingInspectionStock || 0) - item.quantity
          ),
          physicalStock: nextPhys,
          updatedAt: nowIso,
        });
        products[prodIdx] = product;

        newMovements.push({
          id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
          merchantId: resolvedMerchantId || product.merchantId,
          productId: product.id,
          productSku: product.sku || product.name,
          productName: product.name,
          marketplaceId: ret.marketplaceId,
          platformId: ret.marketplaceId,
          source: 'awaiting_inspection',
          destination: 'external',
          type: 'return_missing',
          quantityChange: -item.quantity,
          previousPhysical: prevPhysical,
          newPhysical: product.physicalStock,
          previousAvailable: product.availableStock,
          newAvailable: product.availableStock,
          beforeQty: prevPhysical,
          afterQty: product.physicalStock,
          fromCustody: 'بانتظار الفحص بالمستودع',
          toCustody: 'شطب (طرد مفقود من شركة الشحن)',
          referenceOrderId: ret.orderId,
          referenceReturnId: ret.id,
          eventKey: `return_missing|${product.id}|${ret.id}|${i}`,
          reason: 'شطب طرد مرتجع مفقود أو غير مستلم',
          operator,
          timestamp: nowIso,
        });
      }
    }

    ret.returnStatus = 'closed';
    ret.inspectionOutcome = 'missing';
    ret.stockRestored = false;
    ret.rejectedFromResale = true;
    ret.isCompleted = true;

    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'inspection_missing',
      actionAr: 'تم تسجيل الطرد المرتجع كمفقود وشطبه وإغلاق المرتجع',
      operator,
      notes,
    });
  } else {
    ret.returnStatus = 'under_inspection';
    ret.inspectionOutcome = 'requires_action';
    ret.isCompleted = false;

    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'manual',
      action: 'requires_action',
      actionAr: 'المرتجع يحتاج لإجراء إضافي أو فحص متخصص قبل الإغلاق',
      operator,
      notes,
    });
  }

  // Generate accurate customer_refund transaction for completed post-delivery returns
  // (restockable or damaged). Uses original order item unitPrice snapshots and never duplicates.
  if (
    isPostDelivery &&
    ret.isCompleted &&
    (outcome === 'restockable' || outcome === 'damaged') &&
    !existingRet.refundProcessed
  ) {
    const refundAmount = computeReturnRefundAmount(ret, order, rawReturns);
    ret.refundAmount = refundAmount;
    ret.refundProcessed = true;

    if (refundAmount > 0) {
      const refundedUnits = ret.items.reduce(
        (sum, it) => sum + Math.max(0, Math.floor(Number(it.quantity) || 0)),
        0
      );
      newTransactions.push({
        merchantId: resolvedMerchantId,
        eventRef: `return_inspection|customer_refund|${ret.id}`,
        orderId: ret.orderId,
        returnId: ret.id,
        marketplaceId: ret.marketplaceId,
        type: 'customer_refund',
        amount: refundAmount,
        currency,
        status: 'confirmed',
        source: 'automatic',
        date: nowIso,
        notes: `استرداد قيمة أصناف المرتجع #${ret.id} للعميل (${refundedUnits} قطعة وفق سعر الطلب الأصلي)`,
      });
    }
  }

  ret.physicalCondition = condition;
  ret.inspectionDate = nowIso;
  ret.notes = notes;
  ret.updatedAt = nowIso;
  returns[retIndex] = ret;

  if (ret.isCompleted && order && !order.isClosed) {
    order.isClosed = true;
    order.closedReason = 'return_completed';
    order.closedAt = nowIso;
    order.updatedAt = nowIso;
    orders[orderIndex] = order;
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
    returns,
    products,
    orders,
    newMovements,
    newTransactions,
  };
}

export function registerPostDeliveryReturnPure(params: {
  orderId: string;
  reason: string;
  notes?: string;
  selectedItems?: Array<{ productId: string; productSku?: string; quantity: number }>;
  orders: Order[];
  returns: ReturnRecord[];
  products: Product[];
  currency: string;
  operator?: string;
  merchantId?: string;
  nowIso?: string;
}): {
  success: boolean;
  error?: string;
  returnRecord?: ReturnRecord;
  orders: Order[];
  returns: ReturnRecord[];
  products: Product[];
  newMovements: StockMovement[];
  newTransactions: Array<Omit<FinancialTransaction, 'id' | 'date'> & { date?: string }>;
} {
  const {
    orderId,
    reason,
    notes,
    selectedItems,
    orders: rawOrders,
    returns: rawReturns,
    products: rawProducts,
    currency,
    operator = 'مدير العمليات',
    merchantId,
    nowIso = new Date().toISOString(),
  } = params;

  const orderIndex = rawOrders.findIndex((o) => o.id === orderId);
  if (orderIndex === -1) {
    return {
      success: false,
      error: 'الطلب غير موجود.',
      orders: rawOrders,
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
      newTransactions: [],
    };
  }

  const existingOrder = rawOrders[orderIndex];
  if (existingOrder.status !== 'delivered') {
    return {
      success: false,
      error: 'لا يمكن تسجيل مرتجع ما بعد التسليم إلا للطلبات التي تم تسليمها للعميل.',
      orders: rawOrders,
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
      newTransactions: [],
    };
  }

  const eligibleSummary = getOrderReturnableItems(existingOrder, rawReturns);
  const totalRemaining = eligibleSummary.reduce((sum, e) => sum + e.remainingQty, 0);

  if (totalRemaining <= 0) {
    return {
      success: false,
      error: 'تم إرجاع كامل كميات هذا الطلب مسبقاً ولا توجد وحدات مؤهلة لإرجاع جديد.',
      orders: rawOrders,
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
      newTransactions: [],
    };
  }

  const returnItems: OrderItem[] = [];

  if (selectedItems && selectedItems.length > 0) {
    const requestedByKey = new Map<string, { item: OrderItem; quantity: number }>();
    for (const sel of selectedItems) {
      if (!Number.isFinite(sel.quantity) || !Number.isInteger(sel.quantity) || sel.quantity <= 0) {
        return {
          success: false,
          error: 'يجب أن تكون كمية الإرجاع لكل صنف عدداً صحيحاً موجباً.',
          orders: rawOrders,
          returns: rawReturns,
          products: rawProducts,
          newMovements: [],
          newTransactions: [],
        };
      }

      const match = eligibleSummary.find(
        (e) =>
          e.item.productId === sel.productId ||
          (sel.productSku && e.item.productSku === sel.productSku)
      );
      if (!match) {
        return {
          success: false,
          error: 'تم تحديد صنف لا ينتمي إلى عناصر الطلب الأصلي.',
          orders: rawOrders,
          returns: rawReturns,
          products: rawProducts,
          newMovements: [],
          newTransactions: [],
        };
      }

      const itemKey = `${match.item.productId}|${match.item.productSku || ''}`;
      const prevSelected = requestedByKey.get(itemKey)?.quantity || 0;
      const cumulativeQty = prevSelected + sel.quantity;

      if (cumulativeQty > match.remainingQty) {
        return {
          success: false,
          error: `الكمية المطلوبة لإرجاع (${match.item.productName}) (${cumulativeQty}) تتجاوز الكمية المؤهلة المتبقية (${match.remainingQty}).`,
          orders: rawOrders,
          returns: rawReturns,
          products: rawProducts,
          newMovements: [],
          newTransactions: [],
        };
      }

      requestedByKey.set(itemKey, {
        item: match.item,
        quantity: cumulativeQty,
      });
    }

    for (const entry of requestedByKey.values()) {
      returnItems.push({
        ...entry.item,
        quantity: entry.quantity,
      });
    }
  } else {
    // Full remaining items return (backward-compatible default)
    for (const e of eligibleSummary) {
      if (e.remainingQty > 0) {
        returnItems.push({
          ...e.item,
          quantity: e.remainingQty,
        });
      }
    }
  }

  if (returnItems.length === 0) {
    return {
      success: false,
      error: 'يجب اختيار وحدة واحدة على الأقل للإرجاع.',
      orders: rawOrders,
      returns: rawReturns,
      products: rawProducts,
      newMovements: [],
      newTransactions: [],
    };
  }

  const existingReturnIds = new Set(rawReturns.map((r) => r.id));
  const returnId = generateUniqueId('RET', existingReturnIds, 3);
  const products = rawProducts.map(normalizeProductCustody);
  const newMovements: StockMovement[] = [];

  for (let i = 0; i < returnItems.length; i++) {
    const item = returnItems[i];
    const prodIdx = products.findIndex(
      (prod) => prod.id === item.productId || (item.productSku && prod.sku === item.productSku)
    );
    if (prodIdx >= 0) {
      let product = products[prodIdx];
      const prevRetTransit = product.returnInTransitStock || 0;
      product = normalizeProductCustody({
        ...product,
        returnInTransitStock: prevRetTransit + item.quantity,
        updatedAt: nowIso,
      });
      products[prodIdx] = product;

      newMovements.push({
        id: `mov-${Date.now()}`,
        merchantId: merchantId || existingOrder.merchantId || product.merchantId,
        productId: product.id,
        productSku: product.sku || product.name,
        productName: product.name,
        marketplaceId: existingOrder.marketplaceId,
        platformId: existingOrder.marketplaceId,
        source: 'customer',
        destination: 'return_transit',
        type: 'return_initiated',
        quantityChange: 0,
        previousPhysical: product.physicalStock,
        newPhysical: product.physicalStock,
        previousAvailable: product.availableStock,
        newAvailable: product.availableStock,
        beforeQty: prevRetTransit,
        afterQty: product.returnInTransitStock,
        fromCustody: 'بحوزة العميل (طلب مسلم)',
        toCustody: 'مرتجع في طريق العودة للمستودع',
        referenceOrderId: existingOrder.id,
        referenceReturnId: returnId,
        eventKey: `post_delivery_return|${product.id}|${returnId}|${i}`,
        reason: `فتح طلب مرتجع لاحق بعد التسليم للطلب #${existingOrder.id}`,
        operator,
        timestamp: nowIso,
      });
    }
  }

  const newReturn: ReturnRecord = {
    id: returnId,
    merchantId: merchantId || existingOrder.merchantId,
    orderId: existingOrder.id,
    marketplaceId: existingOrder.marketplaceId,
    items: returnItems,
    returnReason: reason.trim() || 'طلب استرجاع بعد استلام الشحنة من العميل',
    returnStatus: 'in_transit_back',
    physicalCondition: undefined,
    stockRestored: false,
    rejectedFromResale: false,
    isCompleted: false,
    isPostDeliveryReturn: true,
    physicalRestoredAtReceipt: false,
    courierName: existingOrder.courierName || 'شركة الشحن',
    trackingNumber: `RET-${existingOrder.trackingNumber || Math.floor(1000 + Math.random() * 9000)}`,
    returnShippingCost: 15,
    returnCostPayer: 'seller',
    notes: notes?.trim() || 'مرتجع لاحق لطلب مكتمل التسليم - في انتظار الاستلام والفحص بالمستودع.',
    activities: [
      {
        id: `act-${Date.now()}`,
        timestamp: nowIso,
        type: 'system',
        action: 'post_delivery_return_opened',
        actionAr: 'تم فتح طلب إرجاع لطلب تم تسليمه مسبقاً وبدء دورة المرتجع',
        operator,
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const orders = [...rawOrders];
  orders[orderIndex] = {
    ...existingOrder,
    hasPostDeliveryReturn: true,
    updatedAt: nowIso,
  };

  const returns = [newReturn, ...rawReturns];

  const newTransactions: Array<Omit<FinancialTransaction, 'id' | 'date'> & { date?: string }> = [
    {
      merchantId: merchantId || existingOrder.merchantId,
      eventRef: `post_delivery_return|return_shipping|${returnId}`,
      orderId: existingOrder.id,
      returnId,
      marketplaceId: existingOrder.marketplaceId,
      type: 'return_shipping',
      amount: 15,
      currency,
      status: 'pending',
      source: 'automatic',
      date: nowIso,
      notes: `رسوم شحن العودة المقدرة للمرتجع اللاحق #${returnId}`,
    },
  ];

  return {
    success: true,
    returnRecord: newReturn,
    orders,
    returns,
    products,
    newMovements,
    newTransactions,
  };
}

export function addReturnNotePure(params: {
  returnId: string;
  note: string;
  returns: ReturnRecord[];
  operator?: string;
  nowIso?: string;
}): {
  success: boolean;
  error?: string;
  returnRecord?: ReturnRecord;
  returns: ReturnRecord[];
} {
  const {
    returnId,
    note,
    returns: rawReturns,
    operator = 'مدير العمليات',
    nowIso = new Date().toISOString(),
  } = params;

  const trimmed = note.trim();
  if (!trimmed) {
    return { success: false, error: 'الملاحظة مطلوبة.', returns: rawReturns };
  }

  const idx = rawReturns.findIndex((r) => r.id === returnId);
  if (idx === -1) {
    return { success: false, error: 'سجل المرتجع غير موجود.', returns: rawReturns };
  }

  const updated: ReturnRecord = {
    ...rawReturns[idx],
    notes: trimmed,
    updatedAt: nowIso,
    activities: [
      ...(rawReturns[idx].activities || []),
      {
        id: `act-${Date.now()}`,
        timestamp: nowIso,
        type: 'manual',
        action: 'merchant_note',
        actionAr: 'ملاحظة يدوية من التاجر',
        operator,
        notes: trimmed,
      },
    ],
  };

  const nextReturns = [...rawReturns];
  nextReturns[idx] = updated;

  return {
    success: true,
    returnRecord: updated,
    returns: nextReturns,
  };
}
