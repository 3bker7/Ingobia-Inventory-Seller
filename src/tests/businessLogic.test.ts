import test from 'node:test';
import assert from 'node:assert/strict';
import { Product, Order, FinancialTransaction, StockMovement, ReturnRecord } from '../types';
import {
  allocateStockToPlatformPure,
  applyManualStockAdjustmentPure,
  computeEditedAvailableStock,
  computePriceChangeMetrics,
  getLockedCustodyFloor,
  getSellableCapacityForMarketplace,
  getTotalPlatformAllocatedStock,
  releasePlatformAllocationPure,
} from '../domain/inventoryCustody';
import {
  computeOrderFinancialBreakdown,
  computeFinancialSummary,
  resolveOrderItemUnitCost,
} from '../domain/financialLedger';
import {
  ALLOWED_ORDER_TRANSITIONS,
  createOrderPure,
  updateOrderStatusPure,
} from '../domain/orderLifecycle';
import {
  ALLOWED_RETURN_TRANSITIONS,
  addReturnNotePure,
  advanceReturnStatusPure,
  computeReturnRefundAmount,
  computeReturnRefundAssessment,
  getOrderReturnableItems,
  processReturnInspectionPure,
  registerPostDeliveryReturnPure,
} from '../domain/returnLifecycle';
import { saveSmartImportOrdersPure } from '../domain/smartImportCustody';
import { DEFAULT_PRODUCTS, DEFAULT_ORDERS, DEFAULT_RETURNS, STORAGE_KEYS } from '../services/seedData';
import { storageService } from '../services/storage';
import { getDynamicTemplateColumns } from '../services/excel';

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'prod-test-1',
  sku: 'TEST-SKU-01',
  name: 'Test Wireless Headphones',
  imageUrl: 'https://example.com/img.jpg',
  currentPrice: 200,
  baseCost: 100,
  physicalStock: 20,
  availableStock: 20,
  reservedStock: 0,
  awaitingInspectionStock: 0,
  damagedStock: 0,
  outboundInTransitStock: 0,
  returnInTransitStock: 0,
  marketplaceListings: {
    noon: {
      marketplaceId: 'noon',
      price: 200,
      quantity: 20,
      listingStatus: 'active',
      lastUpdated: '2026-11-10T10:00:00Z',
    },
  },
  createdAt: '2026-11-10T10:00:00Z',
  updatedAt: '2026-11-10T10:00:00Z',
  ...overrides,
});

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'ORD-1001',
  marketplaceId: 'noon',
  customerName: 'سعد التميمي',
  shippingAddress: 'الرياض',
  items: [
    {
      productId: 'prod-test-1',
      productSku: 'TEST-SKU-01',
      productName: 'Test Wireless Headphones',
      imageUrl: 'https://example.com/img.jpg',
      quantity: 2,
      unitPrice: 200,
      unitCostSnapshot: 100,
    },
  ],
  totalAmount: 400,
  shippingCost: 25,
  marketplaceCommission: 40,
  status: 'preparing',
  stockDeducted: true,
  isClosed: false,
  orderDate: '2026-11-10T10:00:00Z',
  createdAt: '2026-11-10T10:00:00Z',
  updatedAt: '2026-11-10T10:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. Seed Data Custody Synchronization
// ---------------------------------------------------------------------------
test('seed data custody buckets are non-negative and synchronized with active orders/returns', () => {
  for (const p of DEFAULT_PRODUCTS) {
    assert.ok(p.physicalStock >= 0);
    assert.ok(p.availableStock >= 0);
    assert.ok(p.reservedStock >= 0);
    assert.ok((p.awaitingInspectionStock || 0) >= 0);
    assert.ok((p.damagedStock || 0) >= 0);
    assert.equal(
      p.physicalStock,
      p.availableStock +
        p.reservedStock +
        (p.awaitingInspectionStock || 0) +
        (p.damagedStock || 0) +
        (p.outboundInTransitStock || 0) +
        (p.returnInTransitStock || 0),
      `Custody sum mismatch on seed product ${p.id}`
    );
  }

  const awaitingInspectionByProd = new Map<string, number>();
  for (const r of DEFAULT_RETURNS) {
    if (r.returnStatus === 'received_at_warehouse' || r.returnStatus === 'under_inspection') {
      for (const item of r.items) {
        awaitingInspectionByProd.set(
          item.productId,
          (awaitingInspectionByProd.get(item.productId) || 0) + item.quantity
        );
      }
    }
  }
  for (const [prodId, qty] of awaitingInspectionByProd.entries()) {
    const prod = DEFAULT_PRODUCTS.find((p) => p.id === prodId);
    assert.ok(prod);
    assert.equal(prod.awaitingInspectionStock, qty);
  }

  for (const ord of DEFAULT_ORDERS) {
    assert.ok(ord.items.every((it) => typeof it.unitCostSnapshot === 'number' && it.unitCostSnapshot > 0));
  }
});

// ---------------------------------------------------------------------------
// 2. Order Creation Validation & Aggregated Split-Line Protection
// ---------------------------------------------------------------------------
test('createOrderPure reserves stock, snapshots COGS, and blocks aggregated multi-line oversell', () => {
  const product = makeProduct({ physicalStock: 10, availableStock: 10 });

  const splitOversell = createOrderPure({
    orderData: {
      marketplaceId: 'noon',
      customerName: 'عميل 1',
      shippingAddress: 'جدة',
      items: [
        { productId: product.id, productSku: product.sku, productName: product.name, imageUrl: product.imageUrl, quantity: 6, unitPrice: 200 },
        { productId: product.id, productSku: product.sku, productName: product.name, imageUrl: product.imageUrl, quantity: 6, unitPrice: 200 },
      ],
      totalAmount: 2400,
      shippingCost: 20,
      status: 'preparing',
      orderDate: '2026-11-10T10:00:00Z',
    },
    products: [product],
    existingOrders: [],
  });
  assert.equal(splitOversell.success, false);

  const nonPositive = createOrderPure({
    orderData: {
      marketplaceId: 'noon',
      customerName: 'عميل 1',
      shippingAddress: 'جدة',
      items: [{ productId: product.id, productSku: product.sku, productName: product.name, imageUrl: product.imageUrl, quantity: 0, unitPrice: 200 }],
      totalAmount: 0,
      shippingCost: 0,
      status: 'preparing',
      orderDate: '2026-11-10T10:00:00Z',
    },
    products: [product],
    existingOrders: [],
  });
  assert.equal(nonPositive.success, false);

  const valid = createOrderPure({
    orderData: {
      marketplaceId: 'noon',
      customerName: 'عميل 1',
      shippingAddress: 'جدة',
      items: [{ productId: product.id, productSku: product.sku, productName: product.name, imageUrl: product.imageUrl, quantity: 4, unitPrice: 200 }],
      totalAmount: 800,
      shippingCost: 20,
      status: 'preparing',
      orderDate: '2026-11-10T10:00:00Z',
    },
    products: [product],
    existingOrders: [],
    customId: 'ORD-CUSTOM-1',
  });

  assert.equal(valid.success, true);
  assert.ok(valid.order);
  assert.equal(valid.order.items[0].unitCostSnapshot, 100);
  assert.equal(valid.products[0].availableStock, 6);
  assert.equal(valid.products[0].reservedStock, 4);
  assert.equal(valid.products[0].physicalStock, 10);

  // Duplicate custom ID must fail cleanly
  const dup = createOrderPure({
    orderData: {
      marketplaceId: 'noon',
      customerName: 'عميل 2',
      shippingAddress: 'الدمام',
      items: [{ productId: product.id, productSku: product.sku, productName: product.name, imageUrl: product.imageUrl, quantity: 1, unitPrice: 200 }],
      totalAmount: 200,
      shippingCost: 20,
      status: 'preparing',
      orderDate: '2026-11-10T10:00:00Z',
    },
    products: valid.products,
    existingOrders: valid.orders,
    customId: 'ORD-CUSTOM-1',
  });
  assert.equal(dup.success, false);
});

// ---------------------------------------------------------------------------
// 3. Order State Machine & Custody Transitions
// ---------------------------------------------------------------------------
test('updateOrderStatusPure enforces ALLOWED_ORDER_TRANSITIONS and records full lifecycle accurately', () => {
  assert.deepEqual(ALLOWED_ORDER_TRANSITIONS.preparing, ['with_delivery', 'cancelled']);
  assert.deepEqual(ALLOWED_ORDER_TRANSITIONS.with_delivery, ['delivered', 'rejected']);
  assert.deepEqual(ALLOWED_ORDER_TRANSITIONS.delivered, []);

  const prod = makeProduct({ physicalStock: 20, availableStock: 18, reservedStock: 2 });
  const order = makeOrder({ status: 'preparing', isClosed: false });

  // Forbidden direct jump: preparing -> delivered or preparing -> rejected
  const illegalDelivered = updateOrderStatusPure({
    orderId: order.id,
    newStatus: 'delivered',
    orders: [order],
    products: [prod],
    returns: [],
    currency: 'SAR',
  });
  assert.equal(illegalDelivered.success, false);

  // preparing -> with_delivery
  const dispatched = updateOrderStatusPure({
    orderId: order.id,
    newStatus: 'with_delivery',
    orders: [order],
    products: [prod],
    returns: [],
    currency: 'SAR',
    shipmentDetails: { courierName: 'SMSA', trackingNumber: 'SMSA-99' },
  });
  assert.equal(dispatched.success, true);
  assert.equal(dispatched.products[0].reservedStock, 0);
  assert.equal(dispatched.products[0].outboundInTransitStock, 2);

  // Forbidden reversal: with_delivery -> cancelled
  const illegalCancel = updateOrderStatusPure({
    orderId: order.id,
    newStatus: 'cancelled',
    orders: dispatched.orders,
    products: dispatched.products,
    returns: dispatched.returns,
    currency: 'SAR',
  });
  assert.equal(illegalCancel.success, false);

  // with_delivery -> delivered
  const delivered = updateOrderStatusPure({
    orderId: order.id,
    newStatus: 'delivered',
    orders: dispatched.orders,
    products: dispatched.products,
    returns: dispatched.returns,
    currency: 'EGP',
  });
  assert.equal(delivered.success, true);
  assert.equal(delivered.products[0].outboundInTransitStock, 0);
  assert.equal(delivered.products[0].physicalStock, 18);
  assert.equal(delivered.orders[0].isClosed, true);
  assert.ok(delivered.newTransactions.some((t) => t.type === 'sale_revenue' && t.currency === 'EGP'));
  assert.ok(delivered.newTransactions.some((t) => t.type === 'marketplace_commission' && t.amount === 40));

  // Terminal order lock: cannot change delivered order to cancelled or rejected
  const postCloseAttempt = updateOrderStatusPure({
    orderId: order.id,
    newStatus: 'rejected',
    orders: delivered.orders,
    products: delivered.products,
    returns: delivered.returns,
    currency: 'EGP',
  });
  assert.equal(postCloseAttempt.success, false);
});

