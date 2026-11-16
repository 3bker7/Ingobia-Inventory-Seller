/**
 * Pure Smart Order Import custody & deduplication engine.
 * Handles active (preparing / with_delivery), rejected, cancelled, and historical delivered orders
 * while strictly validating inventory sufficiency (never silently inflating physicalStock)
 * and preserving COGS snapshots.
 */

import {
  Order,
  OrderItem,
  Product,
  ReturnRecord,
  StockMovement,
} from '../types';
import {
  generateUniqueId,
  getLockedCustodyFloor,
  getSellableCapacityForMarketplace,
  normalizeProductCustody,
} from './inventoryCustody';

export interface SmartImportRejectedOrder {
  orderId: string;
  reason: string;
}

export function saveSmartImportOrdersPure(params: {
  ordersToImport: Order[];
  isHistoricalDeducted: boolean;
  existingOrders: Order[];
  products: Product[];
  returns: ReturnRecord[];
  activeMarketplaceIds?: string[];
  merchantId?: string;
  operator?: string;
  nowIso?: string;
}): {
  importedCount: number;
  historicalCount: number;
  duplicateCount: number;
  rejectedCount: number;
  rejectedOrders: SmartImportRejectedOrder[];
  orders: Order[];
  products: Product[];
  returns: ReturnRecord[];
  newMovements: StockMovement[];
} {
  const {
    ordersToImport,
    isHistoricalDeducted,
    existingOrders: rawOrders,
    products: rawProducts,
    returns: rawReturns,
    activeMarketplaceIds,
    merchantId,
    operator = 'مدير العمليات',
    nowIso = new Date().toISOString(),
  } = params;

  const existingOrders = [...rawOrders];
  const existingKeySet = new Set(
    existingOrders.map((o) => `${o.marketplaceId.toLowerCase()}_${o.id.toLowerCase()}`)
  );
  const products = rawProducts.map(normalizeProductCustody);
  const returns = [...rawReturns];
  const existingReturnIds = new Set(returns.map((r) => r.id));
  const newMovements: StockMovement[] = [];
  const rejectedOrders: SmartImportRejectedOrder[] = [];

  let importedCount = 0;
  let historicalCount = 0;
  let duplicateCount = 0;

  for (const rawOrder of ordersToImport) {
    const key = `${rawOrder.marketplaceId.toLowerCase()}_${rawOrder.id.toLowerCase()}`;
    if (existingKeySet.has(key)) {
      duplicateCount++;
      continue;
    }

    if (activeMarketplaceIds && !activeMarketplaceIds.includes(rawOrder.marketplaceId)) {
      rejectedOrders.push({
        orderId: rawOrder.id,
        reason: `المنصة (${rawOrder.marketplaceId}) غير مفعلة في حساب التاجر الحالي.`,
      });
      continue;
    }

    const enrichedItems: OrderItem[] = rawOrder.items.map((item) => {
      const product = products.find(
        (p) =>
          p.id === item.productId ||
          (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
      );
      return {
        ...item,
        unitCostSnapshot:
          typeof item.unitCostSnapshot === 'number' && item.unitCostSnapshot > 0
            ? item.unitCostSnapshot
            : product && typeof product.baseCost === 'number' && product.baseCost > 0
            ? product.baseCost
            : undefined,
      };
    });

    const isActiveOrReturn =
      rawOrder.status === 'preparing' ||
      rawOrder.status === 'with_delivery' ||
      rawOrder.status === 'rejected';

    // Never silently invent physicalStock on active/return orders; reject shortfalls cleanly
    if (isActiveOrReturn) {
      const requiredByProd = new Map<string, number>();
      let missingProdReason: string | null = null;
      for (const item of enrichedItems) {
        const product = products.find(
          (p) =>
            p.id === item.productId ||
            (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
        );
        if (!product) {
          missingProdReason = `المنتج (${item.productSku || item.productName}) غير مسجل في الكتالوج.`;
          break;
        }
        requiredByProd.set(product.id, (requiredByProd.get(product.id) || 0) + item.quantity);
      }

      if (missingProdReason) {
        rejectedOrders.push({ orderId: rawOrder.id, reason: missingProdReason });
        continue;
      }

      let shortfallReason: string | null = null;
      for (const [prodId, reqQty] of requiredByProd.entries()) {
        const product = products.find((p) => p.id === prodId)!;
        const cap = getSellableCapacityForMarketplace(product, rawOrder.marketplaceId);
        if (cap.sellable < reqQty) {
          shortfallReason =
            cap.source === 'platform'
              ? `الرصيد المخصص لمنصة (${rawOrder.marketplaceId}) للمنتج (${product.name}) غير كافٍ (المتاح: ${cap.sellable}، المطلوب: ${reqQty}).`
              : `المخزون المتاح للمنتج (${product.name}) غير كافٍ (المتاح: ${cap.sellable}، المطلوب: ${reqQty}).`;
          break;
        }
      }

      if (shortfallReason) {
        rejectedOrders.push({ orderId: rawOrder.id, reason: shortfallReason });
        continue;
      }
    }

    const order: Order = {
      ...rawOrder,
      merchantId: merchantId || rawOrder.merchantId,
      items: enrichedItems,
      updatedAt: nowIso,
    };

    if (order.status === 'cancelled') {
      order.isClosed = true;
      order.closedReason = 'cancelled';
      order.closedAt = order.closedAt || nowIso;
      order.deliveredProcessed = false;
      historicalCount++;
    } else if (order.status === 'delivered' || order.isClosed) {
      order.status = 'delivered';
      order.isClosed = true;
      order.deliveredProcessed = true;
      order.closedReason = 'delivered';
      order.closedAt = order.closedAt || order.deliveredDate || nowIso;

      if (isHistoricalDeducted) {
        for (let i = 0; i < order.items.length; i++) {
          const item = order.items[i];
          const prodIdx = products.findIndex(
            (p) =>
              p.id === item.productId ||
              (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
          );
          if (prodIdx >= 0) {
            let product = products[prodIdx];
            const prevPhysical = product.physicalStock;
            const prevAvail = product.availableStock;
            const cap = getSellableCapacityForMarketplace(product, order.marketplaceId);
            const deductible = Math.min(cap.sellable, Math.max(0, item.quantity));

            const nextAllocations = { ...(product.platformAllocations || {}) };
            if (cap.source === 'platform' && nextAllocations[order.marketplaceId] && deductible > 0) {
              const alloc = nextAllocations[order.marketplaceId];
              const nextAllocQty = Math.max(alloc.reservedQty, alloc.allocatedQty - deductible);
              nextAllocations[order.marketplaceId] = {
                ...alloc,
                allocatedQty: nextAllocQty,
                availableQty: Math.max(0, nextAllocQty - alloc.reservedQty),
                lastUpdated: nowIso,
              };
            }

            const nextAvail = Math.max(0, prevAvail - deductible);
            const floor = getLockedCustodyFloor({
              ...product,
              availableStock: nextAvail,
            });
            product = normalizeProductCustody({
              ...product,
              availableStock: nextAvail,
              physicalStock: Math.max(floor, prevPhysical - deductible),
              platformAllocations: nextAllocations,
              updatedAt: nowIso,
            });
            products[prodIdx] = product;

            if (deductible > 0) {
              newMovements.push({
                id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
                merchantId: order.merchantId || product.merchantId,
                productId: product.id,
                productSku: product.sku || product.name,
                productName: product.name,
                marketplaceId: order.marketplaceId,
                platformId: order.marketplaceId,
                source: cap.source === 'platform' ? 'platform_allocation' : 'central_available',
                destination: 'customer',
                type: 'order_delivered',
                quantityChange: -deductible,
                previousPhysical: prevPhysical,
                newPhysical: product.physicalStock,
                previousAvailable: prevAvail,
                newAvailable: product.availableStock,
                referenceOrderId: order.id,
                eventKey: `smart_delivered|${product.id}|${order.id}|${i}`,
                reason: `تسجيل تسليم سابق لطلب تاريخي #${order.id} عبر الاستيراد الذكي`,
                operator,
                timestamp: nowIso,
              });
            }
          }
        }
      }
      historicalCount++;
    } else if (order.status === 'with_delivery') {
      for (let i = 0; i < order.items.length; i++) {
        const item = order.items[i];
        const prodIdx = products.findIndex(
          (p) =>
            p.id === item.productId ||
            (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
        );
        if (prodIdx >= 0) {
          let product = products[prodIdx];
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;
          const cap = getSellableCapacityForMarketplace(product, order.marketplaceId);
          const nextAllocations = { ...(product.platformAllocations || {}) };

          if (cap.source === 'platform' && nextAllocations[order.marketplaceId]) {
            const alloc = nextAllocations[order.marketplaceId];
            const nextAllocQty = Math.max(alloc.reservedQty, alloc.allocatedQty - item.quantity);
            nextAllocations[order.marketplaceId] = {
              ...alloc,
              allocatedQty: nextAllocQty,
              availableQty: Math.max(0, nextAllocQty - alloc.reservedQty),
              lastUpdated: nowIso,
            };
          }

          item.reservationSource = cap.source;
          product = normalizeProductCustody({
            ...product,
            availableStock: Math.max(0, prevAvail - item.quantity),
            outboundInTransitStock: (product.outboundInTransitStock || 0) + item.quantity,
            platformAllocations: nextAllocations,
            updatedAt: nowIso,
          });
          products[prodIdx] = product;

          newMovements.push({
            id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
            merchantId: order.merchantId || product.merchantId,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            platformId: order.marketplaceId,
            source: cap.source === 'platform' ? 'platform_allocation' : 'central_available',
            destination: 'outbound_transit',
            type: 'handover_to_courier',
            quantityChange: -item.quantity,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'متاح بالمستودع',
            toCustody: 'خارج المستودع (مع شركة الشحن)',
            referenceOrderId: order.id,
            eventKey: `smart_with_delivery|${product.id}|${order.id}|${i}`,
            reason: `استيراد طلب قيد التوصيل #${order.id} (${order.marketplaceId})`,
            operator,
            timestamp: nowIso,
          });
        }
      }
      importedCount++;
    } else if (order.status === 'rejected') {
      for (let i = 0; i < order.items.length; i++) {
        const item = order.items[i];
        const prodIdx = products.findIndex(
          (p) =>
            p.id === item.productId ||
            (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
        );
        if (prodIdx >= 0) {
          let product = products[prodIdx];
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;
          const cap = getSellableCapacityForMarketplace(product, order.marketplaceId);
          const nextAllocations = { ...(product.platformAllocations || {}) };

          if (cap.source === 'platform' && nextAllocations[order.marketplaceId]) {
            const alloc = nextAllocations[order.marketplaceId];
            const nextAllocQty = Math.max(alloc.reservedQty, alloc.allocatedQty - item.quantity);
            nextAllocations[order.marketplaceId] = {
              ...alloc,
              allocatedQty: nextAllocQty,
              availableQty: Math.max(0, nextAllocQty - alloc.reservedQty),
              lastUpdated: nowIso,
            };
          }

          item.reservationSource = cap.source;
          product = normalizeProductCustody({
            ...product,
            availableStock: Math.max(0, prevAvail - item.quantity),
            returnInTransitStock: (product.returnInTransitStock || 0) + item.quantity,
            platformAllocations: nextAllocations,
            updatedAt: nowIso,
          });
          products[prodIdx] = product;

          newMovements.push({
            id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
            merchantId: order.merchantId || product.merchantId,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            platformId: order.marketplaceId,
            source: cap.source === 'platform' ? 'platform_allocation' : 'central_available',
            destination: 'return_transit',
            type: 'return_initiated',
            quantityChange: 0,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            referenceOrderId: order.id,
            eventKey: `smart_rejected|${product.id}|${order.id}|${i}`,
            reason: `استيراد طلب مرفوض #${order.id} ونقله لمسار المرتجعات`,
            operator,
            timestamp: nowIso,
          });
        }
      }

      if (!returns.some((r) => r.orderId === order.id)) {
        const retId = generateUniqueId('RET', existingReturnIds, 3);
        existingReturnIds.add(retId);
        returns.unshift({
          id: retId,
          merchantId: order.merchantId,
          orderId: order.id,
          marketplaceId: order.marketplaceId,
          items: order.items,
          returnReason: 'طلب مستورد بحالة مرتجع / مرفوض',
          returnStatus: 'in_transit_back',
          stockRestored: false,
          rejectedFromResale: false,
          isCompleted: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      importedCount++;
    } else {
      // 'preparing' -> reserve stock safely from platform allocation or central available
      for (let i = 0; i < order.items.length; i++) {
        const item = order.items[i];
        const prodIdx = products.findIndex(
          (p) =>
            p.id === item.productId ||
            (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
        );
        if (prodIdx >= 0) {
          let product = products[prodIdx];
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;
          const cap = getSellableCapacityForMarketplace(product, order.marketplaceId);
          const nextAllocations = { ...(product.platformAllocations || {}) };
          let nextCentralReserved = product.centralReservedStock ?? 0;

          if (cap.source === 'platform' && nextAllocations[order.marketplaceId]) {
            const alloc = nextAllocations[order.marketplaceId];
            const nextRes = alloc.reservedQty + item.quantity;
            nextAllocations[order.marketplaceId] = {
              ...alloc,
              reservedQty: nextRes,
              availableQty: Math.max(0, alloc.allocatedQty - nextRes),
              lastUpdated: nowIso,
            };
          } else {
            nextCentralReserved += item.quantity;
          }

          item.reservationSource = cap.source;
          product = normalizeProductCustody({
            ...product,
            availableStock: Math.max(0, prevAvail - item.quantity),
            reservedStock: product.reservedStock + item.quantity,
            centralReservedStock: nextCentralReserved,
            platformAllocations: nextAllocations,
            updatedAt: nowIso,
          });
          products[prodIdx] = product;

          newMovements.push({
            id: `mov-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
            merchantId: order.merchantId || product.merchantId,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            platformId: order.marketplaceId,
            source: cap.source === 'platform' ? 'platform_allocation' : 'central_available',
            destination: 'reserved',
            type: 'order_created',
            quantityChange: -item.quantity,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            referenceOrderId: order.id,
            eventKey: `smart_preparing|${product.id}|${order.id}|${i}`,
            reason: `حجز مخزون عبر الاستيراد الذكي للطلب #${order.id} (${order.marketplaceId})`,
            operator,
            timestamp: nowIso,
          });
        }
      }
      importedCount++;
    }

    existingOrders.unshift(order);
    existingKeySet.add(key);
  }

  return {
    importedCount,
    historicalCount,
    duplicateCount,
    rejectedCount: rejectedOrders.length,
    rejectedOrders,
    orders: existingOrders,
    products,
    returns,
    newMovements,
  };
}
