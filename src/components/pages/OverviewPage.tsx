import React, { useState, useMemo } from 'react';
import {
  Package,
  Clock,
  Truck,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Boxes,
  Eye,
  AlertTriangle,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  X,
  Filter,
  Calendar,
  DollarSign,
  ShieldAlert,
  Sparkles,
  Info,
  BarChart3,
  Layers,
  ArrowDownRight,
  ExternalLink,
} from 'lucide-react';
import { storageService } from '../../services/storage';
import { resolveOrderItemUnitCost } from '../../domain/financialLedger';
import { translations, Locale } from '../../locales/translations';
import { ActiveTab } from '../layout/Sidebar';
import {
  Order,
  Product,
  ReturnRecord,
  DateFilterOption,
  OperationalAlert,
  TopSellingProductItem,
  InventoryHealthItem,
  PlatformPerformanceStats,
  MarketplaceId,
} from '../../types';

interface OverviewPageProps {
  locale: Locale;
  onNavigate: (tab: ActiveTab, filterState?: Record<string, string>) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ locale, onNavigate }) => {
  const t = translations[locale];
  const settings = storageService.getSettings();

  // 1. Dashboard Filters State
  const [dateFilter, setDateFilter] = useState<DateFilterOption>('allTime');
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('all');
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthStartIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }, []);
  const [customStartDate, setCustomStartDate] = useState<string>(monthStartIso);
  const [customEndDate, setCustomEndDate] = useState<string>(todayIso);

  // Compute Active Date Range dynamically from current system clock
  const activeDateRange = useMemo<{ start: Date; end: Date; daysCount: number }>(() => {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    if (dateFilter === 'allTime') {
      const start = new Date('2020-01-01T00:00:00Z');
      return { start, end: endOfToday, daysCount: Math.max(1, Math.round((endOfToday.getTime() - start.getTime()) / 86400000)) };
    }
    if (dateFilter === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end: endOfToday, daysCount: 1 };
    }
    if (dateFilter === '7days') {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end: endOfToday, daysCount: 7 };
    }
    if (dateFilter === '30days') {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end: endOfToday, daysCount: 30 };
    }
    if (dateFilter === 'thisMonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: endOfToday, daysCount: Math.max(1, now.getDate()) };
    }
    if (dateFilter === 'prevMonth') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end, daysCount: end.getDate() };
    }
    // Custom (inclusive end-of-day)
    const start = new Date(`${customStartDate || monthStartIso}T00:00:00`);
    const end = new Date(`${customEndDate || todayIso}T23:59:59.999`);
    const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 3600 * 24)));
    return { start, end, daysCount: diffDays };
  }, [dateFilter, customStartDate, customEndDate, monthStartIso, todayIso]);

  // Active Marketplaces
  const configuredMarketplaces = useMemo(() => storageService.getMarketplaces(), []);

  // Raw Database Queries
  const allProducts = useMemo(() => storageService.getProducts(), []);
  const filteredOrders = useMemo(
    () => storageService.getFilteredOrders(activeDateRange, selectedMarketplace),
    [activeDateRange, selectedMarketplace]
  );
  const filteredReturns = useMemo(
    () => storageService.getFilteredReturns(activeDateRange, selectedMarketplace),
    [activeDateRange, selectedMarketplace]
  );

  // ----------------------------------------------------------------------
  // SECTION 1.1: MAIN KPI CARDS CALCULATIONS
  // ----------------------------------------------------------------------
  const totalOrdersCount = filteredOrders.length;
  const successfulOrders = filteredOrders.filter((o) => o.status === 'delivered');
  const successfulOrdersCount = successfulOrders.length;

  const activeOrders = filteredOrders.filter(
    (o) => !o.isClosed && (o.status === 'preparing' || o.status === 'with_delivery')
  );
  const activeOrdersCount = activeOrders.length;

  const ordersPreparing = filteredOrders.filter((o) => o.status === 'preparing');
  const ordersWithDelivery = filteredOrders.filter((o) => o.status === 'with_delivery');

  // Returns in Transit
  const returnsInTransit = filteredReturns.filter(
    (r) => !r.isCompleted && (r.returnStatus === 'in_transit_back' || r.returnStatus === 'pickup_pending' || r.returnStatus === 'return_initiated')
  );
  // Returns Received & Under Inspection
  const returnsAwaitingInspection = filteredReturns.filter(
    (r) =>
      !r.isCompleted &&
      (r.returnStatus === 'received_at_warehouse' ||
        r.returnStatus === 'under_inspection' ||
        r.returnStatus === 'product_received')
  );
  // Damaged Products
  const damagedReturns = filteredReturns.filter(
    (r) => r.inspectionOutcome === 'damaged' || r.returnStatus === 'damaged'
  );

  // Total Successful Sales Value (Delivered orders only!)
  const totalDeliveredRevenue = useMemo(() => {
    return successfulOrders.reduce((acc, o) => acc + o.totalAmount, 0);
  }, [successfulOrders]);

  // Total Registered Value (All registered orders in period)
  const totalRegisteredRevenue = useMemo(() => {
    return filteredOrders.reduce((acc, o) => acc + o.totalAmount, 0);
  }, [filteredOrders]);

  // Value of returned products in period
  const totalReturnedValue = useMemo(() => {
    return filteredReturns.reduce((acc, r) => {
      const retTotal = r.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
      return acc + retTotal;
    }, 0);
  }, [filteredReturns]);

  // Value of damaged products
  const totalDamagedValue = useMemo(() => {
    return damagedReturns.reduce((acc, r) => {
      const retTotal = r.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
      return acc + retTotal;
    }, 0);
  }, [damagedReturns]);

  // Actual Known Financial Loss (strictly recorded unit cost only; never substitute selling price)
  const actualRecordedLosses = useMemo(() => {
    let loss = 0;
    for (const ret of damagedReturns) {
      for (const item of ret.items) {
        const { unitCost } = resolveOrderItemUnitCost(item, allProducts);
        if (unitCost !== null) {
          loss += unitCost * item.quantity;
        }
      }
    }
    return loss;
  }, [damagedReturns, allProducts]);

  // Actual accounting ledger summary
  const financialSummary = useMemo(
    () => storageService.getFinancialSummary(),
    [filteredOrders, filteredReturns]
  );

  // ----------------------------------------------------------------------
  // SECTION 1.3: TOP SELLING PRODUCTS ANALYSIS
  // ----------------------------------------------------------------------
  const topSellingProducts = useMemo<TopSellingProductItem[]>(() => {
    const productSalesMap = new Map<
      string,
      { units: number; revenue: number; ordersCount: number }
    >();

    // Strictly delivered orders count towards successful sales!
    for (const ord of successfulOrders) {
      for (const item of ord.items) {
        const key = item.productId || item.productSku;
        const current = productSalesMap.get(key) || { units: 0, revenue: 0, ordersCount: 0 };
        current.units += item.quantity;
        current.revenue += item.unitPrice * item.quantity;
        current.ordersCount += 1;
        productSalesMap.set(key, current);
      }
    }

    const items: TopSellingProductItem[] = [];
    for (const [key, data] of productSalesMap.entries()) {
      const prod = allProducts.find((p) => p.id === key || p.sku === key);
      if (prod) {
        let health: TopSellingProductItem['healthStatus'] = 'healthy';
        if (prod.availableStock <= 0) health = 'out_of_stock';
        else if (prod.availableStock <= 5) health = 'low';
        else if (prod.availableStock <= 15) health = 'moderate';

        items.push({
          product: prod,
          deliveredUnits: data.units,
          deliveredRevenue: data.revenue,
          totalOrdersCount: data.ordersCount,
          physicalStock: prod.physicalStock,
          availableStock: prod.availableStock,
          healthStatus: health,
        });
      }
    }

    return items.sort((a, b) => b.deliveredUnits - a.deliveredUnits);
  }, [successfulOrders, allProducts]);

  // ----------------------------------------------------------------------
  // SECTION 1.4: INVENTORY HEALTH & LOW-STOCK ESTIMATIONS
  // ----------------------------------------------------------------------
  const inventoryHealthList = useMemo<InventoryHealthItem[]>(() => {
    const days = Math.max(1, activeDateRange.daysCount);

    return allProducts.map((prod) => {
      // Delivered sales for this product in active period
      const deliveredInPeriod = successfulOrders.reduce((acc, o) => {
        const item = o.items.find((it) => it.productId === prod.id || it.productSku === prod.sku);
        return acc + (item ? item.quantity : 0);
      }, 0);

      const velocity = Number((deliveredInPeriod / days).toFixed(2));
      let daysRemaining: number | null = null;
      if (velocity > 0 && prod.availableStock > 0) {
        daysRemaining = Math.max(1, Math.round(prod.availableStock / velocity));
      }

      let status: InventoryHealthItem['status'] = 'healthy';
      let alertNote: string | undefined;
      let alertNoteEn: string | undefined;

      if (prod.availableStock <= 0) {
        status = 'out_of_stock';
        alertNote = 'نفد المخزون المتاح للبيع تماماً من هذا المنتج.';
        alertNoteEn = 'Out of available stock.';
      } else if (daysRemaining !== null && daysRemaining <= 3) {
        status = 'critical_low';
        alertNote = `قد ينفد المخزون المتاح خلال ~${daysRemaining} أيام بناءً على معدل المبيعات الحالي (${velocity} قطعة/يوم).`;
        alertNoteEn = `Estimated stockout within ~${daysRemaining} days based on daily sales velocity.`;
      } else if (prod.availableStock <= 5) {
        status = 'low';
        alertNote = 'المخزون المتاح يقترب من النفاد (أقل من 5 قطع).';
        alertNoteEn = 'Low available inventory (under 5 units).';
      } else if (deliveredInPeriod === 0 && prod.physicalStock > 30) {
        status = 'excessive';
        alertNote = 'مخزون مرتفع مع ركود في المبيعات خلال الفترة المحددة.';
        alertNoteEn = 'Excessive stock with zero sales in period.';
      }

      return {
        product: prod,
        availableStock: prod.availableStock,
        physicalStock: prod.physicalStock,
        dailySalesVelocity: velocity,
        estimatedDaysRemaining: daysRemaining,
        status,
        alertNote,
        alertNoteEn,
      };
    });
  }, [allProducts, successfulOrders, activeDateRange]);

  // Filter urgent inventory items for the dedicated card
  const urgentInventoryItems = useMemo(
    () => inventoryHealthList.filter((i) => i.status !== 'healthy'),
    [inventoryHealthList]
  );

  // ----------------------------------------------------------------------
  // SECTION 1.5: PLATFORM PERFORMANCE ANALYSIS (NOON vs AMAZON)
  // ----------------------------------------------------------------------
  // ----------------------------------------------------------------------
  // SECTION 1.5: DYNAMIC PLATFORM PERFORMANCE ANALYSIS
  // ----------------------------------------------------------------------
  const platformStatsList = useMemo<PlatformPerformanceStats[]>(() => {
    return configuredMarketplaces.map((mkt) => {
      const orders = filteredOrders.filter((o) => o.marketplaceId === mkt.id);
      const delivered = orders.filter((o) => o.status === 'delivered');
      const returns = filteredReturns.filter((r) => r.marketplaceId === mkt.id);

      const total = orders.length;
      const successRate = total > 0 ? Number(((delivered.length / total) * 100).toFixed(1)) : 0;
      const returnRate = total > 0 ? Number(((returns.length / total) * 100).toFixed(1)) : 0;

      const unitsSold = delivered.reduce((acc, o) => {
        return acc + o.items.reduce((s, it) => s + it.quantity, 0);
      }, 0);

      const revenue = delivered.reduce((acc, o) => acc + o.totalAmount, 0);

      // Top product on that marketplace
      const prodMap = new Map<string, { units: number; revenue: number }>();
      for (const ord of delivered) {
        for (const item of ord.items) {
          const cur = prodMap.get(item.productName) || { units: 0, revenue: 0 };
          cur.units += item.quantity;
          cur.revenue += item.unitPrice * item.quantity;
          prodMap.set(item.productName, cur);
        }
      }
      let topProduct: { name: string; units: number; revenue: number } | undefined;
      let maxUnits = 0;
      for (const [name, stats] of prodMap.entries()) {
        if (stats.units > maxUnits) {
          maxUnits = stats.units;
          topProduct = { name, units: stats.units, revenue: stats.revenue };
        }
      }

      return {
        marketplaceId: mkt.id,
        nameAr: mkt.nameAr,
        nameEn: mkt.nameEn,
        totalOrders: total,
        deliveredOrders: delivered.length,
        successRate,
        returnsCount: returns.length,
        returnRate,
        unitsSold,
        revenue,
        topProduct,
      };
    });
  }, [configuredMarketplaces, filteredOrders, filteredReturns]);

  // ----------------------------------------------------------------------
  // SECTION 1.7: OPERATIONAL RECOMMENDATIONS ("What Needs Your Attention?")
  // ----------------------------------------------------------------------
  const operationalAlerts = useMemo<OperationalAlert[]>(() => {
    const alerts: OperationalAlert[] = [];

    // 1. Fast selling product running out of stock
    const criticalStock = inventoryHealthList.find((i) => i.status === 'critical_low');
    if (criticalStock) {
      alerts.push({
        id: 'alert-stockout',
        severity: 'critical',
        title: 'خطر نفاد وشيك لمنتج سريع البيع',
        titleEn: 'Imminent Stockout on Fast Seller',
        entity: criticalStock.product.name,
        reason: `المخزون المتاح (${criticalStock.availableStock} وحدة) قد ينفد خلال ~${criticalStock.estimatedDaysRemaining} أيام بمعدل مبيعات ${criticalStock.dailySalesVelocity} وحدة يومياً.`,
        reasonEn: `Available stock (${criticalStock.availableStock}) may deplete within ~${criticalStock.estimatedDaysRemaining} days at current velocity.`,
        recommendedAction: 'قم بتوريد كميات جديدة للمستودع أو زيادة السعر لتنظيم وتيرة الطلب.',
        recommendedActionEn: 'Replenish stock immediately or optimize price to control order velocity.',
        targetTab: 'inventory',
      });
    }

    // 2. Returns in transit for long duration
    if (returnsInTransit.length > 0) {
      alerts.push({
        id: 'alert-returns-transit',
        severity: 'warning',
        title: 'شحنات مرتجعة قيد العودة مع شركة الشحن',
        titleEn: 'Returns In Transit Back to Warehouse',
        entity: `${returnsInTransit.length} ${locale === 'ar' ? 'طرد مرتجع' : 'parcels'}`,
        reason: 'توجد طرود مرتجعة مسجلة لم تصل للمستودع بعد من شركة الشحن.',
        reasonEn: 'Registered return shipments that have not yet arrived at the warehouse.',
        recommendedAction: 'تتبع بوالص الإرجاع مع شركة الشحن لتأكيد استلام الطرود وبدء الفحص.',
        recommendedActionEn: 'Track courier AWBs to expedite warehouse receiving and inspection.',
        targetTab: 'returns',
        targetFilter: { status: 'in_transit_back' },
      });
    }

    // 3. Returns awaiting physical inspection
    if (returnsAwaitingInspection.length > 0) {
      alerts.push({
        id: 'alert-returns-inspection',
        severity: 'warning',
        title: 'منتجات مرتجعة مستلمة بانتظار الفحص والتقييم',
        titleEn: 'Received Returns Pending Quality Inspection',
        entity: `${returnsAwaitingInspection.length} ${locale === 'ar' ? 'طرد بالمستودع' : 'units at warehouse'}`,
        reason: 'لا يمكن إعادة هذه المنتجات للمخزون المتاح إلا بعد فحصها وتحديد سلامتها.',
        reasonEn: 'Items cannot re-enter sellable inventory until physical inspection is completed.',
        recommendedAction: 'افتح صفحة المرتجعات لإجراء الفحص واعتماد الصالح لإعادة البيع.',
        recommendedActionEn: 'Perform inspection to approve resellable units and write off damaged goods.',
        targetTab: 'returns',
        targetFilter: { status: 'under_inspection' },
      });
    }

    // 4. Stagnant inventory
    const stagnant = inventoryHealthList.find((i) => i.status === 'excessive');
    if (stagnant) {
      alerts.push({
        id: 'alert-stagnant',
        severity: 'info',
        title: 'مخزون راكد يحتاج إلى تنشيط',
        titleEn: 'Slow-Moving / Stagnant Stock',
        entity: stagnant.product.name,
        reason: `يوجد ${stagnant.physicalStock} وحدة بالمستودع دون تسجيل مبيعات ناجحة خلال الفترة الحالية.`,
        reasonEn: `${stagnant.physicalStock} units in warehouse with zero delivered sales in selected period.`,
        recommendedAction: 'راجع التسعير وقدم عروضاً ترويجية لتسييل رأس المال المجمد.',
        recommendedActionEn: 'Review pricing or run promotional campaigns to unlock tied capital.',
        targetTab: 'products',
      });
    }

    // 5. Channel delivery success check
    const platformsWithOrders = platformStatsList.filter((p) => p.totalOrders >= 2);
    if (platformsWithOrders.length >= 2) {
      const best = [...platformsWithOrders].sort((a, b) => b.successRate - a.successRate)[0];
      const worst = [...platformsWithOrders].sort((a, b) => a.successRate - b.successRate)[0];
      if (best.successRate - worst.successRate >= 20) {
        alerts.push({
          id: 'alert-mkt-discrepancy',
          severity: 'warning',
          title: `فارق ملحوظ في نسبة تسليم ${locale === 'ar' ? worst.nameAr : worst.nameEn}`,
          titleEn: `Delivery Success Rate Discrepancy on ${worst.nameEn}`,
          entity: locale === 'ar' ? worst.nameAr : worst.nameEn,
          reason: `نسبة التسليم الناجح بلغت (${worst.successRate}%) مقارنة بـ (${best.successRate}%) على ${locale === 'ar' ? best.nameAr : best.nameEn}.`,
          reasonEn: `Delivered success rate is ${worst.successRate}%, significantly lower than ${best.nameEn}.`,
          recommendedAction: 'تحقق من أداء شركة الشحن ومناطق التغطية وتأكيدات العملاء قبل الإرسال.',
          recommendedActionEn: 'Investigate courier performance and dispatch confirmations.',
        });
      }
    }

    return alerts;
  }, [inventoryHealthList, returnsInTransit, returnsAwaitingInspection, platformStatsList, locale]);

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* DASHBOARD TOP CONTROLS & FILTER BAR                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-white p-4 rounded-2xl border border-[#E8ECF2] shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Title and Scope in Natural Business Language */}
        <div>
          <h2 className="text-base font-bold text-[#172033] flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#2563EB]" />
            <span>{locale === 'ar' ? 'نظرة عامة على المتجر والعمليات' : 'Store Operations Overview'}</span>
          </h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            {locale === 'ar'
              ? `متابعة مباشرة للطلبات، المخزون، ونسب التسليم عبر كافة المنصات (${dateFilter === 'allTime' ? 'كامل سجل المتجر' : `${activeDateRange.daysCount} يوم`})`
              : `Live operational monitoring across active channels (${dateFilter === 'allTime' ? 'All-Time Store History' : `${activeDateRange.daysCount} days`})`}
          </p>
        </div>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Dynamic Marketplace Selector */}
          <div className="flex items-center gap-1 bg-[#F7F8FA] p-1 rounded-xl border border-[#E8ECF2] overflow-x-auto max-w-full">
            <button
              onClick={() => setSelectedMarketplace('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                selectedMarketplace === 'all'
                  ? 'bg-white text-[#172033] shadow-xs'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'جميع المنصات' : 'All Channels'}
            </button>
            {configuredMarketplaces.map((mkt) => (
              <button
                key={mkt.id}
                onClick={() => setSelectedMarketplace(mkt.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  selectedMarketplace === mkt.id
                    ? 'bg-white text-[#172033] shadow-xs'
                    : 'text-[#64748B] hover:text-[#172033]'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: mkt.color }}
                />
                <span>{locale === 'ar' ? mkt.nameAr : mkt.nameEn}</span>
              </button>
            ))}
          </div>

          {/* Date Range Selector with allTime default */}
          <div className="flex items-center gap-1 bg-[#F7F8FA] p-1 rounded-xl border border-[#E8ECF2] overflow-x-auto">
            <button
              onClick={() => setDateFilter('allTime')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === 'allTime'
                  ? 'bg-white text-[#2563EB] shadow-xs font-bold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'كل الفترات' : 'All Time'}
            </button>
            <button
              onClick={() => setDateFilter('today')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === 'today'
                  ? 'bg-white text-[#2563EB] shadow-xs font-bold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'اليوم' : 'Today'}
            </button>
            <button
              onClick={() => setDateFilter('7days')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === '7days'
                  ? 'bg-white text-[#2563EB] shadow-xs font-bold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'آخر 7 أيام' : '7 Days'}
            </button>
            <button
              onClick={() => setDateFilter('30days')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === '30days'
                  ? 'bg-white text-[#2563EB] shadow-xs font-bold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'آخر 30 يوم' : '30 Days'}
            </button>
            <button
              onClick={() => setDateFilter('thisMonth')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === 'thisMonth'
                  ? 'bg-white text-[#2563EB] shadow-xs font-bold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'هذا الشهر' : 'This Month'}
            </button>
            <button
              onClick={() => setDateFilter('prevMonth')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === 'prevMonth'
                  ? 'bg-white text-[#2563EB] shadow-xs font-bold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'الشهر السابق' : 'Prev Month'}
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* SECTION 1.8: WHAT NEEDS YOUR ATTENTION? (OPERATIONAL ALERTS)      */}
      {/* ------------------------------------------------------------------ */}
      {operationalAlerts.length > 0 && (
        <div id="tour-attention-center" className="bg-white rounded-2xl border border-[#E8ECF2] p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              <h3 className="text-sm font-bold text-[#172033]">
                {locale === 'ar' ? 'ما يحتاج انتباهك الآن؟ (توصيات وإجراءات عاجلة)' : 'What Needs Your Attention?'}
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-[#64748B]">
              {operationalAlerts.length} {locale === 'ar' ? 'إشعارات تشغيلية مبنية على البيانات' : 'actionable notices'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {operationalAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3.5 rounded-xl border flex flex-col justify-between transition-all ${
                  alert.severity === 'critical'
                    ? 'bg-rose-50/50 border-rose-200'
                    : alert.severity === 'warning'
                    ? 'bg-amber-50/50 border-amber-200'
                    : 'bg-blue-50/50 border-blue-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        alert.severity === 'critical'
                          ? 'bg-rose-100 text-rose-800'
                          : alert.severity === 'warning'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-blue-100 text-blue-900'
                      }`}
                    >
                      {alert.severity === 'critical'
                        ? locale === 'ar' ? 'عاجل وحرج' : 'Critical'
                        : alert.severity === 'warning'
                        ? locale === 'ar' ? 'تنبيه تشغيلي' : 'Warning'
                        : locale === 'ar' ? 'توصية تحسين' : 'Notice'}
                    </span>
                    <span className="text-[11px] font-bold text-[#172033] truncate max-w-[140px]">
                      {alert.entity}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-[#172033] mb-1">
                    {locale === 'ar' ? alert.title : alert.titleEn}
                  </h4>
                  <p className="text-[11px] text-[#64748B] leading-relaxed mb-2">
                    {locale === 'ar' ? alert.reason : alert.reasonEn}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-200/60 mt-auto">
                  <div className="text-[10px] text-[#172033] font-medium mb-2">
                    <strong className="text-[#2563EB]">
                      {locale === 'ar' ? 'الإجراء المقترح:' : 'Recommended Action:'}
                    </strong>{' '}
                    {locale === 'ar' ? alert.recommendedAction : alert.recommendedActionEn}
                  </div>

                  {alert.targetTab && (
                    <button
                      onClick={() => onNavigate(alert.targetTab as ActiveTab, alert.targetFilter)}
                      className="w-full flex items-center justify-center gap-1.5 py-1 text-xs font-semibold text-[#2563EB] hover:bg-blue-100/60 rounded-md transition-colors cursor-pointer"
                    >
                      <span>{locale === 'ar' ? 'اتخاذ الإجراء في الصفحة' : 'Open Page'}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* SECTION 1.1: MAIN KPI CARDS (BALANCED HIERARCHY)                  */}
      {/* ------------------------------------------------------------------ */}
      <div id="tour-overview-stats" className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* 1. Total Orders */}
        <div
          onClick={() => onNavigate('orders')}
          className="bg-white p-4 rounded-xl border border-[#E8ECF2] hover:border-[#2563EB] transition-all cursor-pointer shadow-xs flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-[#64748B]">
            <span className="font-semibold">{locale === 'ar' ? 'إجمالي الطلبات' : 'Total Orders'}</span>
            <Boxes className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold text-[#172033] tabular-nums font-mono-code">
              {totalOrdersCount}
            </span>
          </div>
          <span className="text-[11px] text-[#64748B]">
            {locale === 'ar' ? 'كافة المسارات المسجلة' : 'All channels in period'}
          </span>
        </div>

        {/* 2. Successful Orders (Delivered) */}
        <div
          onClick={() => onNavigate('completedOrders')}
          className="bg-white p-4 rounded-xl border border-[#E8ECF2] hover:border-[#16A36A] transition-all cursor-pointer shadow-xs flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-[#16A36A]">
            <span className="font-semibold">{locale === 'ar' ? 'الطلبات الناجحة' : 'Successful Orders'}</span>
            <CheckCircle2 className="w-4 h-4 text-[#16A36A]" />
          </div>
          <div className="my-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-[#16A36A] tabular-nums font-mono-code">
              {successfulOrdersCount}
            </span>
            {totalOrdersCount > 0 && (
              <span className="text-[11px] font-bold text-[#16A36A]">
                ({Math.round((successfulOrdersCount / totalOrdersCount) * 100)}%)
              </span>
            )}
          </div>
          <span className="text-[11px] text-[#64748B]">
            {locale === 'ar' ? 'مسلمة للعميل بنجاح' : 'Delivered to customers'}
          </span>
        </div>

        {/* 3. Total Sales Value */}
        <div
          onClick={() => onNavigate('completedOrders')}
          className="bg-white p-4 rounded-xl border border-[#E8ECF2] hover:border-[#2563EB] transition-all cursor-pointer shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1"
        >
          <div className="flex items-center justify-between text-xs text-[#2563EB]">
            <span className="font-semibold">{locale === 'ar' ? 'قيمة المبيعات المسلمة' : 'Delivered Revenue'}</span>
            <DollarSign className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold text-[#2563EB] tabular-nums font-mono-code">
              {totalDeliveredRevenue.toLocaleString()}
            </span>
            <span className="text-xs text-[#64748B] ms-1 font-semibold">{settings.currency}</span>
          </div>
          <span className="text-[11px] text-[#64748B]">
            {locale === 'ar' ? 'إيرادات فعلية مثبتة' : 'Confirmed sales revenue'}
          </span>
        </div>

        {/* 4. Active Orders in Progress */}
        <div
          onClick={() => onNavigate('orders')}
          className="bg-white p-4 rounded-xl border border-[#E8ECF2] hover:border-slate-400 transition-all cursor-pointer shadow-xs flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-[#172033]">
            <span className="font-semibold">{locale === 'ar' ? 'طلبات نشطة جارية' : 'Active Orders'}</span>
            <Clock className="w-4 h-4 text-[#172033]" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold text-[#172033] tabular-nums font-mono-code">
              {activeOrdersCount}
            </span>
          </div>
          <span className="text-[11px] text-[#64748B]">
            {ordersPreparing.length} {locale === 'ar' ? 'تجهيز' : 'prep'} · {ordersWithDelivery.length} {locale === 'ar' ? 'شحن' : 'shipped'}
          </span>
        </div>

        {/* 5. Returns & Risks (In Transit / Unreceived) */}
        <div
          onClick={() => onNavigate('returns')}
          className="bg-white p-4 rounded-xl border border-[#E8ECF2] hover:border-[#D99A27] transition-all cursor-pointer shadow-xs flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-[#D99A27]">
            <span className="font-semibold">{locale === 'ar' ? 'مرتجعات خارج المستودع' : 'Returns in Transit'}</span>
            <RotateCcw className="w-4 h-4 text-[#D99A27]" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold text-[#D99A27] tabular-nums font-mono-code">
              {returnsInTransit.length}
            </span>
          </div>
          <span className="text-[11px] text-[#64748B]">
            {returnsAwaitingInspection.length} {locale === 'ar' ? 'بانتظار الفحص' : 'awaiting inspection'}
          </span>
        </div>
      </div>

      {/* Row 2 of Minor Operational KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {/* Orders Being Prepared */}
        <div
          onClick={() => onNavigate('orders', { status: 'preparing' })}
          className="bg-[#F7F8FA] p-3 rounded-xl border border-[#E8ECF2] hover:bg-white transition-all cursor-pointer"
        >
          <span className="text-[11px] text-[#64748B] block">{locale === 'ar' ? 'قيد التجهيز' : 'Being Prepared'}</span>
          <span className="text-lg font-bold text-[#172033] font-mono-code">{ordersPreparing.length}</span>
        </div>

        {/* Out for Delivery */}
        <div
          onClick={() => onNavigate('orders', { status: 'with_delivery' })}
          className="bg-[#F7F8FA] p-3 rounded-xl border border-[#E8ECF2] hover:bg-white transition-all cursor-pointer"
        >
          <span className="text-[11px] text-[#64748B] block">{locale === 'ar' ? 'مع المندوب / جاري الشحن' : 'Out for Delivery'}</span>
          <span className="text-lg font-bold text-[#2563EB] font-mono-code">{ordersWithDelivery.length}</span>
        </div>

        {/* Returns Awaiting Inspection */}
        <div
          onClick={() => onNavigate('returns', { status: 'under_inspection' })}
          className="bg-[#F7F8FA] p-3 rounded-xl border border-[#E8ECF2] hover:bg-white transition-all cursor-pointer"
        >
          <span className="text-[11px] text-[#64748B] block">{locale === 'ar' ? 'بانتظار الفحص' : 'Awaiting Inspection'}</span>
          <span className="text-lg font-bold text-[#D99A27] font-mono-code">{returnsAwaitingInspection.length}</span>
        </div>

        {/* Damaged Products */}
        <div
          onClick={() => onNavigate('returns', { status: 'damaged' })}
          className="bg-[#F7F8FA] p-3 rounded-xl border border-[#E8ECF2] hover:bg-white transition-all cursor-pointer"
        >
          <span className="text-[11px] text-[#DC5555] block">{locale === 'ar' ? 'منتجات تالفة / مشطوبة' : 'Damaged / Unsellable'}</span>
          <span className="text-lg font-bold text-[#DC5555] font-mono-code">{damagedReturns.length}</span>
        </div>

        {/* Recorded Financial Losses */}
        <div
          onClick={() => onNavigate('returns')}
          className="bg-[#F7F8FA] p-3 rounded-xl border border-[#E8ECF2] hover:bg-white transition-all cursor-pointer"
        >
          <span className="text-[11px] text-[#DC5555] block">{locale === 'ar' ? 'الخسائر المثبتة' : 'Recorded Losses'}</span>
          <span className="text-lg font-bold text-[#DC5555] font-mono-code">
            {actualRecordedLosses.toLocaleString()} {settings.currency}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* SECTION 1.2: FINANCIAL & LOSS TRANSPARENCY PANEL                   */}
      {/* ------------------------------------------------------------------ */}
      <div id="tour-financial-summary" className="bg-white rounded-2xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2]">
          <div>
            <h3 className="text-sm font-bold text-[#172033] flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#16A36A]" />
              <span>{locale === 'ar' ? 'التحليل المالي وتفكيك الخسائر' : 'Financial Breakdown & Loss Transparency'}</span>
            </h3>
            <p className="text-xs text-[#64748B] mt-0.5">
              {locale === 'ar'
                ? 'فصل صارم بين قيمة المنتجات، الخسائر الفعلية المثبتة، والخسائر المحتملة دون افتراض أرقام وهمية'
                : 'Separation of product values, confirmed losses, and undetermined risks'}
            </p>
          </div>

          <div className="text-xs text-[#64748B] bg-emerald-50 text-[#16A36A] px-3 py-1 rounded-md font-semibold border border-emerald-200">
            {locale === 'ar' ? 'معايير الدقة المالية مفعلة' : 'Financial Accuracy Enforced'}
          </div>
        </div>

        {/* 5-Column Financial Spectrum */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Registered Gross */}
          <div className="p-3.5 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2]">
            <span className="text-[11px] text-[#64748B] block mb-1">
              {locale === 'ar' ? 'إجمالي قيمة الطلبات المسجلة' : 'Registered Orders Gross'}
            </span>
            <span className="text-lg font-bold text-[#172033] tabular-nums font-mono-code">
              {totalRegisteredRevenue.toLocaleString()} {settings.currency}
            </span>
            <span className="text-[10px] text-[#64748B] block mt-1">
              {locale === 'ar' ? 'تشمل المسلم والنشط والمرتجع' : 'All orders created in period'}
            </span>
          </div>

          {/* Delivered Confirmed Net */}
          <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-200">
            <span className="text-[11px] text-[#16A36A] block mb-1 font-semibold">
              {locale === 'ar' ? 'قيمة المبيعات المحققة (المسلمة)' : 'Delivered Confirmed Revenue'}
            </span>
            <span className="text-lg font-bold text-[#16A36A] tabular-nums font-mono-code">
              {totalDeliveredRevenue.toLocaleString()} {settings.currency}
            </span>
            <span className="text-[10px] text-[#16A36A] block mt-1">
              {locale === 'ar' ? 'إيرادات مؤكدة 100%' : 'Final delivered cashflow'}
            </span>
          </div>

          {/* Returned Value (Pending Resolution) */}
          <div className="p-3.5 bg-amber-50/50 rounded-xl border border-amber-200">
            <span className="text-[11px] text-[#D99A27] block mb-1 font-semibold">
              {locale === 'ar' ? 'قيمة المنتجات المرتجعة' : 'Returned Products Value'}
            </span>
            <span className="text-lg font-bold text-[#D99A27] tabular-nums font-mono-code">
              {totalReturnedValue.toLocaleString()} {settings.currency}
            </span>
            <span className="text-[10px] text-amber-900 block mt-1">
              {locale === 'ar' ? 'ليست خسارة تلقائية (بانتظار الفحص)' : 'Potential, not automatic loss'}
            </span>
          </div>

          {/* Damaged Loss (Known) */}
          <div className="p-3.5 bg-rose-50/50 rounded-xl border border-rose-200">
            <span className="text-[11px] text-[#DC5555] block mb-1 font-semibold">
              {locale === 'ar' ? 'الخسارة الفعلية (المنتجات التالفة)' : 'Actual Loss (Damaged Goods)'}
            </span>
            <span className="text-lg font-bold text-[#DC5555] tabular-nums font-mono-code">
              {actualRecordedLosses.toLocaleString()} {settings.currency}
            </span>
            <span className="text-[10px] text-rose-900 block mt-1">
              {locale === 'ar' ? 'تكلفة الوحدات المشطوبة' : 'Written off inventory cost'}
            </span>
          </div>

          {/* Shipping & Marketplace Commissions Disclosure */}
          <div className="p-3.5 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2] flex flex-col justify-between">
            <div>
              <span className="text-[11px] text-[#64748B] block mb-1 font-semibold">
                {locale === 'ar' ? 'رسوم الشحن وعمولات المنصات' : 'Shipping & Marketplace Fees'}
              </span>
              <span className="text-sm font-bold text-[#172033] block font-mono-code">
                {financialSummary.courierShippingExpenses + financialSummary.marketplaceCommissions > 0
                  ? `${(financialSummary.courierShippingExpenses + financialSummary.marketplaceCommissions).toLocaleString()} ${settings.currency}`
                  : locale === 'ar'
                  ? `0 ${settings.currency} (مسجلة بالدفتر)`
                  : `0 ${settings.currency} (in ledger)`}
              </span>
              {financialSummary.ordersMissingCostCount > 0 && (
                <span className="text-[10px] text-amber-700 block mt-1 font-semibold">
                  {locale === 'ar'
                    ? `⚠️ ${financialSummary.ordersMissingCostCount} طلب بانتظار توثيق التكلفة`
                    : `⚠️ ${financialSummary.ordersMissingCostCount} orders missing COGS`}
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#64748B] block mt-1">
              {locale === 'ar' ? 'سجل محاسبي فعلي مثبت' : 'Verified ledger transactions'}
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* SECTION 1.5: DYNAMIC PLATFORM PERFORMANCE COMPARISON               */}
      {/* ------------------------------------------------------------------ */}
      <div id="tour-marketplaces" className="bg-white rounded-2xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8ECF2]">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#2563EB]" />
            <h3 className="text-sm font-bold text-[#172033]">
              {locale === 'ar' ? 'مقارنة أداء قنوات البيع' : 'Marketplace Channels Comparison'}
            </h3>
          </div>
          <span className="text-xs text-[#64748B]">
            {locale === 'ar' ? 'مقارنة دقيقة تشمل المبيعات ونسب النجاح والقطع المباعة' : 'Strictly separates orders, units, and revenue'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {platformStatsList.map((stat) => (
            <div
              key={stat.marketplaceId}
              className="p-4 rounded-xl border border-[#E8ECF2] bg-[#F7F8FA]/60 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs"
                    style={{
                      backgroundColor:
                        stat.marketplaceId === 'noon'
                          ? '#FEEC00'
                          : stat.marketplaceId === 'amazon'
                          ? '#FF9900'
                          : '#2563EB',
                      color:
                        stat.marketplaceId === 'noon'
                          ? '#854D0E'
                          : '#FFFFFF',
                    }}
                  >
                    {stat.marketplaceId.slice(0, 4).toUpperCase()}
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-[#172033]">
                      {locale === 'ar' ? stat.nameAr : stat.nameEn}
                    </h4>
                    <span className="text-[10px] text-[#64748B]">
                      {stat.totalOrders} {locale === 'ar' ? 'طلب مسجل' : 'orders'}
                    </span>
                  </div>
                </div>

                {stat.totalOrders > 0 && stat.successRate >= 70 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-[#16A36A] border border-emerald-200">
                    {locale === 'ar' ? 'أداء ممتاز' : 'Top Performer'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E8ECF2]">
                <div>
                  <span className="text-[10px] text-[#64748B] block">{locale === 'ar' ? 'مبيعات محققة' : 'Revenue'}</span>
                  <span className="text-sm font-bold text-[#2563EB] font-mono-code tabular-nums">
                    {stat.revenue.toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#64748B] block">{locale === 'ar' ? 'نسبة النجاح' : 'Success'}</span>
                  <span className="text-sm font-bold text-[#16A36A] font-mono-code tabular-nums">
                    {stat.successRate}%
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#64748B] block">{locale === 'ar' ? 'قطع مباعة' : 'Units'}</span>
                  <span className="text-sm font-bold text-[#172033] font-mono-code tabular-nums">
                    {stat.unitsSold}
                  </span>
                </div>
              </div>

              {stat.topProduct && (
                <div className="pt-2 text-[11px] text-[#64748B] flex items-center justify-between border-t border-[#E8ECF2]">
                  <span>{locale === 'ar' ? 'الأكثر مبيعاً:' : 'Top Product:'}</span>
                  <strong className="text-[#172033] truncate max-w-[170px]">
                    {stat.topProduct.name} ({stat.topProduct.units})
                  </strong>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* SECTION 1.3 & 1.4: TOP SELLERS & INVENTORY HEALTH                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Selling Products */}
        <div id="tour-best-sellers" className="bg-white rounded-2xl border border-[#E8ECF2] p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8ECF2]">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#16A36A]" />
              <h3 className="text-sm font-bold text-[#172033]">
                {locale === 'ar' ? 'المنتجات الأكثر مبيعاً (المسلمة بنجاح فقط)' : 'Top Selling Products'}
              </h3>
            </div>
            <button
              onClick={() => onNavigate('products')}
              className="text-xs text-[#2563EB] hover:underline font-semibold cursor-pointer"
            >
              {locale === 'ar' ? 'الكتالوج الكامل' : 'All Products'}
            </button>
          </div>

          <div className="divide-y divide-[#E8ECF2]">
            {topSellingProducts.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#64748B]">
                {locale === 'ar' ? 'لا توجد مبيعات مسلمة خلال الفترة المحددة.' : 'No delivered sales in period.'}
              </div>
            ) : (
              topSellingProducts.slice(0, 5).map((item, idx) => (
                <div
                  key={item.product.id}
                  onClick={() => onNavigate('products')}
                  className="py-2.5 flex items-center justify-between gap-3 hover:bg-[#F7F8FA] px-2 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xs font-bold text-[#64748B] w-4 text-center">
                      #{idx + 1}
                    </span>
                    <img
                      src={item.product.imageUrl}
                      alt={item.product.name}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-lg object-cover border border-[#E8ECF2] shrink-0"
                    />
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-[#172033] truncate max-w-xs">
                        {item.product.name}
                      </h4>
                      <div className="text-[10px] text-[#64748B]">
                        SKU: {item.product.sku} · {locale === 'ar' ? 'المتاح:' : 'Available:'}{' '}
                        <strong className="text-[#172033]">{item.availableStock}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="text-end shrink-0">
                    <span className="text-xs font-bold text-[#16A36A] font-mono-code block">
                      {item.deliveredUnits} {locale === 'ar' ? 'قطعة مباعة' : 'units sold'}
                    </span>
                    <span className="text-[10px] text-[#64748B] font-mono-code tabular-nums">
                      {item.deliveredRevenue.toLocaleString()} {settings.currency}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Inventory Health & Low-Stock Alerts */}
        <div id="tour-stock-recommendations" className="bg-white rounded-2xl border border-[#E8ECF2] p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8ECF2]">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-[#D99A27]" />
              <h3 className="text-sm font-bold text-[#172033]">
                {locale === 'ar' ? 'صحة وسلامة المخزون (تنبيهات النفاد)' : 'Inventory Health & Stockout Alerts'}
              </h3>
            </div>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-xs text-[#2563EB] hover:underline font-semibold cursor-pointer"
            >
              {locale === 'ar' ? 'سجل المخزون' : 'Inventory Ledger'}
            </button>
          </div>

          <div className="divide-y divide-[#E8ECF2]">
            {urgentInventoryItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#16A36A] flex flex-col items-center gap-1">
                <CheckCircle2 className="w-6 h-6" />
                <span>{locale === 'ar' ? 'جميع المنتجات بحالة مخزون ممتازة ومستقرة' : 'All inventory levels healthy'}</span>
              </div>
            ) : (
              urgentInventoryItems.slice(0, 5).map((item) => (
                <div
                  key={item.product.id}
                  onClick={() => onNavigate('inventory')}
                  className="py-2.5 flex items-center justify-between gap-3 hover:bg-[#F7F8FA] px-2 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={item.product.imageUrl}
                      alt={item.product.name}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-lg object-cover border border-[#E8ECF2] shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            item.status === 'out_of_stock'
                              ? 'bg-rose-100 text-rose-800'
                              : item.status === 'critical_low'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.status === 'out_of_stock'
                            ? locale === 'ar' ? 'نفد المخزون' : 'Out of Stock'
                            : item.status === 'critical_low'
                            ? locale === 'ar' ? 'نفاد وشيك' : 'Critical'
                            : locale === 'ar' ? 'مخزون منخفض' : 'Low Stock'}
                        </span>
                        <h4 className="text-xs font-semibold text-[#172033] truncate max-w-xs">
                          {item.product.name}
                        </h4>
                      </div>
                      <p className="text-[10px] text-[#64748B] mt-0.5 truncate">
                        {item.alertNote}
                      </p>
                    </div>
                  </div>

                  <div className="text-end shrink-0">
                    <span className="text-xs font-bold text-[#172033] font-mono-code block">
                      {item.availableStock} {locale === 'ar' ? 'متاح' : 'avail'}
                    </span>
                    {item.estimatedDaysRemaining !== null && (
                      <span className="text-[10px] text-amber-600 font-semibold block">
                        ~{item.estimatedDaysRemaining} {locale === 'ar' ? 'أيام متبقية' : 'days left'}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