// ---------------------------------------------------------------------------
// 4. Return State Machine, Quarantine, Damage Isolation & Post-Delivery Physical Receipt
// ---------------------------------------------------------------------------
test('return lifecycle enforces warehouse receipt before inspection and handles pre/post delivery custody', () => {
  assert.deepEqual(ALLOWED_RETURN_TRANSITIONS.in_transit_back, ['received_at_warehouse']);
  assert.deepEqual(ALLOWED_RETURN_TRANSITIONS.received_at_warehouse, ['under_inspection']);

  // Pre-delivery rejection -> receipt -> under_inspection -> restockable
  const prodA = makeProduct({ physicalStock: 20, availableStock: 18, outboundInTransitStock: 2 });
  const ordA = makeOrder({ id: 'ORD-PRE-1', status: 'with_delivery' });

  const rejected = updateOrderStatusPure({
    orderId: ordA.id,
    newStatus: 'rejected',
    orders: [ordA],
    products: [prodA],
    returns: [],
    currency: 'SAR',
  });
  assert.equal(rejected.success, true);
  assert.equal(rejected.returns.length, 1);
  assert.equal(rejected.products[0].returnInTransitStock, 2);
  assert.equal(rejected.products[0].availableStock, 18);

  const retId = rejected.returns[0].id;

  // Cannot skip directly to under_inspection or processReturnInspection before receipt
  const skipInsp = advanceReturnStatusPure({
    returnId: retId,
    targetStatus: 'under_inspection',
    returns: rejected.returns,
    products: rejected.products,
    orders: rejected.orders,
  });
  assert.equal(skipInsp.success, false);

  const prematureProcess = processReturnInspectionPure({
    returnId: retId,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'premature',
    returns: rejected.returns,
    products: rejected.products,
    orders: rejected.orders,
    currency: 'SAR',
  });
  assert.equal(prematureProcess.success, false);

  // Receive at warehouse dock
  const received = advanceReturnStatusPure({
    returnId: retId,
    targetStatus: 'received_at_warehouse',
    returns: rejected.returns,
    products: rejected.products,
    orders: rejected.orders,
  });
  assert.equal(received.success, true);
  assert.equal(received.products[0].returnInTransitStock, 0);
  assert.equal(received.products[0].awaitingInspectionStock, 2);
  assert.equal(received.products[0].availableStock, 18);
  assert.equal(received.products[0].physicalStock, 20);

  // Move to under_inspection
  const underInsp = advanceReturnStatusPure({
    returnId: retId,
    targetStatus: 'under_inspection',
    returns: received.returns,
    products: received.products,
    orders: rejected.orders,
  });
  assert.equal(underInsp.success, true);

  // Cannot go backward to received_at_warehouse
  const backStep = advanceReturnStatusPure({
    returnId: retId,
    targetStatus: 'received_at_warehouse',
    returns: underInsp.returns,
    products: underInsp.products,
    orders: rejected.orders,
  });
  assert.equal(backStep.success, false);

  // Approve restockable -> returns to availableStock
  const restocked = processReturnInspectionPure({
    returnId: retId,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'مختوم وسليم',
    returns: underInsp.returns,
    products: underInsp.products,
    orders: rejected.orders,
    currency: 'SAR',
  });
  assert.equal(restocked.success, true);
  assert.equal(restocked.products[0].awaitingInspectionStock, 0);
  assert.equal(restocked.products[0].availableStock, 20);
  assert.equal(restocked.products[0].physicalStock, 20);
  assert.equal(restocked.returns[0].isCompleted, true);
  assert.equal(restocked.returns[0].stockRestored, true);

  // Post-delivery return physicalStock consistency (no double increment between receipt & inspection)
  const prodPost = makeProduct({
    id: 'prod-post',
    sku: 'POST-1',
    baseCost: 80,
    physicalStock: 8,
    availableStock: 8,
  });
  const deliveredOrder = makeOrder({
    id: 'ORD-DEL-POST',
    status: 'delivered',
    deliveredProcessed: true,
    isClosed: true,
    items: [
      {
        productId: prodPost.id,
        productSku: prodPost.sku,
        productName: prodPost.name,
        imageUrl: prodPost.imageUrl,
        quantity: 2,
        unitPrice: 150,
        unitCostSnapshot: 70, // historical snapshot lower than current catalog cost 80
      },
    ],
  });

  const postReg = registerPostDeliveryReturnPure({
    orderId: deliveredOrder.id,
    reason: 'العميل اشتكى من تلف',
    orders: [deliveredOrder],
    returns: [],
    products: [prodPost],
    currency: 'AED',
  });
  assert.equal(postReg.success, true);
  assert.equal(postReg.products[0].returnInTransitStock, 2);
  assert.equal(postReg.products[0].physicalStock, 8);

  // Duplicate post-delivery return is blocked
  const dupPost = registerPostDeliveryReturnPure({
    orderId: deliveredOrder.id,
    reason: 'تكرار',
    orders: postReg.orders,
    returns: postReg.returns,
    products: postReg.products,
    currency: 'AED',
  });
  assert.equal(dupPost.success, false);

  // Dock receipt restores physicalStock once (8 -> 10) into awaitingInspectionStock
  const postReceived = advanceReturnStatusPure({
    returnId: postReg.returnRecord!.id,
    targetStatus: 'received_at_warehouse',
    returns: postReg.returns,
    products: postReg.products,
    orders: postReg.orders,
  });
  assert.equal(postReceived.success, true);
  assert.equal(postReceived.products[0].physicalStock, 10);
  assert.equal(postReceived.products[0].awaitingInspectionStock, 2);
  assert.equal(postReceived.returns[0].physicalRestoredAtReceipt, true);

  // Damaged inspection isolates into damagedStock without adding physicalStock twice, uses snapshot cost 70 * 2 = 140
  const postDamaged = processReturnInspectionPure({
    returnId: postReg.returnRecord!.id,
    outcome: 'damaged',
    condition: 'damaged',
    notes: 'تلف في التغليف والهيكل',
    returns: postReceived.returns,
    products: postReceived.products,
    orders: postReg.orders,
    currency: 'AED',
  });
  assert.equal(postDamaged.success, true);
  assert.equal(postDamaged.products[0].physicalStock, 10);
  assert.equal(postDamaged.products[0].availableStock, 8);
  assert.equal(postDamaged.products[0].awaitingInspectionStock, 0);
  assert.equal(postDamaged.products[0].damagedStock, 2);
  const dmgTx = postDamaged.newTransactions.find((tx) => tx.type === 'damage_writeoff');
  assert.ok(dmgTx);
  assert.equal(dmgTx.amount, 140);
  assert.equal(dmgTx.currency, 'AED');
});

// ---------------------------------------------------------------------------
// 5. Financial Breakdown & Historical COGS Snapshot Immutability
// ---------------------------------------------------------------------------
test('financial breakdown preserves historical snapshot COGS and avoids fake profits/fees', () => {
  const prod = makeProduct({ baseCost: 180 }); // Catalog cost updated later from 100 -> 180
  const deliveredOrder = makeOrder({
    status: 'delivered',
    totalAmount: 500,
    shippingCost: 30,
    marketplaceCommission: undefined, // Missing commission should NOT inject 12% into confirmedNet
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 2,
        unitPrice: 250,
        unitCostSnapshot: 100, // Historical cost at order time
      },
    ],
  });

  const resolved = resolveOrderItemUnitCost(deliveredOrder.items[0], [prod]);
  assert.equal(resolved.unitCost, 100);
  assert.equal(resolved.source, 'snapshot');

  const breakdown = computeOrderFinancialBreakdown(deliveredOrder, [prod]);
  // Missing commission MUST block confirmedNet even when COGS is present, exposing recordedCostMargin & estimatedNet separately
  assert.equal(breakdown.isProfitCalculable, false);
  assert.equal(breakdown.confirmedNet, null);
  assert.equal(breakdown.recordedCostMargin, 270); // 500 - 30 - 200
  assert.equal(breakdown.estimatedNet, 210); // 270 - 60 (12% heuristic)
  assert.equal(breakdown.productCostOfGoods, 200);
  assert.equal(breakdown.cogsSource, 'snapshot');
  assert.equal(breakdown.commissionStatus, 'missing');
  assert.equal(breakdown.marketplaceCommission, 0);
  assert.equal(breakdown.estimatedMarketplaceCommission, 60);

  // Complete order with both COGS snapshot and recorded commission IS profit-calculable
  const completeOrder = makeOrder({
    ...deliveredOrder,
    id: 'ORD-COMPLETE-1',
    marketplaceCommission: 50,
  });
  const completeBreakdown = computeOrderFinancialBreakdown(completeOrder, [prod]);
  assert.equal(completeBreakdown.isProfitCalculable, true);
  assert.equal(completeBreakdown.confirmedNet, 220); // 500 - 50 - 30 - 200
  assert.equal(completeBreakdown.recordedCostMargin, 220);
  assert.equal(completeBreakdown.estimatedNet, 220);
  assert.equal(completeBreakdown.commissionStatus, 'recorded');

  // Missing COGS blocks all profit/margin outputs even if commission is recorded
  const noCostProd = makeProduct({ id: 'p-missing', sku: 'MISS-1', baseCost: undefined });
  const orderMissingCost = makeOrder({
    status: 'delivered',
    marketplaceCommission: 36,
    items: [
      {
        productId: noCostProd.id,
        productSku: noCostProd.sku,
        productName: noCostProd.name,
        imageUrl: noCostProd.imageUrl,
        quantity: 1,
        unitPrice: 300,
      },
    ],
  });
  const missingBreakdown = computeOrderFinancialBreakdown(orderMissingCost, [noCostProd]);
  assert.equal(missingBreakdown.isProfitCalculable, false);
  assert.equal(missingBreakdown.confirmedNet, null);
  assert.equal(missingBreakdown.recordedCostMargin, null);
  assert.equal(missingBreakdown.estimatedNet, null);
  assert.equal(missingBreakdown.cogsSource, 'missing');

  const summary = computeFinancialSummary(
    [deliveredOrder, orderMissingCost],
    [
      {
        id: 'tx-1',
        orderId: deliveredOrder.id,
        marketplaceId: 'noon',
        type: 'courier_shipping',
        amount: 30,
        currency: 'SAR',
        status: 'confirmed',
        source: 'automatic',
        date: '2026-11-10T10:00:00Z',
        notes: 'شحن',
      },
    ],
    [prod, noCostProd]
  );
  assert.equal(summary.ordersMissingCostCount, 1);
  assert.equal(summary.ordersMissingCommissionCount, 1);
  assert.equal(summary.courierShippingExpenses, 30);
  assert.equal(summary.estimatedUnrecordedCommissions, 60);
});

// ---------------------------------------------------------------------------
// 6. Custody Floor Protection, Inventory Edits & Zero-Price Math
// ---------------------------------------------------------------------------
test('custody floor protects locked stock and price change handles previousPrice === 0 cleanly', () => {
  const prod = makeProduct({
    physicalStock: 18,
    availableStock: 10,
    reservedStock: 3,
    awaitingInspectionStock: 2,
    damagedStock: 3,
  });

  assert.equal(getLockedCustodyFloor(prod), 8);

  // Reject reducing physical below locked floor (8)
  const badEdit = computeEditedAvailableStock(prod, 7);
  assert.equal(badEdit.valid, false);
  assert.equal(badEdit.minAllowed, 8);

  const badManual = applyManualStockAdjustmentPure([prod], prod.id, 7, 'جرد خاطئ');
  assert.equal(badManual.success, false);

  // Valid physical increase preserves damagedStock & awaitingInspectionStock
  const goodManual = applyManualStockAdjustmentPure([prod], prod.id, 22, 'توريد إضافي');
  assert.equal(goodManual.success, true);
  assert.equal(goodManual.products[0].physicalStock, 22);
  assert.equal(goodManual.products[0].availableStock, 14);
  assert.equal(goodManual.products[0].damagedStock, 3);
  assert.equal(goodManual.products[0].awaitingInspectionStock, 2);

  // Zero previous price never produces Infinity or NaN
  const zeroMetrics = computePriceChangeMetrics(0, 120);
  assert.equal(zeroMetrics.valid, true);
  assert.equal(zeroMetrics.percentageDiff, 0);
  assert.equal(Number.isFinite(zeroMetrics.percentageDiff), true);

  const negativePrice = computePriceChangeMetrics(100, -10);
  assert.equal(negativePrice.valid, false);
});

// ---------------------------------------------------------------------------
// 7. Smart Import Custody & Note Updates
// ---------------------------------------------------------------------------
test('saveSmartImportOrdersPure handles with_delivery, rejected, cancelled, and delivered cleanly', () => {
  const prod = makeProduct({ physicalStock: 20, availableStock: 20 });

  const ordersToImport: Order[] = [
    makeOrder({ id: 'IMP-1', status: 'with_delivery', items: [{ productId: prod.id, productSku: prod.sku, productName: prod.name, imageUrl: prod.imageUrl, quantity: 3, unitPrice: 200 }] }),
    makeOrder({ id: 'IMP-2', status: 'rejected', items: [{ productId: prod.id, productSku: prod.sku, productName: prod.name, imageUrl: prod.imageUrl, quantity: 2, unitPrice: 200 }] }),
    makeOrder({ id: 'IMP-3', status: 'cancelled', items: [{ productId: prod.id, productSku: prod.sku, productName: prod.name, imageUrl: prod.imageUrl, quantity: 5, unitPrice: 200 }] }),
    makeOrder({ id: 'IMP-4', status: 'delivered', items: [{ productId: prod.id, productSku: prod.sku, productName: prod.name, imageUrl: prod.imageUrl, quantity: 4, unitPrice: 200 }] }),
  ];

  const res = saveSmartImportOrdersPure({
    ordersToImport,
    isHistoricalDeducted: true,
    existingOrders: [],
    products: [prod],
    returns: [],
  });

  assert.equal(res.importedCount, 2); // with_delivery + rejected
  assert.equal(res.historicalCount, 2); // cancelled + delivered
  assert.equal(res.duplicateCount, 0);
  assert.equal(res.products[0].outboundInTransitStock, 3);
  assert.equal(res.products[0].returnInTransitStock, 2);
  assert.equal(res.products[0].availableStock, 11); // 20 - 3 - 2 - 4 (cancelled does not deduct)
  assert.equal(res.products[0].physicalStock, 16); // 20 - 4 delivered
  assert.equal(res.returns.length, 1);
  assert.equal(res.returns[0].orderId, 'IMP-2');
  assert.ok(res.orders.every((o) => o.items.every((it) => it.unitCostSnapshot === 100)));

  const noteRes = addReturnNotePure({
    returnId: res.returns[0].id,
    note: 'تم التواصل مع شركة الشحن',
    returns: res.returns,
  });
  assert.equal(noteRes.success, true);
  assert.equal(noteRes.returnRecord?.notes, 'تم التواصل مع شركة الشحن');
});

