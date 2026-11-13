/**
 * Pure financial breakdown and accounting ledger helpers.
 * Strictly separates recorded values from missing/unrecorded inputs,
 * preserves historical COGS snapshots, and never fabricates speculative net profits.
 */

import {
  FinancialTransaction,
  MarketplaceId,
  Order,
  OrderFinancialBreakdown,
  OrderItem,
  Product,
} from '../types';

export function resolveOrderItemUnitCost(
  item: OrderItem,
  products: Product[]
): { unitCost: number | null; source: 'snapshot' | 'catalog' | 'missing' } {
  if (typeof item.unitCostSnapshot === 'number' && Number.isFinite(item.unitCostSnapshot) && item.unitCostSnapshot > 0) {
    return { unitCost: item.unitCostSnapshot, source: 'snapshot' };
  }

  const product = products.find(
    (p) => p.id === item.productId || (item.productSku && p.sku === item.productSku)
  );
  if (product && typeof product.baseCost === 'number' && Number.isFinite(product.baseCost) && product.baseCost > 0) {
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

  // Strictly report recorded commission; never inject an estimated 12% fee into confirmedNet.
  const marketplaceCommission = isCommissionRecorded ? order.marketplaceCommission! : 0;
  const estimatedMarketplaceCommission = isCommissionRecorded
    ? undefined
    : Math.round(totalSellingPrice * 0.12 * 100) / 100;
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

  let confirmedNet: number | null = null;
  let isProfitCalculable = false;

  if (isDelivered && hasAllCosts && !isCancelled) {
    confirmedNet =
      totalSellingPrice -
      marketplaceCommission -
      shippingFee -
      packagingCost -
      totalCostOfGoods +
      extraAdjustments;
    isProfitCalculable = true;
  }

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
    confirmedNet,
    isProfitCalculable,
    uncalculatedReason: !isProfitCalculable
      ? missingReasons.length > 0
        ? missingReasons.join(' ')
        : !isDelivered
        ? 'الطلب لم يتم تسليمه نهائياً بعد.'
        : 'بيانات التكلفة غير مكتملة.'
      : undefined,
  };
}

export function computeFinancialSummary(
  orders: Order[],
  transactions: FinancialTransaction[],
  products: Product[],
  dateRange?: { start: Date; end: Date },
  marketplace?: MarketplaceId
) {
  const deliveredOrders = orders.filter((o) => o.status === 'delivered');
  const deliveredRevenue = deliveredOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  const relevantTx = transactions.filter((tx) => {
    if (marketplace && marketplace !== 'all' && tx.marketplaceId !== marketplace) return false;
    if (dateRange) {
      const time = new Date(tx.date).getTime();
      if (time < dateRange.start.getTime() || time > dateRange.end.getTime()) return false;
    }
    return true;
  });

  const courierShippingExpenses = relevantTx
    .filter((t) => t.type === 'courier_shipping')
    .reduce((sum, t) => sum + t.amount, 0);

  const returnShippingExpenses = relevantTx
    .filter((t) => t.type === 'return_shipping')
    .reduce((sum, t) => sum + t.amount, 0);

  const damageWriteoffs = relevantTx
    .filter((t) => t.type === 'damage_writeoff')
    .reduce((sum, t) => sum + t.amount, 0);

  const marketplaceCommissions = relevantTx
    .filter((t) => t.type === 'marketplace_commission')
    .reduce((sum, t) => sum + t.amount, 0);

  const confirmedRefunds = relevantTx
    .filter((t) => t.type === 'customer_refund')
    .reduce((sum, t) => sum + t.amount, 0);

  let ordersMissingCostCount = 0;
  for (const o of deliveredOrders) {
    const hasMissing = o.items.some((item) => resolveOrderItemUnitCost(item, products).unitCost === null);
    if (hasMissing) ordersMissingCostCount++;
  }

  return {
    deliveredRevenue,
    deliveredOrdersCount: deliveredOrders.length,
    courierShippingExpenses,
    returnShippingExpenses,
    damageWriteoffs,
    marketplaceCommissions,
    confirmedRefunds,
    ordersMissingCostCount,
    estimatedSettlement:
      deliveredRevenue -
      marketplaceCommissions -
      courierShippingExpenses -
      returnShippingExpenses -
      damageWriteoffs,
  };
}
