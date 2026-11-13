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

export function computeOrderFinancialBreakdown(
  order: Order,
  products: Product[]
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
  const refundAmount =
    order.hasPostDeliveryReturn || order.status === 'rejected' ? totalSellingPrice : 0;

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
  const seenIds = new Set<string>();
  const seenAutoSignatures = new Set<string>();
  const dedupedTx: FinancialTransaction[] = [];

  for (const tx of relevantTx) {
    if (tx.id && seenIds.has(tx.id)) continue;
    if (tx.source === 'automatic' && tx.type !== 'adjustment') {
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