// ---------------------------------------------------------------------------
// 8. End-to-End StorageService Persistence with In-Memory localStorage
// ---------------------------------------------------------------------------
test('storageService executes end-to-end order -> return -> inspection -> price history persistence cleanly', () => {
  const backing = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key: string) {
      return backing.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(backing.keys())[index] ?? null;
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    setItem(key: string, value: string) {
      backing.set(key, value);
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  storageService.resetToSample();

  const initialProducts = storageService.getProducts();
  const targetProd = initialProducts[0];
  const startAvail = targetProd.availableStock;

  const created = storageService.createOrder({
    marketplaceId: 'noon',
    customerName: 'تجربة تكامل',
    shippingAddress: 'الرياض',
    items: [
      {
        productId: targetProd.id,
        productSku: targetProd.sku,
        productName: targetProd.name,
        imageUrl: targetProd.imageUrl,
        quantity: 2,
        unitPrice: targetProd.currentPrice,
      },
    ],
    totalAmount: targetProd.currentPrice * 2,
    shippingCost: 22,
    marketplaceCommission: 35,
    status: 'preparing',
    orderDate: '2026-11-10T10:00:00Z',
  });
  assert.equal(created.success, true);
  assert.ok(created.order);

  assert.equal(storageService.getProductById(targetProd.id)?.availableStock, startAvail - 2);

  const handover = storageService.updateOrderStatus(created.order.id, 'with_delivery');
  assert.equal(handover.success, true);

  const rejected = storageService.updateOrderStatus(created.order.id, 'rejected');
  assert.equal(rejected.success, true);

  const ret = storageService.getReturns().find((r) => r.orderId === created.order!.id);
  assert.ok(ret);

  const noteSave = storageService.addReturnNote(ret.id, 'ملاحظة فحص');
  assert.equal(noteSave.success, true);

  const dock = storageService.advanceReturnStatus(ret.id, 'received_at_warehouse');
  assert.equal(dock.success, true);

  const insp = storageService.processReturnInspection(ret.id, 'restockable', 'like_new', 'سليم');
  assert.equal(insp.success, true);
  assert.equal(storageService.getProductById(targetProd.id)?.availableStock, startAvail);

  const ph = storageService.updateProductPrice(targetProd.id, 'noon', targetProd.currentPrice + 10, 'تعديل سعر');
  assert.ok(ph);
  assert.equal(storageService.getPriceHistory()[0].newPrice, targetProd.currentPrice + 10);
});

// ---------------------------------------------------------------------------
// 9. Clean Startup (No Auto-Seeded Fake Products) & Developer-Only Seeding
// ---------------------------------------------------------------------------
test('storageService.init starts completely empty without fake demo products unless explicitly seeded in Developer Center', () => {
  const backing = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key: string) {
      return backing.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(backing.keys())[index] ?? null;
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    setItem(key: string, value: string) {
      backing.set(key, value);
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  const initRes = storageService.init();
  assert.equal(initRes.success, true);
  assert.equal(storageService.getProducts().length, 0);
  assert.equal(storageService.getOrders().length, 0);
  assert.equal(storageService.getReturns().length, 0);
  assert.equal(storageService.getMovements().length, 0);
  assert.equal(storageService.getFinancialTransactions().length, 0);

  // Explicit Developer Center demo seeding
  const seedRes = storageService.loadDemoSampleData();
  assert.equal(seedRes.success, true);
  assert.equal(storageService.getProducts().length, DEFAULT_PRODUCTS.length);
  assert.equal(storageService.getOrders().length, DEFAULT_ORDERS.length);

  // Calling init() again preserves existing store data
  storageService.init();
  assert.equal(storageService.getProducts().length, DEFAULT_PRODUCTS.length);

  // Explicit Developer Center clear resets to clean empty store
  const clearRes = storageService.clearAllStoreData();
  assert.equal(clearRes.success, true);
  assert.equal(storageService.getProducts().length, 0);
  assert.equal(storageService.getOrders().length, 0);
});

// ---------------------------------------------------------------------------
// 10. LocalStorage Reliability: QuotaExceededError, Multi-Key Rollback, Corruption Preservation, Idempotency
// ---------------------------------------------------------------------------
test('storageService rolls back multi-key writes on QuotaExceededError, preserves corrupted JSON, and prevents duplicate ledger/movement rows', () => {
  const backing = new Map<string, string>();
  let failOnKey: string | null = null;
  let throwQuota = true;

  const installMockStorage = () => {
    const mockStorage: Storage = {
      get length() {
        return backing.size;
      },
      clear() {
        backing.clear();
      },
      getItem(key: string) {
        return backing.get(key) ?? null;
      },
      key(index: number) {
        return Array.from(backing.keys())[index] ?? null;
      },
      removeItem(key: string) {
        backing.delete(key);
      },
      setItem(key: string, value: string) {
        if (failOnKey && key === failOnKey) {
          if (throwQuota) {
            const err = new Error('The quota has been exceeded.');
            err.name = 'QuotaExceededError';
            throw err;
          }
          throw new Error('Disk failure');
        }
        backing.set(key, value);
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    });
  };

  installMockStorage();
  storageService.clearAllStoreData();

  const prod = makeProduct({ id: 'prod-rb-1', sku: 'RB-SKU-1', physicalStock: 10, availableStock: 10 });
  assert.equal(storageService.saveProduct(prod).success, true);

  // Snapshot before multi-key failure in createOrder:
  // Order writes PRODUCTS -> ORDERS -> MOVEMENTS. Fail on ORDERS (2nd key)!
  const preProductsJson = backing.get(STORAGE_KEYS.PRODUCTS);
  const preOrdersJson = backing.get(STORAGE_KEYS.ORDERS);
  const preMovementsJson = backing.get(STORAGE_KEYS.MOVEMENTS);

  failOnKey = STORAGE_KEYS.ORDERS;
  throwQuota = true;
  const failedOrder = storageService.createOrder({
    marketplaceId: 'noon',
    customerName: 'عميل فشل مساحة',
    shippingAddress: 'الرياض',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 2,
        unitPrice: 200,
      },
    ],
    totalAmount: 400,
    shippingCost: 20,
    status: 'preparing',
    orderDate: '2026-11-10T10:00:00Z',
  });
  failOnKey = null;

  assert.equal(failedOrder.success, false);
  assert.equal(failedOrder.quotaExceeded, true);
  assert.equal(failedOrder.rolledBack, true);
  // PRODUCTS must be restored to exact pre-operation state (availableStock=10, reservedStock=0)
  assert.equal(backing.get(STORAGE_KEYS.PRODUCTS), preProductsJson);
  assert.equal(backing.get(STORAGE_KEYS.ORDERS), preOrdersJson);
  assert.equal(backing.get(STORAGE_KEYS.MOVEMENTS), preMovementsJson);
  assert.equal(storageService.getProductById(prod.id)?.availableStock, 10);
  assert.equal(storageService.getOrders().length, 0);

  // Succeed creating an order cleanly, then fail on last key (FINANCIAL_TRANSACTIONS) during delivered status update
  const okOrder = storageService.createOrder({
    marketplaceId: 'noon',
    customerName: 'عميل سليم',
    shippingAddress: 'الرياض',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 2,
        unitPrice: 200,
      },
    ],
    totalAmount: 400,
    shippingCost: 20,
    marketplaceCommission: 40,
    status: 'preparing',
    orderDate: '2026-11-10T10:00:00Z',
  });
  assert.equal(okOrder.success, true);

  assert.equal(storageService.updateOrderStatus(okOrder.order!.id, 'with_delivery').success, true);
  const preDeliverProducts = backing.get(STORAGE_KEYS.PRODUCTS);
  const preDeliverOrders = backing.get(STORAGE_KEYS.ORDERS);
  const preDeliverTx = backing.get(STORAGE_KEYS.FINANCIAL_TRANSACTIONS);

  // Fail on FINANCIAL_TRANSACTIONS (last key of delivered transition) -> must roll back PRODUCTS, ORDERS, MOVEMENTS
  failOnKey = STORAGE_KEYS.FINANCIAL_TRANSACTIONS;
  const failedDeliver = storageService.updateOrderStatus(okOrder.order!.id, 'delivered');
  failOnKey = null;
  assert.equal(failedDeliver.success, false);
  assert.equal(failedDeliver.rolledBack, true);
  assert.equal(backing.get(STORAGE_KEYS.PRODUCTS), preDeliverProducts);
  assert.equal(backing.get(STORAGE_KEYS.ORDERS), preDeliverOrders);
  assert.equal(backing.get(STORAGE_KEYS.FINANCIAL_TRANSACTIONS), preDeliverTx);

  // Idempotency: duplicate transactions and duplicate movement IDs are not duplicated
  const txSample: FinancialTransaction = {
    id: 'tx-idem-1',
    orderId: okOrder.order!.id,
    marketplaceId: 'noon',
    type: 'courier_shipping',
    amount: 20,
    currency: 'SAR',
    status: 'confirmed',
    source: 'automatic',
    date: '2026-11-10T10:00:00Z',
    notes: 'شحن',
  };
  assert.equal(storageService.recordFinancialTransactionWithResult(txSample).success, true);
  assert.equal(storageService.recordFinancialTransactionWithResult({ ...txSample }).success, true);
  assert.equal(
    storageService.getFinancialTransactions().filter((t) => t.id === 'tx-idem-1').length,
    1
  );

  // Movement idempotency: repeating the same StockMovement id or lifecycle signature does not duplicate
  const movSample: StockMovement = {
    id: 'mov-idem-1',
    productId: prod.id,
    productName: prod.name,
    productSku: prod.sku,
    type: 'order_created',
    quantityChange: -2,
    previousPhysical: 10,
    newPhysical: 10,
    previousAvailable: 10,
    newAvailable: 8,
    reason: 'اختبار تكرار',
    operator: 'مدير العمليات',
    referenceOrderId: 'ORD-IDEM-CHECK',
    timestamp: '2026-11-10T10:00:00Z',
  };
  assert.equal(storageService.recordStockMovements([movSample]).success, true);
  assert.equal(storageService.recordStockMovements([{ ...movSample, id: 'mov-idem-2' }]).success, true);
  assert.equal(
    storageService.getMovements().filter((m) => m.referenceOrderId === 'ORD-IDEM-CHECK').length,
    1
  );

  // Corrupted JSON preservation: never silently overwrite or trigger resetToSample
  const rawCorrupted = '{"broken": [1, 2,';
  backing.set(STORAGE_KEYS.PRODUCTS, rawCorrupted);
  const readAfterCorruption = storageService.getProducts();
  assert.deepEqual(readAfterCorruption, []);
  assert.equal(backing.get(STORAGE_KEYS.PRODUCTS), rawCorrupted);
  assert.ok(storageService.getCorruptedKeys().includes(STORAGE_KEYS.PRODUCTS));

  // Saving a product while PRODUCTS is corrupted must refuse overwrite
  const blockedWrite = storageService.saveProduct(prod);
  assert.equal(blockedWrite.success, false);
  assert.equal(backing.get(STORAGE_KEYS.PRODUCTS), rawCorrupted);
});

