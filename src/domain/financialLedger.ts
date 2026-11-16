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

export function parseValidPositiveIntegerQty(qty: unknown): number | null {
  if (typeof qty !== 'number' || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
    return null;
  }
  return qty;
}

/**
 * Strictly validates whether a return item matches an original order line.
 * When both productId and productSku are present on both sides, BOTH must agree
 * so a mismatched productId sharing an unrelated SKU (or vice versa) can never match.
 */
export function doesReturnItemMatchOrderItem(
  retItem: { productId?: string; productSku?: string },
  orderItem: { productId?: string; productSku?: string }
): boolean {
  const rId = typeof retItem.productId === 'string' ? retItem.productId.trim() : '';
  const rSku = typeof retItem.productSku === 'string' ? retItem.productSku.trim() : '';
  const oId = typeof orderItem.productId === 'string' ? orderItem.productId.trim() : '';
  const oSku = typeof orderItem.productSku === 'string' ? orderItem.productSku.trim() : '';

  if (rId && oId && rId !== oId) return false;
  if (rSku && oSku && rSku !== oSku) return false;

  return Boolean((rId && oId && rId === oId) || (rSku && oSku && rSku === oSku));
}

export function isReturnRecordCompleted(ret: ReturnRecord): boolean {
  return Boolean(
    ret.isCompleted ||
      ret.returnStatus === 'closed' ||
      ret.returnStatus === 'inspection_completed' ||
      ret.returnStatus === 'restocked' ||
      ret.returnStatus === 'damaged'
  );
}

