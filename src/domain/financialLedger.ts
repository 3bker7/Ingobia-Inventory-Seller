/**
 * Pure financial breakdown and accounting ledger helpers.
 * Strictly separates:
 * - Confirmed Net Profit vs Recorded-Cost Margin vs Estimated Net Profit
 * - Confirmed vs Pending vs Cancelled financial ledger transactions
 * - Historical COGS snapshots from mutable catalog baseCost edits
 */

import {
  FinancialTransaction,
  MarketplaceId,
  Order,
  OrderFinancialBreakdown,
  OrderItem,
  Product,
  ReturnRecord,
} from '../types';

/** Documented heuristic rate used ONLY for informational estimates when marketplace commission is unrecorded. */
export const ESTIMATED_MARKETPLACE_COMMISSION_RATE = 0.12;

export function resolveOrderItemUnitCost(
  item: OrderItem,
  products: Product[]
): { unitCost: number | null; source: 'snapshot' | 'catalog' | 'missing' } {
  if (
    typeof item.unitCostSnapshot === 'number' &&
    Number.isFinite(item.unitCostSnapshot) &&
    item.unitCostSnapshot > 0
  ) {
    return { unitCost: item.unitCostSnapshot, source: 'snapshot' };
  }

  const product = products.find(
    (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
  );
  if (
    product &&
    typeof product.baseCost === 'number' &&
    Number.isFinite(product.baseCost) &&
    product.baseCost > 0
  ) {
    return { unitCost: product.baseCost, source: 'catalog' };
  }

  return { unitCost: null, source: 'missing' };
}

function isReturnRecordCompleted(ret: ReturnRecord): boolean {
  return Boolean(
    ret.isCompleted ||
      ret.returnStatus === 'closed' ||
      ret.returnStatus === 'inspection_completed' ||
      ret.returnStatus === 'restocked' ||
      ret.returnStatus === 'damaged'
  );
}

function deduplicateTransactionsList(
  transactions: FinancialTransaction[]
): FinancialTransaction[] {
  const seenIds = new Set<string>();
  const seenEventRefs = new Set<string>();
  const seenAutoSignatures = new Set<string>();
  const dedupedTx: FinancialTransaction[] = [];

  for (const tx of transactions) {
    if (tx.id && seenIds.has(tx.id)) continue;
    if (tx.eventRef) {
      const refSig = `ref|${tx.eventRef}|${tx.status === 'cancelled' ? 'cancelled' : 'active'}`;
      if (seenEventRefs.has(refSig)) continue;
      seenEventRefs.add(refSig);
    } else if (tx.source === 'automatic' && tx.type !== 'adjustment') {
      const signature =
        tx.type === 'damage_writeoff'
          ? `auto|${tx.orderId}|${tx.returnId || ''}|${tx.type}|${tx.status}|${tx.amount}|${tx.notes || ''}`
          : `auto|${tx.orderId}|${tx.returnId || ''}|${tx.type}|${tx.status}`;
      if (seenAutoSignatures.has(signature)) continue;
      seenAutoSignatures.add(signature);
    }
    if (tx.id) seenIds.add(tx.id);
    dedupedTx.push(tx);
  }

  return dedupedTx;
}

export function computeOrderFinancialBreakdown(
  order: Order,
  products: Product[],
  returns: ReturnRecord[] = [],
  transactions: FinancialTransaction[] = []
): OrderFinancialBreakdown {
  const totalSellingPrice = order.totalAmount;
  let totalCostOfGoods = 0;
  let hasAllCosts = true;
  let usedSnapshot = false;
  let usedCatalog = false;
  const missingReasons: string[] = [];

  let totalItems = 0;
  for (const item of order.items) {
    totalItems += item.quantity;
    const resolved = resolveOrderItemUnitCost(item, products);
    if (resolved.unitCost !== null) {
      totalCostOfGoods += resolved.unitCost * item.quantity;
      if (resolved.source === 'snapshot') usedSnapshot = true;
      if (resolved.source === 'catalog') usedCatalog = true;
    } else {
      hasAllCosts = false;
      missingReasons.push(`سعر التكلفة للمنتج (${item.productName}) غير مسجل.`);
    }
  }

  const cogsSource: OrderFinancialBreakdown['cogsSource'] = !hasAllCosts
    ? 'missing'
    : usedSnapshot && usedCatalog
    ? 'mixed'
    : usedSnapshot
    ? 'snapshot'
    : 'catalog';

  const shippingFee = order.shippingCost || (order.shipment?.shippingCost ?? 0);
  const returnShippingFee = order.shipment?.returnShippingCost ?? 0;
  const packagingCost = order.packagingCost ?? 0;

  const isCommissionRecorded =
    typeof order.marketplaceCommission === 'number' &&
    Number.isFinite(order.marketplaceCommission) &&
    order.marketplaceCommission >= 0;

  if (!isCommissionRecorded) {
    missingReasons.push('عمولة المنصة غير مسجلة لهذا الطلب؛ يظهر هامش التكاليف المسجلة فقط حتى توثيق العمولة.');
  }

  const marketplaceCommission = isCommissionRecorded ? order.marketplaceCommission! : 0;
  const estimatedMarketplaceCommission = isCommissionRecorded
    ? undefined
    : Math.round(totalSellingPrice * ESTIMATED_MARKETPLACE_COMMISSION_RATE * 100) / 100;
  const serviceFees = 0;

  let extraAdjustments = 0;
  if (order.adjustments) {
    for (const adj of order.adjustments) {
      if (adj.type === 'discount') {
        extraAdjustments -= adj.amount;
      } else {
        extraAdjustments += adj.amount;
      }
    }
  }

  const isDelivered = order.status === 'delivered';
  const isCancelled = order.status === 'cancelled';

  // Calculate actual completed refund amount strictly from completed post-delivery return records
  // associated with this order (and any unaccounted confirmed customer_refund ledger entries),
  // bounded by original order item quantities and valued at original order item unitPrice snapshots.
  let refundAmount = 0;
  let pendingRefundAmount = 0;
  let refundedItemsCount = 0;

  if (!isCancelled) {
    const orderReturns = returns.filter((r) => r.orderId === order.id);
    const remainingByLine = order.items.map((it) =>
      Math.max(0, Math.floor(Number(it.quantity) || 0))
    );
    const seenReturnIds = new Set<string>();
    const accountedReturnIds = new Set<string>();

    for (const ret of orderReturns) {
      if (ret.id && seenReturnIds.has(ret.id)) continue;
      if (ret.id) seenReturnIds.add(ret.id);

      const isPostDeliveryContext =
        ret.isPostDeliveryReturn === true || isDelivered || order.deliveredProcessed === true;
      if (!isPostDeliveryContext) continue;

      if (!isReturnRecordCompleted(ret)) {
        // Uninspected return is kept strictly in pendingRefundAmount, NEVER in completed refundAmount
        for (const rItem of ret.items || []) {
          let qty = Math.max(0, Math.floor(Number(rItem.quantity) || 0));
          for (let idx = 0; idx < order.items.length && qty > 0; idx++) {
            const oItem = order.items[idx];
            const matches =
              oItem.productId === rItem.productId ||
              (Boolean(oItem.productSku) && oItem.productSku === rItem.productSku);
            if (!matches || remainingByLine[idx] <= 0) continue;
            const bounded = Math.min(qty, remainingByLine[idx]);
            const origPrice =
              typeof oItem.unitPrice === 'number' &&
              Number.isFinite(oItem.unitPrice) &&
              oItem.unitPrice >= 0
                ? oItem.unitPrice
                : 0;
            pendingRefundAmount += bounded * origPrice;
            qty -= bounded;
          }
        }
        continue;
      }

      if (ret.inspectionOutcome === 'missing' || ret.physicalCondition === 'lost') {
        continue;
      }

      for (const rItem of ret.items || []) {
        let qtyToRefund = Math.max(0, Math.floor(Number(rItem.quantity) || 0));
        for (let idx = 0; idx < order.items.length && qtyToRefund > 0; idx++) {
          const oItem = order.items[idx];
          const matches =
            oItem.productId === rItem.productId ||
            (Boolean(oItem.productSku) && oItem.productSku === rItem.productSku);
          if (!matches || remainingByLine[idx] <= 0) continue;
          const appliedQty = Math.min(qtyToRefund, remainingByLine[idx]);
          const origPrice =
            typeof oItem.unitPrice === 'number' &&
            Number.isFinite(oItem.unitPrice) &&
            oItem.unitPrice >= 0
              ? oItem.unitPrice
              : 0;
          refundAmount += appliedQty * origPrice;
          refundedItemsCount += appliedQty;
          remainingByLine[idx] -= appliedQty;
          qtyToRefund -= appliedQty;
        }
      }

      if (ret.id) {
        accountedReturnIds.add(ret.id);
      }
    }

    // Reconcile any confirmed/pending customer_refund ledger transactions not already counted from return records
    if (transactions.length > 0) {
      const dedupedOrderTx = deduplicateTransactionsList(
        transactions.filter((tx) => tx.orderId === order.id && tx.type === 'customer_refund')
      );

      for (const tx of dedupedOrderTx) {
        if (tx.status === 'cancelled') continue;
        if (tx.returnId && accountedReturnIds.has(tx.returnId)) continue;
        const txAmount = Number.isFinite(tx.amount) ? Math.max(0, tx.amount) : 0;

        if (isConfirmedStatus(tx.status)) {
          const remainingOrderCap = Math.max(0, totalSellingPrice - refundAmount);
          refundAmount += Math.min(txAmount, remainingOrderCap);
        } else if (tx.status === 'pending') {
          const remainingOrderCap = Math.max(
            0,
            totalSellingPrice - refundAmount - pendingRefundAmount
          );
          pendingRefundAmount += Math.min(txAmount, remainingOrderCap);
        }
      }
    }
  }

  refundAmount = Math.round(refundAmount * 100) / 100;
  pendingRefundAmount = Math.round(pendingRefundAmount * 100) / 100;

  // Recorded-Cost Margin can be computed whenever order is delivered and all item COGS exist,
  // explicitly reflecting ONLY recorded expenses (excluding missing marketplace commission).
  let recordedCostMargin: number | null = null;
  let confirmedNet: number | null = null;
  let estimatedNet: number | null = null;
  let isProfitCalculable = false;

  if (isDelivered && !isCancelled && hasAllCosts) {
    recordedCostMargin =
      Math.round(
        (totalSellingPrice -
          marketplaceCommission -
          shippingFee -
          packagingCost -
          totalCostOfGoods +
          extraAdjustments) *
          100
      ) / 100;

    if (isCommissionRecorded) {
      confirmedNet = recordedCostMargin;
      estimatedNet = recordedCostMargin;
      isProfitCalculable = true;
    } else {
      // Missing marketplace commission: NEVER claim confirmedNet!
      confirmedNet = null;
      isProfitCalculable = false;
      estimatedNet =
        Math.round((recordedCostMargin - (estimatedMarketplaceCommission ?? 0)) * 100) / 100;
    }
  }

  const uncalculatedReason = !isProfitCalculable
    ? isCancelled
      ? 'تم إلغاء الطلب قبل الشحن.'
      : !isDelivered
      ? 'الطلب لم يتم تسليمه نهائياً بعد.'
      : missingReasons.length > 0
      ? missingReasons.join(' ')
      : 'بيانات التكلفة غير مكتملة.'
    : undefined;

  return {
    orderId: order.id,
    sellingPriceTotal: totalSellingPrice,
    itemCount: totalItems,
    marketplaceCommission,
    commissionStatus: isCommissionRecorded ? 'recorded' : 'missing',
    estimatedMarketplaceCommission,
    serviceFees,
    originalShippingFee: shippingFee,
    returnShippingFee,
    packagingCost,
    extraAdjustments,
    productCostOfGoods: hasAllCosts ? totalCostOfGoods : null,
    cogsSource,
    refundAmount,
    pendingRefundAmount,
    refundedItemsCount,
    recordedCostMargin,
    confirmedNet,
    estimatedNet,
    isProfitCalculable,
    uncalculatedReason,
    missingCostReasons: missingReasons,
  };
}

export interface FinancialSummaryResult {
  deliveredRevenue: number;
  confirmedRevenue: number;
  deliveredOrdersCount: number;
  // Confirmed ledger categories (status === 'confirmed' | 'settled')
  courierShippingExpenses: number;
  returnShippingExpenses: number;
  damageWriteoffs: number;
  marketplaceCommissions: number;
  packagingExpenses: number;
  confirmedExpenses: number;
  confirmedRefunds: number;
  // Pending ledger categories (status === 'pending')
  pendingCourierShipping: number;
  pendingReturnShipping: number;
  pendingDamageWriteoffs: number;
  pendingMarketplaceCommissions: number;
  pendingExpenses: number;
  pendingRefunds: number;
  pendingTransactionsTotal: number;
  // Estimated / unrecorded items
  estimatedUnrecordedCommissions: number;
  estimatedExpenses: number;
  // Cancelled ledger items (strictly excluded from confirmed & pending)
  cancelledTransactionsCount: number;
  cancelledTransactionsTotal: number;
  // Settlements
  confirmedSettlement: number;
  expectedSettlement: number;
  estimatedSettlement: number;
  // Diagnostics
  ordersMissingCostCount: number;
  ordersMissingCommissionCount: number;
}

const isConfirmedStatus = (status: FinancialTransaction['status']): boolean =>
  status === 'confirmed' || status === 'settled';

export function computeFinancialSummary(
  orders: Order[],
  transactions: FinancialTransaction[],
  products: Product[],
  dateRange?: { start: Date; end: Date },
  marketplace?: MarketplaceId
): FinancialSummaryResult {
  const startMs = dateRange ? dateRange.start.getTime() : null;
  const endMs = dateRange ? dateRange.end.getTime() : null;

  const filteredOrders = orders.filter((order) => {
    if (marketplace && marketplace !== 'all' && order.marketplaceId !== marketplace) {
      return false;
    }
    if (startMs !== null && endMs !== null) {
      const orderTime = new Date(order.orderDate || order.createdAt).getTime();
      if (orderTime < startMs || orderTime > endMs) return false;
    }
    return true;
  });

  const deliveredOrders = filteredOrders.filter((o) => o.status === 'delivered');
  const deliveredRevenue =
    Math.round(deliveredOrders.reduce((sum, o) => sum + o.totalAmount, 0) * 100) / 100;
  const confirmedRevenue = deliveredRevenue;

  const relevantTx = transactions.filter((tx) => {
    if (marketplace && marketplace !== 'all' && tx.marketplaceId !== marketplace) return false;
    if (startMs !== null && endMs !== null) {
      const time = new Date(tx.date).getTime();
      if (time < startMs || time > endMs) return false;
    }
    return true;
  });

  // Deduplicate transactions to prevent double-counting identical or retried postings
  // while preserving distinct legitimate multi-events on the same order via eventRef.
  const dedupedTx = deduplicateTransactionsList(relevantTx);

  let courierShippingExpenses = 0;
  let returnShippingExpenses = 0;
  let damageWriteoffs = 0;
  let marketplaceCommissions = 0;
  let packagingExpenses = 0;
  let confirmedRefunds = 0;

  let pendingCourierShipping = 0;
  let pendingReturnShipping = 0;
  let pendingDamageWriteoffs = 0;
  let pendingMarketplaceCommissions = 0;
  let pendingPackagingFees = 0;
  let pendingRefunds = 0;

  let cancelledTransactionsCount = 0;
  let cancelledTransactionsTotal = 0;

  const ordersWithCommissionTx = new Set<string>();

  for (const tx of dedupedTx) {
    const amount = Number.isFinite(tx.amount) ? Math.max(0, tx.amount) : 0;

    if (tx.status === 'cancelled') {
      cancelledTransactionsCount++;
      cancelledTransactionsTotal += amount;
      continue;
    }

    if (isConfirmedStatus(tx.status)) {
      if (tx.type === 'courier_shipping') courierShippingExpenses += amount;
      else if (tx.type === 'return_shipping') returnShippingExpenses += amount;
      else if (tx.type === 'damage_writeoff') damageWriteoffs += amount;
      else if (tx.type === 'marketplace_commission') {
        marketplaceCommissions += amount;
        if (tx.orderId) ordersWithCommissionTx.add(tx.orderId);
      } else if (tx.type === 'packaging_fee') packagingExpenses += amount;
      else if (tx.type === 'customer_refund') confirmedRefunds += amount;
    } else if (tx.status === 'pending') {
      if (tx.type === 'courier_shipping') pendingCourierShipping += amount;
      else if (tx.type === 'return_shipping') pendingReturnShipping += amount;
      else if (tx.type === 'damage_writeoff') pendingDamageWriteoffs += amount;
      else if (tx.type === 'marketplace_commission') {
        pendingMarketplaceCommissions += amount;
        if (tx.orderId) ordersWithCommissionTx.add(tx.orderId);
      } else if (tx.type === 'packaging_fee') pendingPackagingFees += amount;
      else if (tx.type === 'customer_refund') pendingRefunds += amount;
    }
  }

  const confirmedExpenses =
    courierShippingExpenses +
    returnShippingExpenses +
    damageWriteoffs +
    marketplaceCommissions +
    packagingExpenses;

  const pendingExpenses =
    pendingCourierShipping +
    pendingReturnShipping +
    pendingDamageWriteoffs +
    pendingMarketplaceCommissions +
    pendingPackagingFees;

  const pendingTransactionsTotal = pendingExpenses + pendingRefunds;

  let ordersMissingCostCount = 0;
  let ordersMissingCommissionCount = 0;
  let estimatedUnrecordedCommissions = 0;

  for (const o of deliveredOrders) {
    const hasMissingCost = o.items.some(
      (item) => resolveOrderItemUnitCost(item, products).unitCost === null
    );
    if (hasMissingCost) ordersMissingCostCount++;

    const hasOrderCommission =
      typeof o.marketplaceCommission === 'number' &&
      Number.isFinite(o.marketplaceCommission) &&
      o.marketplaceCommission >= 0;

    if (!hasOrderCommission && !ordersWithCommissionTx.has(o.id)) {
      ordersMissingCommissionCount++;
      estimatedUnrecordedCommissions +=
        Math.round(o.totalAmount * ESTIMATED_MARKETPLACE_COMMISSION_RATE * 100) / 100;
    }
  }

  estimatedUnrecordedCommissions = Math.round(estimatedUnrecordedCommissions * 100) / 100;
  const estimatedExpenses =
    Math.round((pendingExpenses + estimatedUnrecordedCommissions) * 100) / 100;

  const confirmedSettlement =
    Math.round((confirmedRevenue - confirmedExpenses - confirmedRefunds) * 100) / 100;
  const expectedSettlement =
    Math.round(
      (confirmedSettlement -
        pendingExpenses -
        pendingRefunds -
        estimatedUnrecordedCommissions) *
        100
    ) / 100;

  return {
    deliveredRevenue,
    confirmedRevenue,
    deliveredOrdersCount: deliveredOrders.length,
    courierShippingExpenses,
    returnShippingExpenses,
    damageWriteoffs,
    marketplaceCommissions,
    packagingExpenses,
    confirmedExpenses,
    confirmedRefunds,
    pendingCourierShipping,
    pendingReturnShipping,
    pendingDamageWriteoffs,
    pendingMarketplaceCommissions,
    pendingExpenses,
    pendingRefunds,
    pendingTransactionsTotal,
    estimatedUnrecordedCommissions,
    estimatedExpenses,
    cancelledTransactionsCount,
    cancelledTransactionsTotal,
    confirmedSettlement,
    expectedSettlement,
    estimatedSettlement: expectedSettlement,
    ordersMissingCostCount,
    ordersMissingCommissionCount,
  };
}