// ---------------------------------------------------------------------------
// 11. Comprehensive Financial Summary Scenarios (All 8 Required Cases)
// ---------------------------------------------------------------------------
test('computeFinancialSummary handles all 8 confirmed/pending/cancelled, refund, filter & deduplication scenarios accurately', () => {
  const prod = makeProduct({ id: 'p-fin', sku: 'FIN-1', baseCost: 50 });

  const ordNoonJan = makeOrder({
    id: 'ORD-NOON-JAN',
    marketplaceId: 'noon',
    status: 'delivered',
    totalAmount: 1000,
    marketplaceCommission: 100,
    orderDate: '2026-11-10T10:00:00Z',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 2,
        unitPrice: 500,
        unitCostSnapshot: 50,
      },
    ],
  });

  const ordAmazonJan = makeOrder({
    id: 'ORD-AMZ-JAN',
    marketplaceId: 'amazon',
    status: 'delivered',
    totalAmount: 500,
    marketplaceCommission: 50,
    orderDate: '2026-11-10T10:00:00Z',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 1,
        unitPrice: 500,
        unitCostSnapshot: 50,
      },
    ],
  });

  const ordNoonOld = makeOrder({
    id: 'ORD-NOON-OLD',
    marketplaceId: 'noon',
    status: 'delivered',
    totalAmount: 400,
    marketplaceCommission: 40,
    orderDate: '2026-09-05T10:00:00Z',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 1,
        unitPrice: 400,
        unitCostSnapshot: 50,
      },
    ],
  });

  const txs: FinancialTransaction[] = [
    // Confirmed commission for Noon Jan
    {
      id: 'tx-comm-1',
      orderId: ordNoonJan.id,
      marketplaceId: 'noon',
      type: 'marketplace_commission',
      amount: 100,
      currency: 'SAR',
      status: 'confirmed',
      source: 'automatic',
      date: '2026-11-10T10:00:00Z',
      notes: 'عمولة',
    },
    // Duplicate automatic commission with different ID (Scenario 8: deduplication)
    {
      id: 'tx-comm-1-dup-auto',
      orderId: ordNoonJan.id,
      marketplaceId: 'noon',
      type: 'marketplace_commission',
      amount: 100,
      currency: 'SAR',
      status: 'confirmed',
      source: 'automatic',
      date: '2026-11-10T10:00:00Z',
      notes: 'عمولة مكررة',
    },
    // Scenario 1: Pending return shipping (MUST NOT enter returnShippingExpenses or confirmedExpenses)
    {
      id: 'tx-ret-ship-pend',
      orderId: ordNoonJan.id,
      returnId: 'RET-1',
      marketplaceId: 'noon',
      type: 'return_shipping',
      amount: 35,
      currency: 'SAR',
      status: 'pending',
      source: 'automatic',
      date: '2026-11-11T10:00:00Z',
      notes: 'شحن مرتجع معلق',
    },
    // Scenario 2: Confirmed return shipping (MUST enter returnShippingExpenses and confirmedExpenses)
    {
      id: 'tx-ret-ship-conf',
      orderId: ordNoonJan.id,
      returnId: 'RET-2',
      marketplaceId: 'noon',
      type: 'return_shipping',
      amount: 25,
      currency: 'SAR',
      status: 'confirmed',
      source: 'automatic',
      date: '2026-11-12T10:00:00Z',
      notes: 'شحن مرتجع مؤكد',
    },
    // Scenario 3: Cancelled transaction (MUST NOT enter confirmed OR pending totals)
    {
      id: 'tx-cancelled-1',
      orderId: ordNoonJan.id,
      marketplaceId: 'noon',
      type: 'courier_shipping',
      amount: 99,
      currency: 'SAR',
      status: 'cancelled',
      source: 'manual',
      date: '2026-11-12T10:00:00Z',
      notes: 'شحنة ملغاة',
    },
    // Scenario 4: Confirmed customer refund (MUST be subtracted in confirmedSettlement)
    {
      id: 'tx-refund-conf',
      orderId: ordNoonJan.id,
      marketplaceId: 'noon',
      type: 'customer_refund',
      amount: 120,
      currency: 'SAR',
      status: 'confirmed',
      source: 'manual',
      date: '2026-11-12T12:00:00Z',
      notes: 'استرداد مؤكد للعميل',
    },
    // Scenario 5: Pending customer refund (MUST NOT be subtracted from confirmedSettlement; only expectedSettlement)
    {
      id: 'tx-refund-pend',
      orderId: ordNoonJan.id,
      marketplaceId: 'noon',
      type: 'customer_refund',
      amount: 80,
      currency: 'SAR',
      status: 'pending',
      source: 'manual',
      date: '2026-11-12T13:00:00Z',
      notes: 'استرداد معلق',
    },
    // Amazon commission in November (for Scenario 6 marketplace filter check)
    {
      id: 'tx-amz-comm',
      orderId: ordAmazonJan.id,
      marketplaceId: 'amazon',
      type: 'marketplace_commission',
      amount: 50,
      currency: 'SAR',
      status: 'confirmed',
      source: 'automatic',
      date: '2026-11-10T10:00:00Z',
      notes: 'عمولة أمازون',
    },
    // Old Noon commission in September (for Scenario 7 date range filter check)
    {
      id: 'tx-old-comm',
      orderId: ordNoonOld.id,
      marketplaceId: 'noon',
      type: 'marketplace_commission',
      amount: 40,
      currency: 'SAR',
      status: 'confirmed',
      source: 'automatic',
      date: '2026-09-05T10:00:00Z',
      notes: 'عمولة سبتمبر',
    },
  ];

  // Duplicate ID scenario (push identical id object)
  txs.push({ ...txs[0] });

  const novRange = {
    start: new Date('2026-11-01T00:00:00Z'),
    end: new Date('2026-11-30T23:59:59Z'),
  };

  // Filtered by Noon + November DateRange
  const noonNov = computeFinancialSummary(
    [ordNoonJan, ordAmazonJan, ordNoonOld],
    txs,
    [prod],
    novRange,
    'noon'
  );

  assert.equal(noonNov.deliveredRevenue, 1000);
  assert.equal(noonNov.confirmedRevenue, 1000);
  // Confirmed commission (100, deduplicated from 3 copies) + confirmed return shipping (25) = 125
  assert.equal(noonNov.marketplaceCommissions, 100);
  assert.equal(noonNov.returnShippingExpenses, 25);
  assert.equal(noonNov.confirmedExpenses, 125);
  // Confirmed refund = 120
  assert.equal(noonNov.confirmedRefunds, 120);
  // Confirmed settlement = 1000 - 125 - 120 = 755
  assert.equal(noonNov.confirmedSettlement, 755);

  // Pending return shipping (35) + Pending refund (80) = 115
  assert.equal(noonNov.pendingReturnShipping, 35);
  assert.equal(noonNov.pendingExpenses, 35);
  assert.equal(noonNov.pendingRefunds, 80);
  assert.equal(noonNov.pendingTransactionsTotal, 115);

  // Expected settlement = 755 - 35 - 80 = 640
  assert.equal(noonNov.expectedSettlement, 640);

  // Cancelled tx (99) tracked separately and NEVER enters confirmed or pending
  assert.equal(noonNov.cancelledTransactionsCount, 1);
  assert.equal(noonNov.cancelledTransactionsTotal, 99);

  // Filtered by Amazon + November DateRange (Scenario 6 & 7 cross-check)
  const amzNov = computeFinancialSummary(
    [ordNoonJan, ordAmazonJan, ordNoonOld],
    txs,
    [prod],
    novRange,
    'amazon'
  );
  assert.equal(amzNov.deliveredRevenue, 500);
  assert.equal(amzNov.marketplaceCommissions, 50);
  assert.equal(amzNov.confirmedRefunds, 0);
  assert.equal(amzNov.pendingTransactionsTotal, 0);
  assert.equal(amzNov.confirmedSettlement, 450);
});

// ---------------------------------------------------------------------------
// 12. Central Pool vs Platform Allocation Custody & Restock Routing
// ---------------------------------------------------------------------------
test('central pool and platform allocations reconcile without double-counting across orders and returns', () => {
  const baseProd = makeProduct({
    id: 'p-alloc-1',
    sku: 'ALLOC-SKU-1',
    physicalStock: 10,
    availableStock: 10,
  });

  // Allocate 4 to Noon (should leave 6 central, 4 platform, total available still 10)
  const alloc1 = allocateStockToPlatformPure({
    products: [baseProd],
    productId: baseProd.id,
    marketplaceId: 'noon',
    quantity: 4,
    isMarketplaceActive: true,
  });
  assert.equal(alloc1.success, true);
  assert.equal(alloc1.products[0].centralAvailableStock, 6);
  assert.equal(alloc1.products[0].availableStock, 10);
  assert.equal(alloc1.products[0].physicalStock, 10);
  assert.equal(getTotalPlatformAllocatedStock(alloc1.products[0]), 4);
  assert.deepEqual(getSellableCapacityForMarketplace(alloc1.products[0], 'noon'), {
    sellable: 4,
    source: 'platform',
  });
  assert.deepEqual(getSellableCapacityForMarketplace(alloc1.products[0], 'amazon'), {
    sellable: 6,
    source: 'central',
  });

  // Block over-allocation above centralAvailableStock (7 > 6)
  const overAlloc = allocateStockToPlatformPure({
    products: alloc1.products,
    productId: baseProd.id,
    marketplaceId: 'amazon',
    quantity: 7,
    isMarketplaceActive: true,
  });
  assert.equal(overAlloc.success, false);

  // Order 3 units on Noon -> consumes Noon platform allocation (4 -> 1 available, 3 reserved)
  const ordRes = createOrderPure({
    orderData: {
      marketplaceId: 'noon',
      customerName: 'عميل منصة نون',
      shippingAddress: 'الرياض',
      items: [
        {
          productId: baseProd.id,
          productSku: baseProd.sku,
          productName: baseProd.name,
          imageUrl: baseProd.imageUrl,
          quantity: 3,
          unitPrice: 200,
        },
      ],
      totalAmount: 600,
      shippingCost: 20,
      status: 'preparing',
      orderDate: '2026-11-12T10:00:00Z',
    },
    products: alloc1.products,
    existingOrders: [],
    customId: 'ORD-ALLOC-1',
  });
  assert.equal(ordRes.success, true);
  const pAfterOrder = ordRes.products[0];
  assert.equal(pAfterOrder.centralAvailableStock, 6);
  assert.equal(pAfterOrder.platformAllocations?.noon?.availableQty, 1);
  assert.equal(pAfterOrder.platformAllocations?.noon?.reservedQty, 3);
  assert.equal(pAfterOrder.availableStock, 7);

  // Attempting to release 2 unreserved units from Noon (only 1 unreserved) fails
  const badRelease = releasePlatformAllocationPure({
    products: ordRes.products,
    productId: baseProd.id,
    marketplaceId: 'noon',
    quantity: 2,
  });
  assert.equal(badRelease.success, false);

  // Releasing 1 unreserved unit returns it cleanly to central (6 -> 7)
  const okRelease = releasePlatformAllocationPure({
    products: ordRes.products,
    productId: baseProd.id,
    marketplaceId: 'noon',
    quantity: 1,
  });
  assert.equal(okRelease.success, true);
  assert.equal(okRelease.products[0].centralAvailableStock, 7);
  assert.equal(okRelease.products[0].platformAllocations?.noon?.availableQty, 0);

  // Handover -> courier rejection -> warehouse receipt -> restock directly to Amazon platform allocation
  const handover = updateOrderStatusPure({
    orderId: 'ORD-ALLOC-1',
    newStatus: 'with_delivery',
    orders: ordRes.orders,
    products: okRelease.products,
    returns: [],
    currency: 'SAR',
  });
  assert.equal(handover.success, true);

  const rejected = updateOrderStatusPure({
    orderId: 'ORD-ALLOC-1',
    newStatus: 'rejected',
    orders: handover.orders,
    products: handover.products,
    returns: handover.returns,
    currency: 'SAR',
  });
  assert.equal(rejected.success, true);

  const retId = rejected.returns[0].id;
  const received = advanceReturnStatusPure({
    returnId: retId,
    targetStatus: 'received_at_warehouse',
    returns: rejected.returns,
    products: rejected.products,
    orders: rejected.orders,
  });
  assert.equal(received.success, true);

  // Inspect 3 units as restockable targeted explicitly to active 'amazon' allocation
  const inspected = processReturnInspectionPure({
    returnId: retId,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'توجيه لمنصة أمازون',
    restockTarget: 'amazon',
    activeMarketplaceIds: ['noon', 'amazon'],
    returns: received.returns,
    products: received.products,
    orders: rejected.orders,
    currency: 'SAR',
  });
  assert.equal(inspected.success, true);
  assert.equal(inspected.products[0].centralAvailableStock, 7);
  assert.equal(inspected.products[0].platformAllocations?.amazon?.availableQty, 3);
  assert.equal(inspected.products[0].availableStock, 10);
});

// ---------------------------------------------------------------------------
// 13. Sequential Partial Returns & Ledger Write-Error Safety
// ---------------------------------------------------------------------------
test('partial post-delivery returns bound remaining quantities accurately and emit distinct return ledger eventRefs', () => {
  const prod = makeProduct({ id: 'p-part-1', sku: 'PART-SKU-1', physicalStock: 10, availableStock: 10 });
  const deliveredOrder = makeOrder({
    id: 'ORD-PART-1',
    status: 'delivered',
    deliveredProcessed: true,
    isClosed: true,
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 5,
        unitPrice: 100,
        unitCostSnapshot: 60,
      },
    ],
    totalAmount: 500,
  });

  // First partial return: 2 of 5 units
  const partial1 = registerPostDeliveryReturnPure({
    orderId: deliveredOrder.id,
    reason: 'مقاس غير مناسب',
    selectedItems: [{ productId: prod.id, productSku: prod.sku, quantity: 2 }],
    orders: [deliveredOrder],
    returns: [],
    products: [prod],
    currency: 'SAR',
  });
  assert.equal(partial1.success, true);
  assert.equal(partial1.returnRecord?.items[0].quantity, 2);

  // Remaining returnable quantity must now be 3
  const remAfter1 = getOrderReturnableItems(partial1.orders[0], partial1.returns);
  assert.equal(remAfter1[0].alreadyReturnedQty, 2);
  assert.equal(remAfter1[0].remainingQty, 3);

  // Attempting to return 4 units (> 3 remaining) must fail
  const overRet = registerPostDeliveryReturnPure({
    orderId: deliveredOrder.id,
    reason: 'تجاوز الكمية',
    selectedItems: [{ productId: prod.id, productSku: prod.sku, quantity: 4 }],
    orders: partial1.orders,
    returns: partial1.returns,
    products: partial1.products,
    currency: 'SAR',
  });
  assert.equal(overRet.success, false);

  // Second partial return: remaining 3 units
  const partial2 = registerPostDeliveryReturnPure({
    orderId: deliveredOrder.id,
    reason: 'باقي الكمية',
    selectedItems: [{ productId: prod.id, productSku: prod.sku, quantity: 3 }],
    orders: partial1.orders,
    returns: partial1.returns,
    products: partial1.products,
    currency: 'SAR',
  });
  assert.equal(partial2.success, true);

  // Return shipping transactions must have distinct eventRefs per return ID
  assert.notEqual(partial1.newTransactions[0].eventRef, partial2.newTransactions[0].eventRef);

  // Damaged return must set rejectedFromResale=true and rejectedResaleStock=2 without adding to availableStock
  const recv1 = advanceReturnStatusPure({
    returnId: partial1.returnRecord!.id,
    targetStatus: 'received_at_warehouse',
    returns: partial2.returns,
    products: partial2.products,
    orders: partial2.orders,
  });
  assert.equal(recv1.success, true);

  const dmgInsp = processReturnInspectionPure({
    returnId: partial1.returnRecord!.id,
    outcome: 'damaged',
    condition: 'damaged',
    notes: 'تالف أثناء الشحن',
    returns: recv1.returns,
    products: recv1.products,
    orders: partial2.orders,
    currency: 'SAR',
  });
  assert.equal(dmgInsp.success, true);
  const inspectedRet = dmgInsp.returns.find((r) => r.id === partial1.returnRecord!.id);
  assert.equal(inspectedRet?.rejectedFromResale, true);
  assert.equal(dmgInsp.products[0].damagedStock, 2);
  assert.equal(dmgInsp.products[0].rejectedResaleStock, 2);
  assert.equal(dmgInsp.products[0].availableStock, 10);
});

