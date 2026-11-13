/**
 * Pure Smart Order Import custody & deduplication engine.
 * Handles active (preparing / with_delivery), rejected, cancelled, and historical delivered orders
 * while preserving inventory custody invariants and COGS snapshots.
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
  normalizeProductCustody,
} from './inventoryCustody';

export function saveSmartImportOrdersPure(params: {
  ordersToImport: Order[];
  isHistoricalDeducted: boolean;
  existingOrders: Order[];
  products: Product[];
  returns: ReturnRecord[];
  operator?: string;
  nowIso?: string;
}): {
  importedCount: number;
  historicalCount: number;
  duplicateCount: number;
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

  let importedCount = 0;
  let historicalCount = 0;
  let duplicateCount = 0;

  for (const rawOrder of ordersToImport) {
    const key = `${rawOrder.marketplaceId.toLowerCase()}_${rawOrder.id.toLowerCase()}`;
    if (existingKeySet.has(key)) {
      duplicateCount++;
      continue;
    }

    const enrichedItems: OrderItem[] = rawOrder.items.map((item) => {
      const product = products.find(
        (p) => p.id === item.productId || (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
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

    const order: Order = {
      ...rawOrder,
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
        for (const item of order.items) {
          const product = products.find(
            (p) => p.id === item.productId || (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
          );
          if (product) {
            const prevPhysical = product.physicalStock;
            const prevAvail = product.availableStock;
            const deductible = Math.min(prevAvail, Math.max(0, item.quantity));
            product.availableStock = Math.max(0, prevAvail - deductible);
            const floor = getLockedCustodyFloor({
              ...product,
              availableStock: product.availableStock,
            });
            product.physicalStock = Math.max(floor, prevPhysical - deductible);
            product.updatedAt = nowIso;

            if (deductible > 0) {
              newMovements.push({
                id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                productId: product.id,
                productSku: product.sku || product.name,
                productName: product.name,
                marketplaceId: order.marketplaceId,
                type: 'order_delivered',
                quantityChange: -deductible,
                previousPhysical: prevPhysical,
                newPhysical: product.physicalStock,
                previousAvailable: prevAvail,
                newAvailable: product.availableStock,
                referenceOrderId: order.id,
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
      for (const item of order.items) {
        const product = products.find(
          (p) => p.id === item.productId || (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
        );
        if (product) {
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;
          const shortfall = Math.max(0, item.quantity - prevAvail);
          product.availableStock = Math.max(0, prevAvail - item.quantity);
          product.physicalStock = prevPhysical + shortfall;
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
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            fromCustody: 'متاح بالمستودع',
            toCustody: 'خارج المستودع (مع شركة الشحن)',
            referenceOrderId: order.id,
            reason: `استيراد طلب قيد التوصيل #${order.id} (${order.marketplaceId})`,
            operator,
            timestamp: nowIso,
          });
        }
      }
      importedCount++;
    } else if (order.status === 'rejected') {
      for (const item of order.items) {
        const product = products.find(
          (p) => p.id === item.productId || (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
        );
        if (product) {
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;
          const shortfall = Math.max(0, item.quantity - prevAvail);
          product.availableStock = Math.max(0, prevAvail - item.quantity);
          product.physicalStock = prevPhysical + shortfall;
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
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            referenceOrderId: order.id,
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
          orderId: order.id,
          marketplaceId: order.marketplaceId,
          items: order.items,
          returnReason: 'طلب مستورد بحالة مرتجع / مرفوض',
          returnStatus: 'in_transit_back',
          stockRestored: false,
          isCompleted: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      importedCount++;
    } else {
      // 'preparing' -> reserve stock safely
      for (const item of order.items) {
        const product = products.find(
          (p) => p.id === item.productId || (p.sku && p.sku.toLowerCase() === item.productSku.toLowerCase())
        );
        if (product) {
          const prevPhysical = product.physicalStock;
          const prevAvail = product.availableStock;
          const shortfall = Math.max(0, item.quantity - prevAvail);
          product.availableStock = Math.max(0, prevAvail - item.quantity);
          product.physicalStock = prevPhysical + shortfall;
          product.reservedStock = (product.reservedStock || 0) + item.quantity;
          product.updatedAt = nowIso;

          newMovements.push({
            id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: product.id,
            productSku: product.sku || product.name,
            productName: product.name,
            marketplaceId: order.marketplaceId,
            type: 'order_created',
            quantityChange: -item.quantity,
            previousPhysical: prevPhysical,
            newPhysical: product.physicalStock,
            previousAvailable: prevAvail,
            newAvailable: product.availableStock,
            referenceOrderId: order.id,
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
    orders: existingOrders,
    products,
    returns,
    newMovements,
  };
}
