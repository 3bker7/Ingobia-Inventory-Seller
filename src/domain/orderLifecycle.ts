/**
 * Pure Order Lifecycle State Machine and Stock Reservation Engine.
 * Enforces allowed transitions, aggregated per-product stock checks,
 * COGS snapshotting at creation, and idempotent closure rules.
 */

import {
  FinancialTransaction,
  Order,
  OrderItem,
  OrderStatus,
  Product,
  ReturnRecord,
  ShipmentRecord,
  StockMovement,
} from '../types';
import { generateUniqueId, normalizeProductCustody } from './inventoryCustody';

export const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  preparing: ['with_delivery', 'cancelled'],
  with_delivery: ['delivered', 'rejected'],
  delivered: [],
  rejected: [],
  cancelled: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return ALLOWED_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function createOrderPure(params: {
  orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'stockDeducted' | 'isClosed'>;
  products: Product[];
  existingOrders: Order[];
  customId?: string;
  operator?: string;
  nowIso?: string;
}): {
  success: boolean;
  error?: string;
  order?: Order;
  products: Product[];
  orders: Order[];
  movements: StockMovement[];
} {
  const {
    orderData,
    products: rawProducts,
    existingOrders,
    customId,
    operator = 'مدير العمليات',
    nowIso = new Date().toISOString(),
  } = params;

  if (!orderData.items || orderData.items.length === 0) {
    return {
      success: false,
      error: 'يجب إضافة منتج واحد على الأقل للطلب.',
      products: rawProducts,
      orders: existingOrders,
      movements: [],
    };
  }

  const products = rawProducts.map(normalizeProductCustody);
  const aggregatedQtyByProductId = new Map<string, number>();
  const resolvedProductByItemIdx = new Map<number, Product>();

  // 1. Validate line items & aggregate requested quantities per product
  for (let i = 0; i < orderData.items.length; i++) {
    const item = orderData.items[i];
    if (!Number.isFinite(item.quantity) || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return {
        success: false,
        error: `كمية المنتج (${item.productName || item.productSku}) يجب أن تكون عدداً صحيحاً أكبر من صفر.`,
        products: rawProducts,
        orders: existingOrders,
        movements: [],
      };
    }

    const product = products.find(
      (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
    );
    if (!product) {
      return {
        success: false,
        error: `المنتج (${item.productName || item.productSku}) غير موجود في النظام.`,
        products: rawProducts,
        orders: existingOrders,
        movements: [],
      };
    }

    resolvedProductByItemIdx.set(i, product);
    aggregatedQtyByProductId.set(
      product.id,
      (aggregatedQtyByProductId.get(product.id) || 0) + item.quantity
    );
  }

  // Verify aggregated total demand per product against available stock
  for (const [productId, totalQty] of aggregatedQtyByProductId.entries()) {
    const product = products.find((p) => p.id === productId)!;
    if (product.availableStock < totalQty) {
      return {
        success: false,
        error: `الكمية المطلوبة للمنتج (${product.name}) (${totalQty}) تتجاوز المخزون المتاح حالياً (${product.availableStock} قطعة متاحة).`,
        products: rawProducts,
        orders: existingOrders,
        movements: [],
      };
    }
  }

  const existingOrderIds = new Set(existingOrders.map((o) => o.id));
  const orderId =
    customId && customId.trim()
      ? customId.trim()
      : generateUniqueId('ORD', existingOrderIds, 4);

  if (existingOrderIds.has(orderId)) {
    return {
      success: false,
      error: `رقم الطلب ${orderId} مسجل مسبقاً في النظام.`,
      products: rawProducts,
      orders: existingOrders,
      movements: [],
    };
  }

  const newMovements: StockMovement[] = [];
  const snapshotItems: OrderItem[] = [];

  // 2. Perform stock deductions, reservations, and COGS snapshots
  for (let i = 0; i < orderData.items.length; i++) {
    const item = orderData.items[i];
    const product = resolvedProductByItemIdx.get(i)!;
    const prevAvailable = product.availableStock;
    const prevPhysical = product.physicalStock;

    product.availableStock = Math.max(0, product.availableStock - item.quantity);
    product.reservedStock += item.quantity;

    if (product.marketplaceListings[orderData.marketplaceId]) {
      const listing = product.marketplaceListings[orderData.marketplaceId];
      const nextListingQty = Math.max(0, listing.quantity - item.quantity);
      product.marketplaceListings[orderData.marketplaceId] = {
        ...listing,
        quantity: nextListingQty,
        listingStatus: nextListingQty > 0 ? 'active' : 'out_of_stock',
        lastUpdated: nowIso,
      };
    }

    product.updatedAt = nowIso;

    snapshotItems.push({
      ...item,
      unitCostSnapshot:
        typeof item.unitCostSnapshot === 'number' && item.unitCostSnapshot > 0
          ? item.unitCostSnapshot
          : typeof product.baseCost === 'number' && product.baseCost > 0
          ? product.baseCost
          : undefined,
    });

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
      timestamp: nowIso,
    });
  }

  const newOrder: Order = {
    ...orderData,
    id: orderId,
    items: snapshotItems,
    status: 'preparing',
    stockDeducted: true,
    deliveredProcessed: false,
    isClosed: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    success: true,
    order: newOrder,
    products,
    orders: [newOrder, ...existingOrders],
    movements: newMovements,
  };
}