export function normalizeSortedUniqueReturns(returns: ReturnRecord[], orderId?: string): ReturnRecord[] {
  const filtered = orderId ? returns.filter((r) => r.orderId === orderId) : [...returns];
  const sorted = [...filtered].sort((a, b) => {
    const compDiff = (isReturnRecordCompleted(a) ? 0 : 1) - (isReturnRecordCompleted(b) ? 0 : 1);
    if (compDiff !== 0) return compDiff;
    const cA = a.createdAt || '';
    const cB = b.createdAt || '';
    if (cA !== cB) return cA < cB ? -1 : 1;
    const uA = a.updatedAt || '';
    const uB = b.updatedAt || '';
    if (uA !== uB) return uA < uB ? -1 : 1;
    return (a.id || '').localeCompare(b.id || '');
  });

  const seenIds = new Set<string>();
  const result: ReturnRecord[] = [];
  for (const ret of sorted) {
    if (ret.id) {
      if (seenIds.has(ret.id)) continue;
      seenIds.add(ret.id);
    }
    result.push(ret);
  }
  return result;
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

  // Calculate actual completed & pending refund amounts deterministically:
  // 1) Prioritize completed post-delivery returns before pending returns so they never consume the same units.
  // 2) Deduct consumed units for pending returns too so multiple pending returns cannot exceed ordered quantities.
  // 3) Require strict product identity match and positive integer quantities.
  // 4) Reconcile customer_refund ledger entries by returnId without double-counting, keeping standalone valid entries.
  let refundAmount = 0;
  let pendingRefundAmount = 0;
  let refundedItemsCount = 0;

  if (!isCancelled) {
    const orderReturns = normalizeSortedUniqueReturns(returns, order.id);
    const remainingByLine = order.items.map((it) =>
      Number.isFinite(it.quantity) && Number.isInteger(it.quantity) && it.quantity > 0
        ? it.quantity
        : 0
    );
    const originalItemsTotal = order.items.reduce((sum, it) => {
      const qty =
        Number.isFinite(it.quantity) && Number.isInteger(it.quantity) && it.quantity > 0
          ? it.quantity
          : 0;
      const price =
        typeof it.unitPrice === 'number' && Number.isFinite(it.unitPrice) && it.unitPrice >= 0
          ? it.unitPrice
          : 0;
      return sum + qty * price;
    }, 0);
    const validOrderTotal =
      typeof totalSellingPrice === 'number' &&
      Number.isFinite(totalSellingPrice) &&
      totalSellingPrice >= 0
        ? totalSellingPrice
        : originalItemsTotal;
    const maxRefundableOrderCap =
      originalItemsTotal > 0 ? Math.min(validOrderTotal, originalItemsTotal) : validOrderTotal;

    const accountedReturnIds = new Set<string>();

    const postDeliveryReturns = orderReturns.filter(
      (ret) => ret.isPostDeliveryReturn === true || isDelivered || order.deliveredProcessed === true
    );
    const completedReturns = postDeliveryReturns.filter((ret) => isReturnRecordCompleted(ret));
    const pendingReturns = postDeliveryReturns.filter((ret) => !isReturnRecordCompleted(ret));

    // Pass 1: Completed post-delivery returns (excluding missing/lost or explicitly failed refund verification)
    for (const ret of completedReturns) {
      if (ret.inspectionOutcome === 'missing' || ret.physicalCondition === 'lost') {
        continue;
      }
      if (ret.refundProcessed === false) {
        continue;
      }

      for (const rItem of ret.items || []) {
        const validQty = parseValidPositiveIntegerQty(rItem.quantity);
        if (validQty === null) continue;
        let qtyToRefund = validQty;
        for (let idx = 0; idx < order.items.length && qtyToRefund > 0; idx++) {
          const oItem = order.items[idx];
          if (!doesReturnItemMatchOrderItem(rItem, oItem) || remainingByLine[idx] <= 0) continue;
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

    // Pass 2: Pending/uninspected post-delivery returns share the SAME remaining order-line quantities
    for (const ret of pendingReturns) {
      for (const rItem of ret.items || []) {
        const validQty = parseValidPositiveIntegerQty(rItem.quantity);
        if (validQty === null) continue;
        let qtyToReserve = validQty;
        for (let idx = 0; idx < order.items.length && qtyToReserve > 0; idx++) {
          const oItem = order.items[idx];
          if (!doesReturnItemMatchOrderItem(rItem, oItem) || remainingByLine[idx] <= 0) continue;
          const bounded = Math.min(qtyToReserve, remainingByLine[idx]);
          const origPrice =
            typeof oItem.unitPrice === 'number' &&
            Number.isFinite(oItem.unitPrice) &&
            oItem.unitPrice >= 0
              ? oItem.unitPrice
              : 0;
          pendingRefundAmount += bounded * origPrice;
          remainingByLine[idx] -= bounded;
          qtyToReserve -= bounded;
        }
      }

      if (ret.id) {
        accountedReturnIds.add(ret.id);
      }
    }

    refundAmount = Math.min(refundAmount, maxRefundableOrderCap);
    pendingRefundAmount = Math.min(
      pendingRefundAmount,
      Math.max(0, maxRefundableOrderCap - refundAmount)
    );

    // Reconcile standalone customer_refund ledger transactions not already accounted by returnId
    if (transactions.length > 0) {
      const dedupedOrderTx = deduplicateTransactionsList(
        transactions.filter((tx) => tx.orderId === order.id && tx.type === 'customer_refund')
      );

      for (const tx of dedupedOrderTx) {
        if (tx.status === 'cancelled') continue;
        if (tx.returnId && accountedReturnIds.has(tx.returnId)) continue;
        const txAmount = Number.isFinite(tx.amount) ? Math.max(0, tx.amount) : 0;

        if (isConfirmedStatus(tx.status)) {
          const remainingOrderCap = Math.max(0, maxRefundableOrderCap - refundAmount);
          refundAmount += Math.min(txAmount, remainingOrderCap);
          pendingRefundAmount = Math.min(
            pendingRefundAmount,
            Math.max(0, maxRefundableOrderCap - refundAmount)
          );
        } else if (tx.status === 'pending') {
          const remainingOrderCap = Math.max(
            0,
            maxRefundableOrderCap - refundAmount - pendingRefundAmount
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