// ---------------------------------------------------------------------------
// 14. Dynamic Platform Isolation & Excel Columns
// ---------------------------------------------------------------------------
test('disabled marketplaces block new orders/allocations and Excel columns while keeping historical visibility', () => {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() { return backing.size; },
      clear() { backing.clear(); },
      getItem(k: string) { return backing.get(k) ?? null; },
      key(i: number) { return Array.from(backing.keys())[i] ?? null; },
      removeItem(k: string) { backing.delete(k); },
      setItem(k: string, v: string) { backing.set(k, v); },
    },
    configurable: true,
    writable: true,
  });

  storageService.init();
  storageService.clearAllStoreData();

  const prod = makeProduct({ id: 'p-mkt-1', sku: 'MKT-1', physicalStock: 10, availableStock: 10 });
  assert.equal(storageService.saveProduct(prod).success, true);

  // Create historical order on Amazon while active
  const ordRes = storageService.createOrder({
    marketplaceId: 'amazon',
    customerName: 'عميل تاريخي',
    shippingAddress: 'جدة',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 1,
        unitPrice: 200,
      },
    ],
    totalAmount: 200,
    shippingCost: 20,
    status: 'preparing',
    orderDate: '2026-11-12T10:00:00Z',
  });
  assert.equal(ordRes.success, true);

  // Disable Amazon -> active marketplaces should exclude Amazon, Excel columns exclude Amazon, allocations & orders blocked
  assert.equal(storageService.setMarketplaceActive('amazon', false).success, true);
  assert.equal(storageService.getActiveMarketplaces().some((m) => m.id === 'amazon'), false);
  assert.equal(storageService.getAllMarketplaces().some((m) => m.id === 'amazon'), true);

  const dynamicCols = getDynamicTemplateColumns();
  assert.equal(dynamicCols.some((c) => c.toLowerCase().includes('amazon')), false);

  const blockedAlloc = storageService.allocateStockToPlatform(prod.id, 'amazon', 2);
  assert.equal(blockedAlloc.success, false);

  const blockedOrder = storageService.createOrder({
    marketplaceId: 'amazon',
    customerName: 'عميل محظور',
    shippingAddress: 'جدة',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 1,
        unitPrice: 200,
      },
    ],
    totalAmount: 200,
    shippingCost: 20,
    status: 'preparing',
    orderDate: '2026-11-12T11:00:00Z',
  });
  assert.equal(blockedOrder.success, false);

  // Historical order on disabled Amazon remains intact
  assert.equal(storageService.getOrders().some((o) => o.id === ordRes.order!.id), true);
});

// ---------------------------------------------------------------------------
// 15. Multi-Merchant Isolation, Developer Mode Gating & Pre-Destructive Backups
// ---------------------------------------------------------------------------
test('multi-merchant workspaces isolate data, developer passcode gates access, and backups restore state', () => {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() { return backing.size; },
      clear() { backing.clear(); },
      getItem(k: string) { return backing.get(k) ?? null; },
      key(i: number) { return Array.from(backing.keys())[i] ?? null; },
      removeItem(k: string) { backing.delete(k); },
      setItem(k: string, v: string) { backing.set(k, v); },
    },
    configurable: true,
    writable: true,
  });

  storageService.init();
  storageService.clearAllStoreData();

  // Developer Mode defaults to false, rejects invalid passcodes, unlocks with valid passcode, locks cleanly
  assert.equal(storageService.isDeveloperMode(), false);
  const badUnlock = storageService.unlockDeveloperMode('WRONG-PASS');
  assert.equal(badUnlock.success, false);
  assert.equal(storageService.isDeveloperMode(), false);

  const okUnlock = storageService.unlockDeveloperMode('INGOBIA-DEV-2026');
  assert.equal(okUnlock.success, true);
  assert.equal(storageService.isDeveloperMode(), true);
  assert.ok(storageService.getAdminAuditLog().some((l) => l.action === 'developer_mode_unlocked' && l.success));

  // Save product in default merchant A
  const prodA = makeProduct({ id: 'prod-merch-a', sku: 'MERCH-A-1', physicalStock: 12, availableStock: 12 });
  assert.equal(storageService.saveProduct(prodA).success, true);
  assert.equal(storageService.getProducts().length, 1);

  // Pre-destructive backup captured before clearAllStoreData -> restore recovers product A
  const clearRes = storageService.clearAllStoreData();
  assert.equal(clearRes.success, true);
  assert.equal(storageService.getProducts().length, 0);
  const backups = storageService.getPreDestructiveBackups();
  assert.ok(backups.length >= 1);
  assert.equal(storageService.restorePreDestructiveBackup(backups[0].id).success, true);
  assert.equal(storageService.getProducts().length, 1);
  assert.equal(storageService.getProducts()[0].sku, 'MERCH-A-1');

  // Create & switch to isolated merchant B -> must see zero products from merchant A
  const merchB = storageService.createMerchantAccount({
    storeName: 'متجر النور التجاري',
    merchantName: 'خالد المنصور',
    switchTo: true,
  });
  assert.equal(merchB.success, true);
  assert.equal(storageService.getProducts().length, 0);

  // Switch back to default merchant -> merchant A's product is intact
  assert.equal(storageService.switchMerchantAccount('default').success, true);
  assert.equal(storageService.getProducts().length, 1);
  assert.equal(storageService.getProducts()[0].sku, 'MERCH-A-1');

  assert.equal(storageService.lockDeveloperMode().success, true);
  assert.equal(storageService.isDeveloperMode(), false);
});

// ---------------------------------------------------------------------------
// 16. SmartImport Strict Sellable Stock Enforcement (No Silent Stock Fabrication)
// ---------------------------------------------------------------------------
test('saveSmartImportOrdersPure rejects active orders exceeding sellable stock instead of inventing inventory', () => {
  const prod = makeProduct({ id: 'p-imp-1', sku: 'IMP-1', physicalStock: 2, availableStock: 2 });

  const overOrder = makeOrder({
    id: 'ORD-IMP-OVER',
    marketplaceId: 'noon',
    status: 'preparing',
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 5,
        unitPrice: 200,
      },
    ],
    totalAmount: 1000,
  });

  const res = saveSmartImportOrdersPure({
    ordersToImport: [overOrder],
    isHistoricalDeducted: false,
    existingOrders: [],
    products: [prod],
    returns: [],
    activeMarketplaceIds: ['noon', 'amazon'],
  });

  assert.equal(res.importedCount, 0);
  assert.equal(res.rejectedCount, 1);
  assert.equal(res.rejectedOrders.length, 1);
  assert.equal(res.rejectedOrders[0].orderId, 'ORD-IMP-OVER');
  assert.equal(res.orders.length, 0);
  assert.equal(res.products[0].availableStock, 2);
  assert.equal(res.products[0].physicalStock, 2);
});

// ---------------------------------------------------------------------------
// 17. Refund Integrity Scenario 1: 4 units @ 200 SAR -> 1 unit returned = 200 SAR
//     (and uninspected return is NOT treated as completed refund + snapshot price preserved)
// ---------------------------------------------------------------------------
test('refund integrity: 4 units at 200 SAR with 1 returned generates 200 SAR refund after inspection using original price snapshot', () => {
  // Catalog currentPrice later raised to 350 SAR, but original order snapshot was 200 SAR
  const prod = makeProduct({
    id: 'prod-ref-1',
    sku: 'REF-SKU-1',
    currentPrice: 350,
    baseCost: 90,
    physicalStock: 10,
    availableStock: 10,
  });
  const order = makeOrder({
    id: 'ORD-REF-1',
    merchantId: 'merch-1',
    marketplaceId: 'noon',
    status: 'delivered',
    deliveredProcessed: true,
    isClosed: true,
    totalAmount: 800,
    marketplaceCommission: 80,
    shippingCost: 20,
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 4,
        unitPrice: 200,
        unitCostSnapshot: 90,
      },
    ],
  });

  const reg = registerPostDeliveryReturnPure({
    orderId: order.id,
    reason: 'مرتجع وحدة واحدة',
    selectedItems: [{ productId: prod.id, productSku: prod.sku, quantity: 1 }],
    orders: [order],
    returns: [],
    products: [prod],
    currency: 'SAR',
    merchantId: 'merch-1',
  });
  assert.equal(reg.success, true);

  // Before inspection: NO customer_refund transaction and breakdown.refundAmount === 0
  assert.equal(
    reg.newTransactions.some((t) => t.type === 'customer_refund'),
    false
  );
  const uninspectedBreakdown = computeOrderFinancialBreakdown(
    reg.orders[0],
    reg.products,
    reg.returns,
    []
  );
  assert.equal(uninspectedBreakdown.refundAmount, 0);
  assert.equal(uninspectedBreakdown.pendingRefundAmount, 200);

  const recv = advanceReturnStatusPure({
    returnId: reg.returnRecord!.id,
    targetStatus: 'received_at_warehouse',
    returns: reg.returns,
    products: reg.products,
    orders: reg.orders,
    merchantId: 'merch-1',
  });
  assert.equal(recv.success, true);

  const insp = processReturnInspectionPure({
    returnId: reg.returnRecord!.id,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'وحدة سليمة',
    returns: recv.returns,
    products: recv.products,
    orders: reg.orders,
    currency: 'SAR',
    merchantId: 'merch-1',
  });
  assert.equal(insp.success, true);

  const refundTx = insp.newTransactions.find((t) => t.type === 'customer_refund');
  assert.ok(refundTx);
  assert.equal(refundTx.amount, 200);
  assert.equal(refundTx.orderId, order.id);
  assert.equal(refundTx.returnId, reg.returnRecord!.id);
  assert.equal(refundTx.merchantId, 'merch-1');
  assert.equal(refundTx.marketplaceId, 'noon');
  assert.equal(refundTx.currency, 'SAR');
  assert.equal(refundTx.status, 'confirmed');
  assert.equal(refundTx.eventRef, `return_inspection|customer_refund|${reg.returnRecord!.id}`);

  const inspectedBreakdown = computeOrderFinancialBreakdown(
    insp.orders[0],
    insp.products,
    insp.returns,
    insp.newTransactions as FinancialTransaction[]
  );
  assert.equal(inspectedBreakdown.refundAmount, 200);
  assert.equal(inspectedBreakdown.pendingRefundAmount, 0);
  assert.equal(inspectedBreakdown.refundedItemsCount, 1);
});

// ---------------------------------------------------------------------------
// 18. Refund Integrity Scenario 2: 4 units @ 200 SAR -> all 4 returned = 800 SAR
// ---------------------------------------------------------------------------
test('refund integrity: 4 units at 200 SAR with all 4 returned equals 800 SAR', () => {
  const prod = makeProduct({ id: 'prod-ref-2', sku: 'REF-SKU-2', currentPrice: 299, physicalStock: 5, availableStock: 5 });
  const order = makeOrder({
    id: 'ORD-REF-FULL',
    status: 'delivered',
    deliveredProcessed: true,
    isClosed: true,
    totalAmount: 800,
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 4,
        unitPrice: 200,
        unitCostSnapshot: 100,
      },
    ],
  });

  const reg = registerPostDeliveryReturnPure({
    orderId: order.id,
    reason: 'إرجاع كامل',
    orders: [order],
    returns: [],
    products: [prod],
    currency: 'SAR',
  });
  assert.equal(reg.success, true);

  const recv = advanceReturnStatusPure({
    returnId: reg.returnRecord!.id,
    targetStatus: 'received_at_warehouse',
    returns: reg.returns,
    products: reg.products,
    orders: reg.orders,
  });
  assert.equal(recv.success, true);

  const insp = processReturnInspectionPure({
    returnId: reg.returnRecord!.id,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'إرجاع كامل سليم',
    returns: recv.returns,
    products: recv.products,
    orders: reg.orders,
    currency: 'SAR',
  });
  assert.equal(insp.success, true);

  const refundTx = insp.newTransactions.find((t) => t.type === 'customer_refund');
  assert.ok(refundTx);
  assert.equal(refundTx.amount, 800);

  const breakdown = computeOrderFinancialBreakdown(
    insp.orders[0],
    insp.products,
    insp.returns,
    insp.newTransactions as FinancialTransaction[]
  );
  assert.equal(breakdown.refundAmount, 800);
  assert.equal(breakdown.refundedItemsCount, 4);
});