export function updateOrderStatusPure(params: {
  orderId: string;
  newStatus: OrderStatus;
  orders: Order[];
  products: Product[];
  returns: ReturnRecord[];
  currency: string;
  operator?: string;
  shipmentDetails?: Partial<ShipmentRecord>;
  nowIso?: string;
}): {
  success: boolean;
  error?: string;
  orders: Order[];
  products: Product[];
  returns: ReturnRecord[];
  newMovements: StockMovement[];
  newTransactions: Array<Omit<FinancialTransaction, 'id' | 'date'> & { date?: string }>;
} {
  const {
    orderId,
    newStatus,
    orders: rawOrders,
    products: rawProducts,
    returns: rawReturns,
    currency,
    operator = 'مدير العمليات',
    shipmentDetails,
    nowIso = new Date().toISOString(),
  } = params;

  const orderIndex = rawOrders.findIndex((o) => o.id === orderId);
  if (orderIndex < 0) {
    return {
      success: false,
      error: 'الطلب غير موجود.',
      orders: rawOrders,
      products: rawProducts,
      returns: rawReturns,
      newMovements: [],
      newTransactions: [],
    };
  }

  const existingOrder = rawOrders[orderIndex];
  const prevStatus = existingOrder.status;

  if (prevStatus === newStatus) {
    return {
      success: true,
      orders: rawOrders,
      products: rawProducts,
      returns: rawReturns,
      newMovements: [],
      newTransactions: [],
    };
  }

  if (existingOrder.isClosed) {
    return {
      success: false,
      error: 'هذا الطلب مغلق ومكتمل مسبقاً، لا يمكن تعديل حالته.',
      orders: rawOrders,
      products: rawProducts,
      returns: rawReturns,
      newMovements: [],
      newTransactions: [],
    };
  }

  if (!isValidOrderTransition(prevStatus, newStatus)) {
    return {
      success: false,
      error: `انتقال غير مسموح به من حالة (${prevStatus}) إلى (${newStatus}).`,
      orders: rawOrders,
      products: rawProducts,
      returns: rawReturns,
      newMovements: [],
      newTransactions: [],
    };
  }

  const orders = [...rawOrders];
  const order: Order = {
    ...existingOrder,
    items: existingOrder.items.map((it) => ({ ...it })),
    activities: [...(existingOrder.activities || [])],
  };
  const products = rawProducts.map(normalizeProductCustody);
  const returns = [...rawReturns];
  const newMovements: StockMovement[] = [];
  const newTransactions: Array<Omit<FinancialTransaction, 'id' | 'date'> & { date?: string }> = [];

  if (newStatus === 'with_delivery') {
    for (const item of order.items) {
      const product = products.find(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (product) {
        const prevAvail = product.availableStock;
        const prevPhys = product.physicalStock;

        product.reservedStock = Math.max(0, product.reservedStock - item.quantity);
        product.outboundInTransitStock = (product.outboundInTransitStock || 0) + item.quantity;
        product.updatedAt = nowIso;

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
          timestamp: nowIso,
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

    order.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'handover_to_courier',
      actionAr: 'تم تسليم الشحنة لشركة التوصيل ونقل الحيازة خارج المستودع',
      operator,
      previousState: prevStatus,
      newState: newStatus,
      notes: `رقم التتبع: ${order.trackingNumber || 'غير محدد'}`,
    });
  } else if (newStatus === 'delivered' && !order.deliveredProcessed) {
    for (const item of order.items) {
      const product = products.find(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (product) {
        const prevPhysical = product.physicalStock;
        const prevAvail = product.availableStock;

        if ((product.outboundInTransitStock || 0) >= item.quantity) {
          product.outboundInTransitStock = Math.max(0, (product.outboundInTransitStock || 0) - item.quantity);
        } else {
          product.reservedStock = Math.max(0, product.reservedStock - item.quantity);
        }

        product.physicalStock = Math.max(0, product.physicalStock - item.quantity);
        product.updatedAt = nowIso;

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
          timestamp: nowIso,
        });
      }
    }

    order.deliveredDate = nowIso;
    order.deliveredProcessed = true;
    order.isClosed = true;
    order.closedReason = 'delivered';
    order.closedAt = nowIso;

    newTransactions.push({
      orderId: order.id,
      marketplaceId: order.marketplaceId,
      type: 'sale_revenue',
      amount: order.totalAmount,
      currency,
      status: 'confirmed',
      source: 'automatic',
      date: nowIso,
      notes: `إيراد بيع مؤكد للطلب المكتمل #${order.id}`,
    });

    if (order.shippingCost && order.shippingCost > 0) {
      newTransactions.push({
        orderId: order.id,
        marketplaceId: order.marketplaceId,
        type: 'courier_shipping',
        amount: order.shippingCost,
        currency,
        status: 'confirmed',
        source: 'automatic',
        date: nowIso,
        notes: `رسوم شحن لشركة التوصيل للطلب #${order.id}`,
      });
    }

    if (order.marketplaceCommission && order.marketplaceCommission > 0) {
      newTransactions.push({
        orderId: order.id,
        marketplaceId: order.marketplaceId,
        type: 'marketplace_commission',
        amount: order.marketplaceCommission,
        currency,
        status: 'confirmed',
        source: 'automatic',
        date: nowIso,
        notes: `عمولة منصة مسجلة للطلب #${order.id}`,
      });
    }

    order.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'delivered',
      actionAr: 'تم تأكيد التوصيل الناجح للعميل وإغلاق الطلب وتسجيل الإيراد',
      operator,
      previousState: prevStatus,
      newState: newStatus,
    });
  } else if (newStatus === 'cancelled') {
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
          const listing = product.marketplaceListings[order.marketplaceId];
          const nextQty = listing.quantity + item.quantity;
          product.marketplaceListings[order.marketplaceId] = {
            ...listing,
            quantity: nextQty,
            listingStatus: nextQty > 0 ? 'active' : listing.listingStatus,
            lastUpdated: nowIso,
          };
        }

        product.updatedAt = nowIso;

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
          timestamp: nowIso,
        });
      }
    }

    order.isClosed = true;
    order.closedReason = 'cancelled';
    order.closedAt = nowIso;

    order.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'cancelled',
      actionAr: 'تم إلغاء الطلب وإرجاع الكمية المحجوزة للمخزون المتاح للبيع',
      operator,
      previousState: prevStatus,
      newState: newStatus,
    });
  } else if (newStatus === 'rejected') {
    for (const item of order.items) {
      const product = products.find(
        (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
      );
      if (product) {
        if ((product.outboundInTransitStock || 0) >= item.quantity) {
          product.outboundInTransitStock = Math.max(0, (product.outboundInTransitStock || 0) - item.quantity);
        } else {
          product.reservedStock = Math.max(0, product.reservedStock - item.quantity);
        }
        product.returnInTransitStock = (product.returnInTransitStock || 0) + item.quantity;
        product.updatedAt = nowIso;

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
          timestamp: nowIso,
        });
      }
    }

    const existingReturn = returns.find((r) => r.orderId === order.id);
    if (!existingReturn) {
      const existingReturnIds = new Set(returns.map((r) => r.id));
      const returnId = generateUniqueId('RET', existingReturnIds, 3);
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
            timestamp: nowIso,
            type: 'system',
            action: 'return_initiated',
            actionAr: 'تم فتح ملف مرتجع ونقل الحيازة إلى: مرتجع في طريق العودة',
            operator,
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      returns.unshift(newReturn);

      newTransactions.push({
        orderId: order.id,
        returnId,
        marketplaceId: order.marketplaceId,
        type: 'return_shipping',
        amount: 15,
        currency,
        status: 'pending',
        source: 'automatic',
        date: nowIso,
        notes: `رسوم شحن العودة المقدرة للمرتجع #${returnId}`,
      });
    }

    order.activities!.push({
      id: `act-${Date.now()}`,
      timestamp: nowIso,
      type: 'system',
      action: 'rejected',
      actionAr: 'تم رفض الاستلام من العميل وفتح سجل مرتجع في طريق العودة',
      operator,
      previousState: prevStatus,
      newState: newStatus,
    });
  }

  order.status = newStatus;
  order.updatedAt = nowIso;
  orders[orderIndex] = order;

  return {
    success: true,
    orders,
    products,
    returns,
    newMovements,
    newTransactions,
  };
}
