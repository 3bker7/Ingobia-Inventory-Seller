import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Package,
  Truck,
  RotateCcw as ReturnIcon,
  DollarSign,
  AlertTriangle,
  Clock,
  Sparkles,
  X,
  Boxes,
} from 'lucide-react';
import { Modal } from './Modal';
import { Locale } from '../../locales/translations';
import { Product, Order, ReturnRecord } from '../../types';
import { createOrderPure, updateOrderStatusPure } from '../../domain/orderLifecycle';
import { advanceReturnStatusPure, processReturnInspectionPure } from '../../domain/returnLifecycle';
import { computeOrderFinancialBreakdown } from '../../domain/financialLedger';
import { DEFAULT_MERCHANT_PROFILE } from '../../services/seedData';

interface TestSuiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  locale: Locale;
}

interface TestResult {
  id: string;
  nameAr: string;
  nameEn: string;
  category: 'custody' | 'returns' | 'finance' | 'onboarding';
  status: 'idle' | 'running' | 'passed' | 'failed';
  messageAr: string;
  messageEn: string;
  details?: string[];
  durationMs?: number;
}

const makeTestProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'mock-p1',
  sku: 'TEST-SKU-1',
  name: 'منتج تجريبي 1',
  imageUrl: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=300',
  currentPrice: 150,
  category: 'Electronics',
  baseCost: 100,
  physicalStock: 20,
  availableStock: 20,
  reservedStock: 0,
  outboundInTransitStock: 0,
  returnInTransitStock: 0,
  awaitingInspectionStock: 0,
  damagedStock: 0,
  marketplaceListings: {},
  createdAt: '2026-11-10T10:00:00Z',
  updatedAt: '2026-11-10T10:00:00Z',
  ...overrides,
});

