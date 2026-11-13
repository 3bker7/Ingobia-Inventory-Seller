import test from 'node:test';
import assert from 'node:assert/strict';
import { Product, Order, ReturnRecord } from '../types';
import {
  applyManualStockAdjustmentPure,
  computeEditedAvailableStock,
  computePriceChangeMetrics,
  getLockedCustodyFloor,
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
  processReturnInspectionPure,
  registerPostDeliveryReturnPure,
} from '../domain/returnLifecycle';
import { saveSmartImportOrdersPure } from '../domain/smartImportCustody';
import { DEFAULT_PRODUCTS, DEFAULT_ORDERS, DEFAULT_RETURNS } from '../services/seedData';
import { storageService } from '../services/storage';

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
  assert.equal(breakdown.isProfitCalculable, true);
  assert.equal(breakdown.productCostOfGoods, 200);
  assert.equal(breakdown.cogsSource, 'snapshot');
  assert.equal(breakdown.commissionStatus, 'missing');
  assert.equal(breakdown.marketplaceCommission, 0);
  assert.equal(breakdown.estimatedMarketplaceCommission, 60);
  assert.equal(breakdown.confirmedNet, 270); // 500 - 0 - 30 - 200

  // Missing COGS blocks speculative profit
  const noCostProd = makeProduct({ id: 'p-missing', sku: 'MISS-1', baseCost: undefined });
  const orderMissingCost = makeOrder({
    status: 'delivered',
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
  assert.equal(summary.courierShippingExpenses, 30);
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