// ---------------------------------------------------------------------------
// 19. Refund Integrity Scenario 3: Two separate partial returns + multiple products
// ---------------------------------------------------------------------------
test('refund integrity: two separate partial returns and multi-product returns sum accurately without over-refunding', () => {
  const prodA = makeProduct({ id: 'prod-mp-a', sku: 'MP-A', currentPrice: 999, physicalStock: 10, availableStock: 10 });
  const prodB = makeProduct({ id: 'prod-mp-b', sku: 'MP-B', currentPrice: 888, physicalStock: 10, availableStock: 10 });
  const order = makeOrder({
    id: 'ORD-REF-MULTI',
    status: 'delivered',
    deliveredProcessed: true,
    isClosed: true,
    totalAmount: 1100, // 4 * 200 + 2 * 150
    items: [
      {
        productId: prodA.id,
        productSku: prodA.sku,
        productName: prodA.name,
        imageUrl: prodA.imageUrl,
        quantity: 4,
        unitPrice: 200,
        unitCostSnapshot: 90,
      },
      {
        productId: prodB.id,
        productSku: prodB.sku,
        productName: prodB.name,
        imageUrl: prodB.imageUrl,
        quantity: 2,
        unitPrice: 150,
        unitCostSnapshot: 70,
      },
    ],
  });

  // Partial 1: 1 unit of A (200) + 1 unit of B (150) = 350
  const p1 = registerPostDeliveryReturnPure({
    orderId: order.id,
    reason: 'جزئي أول',
    selectedItems: [
      { productId: prodA.id, productSku: prodA.sku, quantity: 1 },
      { productId: prodB.id, productSku: prodB.sku, quantity: 1 },
    ],
    orders: [order],
    returns: [],
    products: [prodA, prodB],
    currency: 'SAR',
  });
  assert.equal(p1.success, true);

  const r1 = advanceReturnStatusPure({
    returnId: p1.returnRecord!.id,
    targetStatus: 'received_at_warehouse',
    returns: p1.returns,
    products: p1.products,
    orders: p1.orders,
  });
  const i1 = processReturnInspectionPure({
    returnId: p1.returnRecord!.id,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'فحص أول',
    returns: r1.returns,
    products: r1.products,
    orders: p1.orders,
    currency: 'SAR',
  });
  assert.equal(i1.success, true);
  assert.equal(i1.newTransactions.find((t) => t.type === 'customer_refund')?.amount, 350);

  // Partial 2: 2 units of A (400) = 400 -> Combined refund = 750
  const p2 = registerPostDeliveryReturnPure({
    orderId: order.id,
    reason: 'جزئي ثاني',
    selectedItems: [{ productId: prodA.id, productSku: prodA.sku, quantity: 2 }],
    orders: i1.orders,
    returns: i1.returns,
    products: i1.products,
    currency: 'SAR',
  });
  assert.equal(p2.success, true);

  const r2 = advanceReturnStatusPure({
    returnId: p2.returnRecord!.id,
    targetStatus: 'received_at_warehouse',
    returns: p2.returns,
    products: p2.products,
    orders: p2.orders,
  });
  const i2 = processReturnInspectionPure({
    returnId: p2.returnRecord!.id,
    outcome: 'restockable',
    condition: 'opened_good',
    notes: 'فحص ثاني',
    returns: r2.returns,
    products: r2.products,
    orders: p2.orders,
    currency: 'SAR',
  });
  assert.equal(i2.success, true);
  assert.equal(i2.newTransactions.find((t) => t.type === 'customer_refund')?.amount, 400);

  const allLedgerTx: FinancialTransaction[] = [
    ...p1.newTransactions.map((t, idx) => ({ ...t, id: `tx-p1-${idx}`, date: '2026-11-16T00:00:00Z' })),
    ...i1.newTransactions.map((t, idx) => ({ ...t, id: `tx-i1-${idx}`, date: '2026-11-16T01:00:00Z' })),
    ...p2.newTransactions.map((t, idx) => ({ ...t, id: `tx-p2-${idx}`, date: '2026-11-16T02:00:00Z' })),
    ...i2.newTransactions.map((t, idx) => ({ ...t, id: `tx-i2-${idx}`, date: '2026-11-16T03:00:00Z' })),
  ];

  const breakdown = computeOrderFinancialBreakdown(i2.orders[0], i2.products, i2.returns, allLedgerTx);
  assert.equal(breakdown.refundAmount, 750);
  assert.equal(breakdown.refundedItemsCount, 4);

  const summary = computeFinancialSummary(i2.orders, allLedgerTx, i2.products);
  assert.equal(summary.confirmedRefunds, 750);
});

// ---------------------------------------------------------------------------
// 20. Refund Integrity Scenario 4: Repeating inspection/write creates ZERO duplicate refunds
// ---------------------------------------------------------------------------
test('refund integrity: repeating the same return processing never creates duplicate refund transactions', () => {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() { return backing.size; },
      clear() { backing.clear(); },
      getItem(k: string) { return backing.get(k) ?? null; },
      key(i: number) { return Array.from(backing.keys())[i] ?? null; },
      removeItem(k: string) { backing.delete(k); },
      setItem(k: string, v: string) { backing.set(k, v); },
    },
    configurable: true,
    writable: true,
  });

  storageService.init();
  storageService.clearAllStoreData();

  const prod = makeProduct({ id: 'prod-dup-ref', sku: 'DUP-REF-1', currentPrice: 200, physicalStock: 10, availableStock: 10 });
  assert.equal(storageService.saveProduct(prod).success, true);

  const ordRes = storageService.createOrder({
    marketplaceId: 'noon',
    status: 'preparing',
    orderDate: '2026-11-16T00:00:00Z',
    totalAmount: 800,
    items: [{ productId: prod.id, productSku: prod.sku, productName: prod.name, imageUrl: prod.imageUrl, quantity: 4, unitPrice: 200 }],
  });
  assert.equal(ordRes.success, true);
  assert.equal(storageService.updateOrderStatus(ordRes.order!.id, 'with_delivery').success, true);
  assert.equal(storageService.updateOrderStatus(ordRes.order!.id, 'delivered').success, true);

  const retRes = storageService.registerPostDeliveryReturn(ordRes.order!.id, 'تبديل', '', [
    { productId: prod.id, productSku: prod.sku, quantity: 1 },
  ]);
  assert.equal(retRes.success, true);

  assert.equal(storageService.advanceReturnStatus(retRes.returnRecord!.id, 'received_at_warehouse').success, true);

  const firstInsp = storageService.processReturnInspection(retRes.returnRecord!.id, 'restockable', 'like_new', 'أول فحص');
  assert.equal(firstInsp.success, true);

  // Repeat inspection via storageService -> blocked cleanly
  const repeatInsp = storageService.processReturnInspection(retRes.returnRecord!.id, 'restockable', 'like_new', 'تكرار');
  assert.equal(repeatInsp.success, false);

  // Even direct retry of recording the same customer_refund eventRef deduplicates without inserting a 2nd row
  const refundTx = storageService
    .getFinancialTransactions()
    .filter((t) => t.type === 'customer_refund' && t.returnId === retRes.returnRecord!.id);
  assert.equal(refundTx.length, 1);
  assert.equal(refundTx[0].amount, 200);

  const dupAppend = storageService.recordFinancialTransactionWithResult({
    eventRef: refundTx[0].eventRef,
    orderId: ordRes.order!.id,
    returnId: retRes.returnRecord!.id,
    marketplaceId: 'noon',
    type: 'customer_refund',
    amount: 200,
    currency: 'SAR',
    status: 'confirmed',
    source: 'automatic',
  });
  assert.equal(dupAppend.deduplicated, true);
  assert.equal(
    storageService.getFinancialTransactions().filter((t) => t.type === 'customer_refund').length,
    1
  );
});

// ---------------------------------------------------------------------------
// 21. Refund Integrity Scenario 5: Over-returning more units than ordered is rejected & capped
// ---------------------------------------------------------------------------
test('refund integrity: returning more units than originally ordered is rejected and refundAmount is bounded', () => {
  const prod = makeProduct({ id: 'prod-over-ref', sku: 'OVER-REF-1', physicalStock: 10, availableStock: 10 });
  const order = makeOrder({
    id: 'ORD-OVER-REF',
    status: 'delivered',
    deliveredProcessed: true,
    isClosed: true,
    totalAmount: 800,
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 4,
        unitPrice: 200,
        unitCostSnapshot: 90,
      },
    ],
  });

  // Single request exceeding ordered qty
  const overSingle = registerPostDeliveryReturnPure({
    orderId: order.id,
    reason: 'تجاوز مباشر',
    selectedItems: [{ productId: prod.id, productSku: prod.sku, quantity: 5 }],
    orders: [order],
    returns: [],
    products: [prod],
    currency: 'SAR',
  });
  assert.equal(overSingle.success, false);

  // Split duplicate selectedItems lines summing to > 4 (3 + 2 = 5)
  const overSplit = registerPostDeliveryReturnPure({
    orderId: order.id,
    reason: 'تجاوز مجزأ في نفس الطلب',
    selectedItems: [
      { productId: prod.id, productSku: prod.sku, quantity: 3 },
      { productId: prod.id, productSku: prod.sku, quantity: 2 },
    ],
    orders: [order],
    returns: [],
    products: [prod],
    currency: 'SAR',
  });
  assert.equal(overSplit.success, false);

  // Even computeReturnRefundAmount & computeOrderFinancialBreakdown cap corrupted oversized return lines at 4 * 200 = 800
  const oversizedCorruptReturn = {
    id: 'RET-CORRUPT',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 7 }],
    returnReason: 'corrupted',
    returnStatus: 'closed' as const,
    inspectionOutcome: 'restockable' as const,
    stockRestored: true,
    isCompleted: true,
    isPostDeliveryReturn: true,
    createdAt: '2026-11-16T00:00:00Z',
    updatedAt: '2026-11-16T00:00:00Z',
  };
  assert.equal(computeReturnRefundAmount(oversizedCorruptReturn, order, []), 800);
  const cappedBreakdown = computeOrderFinancialBreakdown(order, [prod], [oversizedCorruptReturn], []);
  assert.equal(cappedBreakdown.refundAmount, 800);
  assert.equal(cappedBreakdown.refundedItemsCount, 4);
});

// ---------------------------------------------------------------------------
// 22. Refund Integrity Scenario 6: Failed storage write never reports success or partial refund
// ---------------------------------------------------------------------------
test('refund integrity: failed storage write rolls back and never reports a successful financial transaction', () => {
  const backing = new Map<string, string>();
  let failOnKeySubstr: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() { return backing.size; },
      clear() { backing.clear(); },
      getItem(k: string) { return backing.get(k) ?? null; },
      key(i: number) { return Array.from(backing.keys())[i] ?? null; },
      removeItem(k: string) { backing.delete(k); },
      setItem(k: string, v: string) {
        if (failOnKeySubstr && k.includes(failOnKeySubstr)) {
          const err = new Error('The quota has been exceeded.');
          err.name = 'QuotaExceededError';
          throw err;
        }
        backing.set(k, v);
      },
    },
    configurable: true,
    writable: true,
  });

  storageService.init();
  storageService.clearAllStoreData();

  const prod = makeProduct({ id: 'prod-fail-tx', sku: 'FAIL-TX-1', currentPrice: 200, physicalStock: 10, availableStock: 10 });
  assert.equal(storageService.saveProduct(prod).success, true);

  const ordRes = storageService.createOrder({
    marketplaceId: 'noon',
    status: 'preparing',
    orderDate: '2026-11-16T00:00:00Z',
    totalAmount: 800,
    items: [{ productId: prod.id, productSku: prod.sku, productName: prod.name, imageUrl: prod.imageUrl, quantity: 4, unitPrice: 200 }],
  });
  assert.equal(ordRes.success, true);
  assert.equal(storageService.updateOrderStatus(ordRes.order!.id, 'with_delivery').success, true);
  assert.equal(storageService.updateOrderStatus(ordRes.order!.id, 'delivered').success, true);

  const retRes = storageService.registerPostDeliveryReturn(ordRes.order!.id, 'مرتجع', '', [
    { productId: prod.id, productSku: prod.sku, quantity: 1 },
  ]);
  assert.equal(retRes.success, true);
  assert.equal(storageService.advanceReturnStatus(retRes.returnRecord!.id, 'received_at_warehouse').success, true);

  // Inject failure specifically when writing financial_tx during return inspection
  failOnKeySubstr = STORAGE_KEYS.FINANCIAL_TRANSACTIONS;
  const failedInsp = storageService.processReturnInspection(
    retRes.returnRecord!.id,
    'restockable',
    'like_new',
    'اختبار فشل الكتابة'
  );
  failOnKeySubstr = null;

  assert.equal(failedInsp.success, false);
  assert.equal(failedInsp.quotaExceeded, true);
  assert.equal(failedInsp.rolledBack, true);

  // Zero customer_refund transactions persisted & return remains uncompleted in received_at_warehouse
  assert.equal(
    storageService.getFinancialTransactions().filter((t) => t.type === 'customer_refund').length,
    0
  );
  const currentRet = storageService.getReturns().find((r) => r.id === retRes.returnRecord!.id);
  assert.equal(currentRet?.isCompleted, false);
  assert.equal(currentRet?.returnStatus, 'received_at_warehouse');
});