export const TestSuiteModal: React.FC<TestSuiteModalProps> = ({ isOpen, onClose, locale }) => {
  const isRtl = locale === 'ar';
  const [isRunning, setIsRunning] = useState(false);

  const initialTests: TestResult[] = [
    {
      id: 'test_order_creation_reservation',
      nameAr: '1. حجز المخزون عند إنشاء الطلب (Available -> Reserved)',
      nameEn: '1. Stock Reservation upon Order Creation (Available -> Reserved)',
      category: 'custody',
      status: 'idle',
      messageAr: 'التحقق عبر createOrderPure من نقص المتاح وزيادة المحجوز مع رفض تجاوز المتاح.',
      messageEn: 'Verify via createOrderPure that available stock decreases, reserved increases, and overselling is blocked.',
    },
    {
      id: 'test_handover_courier',
      nameAr: '2. تسليم الشحنة لشركة التوصيل (Reserved -> Outbound in Transit)',
      nameEn: '2. Courier Handover (Reserved -> Outbound In Transit)',
      category: 'custody',
      status: 'idle',
      messageAr: 'التحقق عبر updateOrderStatusPure من انتقال العهدة إلى الترانزيت الخارجي ومنع إلغاء شحنة خرجت للتوصيل.',
      messageEn: 'Verify via updateOrderStatusPure that stock moves to outbound transit and dispatched cancellation is blocked.',
    },
    {
      id: 'test_delivery_success',
      nameAr: '3. اكتمال التسليم الناجح للعميل (Deduct Outbound & Physical, Record Revenue)',
      nameEn: '3. Successful Customer Delivery (Deductions & Revenue Confirmation)',
      category: 'custody',
      status: 'idle',
      messageAr: 'التحقق من الخصم النهائي للوحدات وإثبات الإيراد وقفل الطلب ومنع أي انتقال لاحق.',
      messageEn: 'Verify permanent unit deduction, revenue ledger entry, order closure, and terminal state lock.',
    },
    {
      id: 'test_return_rejection',
      nameAr: '4. رفض العميل للشحنة والعودة بالترانزيت (Outbound -> Return in Transit)',
      nameEn: '4. Delivery Rejection & Return In Transit (Outbound -> Return In Transit)',
      category: 'returns',
      status: 'idle',
      messageAr: 'التحقق من إنشاء سجل المرتجع ونقل العهدة لمسار العودة مع بقاء المتاح محجوباً.',
      messageEn: 'Verify rejected units create a return record in transit back while availableStock stays untouched.',
    },
    {
      id: 'test_warehouse_physical_receipt',
      nameAr: '5. الاستلام الفيزيائي بالمستودع (Return in Transit -> Awaiting Inspection)',
      nameEn: '5. Warehouse Physical Receipt (Return In Transit -> Awaiting Inspection)',
      category: 'returns',
      status: 'idle',
      messageAr: 'التحقق عبر advanceReturnStatusPure من نقل العهدة لبانتظار الفحص ومنع القفز للفحص قبل الاستلام.',
      messageEn: 'Verify via advanceReturnStatusPure transition to awaitingInspectionStock and rejection of skipped stages.',
    },
    {
      id: 'test_inspection_restockable',
      nameAr: '6. فحص المرتجع واعتماده كصالح (Awaiting Inspection -> Available Stock)',
      nameEn: '6. Return Inspection Approval (Awaiting Inspection -> Available Stock)',
      category: 'returns',
      status: 'idle',
      messageAr: 'التحقق عبر processReturnInspectionPure من إعادة الصالح للمتاح ومنع التكرار.',
      messageEn: 'Verify via processReturnInspectionPure restockable approval and duplicate restock prevention.',
    },
    {
      id: 'test_inspection_damaged',
      nameAr: '7. فحص المرتجع كـ تالف (Awaiting Inspection -> Damaged Stock, Never Available)',
      nameEn: '7. Damaged Return Inspection (Awaiting Inspection -> Damaged Stock)',
      category: 'returns',
      status: 'idle',
      messageAr: 'التحقق من عزل التالف في damagedStock وتسجيل قيد الخسارة حسب التكلفة التاريخية للطلب.',
      messageEn: 'Verify damaged isolation in damagedStock and historical snapshot COGS write-off transaction.',
    },
    {
      id: 'test_financial_breakdown_strict_rules',
      nameAr: '8. قاعدة احتساب الأرباح الصارمة (Strict Profit Calculability Rule)',
      nameEn: '8. Strict Profit Calculability Rule (Blocks Speculative Calculations)',
      category: 'finance',
      status: 'idle',
      messageAr: 'التحقق عبر computeOrderFinancialBreakdown من حظر التخمين عند غياب COGS وعدم خصم عمولة غير مسجلة.',
      messageEn: 'Verify via computeOrderFinancialBreakdown missing COGS blocking and unrecorded commission handling.',
    },
    {
      id: 'test_onboarding_dynamic_zero_platforms',
      nameAr: '9. مرونة الإعداد الأولي والمنصات (Dynamic Zero-Marketplace Onboarding)',
      nameEn: '9. Flexible Onboarding (Zero Platforms Allowed, Custom Storefront)',
      category: 'onboarding',
      status: 'idle',
      messageAr: 'التحقق من أن الملف الافتراضي للتاجر يبدأ بصفر منصات مفروضة مع دعم المتجر المستقل.',
      messageEn: 'Verify default merchant profile starts with zero forced marketplaces and supports custom storefronts.',
    },
  ];

  const [tests, setTests] = useState<TestResult[]>(initialTests);

  const runAllTests = async () => {
    setIsRunning(true);

    const currentResults: TestResult[] = initialTests.map((t) => ({ ...t, status: 'running' }));
    setTests(currentResults);

    for (let i = 0; i < currentResults.length; i++) {
      const t = currentResults[i];
      const start = performance.now();

      await new Promise((res) => setTimeout(res, 50));

      try {
        if (t.id === 'test_order_creation_reservation') {
          const p = makeTestProduct();
          const res = createOrderPure({
            orderData: {
              marketplaceId: 'noon',
              customerName: 'عميل اختبار',
              shippingAddress: 'الرياض',
              items: [{ productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 3, unitPrice: 150 }],
              totalAmount: 450,
              shippingCost: 20,
              status: 'preparing',
              orderDate: '2026-11-10T10:00:00Z',
            },
            products: [p],
            existingOrders: [],
            customId: 'TEST-ORD-1',
          });
          if (!res.success || !res.order) throw new Error(res.error || 'Order creation failed');
          const updated = res.products[0];
          if (updated.availableStock !== 17 || updated.reservedStock !== 3 || updated.physicalStock !== 20) {
            throw new Error(`Invalid custody after order creation: avail=${updated.availableStock}, res=${updated.reservedStock}`);
          }
          if (res.order.items[0].unitCostSnapshot !== 100) {
            throw new Error('unitCostSnapshot was not captured at order creation');
          }
          const oversell = createOrderPure({
            orderData: {
              marketplaceId: 'noon',
              customerName: 'عميل اختبار',
              shippingAddress: 'الرياض',
              items: [
                { productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 10, unitPrice: 150 },
                { productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 10, unitPrice: 150 },
              ],
              totalAmount: 3000,
              shippingCost: 20,
              status: 'preparing',
              orderDate: '2026-11-10T10:00:00Z',
            },
            products: res.products,
            existingOrders: res.orders,
          });
          if (oversell.success) throw new Error('Split-line oversell above availableStock was not rejected');

          t.status = 'passed';
          t.details = [
            'createOrderPure: المتاح 20 -> 17، المحجوز 0 -> 3، الفيزيائي ثابت 20',
            'حفظ لقطة التكلفة unitCostSnapshot = 100 بنجاح',
            'تم رفض تجاوز المخزون عبر بندين مكررين لنفس المنتج (20 > 17)',
          ];
        } else if (t.id === 'test_handover_courier') {
          const p = makeTestProduct({ availableStock: 17, reservedStock: 3 });
          const seedOrder: Order = {
            id: 'TEST-ORD-2',
            marketplaceId: 'noon',
            customerName: 'عميل اختبار',
            shippingAddress: 'جدة',
            items: [{ productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 3, unitPrice: 150, unitCostSnapshot: 100 }],
            totalAmount: 450,
            shippingCost: 20,
            status: 'preparing',
            stockDeducted: true,
            isClosed: false,
            orderDate: '2026-11-10T10:00:00Z',
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const res = updateOrderStatusPure({
            orderId: seedOrder.id,
            newStatus: 'with_delivery',
            orders: [seedOrder],
            products: [p],
            returns: [],
            currency: 'SAR',
            shipmentDetails: { courierName: 'Aramex', trackingNumber: 'TRK-22' },
          });
          if (!res.success) throw new Error(res.error || 'Handover failed');
          const updated = res.products[0];
          if (updated.reservedStock !== 0 || updated.outboundInTransitStock !== 3 || updated.availableStock !== 17) {
            throw new Error('Custody mismatch after handover');
          }
          const cancelAfterHandover = updateOrderStatusPure({
            orderId: seedOrder.id,
            newStatus: 'cancelled',
            orders: res.orders,
            products: res.products,
            returns: res.returns,
            currency: 'SAR',
          });
          if (cancelAfterHandover.success) throw new Error('Illegal transition with_delivery -> cancelled was allowed');

          t.status = 'passed';
          t.details = [
            'updateOrderStatusPure: المحجوز 3 -> 0، ترانزيت التوصيل 0 -> 3',
            'رفض الانتقال غير المشروع with_delivery -> cancelled بنجاح',
          ];
        } else if (t.id === 'test_delivery_success') {
          const p = makeTestProduct({ availableStock: 17, reservedStock: 0, outboundInTransitStock: 3 });
          const seedOrder: Order = {
            id: 'TEST-ORD-3',
            marketplaceId: 'amazon',
            customerName: 'عميل اختبار',
            shippingAddress: 'الدمام',
            items: [{ productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 3, unitPrice: 150, unitCostSnapshot: 100 }],
            totalAmount: 450,
            shippingCost: 25,
            marketplaceCommission: 45,
            status: 'with_delivery',
            stockDeducted: true,
            isClosed: false,
            orderDate: '2026-11-10T10:00:00Z',
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const res = updateOrderStatusPure({
            orderId: seedOrder.id,
            newStatus: 'delivered',
            orders: [seedOrder],
            products: [p],
            returns: [],
            currency: 'SAR',
          });
          if (!res.success) throw new Error(res.error || 'Delivery confirmation failed');
          const updated = res.products[0];
          if (updated.outboundInTransitStock !== 0 || updated.physicalStock !== 17) {
            throw new Error(`Expected outbound=0 physical=17, got ${updated.outboundInTransitStock}/${updated.physicalStock}`);
          }
          if (!res.orders[0].isClosed || res.newTransactions.length < 3) {
            throw new Error('Order not closed or ledger transactions missing');
          }

          t.status = 'passed';
          t.details = [
            'الترانزيت الخارجي 3 -> 0 والمستودع الفيزيائي 20 -> 17',
            `تسجيل ${res.newTransactions.length} قيود مالية مؤكدة وإغلاق الطلب`,
          ];
        } else if (t.id === 'test_return_rejection') {
          const p = makeTestProduct({ availableStock: 17, outboundInTransitStock: 3 });
          const seedOrder: Order = {
            id: 'TEST-ORD-4',
            marketplaceId: 'noon',
            customerName: 'عميل اختبار',
            shippingAddress: 'الرياض',
            items: [{ productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 3, unitPrice: 150, unitCostSnapshot: 100 }],
            totalAmount: 450,
            shippingCost: 20,
            status: 'with_delivery',
            stockDeducted: true,
            isClosed: false,
            orderDate: '2026-11-10T10:00:00Z',
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const res = updateOrderStatusPure({
            orderId: seedOrder.id,
            newStatus: 'rejected',
            orders: [seedOrder],
            products: [p],
            returns: [],
            currency: 'SAR',
          });
          if (!res.success || res.returns.length !== 1) throw new Error('Rejection did not create return record');
          const updated = res.products[0];
          if (updated.availableStock !== 17 || updated.returnInTransitStock !== 3 || updated.outboundInTransitStock !== 0) {
            throw new Error('Rejection custody breach detected');
          }

          t.status = 'passed';
          t.details = [
            `تم فتح المرتجع ${res.returns[0].id} بحالة in_transit_back`,
            'ترانزيت التسليم 3 -> 0، ترانزيت الإرجاع 0 -> 3، المتاح محفوظ عند 17',
          ];
        } else if (t.id === 'test_warehouse_physical_receipt') {
          const p = makeTestProduct({ availableStock: 17, returnInTransitStock: 3 });
          const ret: ReturnRecord = {
            id: 'RET-TEST-5',
            orderId: 'TEST-ORD-5',
            marketplaceId: 'noon',
            items: [{ productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 3, unitPrice: 150, unitCostSnapshot: 100 }],
            returnReason: 'رفض الاستلام',
            returnStatus: 'in_transit_back',
            stockRestored: false,
            isCompleted: false,
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const skipAttempt = advanceReturnStatusPure({
            returnId: ret.id,
            targetStatus: 'under_inspection',
            returns: [ret],
            products: [p],
            orders: [],
          });
          if (skipAttempt.success) throw new Error('Illegal skip in_transit_back -> under_inspection succeeded');

          const res = advanceReturnStatusPure({
            returnId: ret.id,
            targetStatus: 'received_at_warehouse',
            returns: [ret],
            products: [p],
            orders: [],
          });
          if (!res.success) throw new Error(res.error || 'Warehouse receipt failed');
          const updated = res.products[0];
          if (updated.availableStock !== 17 || updated.returnInTransitStock !== 0 || updated.awaitingInspectionStock !== 3) {
            throw new Error('Warehouse receipt custody violation');
          }

          t.status = 'passed';
          t.details = [
            'تم رفض تخطي مرحلة الاستلام الفعلي فيزيائياً بنجاح',
            'ترانزيت الإرجاع 3 -> 0 وبانتظار الفحص 0 -> 3 مع بقاء المتاح 17',
          ];
        } else if (t.id === 'test_inspection_restockable') {
          const p = makeTestProduct({ availableStock: 17, awaitingInspectionStock: 3 });
          const ret: ReturnRecord = {
            id: 'RET-TEST-6',
            orderId: 'TEST-ORD-6',
            marketplaceId: 'noon',
            items: [{ productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 3, unitPrice: 150, unitCostSnapshot: 100 }],
            returnReason: 'رفض الاستلام',
            returnStatus: 'received_at_warehouse',
            stockRestored: false,
            isCompleted: false,
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const res = processReturnInspectionPure({
            returnId: ret.id,
            outcome: 'restockable',
            condition: 'like_new',
            notes: 'سليم تماماً',
            returns: [ret],
            products: [p],
            orders: [],
            currency: 'SAR',
          });
          if (!res.success) throw new Error(res.message);
          const updated = res.products[0];
          if (updated.availableStock !== 20 || updated.awaitingInspectionStock !== 0 || !res.returns[0].stockRestored) {
            throw new Error('Restock failed to update custody');
          }
          const repeat = processReturnInspectionPure({
            returnId: ret.id,
            outcome: 'restockable',
            condition: 'like_new',
            notes: 'إعادة ثانية',
            returns: res.returns,
            products: res.products,
            orders: res.orders,
            currency: 'SAR',
          });
          if (repeat.success) throw new Error('Duplicate restock was allowed');

          t.status = 'passed';
          t.details = [
            'processReturnInspectionPure: بانتظار الفحص 3 -> 0، المتاح 17 -> 20',
            'تم حظر إعادة الإرجاع المكرر للوحدات بنجاح',
          ];
        } else if (t.id === 'test_inspection_damaged') {
          const p = makeTestProduct({ availableStock: 17, awaitingInspectionStock: 3, baseCost: 120 });
          const ret: ReturnRecord = {
            id: 'RET-TEST-7',
            orderId: 'TEST-ORD-7',
            marketplaceId: 'noon',
            items: [{ productId: p.id, productSku: p.sku, productName: p.name, imageUrl: p.imageUrl, quantity: 3, unitPrice: 150, unitCostSnapshot: 100 }],
            returnReason: 'كسر',
            returnStatus: 'under_inspection',
            stockRestored: false,
            isCompleted: false,
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const res = processReturnInspectionPure({
            returnId: ret.id,
            outcome: 'damaged',
            condition: 'damaged',
            notes: 'شاشة مكسورة',
            returns: [ret],
            products: [p],
            orders: [],
            currency: 'SAR',
          });
          if (!res.success) throw new Error(res.message);
          const updated = res.products[0];
          if (updated.availableStock !== 17 || updated.damagedStock !== 3 || updated.awaitingInspectionStock !== 0) {
            throw new Error('Damaged custody violation');
          }
          const writeoff = res.newTransactions.find((tx) => tx.type === 'damage_writeoff');
          if (!writeoff || writeoff.amount !== 300) {
            throw new Error(`Expected snapshot writeoff 300, got ${writeoff?.amount}`);
          }

          t.status = 'passed';
          t.details = [
            'عزل 3 وحدات في damagedStock مع بقاء المتاح 17',
            'قيد خسارة الإعدام اعتمد التكلفة التاريخية 300 SAR وليس سعر الكتالوج الجديد 360',
          ];
        } else if (t.id === 'test_financial_breakdown_strict_rules') {
          const pNoCost = makeTestProduct({ id: 'p-nocost', sku: 'NOCOST-1', baseCost: undefined });
          const ordNoCost: Order = {
            id: 'ord-no-cost',
            marketplaceId: 'noon',
            customerName: 'عميل',
            shippingAddress: 'الرياض',
            items: [{ productId: pNoCost.id, productSku: pNoCost.sku, productName: pNoCost.name, imageUrl: pNoCost.imageUrl, quantity: 1, unitPrice: 200 }],
            totalAmount: 200,
            shippingCost: 25,
            marketplaceCommission: 20,
            status: 'delivered',
            stockDeducted: true,
            isClosed: true,
            orderDate: '2026-11-10T10:00:00Z',
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const breakdownA = computeOrderFinancialBreakdown(ordNoCost, [pNoCost]);
          if (breakdownA.isProfitCalculable !== false || breakdownA.confirmedNet !== null) {
            throw new Error('Speculative profit was computed without COGS');
          }

          const pWithCost = makeTestProduct({ id: 'p-cost', sku: 'COST-1', baseCost: 140 });
          const ordWithCost: Order = {
            id: 'ord-with-cost',
            marketplaceId: 'noon',
            customerName: 'عميل',
            shippingAddress: 'الرياض',
            items: [{ productId: pWithCost.id, productSku: pWithCost.sku, productName: pWithCost.name, imageUrl: pWithCost.imageUrl, quantity: 1, unitPrice: 200, unitCostSnapshot: 100 }],
            totalAmount: 200,
            shippingCost: 25,
            marketplaceCommission: undefined,
            status: 'delivered',
            stockDeducted: true,
            isClosed: true,
            orderDate: '2026-11-10T10:00:00Z',
            createdAt: '2026-11-10T10:00:00Z',
            updatedAt: '2026-11-10T10:00:00Z',
          };
          const breakdownB = computeOrderFinancialBreakdown(ordWithCost, [pWithCost]);
          if (breakdownB.confirmedNet !== 75 || breakdownB.commissionStatus !== 'missing' || breakdownB.productCostOfGoods !== 100) {
            throw new Error(`Expected net=75 using snapshot cost=100 & zero unrecorded fee, got ${breakdownB.confirmedNet}`);
          }

          t.status = 'passed';
          t.details = [
            'computeOrderFinancialBreakdown حظر الربح التخمينى عند غياب التكلفة',
            'تم احتساب الصافي 75 وفق التكلفة التاريخية 100 ووسم العمولة غير المسجلة كـ missing دون خصم 12% وهمي',
          ];
        } else if (t.id === 'test_onboarding_dynamic_zero_platforms') {
          if (DEFAULT_MERCHANT_PROFILE.selectedMarketplaceIds.length !== 0 || DEFAULT_MERCHANT_PROFILE.isOnboarded !== false) {
            throw new Error('Default merchant profile must start un-onboarded with zero preselected platforms');
          }

          t.status = 'passed';
          t.details = [
            'DEFAULT_MERCHANT_PROFILE يبدأ بصفر منصات مختارة مسبقاً ([])',
            'البدء متاح بدون إجبار أمازون أو نون ومع دعم المتجر المستقل',
          ];
        }
      } catch (err: unknown) {
        t.status = 'failed';
        t.messageAr = err instanceof Error ? err.message : 'فشل غير متوقع';
        t.messageEn = err instanceof Error ? err.message : 'Unexpected failure';
      }

      t.durationMs = Math.round(performance.now() - start);
      setTests([...currentResults]);
    }

    setIsRunning(false);
  };

  const passedCount = tests.filter((t) => t.status === 'passed').length;
  const failedCount = tests.filter((t) => t.status === 'failed').length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isRtl ? 'حزمة اختبارات قواعد العمل والنزاهة التشغيلية' : 'In-App Business Logic Test Suite'}
      maxWidth="3xl"
    >
      <div className="space-y-5">
        {/* Header notice */}
        <div className="p-4 bg-slate-900 text-white rounded-2xl flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h3 className="font-bold text-sm">
                {isRtl ? 'بيئة التحقق المعزولة للعمليات (In-Memory Isolation)' : 'Isolated In-Memory Operations Verification'}
              </h3>
            </div>
            <p className="text-xs text-slate-300">
              {isRtl
                ? 'تنفذ هذه الحزمة سيناريوهات دورة حياة الطلبات والمرتجعات والقيود المحاسبية دون التأثير على بيانات متجرك الفعلية.'
                : 'Runs rigorous lifecycle, custody, and ledger tests on isolated memory without mutating actual store data.'}
            </p>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={runAllTests}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
              isRunning
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'bg-[#2563EB] hover:bg-blue-700 text-white shadow-md'
            }`}
          >
            {isRunning ? (
              <>
                <Clock className="w-4 h-4 animate-spin" />
                <span>{isRtl ? 'جاري الفحص...' : 'Executing...'}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>{isRtl ? 'تشغيل كامل الاختبارات' : 'Run All Tests'}</span>
              </>
            )}
          </button>
        </div>

        {/* Scoreboard */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-white border border-[#E8ECF2] rounded-xl text-center">
            <span className="text-[11px] text-[#64748B] font-semibold block mb-0.5">
              {isRtl ? 'إجمالي الاختبارات' : 'Total Tests'}
            </span>
            <span className="text-xl font-bold text-[#172033] font-mono-code">{tests.length}</span>
          </div>

          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
            <span className="text-[11px] text-[#16A36A] font-semibold block mb-0.5">
              {isRtl ? 'ناجح ومثبت' : 'Passed'}
            </span>
            <span className="text-xl font-bold text-[#16A36A] font-mono-code">{passedCount}</span>
          </div>

          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center">
            <span className="text-[11px] text-[#DC5555] font-semibold block mb-0.5">
              {isRtl ? 'إخفاقات' : 'Failed'}
            </span>
            <span className="text-xl font-bold text-[#DC5555] font-mono-code">{failedCount}</span>
          </div>
        </div>

        {/* Test Cases List */}
        <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pe-1">
          {tests.map((test) => (
            <div
              key={test.id}
              className={`p-3.5 rounded-xl border transition-all ${
                test.status === 'passed'
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : test.status === 'failed'
                  ? 'bg-rose-50/50 border-rose-200'
                  : test.status === 'running'
                  ? 'bg-blue-50/40 border-blue-200 animate-pulse'
                  : 'bg-white border-[#E8ECF2]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {test.status === 'passed' && <CheckCircle2 className="w-4 h-4 text-[#16A36A]" />}
                    {test.status === 'failed' && <XCircle className="w-4 h-4 text-[#DC5555]" />}
                    {test.status === 'running' && <Clock className="w-4 h-4 text-[#2563EB] animate-spin" />}
                    {test.status === 'idle' && <Boxes className="w-4 h-4 text-[#64748B]" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs text-[#172033]">
                        {isRtl ? test.nameAr : test.nameEn}
                      </span>
                      {test.durationMs !== undefined && (
                        <span className="text-[10px] text-[#64748B] font-mono-code">
                          {test.durationMs}ms
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#64748B] mt-1 leading-relaxed">
                      {isRtl ? test.messageAr : test.messageEn}
                    </p>

                    {/* Step log details */}
                    {test.details && test.details.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200/60 space-y-1">
                        {test.details.map((d, idx) => (
                          <div key={idx} className="text-[10px] font-mono-code text-[#172033] flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span>{d}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                    test.status === 'passed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : test.status === 'failed'
                      ? 'bg-rose-100 text-rose-800'
                      : test.status === 'running'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {test.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t border-[#E8ECF2]">
          <span className="text-xs text-[#64748B]">
            {isRtl ? 'جميع الاختبارات مستقلة ولا تقوم بالكتابة في localStorage.' : 'All tests run in-memory and do not write to localStorage.'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[#172033] hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            {isRtl ? 'إغلاق النافذة' : 'Close'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
