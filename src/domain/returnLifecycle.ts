/**
 * Pure Return & Technical Inspection State Machine.
 * Enforces strict custody isolation across return stages, blocks stage skipping/reversals,
 * and handles both pre-delivery and post-delivery returns consistently.
 */

import {
  FinancialTransaction,
  InspectionOutcome,
  Order,
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

export function advanceReturnStatusPure(params: {
  returnId: string;
  targetStatus: ReturnStatus;
  returns: ReturnRecord[];
  products: Product[];
  orders: Order[];
  operator?: string;
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
    for (const item of ret.items) {
      const product = products.find(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (product) {
        const prevAvail = product.availableStock;
        const prevPhys = product.physicalStock;

        product.returnInTransitStock = Math.max(0, (product.returnInTransitStock || 0) - item.quantity);
        product.awaitingInspectionStock = (product.awaitingInspectionStock || 0) + item.quantity;

        // Post-delivery items had previously left physicalStock on delivery; restore warehouse physical count on dock receipt.
        if (isPostDelivery && !ret.physicalRestoredAtReceipt) {
          product.physicalStock += item.quantity;
        }

        product.updatedAt = nowIso;

        newMovements.push({
          id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          productId: product.id,
          productSku: product.sku || product.name,
          productName: product.name,
          marketplaceId: ret.marketplaceId,
          type: 'return_received_warehouse',
          quantityChange: isPostDelivery && !ret.physicalRestoredAtReceipt ? item.quantity : 0,
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
  operator?: string;
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
    operator = 'مدير العمليات',
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

  // Must have physically arrived at warehouse before technical inspection
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

  const isPostDelivery =
    ret.isPostDeliveryReturn === true || Boolean(order && order.deliveredProcessed === true);

  if (outcome === 'restockable') {
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

        // Only add physicalStock if not already added at dock receipt
        if (isPostDelivery && !ret.physicalRestoredAtReceipt) {
          product.physicalStock += item.quantity;
        }
        product.availableStock += item.quantity;
        product.updatedAt = nowIso;

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
          timestamp: nowIso,
        });
      }
    }

    ret.returnStatus = 'closed';
    ret.inspectionOutcome = 'restockable';
    ret.stockRestored = true;
    ret.isCompleted = true;

    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
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

        if (isPostDelivery && !ret.physicalRestoredAtReceipt) {
          product.physicalStock += item.quantity;
        }
        // Available stock NEVER increases on damaged outcome
        product.updatedAt = nowIso;

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
          timestamp: nowIso,
        });

        const { unitCost } = resolveOrderItemUnitCost(item, products);
        if (unitCost !== null && unitCost > 0) {
          newTransactions.push({
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
    ret.isCompleted = true;

    ret.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
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
        const prevPhysical = product.physicalStock;
        product.awaitingInspectionStock = Math.max(
          0,
          (product.awaitingInspectionStock || 0) - item.quantity
        );
        if (!isPostDelivery || ret.physicalRestoredAtReceipt) {
          product.physicalStock = Math.max(0, product.physicalStock - item.quantity);
        }
        product.updatedAt = nowIso;

        newMovements.push({
          id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          productId: product.id,
          productSku: product.sku || product.name,
          productName: product.name,
          marketplaceId: ret.marketplaceId,
          type: 'return_missing',
          quantityChange: -item.quantity,
          previousPhysical: prevPhysical,
          newPhysical: product.physicalStock,
          previousAvailable: product.availableStock,
          newAvailable: product.availableStock,
          fromCustody: 'بانتظار الفحص بالمستودع',
          toCustody: 'شطب (طرد مفقود من شركة الشحن)',
          referenceOrderId: ret.orderId,
          referenceReturnId: ret.id,
          reason: 'شطب طرد مرتجع مفقود أو غير مستلم',
          operator,
          timestamp: nowIso,
        });
      }
    }

    ret.returnStatus = 'closed';
    ret.inspectionOutcome = 'missing';
    ret.stockRestored = false;
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
  orders: Order[];
  returns: ReturnRecord[];
  products: Product[];
  currency: string;
  operator?: string;
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
    orders: rawOrders,
    returns: rawReturns,
    products: rawProducts,
    currency,
    operator = 'مدير العمليات',
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

  if (existingOrder.hasPostDeliveryReturn || rawReturns.some((r) => r.orderId === orderId)) {
    return {
      success: false,
      error: 'يوجد سجل مرتجع مسجل مسبقاً لهذا الطلب.',
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

  for (const item of existingOrder.items) {
    const product = products.find(
      (prod) => prod.id === item.productId || prod.sku === item.productSku
    );
    if (product) {
      product.returnInTransitStock = (product.returnInTransitStock || 0) + item.quantity;
      product.updatedAt = nowIso;

      newMovements.push({
        id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        productId: product.id,
        productSku: product.sku || product.name,
        productName: product.name,
        marketplaceId: existingOrder.marketplaceId,
        type: 'return_initiated',
        quantityChange: 0,
        previousPhysical: product.physicalStock,
        newPhysical: product.physicalStock,
        previousAvailable: product.availableStock,
        newAvailable: product.availableStock,
        fromCustody: 'بحوزة العميل (طلب مسلم)',
        toCustody: 'مرتجع في طريق العودة للمستودع',
        referenceOrderId: existingOrder.id,
        referenceReturnId: returnId,
        reason: `فتح طلب مرتجع لاحق بعد التسليم للطلب #${existingOrder.id}`,
        operator,
        timestamp: nowIso,
      });
    }
  }

  const newReturn: ReturnRecord = {
    id: returnId,
    orderId: existingOrder.id,
    marketplaceId: existingOrder.marketplaceId,
    items: existingOrder.items,
    returnReason: reason.trim() || 'طلب استرجاع بعد استلام الشحنة من العميل',
    returnStatus: 'in_transit_back',
    physicalCondition: undefined,
    stockRestored: false,
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