// ---------------------------------------------------------------------------
// 23. Refund Integrity Scenario 7: Return shipping & damaged write-offs stay separate from refunds
// ---------------------------------------------------------------------------
test('refund integrity: return shipping costs and damaged stock write-offs remain separate from customer refunds', () => {
  const prod = makeProduct({ id: 'prod-sep-1', sku: 'SEP-1', currentPrice: 250, baseCost: 80, physicalStock: 10, availableStock: 10 });
  const order = makeOrder({
    id: 'ORD-SEP-1',
    status: 'delivered',
    deliveredProcessed: true,
    isClosed: true,
    totalAmount: 800,
    marketplaceCommission: 80,
    shippingCost: 20,
    items: [
      {
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        imageUrl: prod.imageUrl,
        quantity: 4,
        unitPrice: 200,
        unitCostSnapshot: 80,
      },
    ],
  });

  const reg = registerPostDeliveryReturnPure({
    orderId: order.id,
    reason: 'تلف عند العميل',
    selectedItems: [{ productId: prod.id, productSku: prod.sku, quantity: 1 }],
    orders: [order],
    returns: [],
    products: [prod],
    currency: 'SAR',
  });
  assert.equal(reg.success, true);

  const recv = advanceReturnStatusPure({
    returnId: reg.returnRecord!.id,
    targetStatus: 'received_at_warehouse',
    returns: reg.returns,
    products: reg.products,
    orders: reg.orders,
  });
  assert.equal(recv.success, true);

  const dmgInsp = processReturnInspectionPure({
    returnId: reg.returnRecord!.id,
    outcome: 'damaged',
    condition: 'damaged',
    notes: 'منتج تالف غير صالح',
    returns: recv.returns,
    products: recv.products,
    orders: reg.orders,
    currency: 'SAR',
  });
  assert.equal(dmgInsp.success, true);

  // Must emit BOTH damage_writeoff (cost = 80) AND customer_refund (price = 200) distinctly
  const writeoffTx = dmgInsp.newTransactions.find((t) => t.type === 'damage_writeoff');
  const refundTx = dmgInsp.newTransactions.find((t) => t.type === 'customer_refund');
  assert.ok(writeoffTx);
  assert.ok(refundTx);
  assert.equal(writeoffTx.amount, 80);
  assert.equal(refundTx.amount, 200);
  assert.notEqual(writeoffTx.eventRef, refundTx.eventRef);

  const allTx: FinancialTransaction[] = [
    ...reg.newTransactions.map((t, i) => ({ ...t, id: `sep-reg-${i}`, date: '2026-11-16T00:00:00Z' })),
    ...dmgInsp.newTransactions.map((t, i) => ({ ...t, id: `sep-dmg-${i}`, date: '2026-11-16T01:00:00Z' })),
  ];

  const summary = computeFinancialSummary([order], allTx, dmgInsp.products);
  assert.equal(summary.confirmedRefunds, 200);
  assert.equal(summary.damageWriteoffs, 80);
  assert.equal(summary.confirmedExpenses, 80);
  assert.equal(summary.pendingReturnShipping, 15);
  assert.equal(summary.pendingRefunds, 0);
  // Confirmed settlement = 800 (revenue) - 80 (damage writeoff) - 200 (refund) = 520
  assert.equal(summary.confirmedSettlement, 520);
  // Expected settlement = 520 - 15 (pending return shipping) = 505
  assert.equal(summary.expectedSettlement, 505);
});

// ---------------------------------------------------------------------------
// 24. Refund Integrity: Pending + Completed Returns Never Consume Same Units
// ---------------------------------------------------------------------------
test('computeOrderFinancialBreakdown prevents pending and completed returns from consuming the same units', () => {
  const product = makeProduct({ id: 'prod-ri-1', sku: 'RI-SKU-1', currentPrice: 200, baseCost: 90 });
  const order = makeOrder({
    id: 'ORD-RI-24',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 400,
    items: [
      {
        productId: 'prod-ri-1',
        productSku: 'RI-SKU-1',
        productName: 'RI Item',
        imageUrl: '',
        quantity: 2,
        unitPrice: 200,
        unitCostSnapshot: 90,
      },
    ],
  });

  const makeRet = (overrides: Partial<ReturnRecord>): ReturnRecord => ({
    id: 'RET-RI-24',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-ri-1',
        productSku: 'RI-SKU-1',
        productName: 'RI Item',
        imageUrl: '',
        quantity: 1,
        unitPrice: 200,
      },
    ],
    returnReason: 'test',
    returnStatus: 'closed',
    stockRestored: true,
    isCompleted: true,
    isPostDeliveryReturn: true,
    refundProcessed: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
    ...overrides,
  });

  // Case A: 1 completed + 1 pending claiming 2 units -> pending capped at remaining 1 unit
  const completed1 = makeRet({
    id: 'RET-24-DONE',
    returnStatus: 'closed',
    isCompleted: true,
    items: [{ ...order.items[0], quantity: 1 }],
  });
  const pending2 = makeRet({
    id: 'RET-24-PEND',
    returnStatus: 'in_transit_back',
    isCompleted: false,
    stockRestored: false,
    refundProcessed: false,
    items: [{ ...order.items[0], quantity: 2 }],
    createdAt: '2026-11-16T00:30:00Z',
  });

  const bA = computeOrderFinancialBreakdown(order, [product], [pending2, completed1]);
  assert.equal(bA.refundAmount, 200);
  assert.equal(bA.pendingRefundAmount, 200);
  assert.equal(bA.refundedItemsCount, 1);

  // Case B: Completed covers all 2 units; overlapping pending gets 0
  const completedAll = makeRet({
    id: 'RET-24-DONE-ALL',
    items: [{ ...order.items[0], quantity: 2 }],
  });
  const bB = computeOrderFinancialBreakdown(order, [product], [pending2, completedAll]);
  assert.equal(bB.refundAmount, 400);
  assert.equal(bB.pendingRefundAmount, 0);
  assert.equal(bB.refundedItemsCount, 2);
});

// ---------------------------------------------------------------------------
// 25. Refund Integrity: Multiple Pending Returns Bounded by Ordered Quantity
// ---------------------------------------------------------------------------
test('computeOrderFinancialBreakdown bounds multiple pending returns by remaining ordered quantity', () => {
  const product = makeProduct({ id: 'prod-ri-25', sku: 'RI-SKU-25', currentPrice: 200, baseCost: 90 });
  const order = makeOrder({
    id: 'ORD-RI-25',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 800,
    items: [
      {
        productId: 'prod-ri-25',
        productSku: 'RI-SKU-25',
        productName: 'RI Multi Pending',
        imageUrl: '',
        quantity: 4,
        unitPrice: 200,
        unitCostSnapshot: 90,
      },
    ],
  });

  const pend1: ReturnRecord = {
    id: 'RET-25-A',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 3 }],
    returnReason: 'pending 1',
    returnStatus: 'in_transit_back',
    stockRestored: false,
    isCompleted: false,
    isPostDeliveryReturn: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };
  const pend2: ReturnRecord = {
    ...pend1,
    id: 'RET-25-B',
    returnStatus: 'under_inspection',
    createdAt: '2026-11-16T02:00:00Z',
    updatedAt: '2026-11-16T02:00:00Z',
  };

  const breakdown = computeOrderFinancialBreakdown(order, [product], [pend1, pend2]);
  assert.equal(breakdown.refundAmount, 0);
  assert.equal(breakdown.pendingRefundAmount, 800);
  assert.equal(breakdown.refundedItemsCount, 0);
});

// ---------------------------------------------------------------------------
// 26. Refund Integrity: Deterministic Result Regardless of Return Array Order
// ---------------------------------------------------------------------------
test('computeOrderFinancialBreakdown produces identical accounting regardless of return storage order', () => {
  const product = makeProduct({ id: 'prod-ri-26', sku: 'RI-SKU-26', currentPrice: 150, baseCost: 70 });
  const order = makeOrder({
    id: 'ORD-RI-26',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 450,
    items: [
      {
        productId: 'prod-ri-26',
        productSku: 'RI-SKU-26',
        productName: 'RI Order Test',
        imageUrl: '',
        quantity: 3,
        unitPrice: 150,
        unitCostSnapshot: 70,
      },
    ],
  });

  const retCompleted: ReturnRecord = {
    id: 'RET-26-1',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 2 }],
    returnReason: 'done',
    returnStatus: 'closed',
    stockRestored: true,
    isCompleted: true,
    isPostDeliveryReturn: true,
    refundProcessed: true,
    createdAt: '2026-11-16T02:00:00Z',
    updatedAt: '2026-11-16T02:00:00Z',
  };
  const retCompletedDup: ReturnRecord = {
    ...retCompleted,
    items: [{ ...order.items[0], quantity: 2 }],
  };
  const retPendingEarly: ReturnRecord = {
    id: 'RET-26-2',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 2 }],
    returnReason: 'pending',
    returnStatus: 'received_at_warehouse',
    stockRestored: false,
    isCompleted: false,
    isPostDeliveryReturn: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };

  const bForward = computeOrderFinancialBreakdown(order, [product], [
    retCompleted,
    retCompletedDup,
    retPendingEarly,
  ]);
  const bReverse = computeOrderFinancialBreakdown(order, [product], [
    retPendingEarly,
    retCompletedDup,
    retCompleted,
  ]);

  assert.equal(bForward.refundAmount, 300);
  assert.equal(bForward.pendingRefundAmount, 150);
  assert.equal(bForward.refundedItemsCount, 2);
  assert.equal(bReverse.refundAmount, bForward.refundAmount);
  assert.equal(bReverse.pendingRefundAmount, bForward.pendingRefundAmount);
  assert.equal(bReverse.refundedItemsCount, bForward.refundedItemsCount);
});

// ---------------------------------------------------------------------------
// 27. Refund Integrity: Missing Original Order Rejects Fallback Pricing
// ---------------------------------------------------------------------------
test('missing original order blocks untrusted ReturnRecord fallback refund pricing', () => {
  const product = makeProduct({
    id: 'prod-ri-27',
    sku: 'RI-SKU-27',
    currentPrice: 500,
    baseCost: 100,
    physicalStock: 10,
    availableStock: 9,
    awaitingInspectionStock: 1,
  });

  const orphanPostReturn: ReturnRecord = {
    id: 'RET-27-ORPHAN',
    orderId: 'ORD-MISSING-999',
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-ri-27',
        productSku: 'RI-SKU-27',
        productName: 'Orphan Item',
        imageUrl: '',
        quantity: 1,
        unitPrice: 999, // Untrusted return unitPrice should NEVER be credited
      },
    ],
    returnReason: 'post-delivery',
    returnStatus: 'received_at_warehouse',
    stockRestored: false,
    isCompleted: false,
    isPostDeliveryReturn: true,
    physicalRestoredAtReceipt: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };

  const assessment = computeReturnRefundAssessment(orphanPostReturn, undefined, []);
  assert.equal(assessment.valid, false);
  assert.equal(assessment.refundAmount, 0);
  assert.ok(assessment.diagnostic && assessment.diagnostic.length > 0);
  assert.equal(computeReturnRefundAmount(orphanPostReturn, undefined, []), 0);

  const insp = processReturnInspectionPure({
    returnId: orphanPostReturn.id,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'فحص مرتجع بدون طلب أصلي',
    returns: [orphanPostReturn],
    products: [product],
    orders: [],
    currency: 'SAR',
  });
  assert.equal(insp.success, true);
  assert.ok(insp.refundDiagnostic && insp.refundDiagnostic.length > 0);
  assert.equal(insp.newTransactions.filter((t) => t.type === 'customer_refund').length, 0);
  const updatedRet = insp.returns.find((r) => r.id === orphanPostReturn.id)!;
  assert.equal(updatedRet.refundAmount, 0);
  assert.equal(updatedRet.refundProcessed, false);
  // Physical custody can still be restored cleanly without fabricating a financial refund
  assert.equal(updatedRet.stockRestored, true);
  assert.equal(updatedRet.isCompleted, true);
});

// ---------------------------------------------------------------------------
// 28. Refund Integrity: Mismatched Product Identity (ID vs SKU) Blocked
// ---------------------------------------------------------------------------
test('return item with mismatched productId sharing unrelated SKU (and vice versa) is rejected', () => {
  const product = makeProduct({
    id: 'prod-real-28',
    sku: 'SKU-REAL-28',
    currentPrice: 250,
    baseCost: 80,
    physicalStock: 10,
    availableStock: 9,
    awaitingInspectionStock: 1,
  });
  const order = makeOrder({
    id: 'ORD-RI-28',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 250,
    items: [
      {
        productId: 'prod-real-28',
        productSku: 'SKU-REAL-28',
        productName: 'Real Product',
        imageUrl: '',
        quantity: 1,
        unitPrice: 250,
        unitCostSnapshot: 80,
      },
    ],
  });

  const mismatchedIdReturn: ReturnRecord = {
    id: 'RET-28-MISMATCH-ID',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [
      {
        productId: 'prod-wrong-id',
        productSku: 'SKU-REAL-28',
        productName: 'Spoofed ID Item',
        imageUrl: '',
        quantity: 1,
        unitPrice: 250,
      },
    ],
    returnReason: 'test',
    returnStatus: 'received_at_warehouse',
    stockRestored: false,
    isCompleted: false,
    isPostDeliveryReturn: true,
    physicalRestoredAtReceipt: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };

  const mismatchedSkuReturn: ReturnRecord = {
    ...mismatchedIdReturn,
    id: 'RET-28-MISMATCH-SKU',
    items: [
      {
        productId: 'prod-real-28',
        productSku: 'SKU-WRONG-999',
        productName: 'Spoofed SKU Item',
        imageUrl: '',
        quantity: 1,
        unitPrice: 250,
      },
    ],
  };

  const a1 = computeReturnRefundAssessment(mismatchedIdReturn, order, []);
  assert.equal(a1.valid, false);
  assert.equal(a1.refundAmount, 0);
  assert.equal(a1.unmatchedItems.length, 1);

  const a2 = computeReturnRefundAssessment(mismatchedSkuReturn, order, []);
  assert.equal(a2.valid, false);
  assert.equal(a2.refundAmount, 0);
  assert.equal(a2.unmatchedItems.length, 1);

  const insp = processReturnInspectionPure({
    returnId: mismatchedIdReturn.id,
    outcome: 'restockable',
    condition: 'like_new',
    notes: 'id mismatch',
    returns: [mismatchedIdReturn],
    products: [product],
    orders: [order],
    currency: 'SAR',
  });
  assert.equal(insp.newTransactions.filter((t) => t.type === 'customer_refund').length, 0);
  assert.equal(insp.returns[0].refundProcessed, false);

  const breakdown = computeOrderFinancialBreakdown(order, [product], [
    { ...mismatchedIdReturn, isCompleted: true, returnStatus: 'closed', refundProcessed: true },
    { ...mismatchedSkuReturn, returnStatus: 'in_transit_back', isCompleted: false },
  ]);
  assert.equal(breakdown.refundAmount, 0);
  assert.equal(breakdown.pendingRefundAmount, 0);
});

// ---------------------------------------------------------------------------
// 29. Refund Integrity: Pending Ledger Refund Tied to Pending Return Not Double-Counted
// ---------------------------------------------------------------------------
test('pending customer_refund ledger transaction matching pending returnId is not double-counted', () => {
  const product = makeProduct({ id: 'prod-ri-29', sku: 'RI-SKU-29', currentPrice: 200, baseCost: 100 });
  const order = makeOrder({
    id: 'ORD-RI-29',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 400,
    items: [
      {
        productId: 'prod-ri-29',
        productSku: 'RI-SKU-29',
        productName: 'Item 29',
        imageUrl: '',
        quantity: 2,
        unitPrice: 200,
        unitCostSnapshot: 100,
      },
    ],
  });

  const pendingRet: ReturnRecord = {
    id: 'RET-29-PEND',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 1 }],
    returnReason: 'pending return',
    returnStatus: 'in_transit_back',
    stockRestored: false,
    isCompleted: false,
    isPostDeliveryReturn: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };

  const pendingTx: FinancialTransaction = {
    id: 'tx-29-pend',
    orderId: order.id,
    returnId: 'RET-29-PEND',
    eventRef: 'post_delivery_return|customer_refund|RET-29-PEND',
    marketplaceId: 'noon',
    type: 'customer_refund',
    amount: 200,
    currency: 'SAR',
    status: 'pending',
    source: 'automatic',
    date: '2026-11-16T01:00:00Z',
  };

  const breakdown = computeOrderFinancialBreakdown(order, [product], [pendingRet], [pendingTx]);
  assert.equal(breakdown.refundAmount, 0);
  assert.equal(breakdown.pendingRefundAmount, 200);
});

// ---------------------------------------------------------------------------
// 30. Refund Integrity: Confirmed Ledger Refund Tied to Completed Return Not Double-Counted
// ---------------------------------------------------------------------------
test('confirmed customer_refund ledger transaction matching completed returnId is not double-counted', () => {
  const product = makeProduct({ id: 'prod-ri-30', sku: 'RI-SKU-30', currentPrice: 200, baseCost: 100 });
  const order = makeOrder({
    id: 'ORD-RI-30',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 400,
    items: [
      {
        productId: 'prod-ri-30',
        productSku: 'RI-SKU-30',
        productName: 'Item 30',
        imageUrl: '',
        quantity: 2,
        unitPrice: 200,
        unitCostSnapshot: 100,
      },
    ],
  });

  const completedRet: ReturnRecord = {
    id: 'RET-30-DONE',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 1 }],
    returnReason: 'done',
    returnStatus: 'closed',
    inspectionOutcome: 'restockable',
    stockRestored: true,
    isCompleted: true,
    isPostDeliveryReturn: true,
    refundAmount: 200,
    refundProcessed: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T02:00:00Z',
  };

  const confirmedTx: FinancialTransaction = {
    id: 'tx-30-conf',
    orderId: order.id,
    returnId: 'RET-30-DONE',
    eventRef: 'return_inspection|customer_refund|RET-30-DONE',
    marketplaceId: 'noon',
    type: 'customer_refund',
    amount: 200,
    currency: 'SAR',
    status: 'confirmed',
    source: 'automatic',
    date: '2026-11-16T02:00:00Z',
  };

  const breakdown = computeOrderFinancialBreakdown(order, [product], [completedRet], [confirmedTx]);
  assert.equal(breakdown.refundAmount, 200);
  assert.equal(breakdown.pendingRefundAmount, 0);
  assert.equal(breakdown.refundedItemsCount, 1);
});

// ---------------------------------------------------------------------------
// 31. Refund Integrity: Standalone Valid Refund Preserved & Cancelled Excluded
// ---------------------------------------------------------------------------
test('standalone customer_refund ledger transactions are preserved accurately while cancelled entries stay excluded', () => {
  const product = makeProduct({ id: 'prod-ri-31', sku: 'RI-SKU-31', currentPrice: 300, baseCost: 120 });
  const order = makeOrder({
    id: 'ORD-RI-31',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 300,
    items: [
      {
        productId: 'prod-ri-31',
        productSku: 'RI-SKU-31',
        productName: 'Item 31',
        imageUrl: '',
        quantity: 1,
        unitPrice: 300,
        unitCostSnapshot: 120,
      },
    ],
  });

  const txs: FinancialTransaction[] = [
    {
      id: 'tx-31-standalone-conf',
      orderId: order.id,
      marketplaceId: 'noon',
      type: 'customer_refund',
      amount: 150,
      currency: 'SAR',
      status: 'confirmed',
      source: 'manual',
      date: '2026-11-16T01:00:00Z',
    },
    {
      id: 'tx-31-cancelled',
      orderId: order.id,
      marketplaceId: 'noon',
      type: 'customer_refund',
      amount: 300,
      currency: 'SAR',
      status: 'cancelled',
      source: 'manual',
      date: '2026-11-16T01:30:00Z',
    },
    {
      id: 'tx-31-standalone-pend',
      orderId: order.id,
      marketplaceId: 'noon',
      type: 'customer_refund',
      amount: 50,
      currency: 'SAR',
      status: 'pending',
      source: 'manual',
      date: '2026-11-16T02:00:00Z',
    },
  ];

  const breakdown = computeOrderFinancialBreakdown(order, [product], [], txs);
  assert.equal(breakdown.refundAmount, 150);
  assert.equal(breakdown.pendingRefundAmount, 50);
});

// ---------------------------------------------------------------------------
// 32. Refund Integrity: Cumulative Refunds Never Exceed Order Refundable Cap
// ---------------------------------------------------------------------------
test('cumulative confirmed plus pending refunds never exceed original order refundable cap', () => {
  const product = makeProduct({ id: 'prod-ri-32', sku: 'RI-SKU-32', currentPrice: 200, baseCost: 80 });
  const order = makeOrder({
    id: 'ORD-RI-32',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 350, // Discounted order total < 2 * 200 = 400
    items: [
      {
        productId: 'prod-ri-32',
        productSku: 'RI-SKU-32',
        productName: 'Discounted Item',
        imageUrl: '',
        quantity: 2,
        unitPrice: 200,
        unitCostSnapshot: 80,
      },
    ],
  });

  const retDone: ReturnRecord = {
    id: 'RET-32-DONE',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 1 }],
    returnReason: 'partial 1',
    returnStatus: 'closed',
    stockRestored: true,
    isCompleted: true,
    isPostDeliveryReturn: true,
    refundProcessed: true,
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };
  const retPend: ReturnRecord = {
    id: 'RET-32-PEND',
    orderId: order.id,
    marketplaceId: 'noon',
    items: [{ ...order.items[0], quantity: 1 }],
    returnReason: 'partial 2',
    returnStatus: 'in_transit_back',
    stockRestored: false,
    isCompleted: false,
    isPostDeliveryReturn: true,
    createdAt: '2026-11-16T02:00:00Z',
    updatedAt: '2026-11-16T02:00:00Z',
  };
  const extraManualTx: FinancialTransaction = {
    id: 'tx-32-manual',
    orderId: order.id,
    marketplaceId: 'noon',
    type: 'customer_refund',
    amount: 500,
    currency: 'SAR',
    status: 'pending',
    source: 'manual',
    date: '2026-11-16T03:00:00Z',
  };

  const breakdown = computeOrderFinancialBreakdown(
    order,
    [product],
    [retDone, retPend],
    [extraManualTx]
  );
  assert.equal(breakdown.refundAmount, 200);
  assert.equal(breakdown.pendingRefundAmount, 150);
  assert.ok(breakdown.refundAmount + (breakdown.pendingRefundAmount || 0) <= order.totalAmount);
});

// ---------------------------------------------------------------------------
// 33. Refund Integrity: Invalid Return Quantities Rejected Strictly
// ---------------------------------------------------------------------------
test('fractional, zero, negative, NaN, and Infinity return quantities are rejected without truncation or refunds', () => {
  const product = makeProduct({
    id: 'prod-ri-33',
    sku: 'RI-SKU-33',
    currentPrice: 200,
    baseCost: 80,
    physicalStock: 10,
    availableStock: 9,
    awaitingInspectionStock: 1,
  });
  const order = makeOrder({
    id: 'ORD-RI-33',
    status: 'delivered',
    deliveredProcessed: true,
    totalAmount: 400,
    items: [
      {
        productId: 'prod-ri-33',
        productSku: 'RI-SKU-33',
        productName: 'Qty Validation Item',
        imageUrl: '',
        quantity: 2,
        unitPrice: 200,
        unitCostSnapshot: 80,
      },
    ],
  });

  for (const badQty of [1.5, -2, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const badReturn: ReturnRecord = {
      id: `RET-33-BAD-${String(badQty)}`,
      orderId: order.id,
      marketplaceId: 'noon',
      items: [{ ...order.items[0], quantity: badQty }],
      returnReason: 'bad qty',
      returnStatus: 'received_at_warehouse',
      stockRestored: false,
      isCompleted: false,
      isPostDeliveryReturn: true,
      physicalRestoredAtReceipt: true,
      createdAt: '2026-11-16T01:00:00Z',
      updatedAt: '2026-11-16T01:00:00Z',
    };

    const assessment = computeReturnRefundAssessment(badReturn, order, []);
    assert.equal(assessment.valid, false);
    assert.equal(assessment.refundAmount, 0);
    assert.equal(assessment.invalidQuantities.length, 1);

    const insp = processReturnInspectionPure({
      returnId: badReturn.id,
      outcome: 'restockable',
      condition: 'like_new',
      notes: 'invalid qty',
      returns: [badReturn],
      products: [product],
      orders: [order],
      currency: 'SAR',
    });
    assert.equal(insp.newTransactions.filter((t) => t.type === 'customer_refund').length, 0);
    assert.equal(insp.returns[0].refundProcessed, false);

    const breakdown = computeOrderFinancialBreakdown(order, [product], [
      { ...badReturn, isCompleted: true, returnStatus: 'closed', refundProcessed: true },
    ]);
    assert.equal(breakdown.refundAmount, 0);
    assert.equal(breakdown.pendingRefundAmount, 0);
  }
});


