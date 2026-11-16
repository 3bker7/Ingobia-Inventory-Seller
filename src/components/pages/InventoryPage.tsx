import React, { useState } from 'react';
import {
  Boxes,
  CheckCircle,
  Clock,
  TrendingDown,
  TrendingUp,
  SlidersHorizontal,
  History,
  Search,
  Filter,
  ShieldAlert,
  ArrowRightLeft,
  X,
} from 'lucide-react';
import { Product, MovementType, MarketplaceId } from '../../types';
import { storageService } from '../../services/storage';
import { getTotalPlatformAvailableStock } from '../../domain/inventoryCustody';
import { translations, Locale } from '../../locales/translations';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';

interface InventoryPageProps {
  locale: Locale;
  onDataChange?: () => void;
}

export const InventoryPage: React.FC<InventoryPageProps> = ({ locale, onDataChange }) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();
  const isRtl = locale === 'ar';
  const activeMarketplaces = storageService.getActiveMarketplaces();
  const allMarketplaces = storageService.getAllMarketplaces();

  // State
  const [products, setProducts] = useState<Product[]>(() => storageService.getProducts());
  const [movements, setMovements] = useState(() => storageService.getMovements());
  const [searchQuery, setSearchQuery] = useState('');
  const [movementFilter, setMovementFilter] = useState<string>('all');
  const [showCustodyNotice, setShowCustodyNotice] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Manual adjust modal
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [newPhysicalStock, setNewPhysicalStock] = useState<number>(0);
  const [adjustmentReason, setAdjustmentReason] = useState('');

  // Platform Allocation modal
  const [allocatingProduct, setAllocatingProduct] = useState<Product | null>(null);
  const [allocDirection, setAllocDirection] = useState<'allocate' | 'release'>('allocate');
  const [allocMarketplaceId, setAllocMarketplaceId] = useState<MarketplaceId>(
    () => activeMarketplaces[0]?.id || ''
  );
  const [allocQuantity, setAllocQuantity] = useState<number>(1);

  const refreshData = () => {
    setProducts(storageService.getProducts());
    setMovements(storageService.getMovements());
    onDataChange?.();
  };

  // Metrics
  const totalPhysical = products.reduce((acc, p) => acc + p.physicalStock, 0);
  const totalCentralAvailable = products.reduce(
    (acc, p) => acc + (p.centralAvailableStock ?? p.availableStock),
    0
  );
  const totalPlatformAvailable = products.reduce(
    (acc, p) => acc + getTotalPlatformAvailableStock(p),
    0
  );
  const totalReserved = products.reduce((acc, p) => acc + p.reservedStock, 0);
  const totalAwaitingInspection = products.reduce((acc, p) => acc + (p.awaitingInspectionStock || 0), 0);
  const totalDamaged = products.reduce(
    (acc, p) => acc + (p.rejectedResaleStock ?? p.damagedStock ?? 0),
    0
  );
  const totalOutboundTransit = products.reduce((acc, p) => acc + (p.outboundInTransitStock || 0), 0);
  const totalReturnTransit = products.reduce((acc, p) => acc + (p.returnInTransitStock || 0), 0);

  // Filter products
  const filteredProducts = products.filter((p) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.nameAr && p.nameAr.toLowerCase().includes(q))
    );
  });

  // Filter movements
  const filteredMovements = movements.filter((m) => {
    if (movementFilter === 'all') return true;
    return m.type === movementFilter;
  });

  const handleOpenAdjust = (p: Product) => {
    setAdjustingProduct(p);
    setNewPhysicalStock(p.physicalStock);
    setAdjustmentReason('');
  };

  const handleOpenAllocation = (p: Product) => {
    setAllocatingProduct(p);
    setAllocDirection('allocate');
    const existingAllocatedChannels = Object.keys(p.platformAllocations || {});
    setAllocMarketplaceId(activeMarketplaces[0]?.id || existingAllocatedChannels[0] || '');
    setAllocQuantity(1);
  };

  const handleCommitAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct || isSubmitting) return;
    if (!adjustmentReason.trim()) {
      showToast(
        isRtl ? 'يرجى كتابة سبب التسوية الجردية.' : 'Adjustment reason is required.',
        'warning'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = storageService.manualStockAdjustmentWithResult(
        adjustingProduct.id,
        newPhysicalStock,
        adjustmentReason.trim(),
        settings.sellerName
      );

      if (res.success) {
        showToast(
          isRtl ? 'تمت تسوية المخزون وتسجيل حركة التدقيق بنجاح.' : 'Stock adjusted successfully.',
          'success'
        );
        setAdjustingProduct(null);
        refreshData();
      } else {
        showToast(
          res.error || (isRtl ? 'تعذر تنفيذ التسوية الجردية.' : 'Stock adjustment failed.'),
          'error'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCommitAllocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocatingProduct || isSubmitting) return;
    if (!allocMarketplaceId) {
      showToast(isRtl ? 'يرجى اختيار منصة البيع.' : 'Please select a marketplace.', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const res =
        allocDirection === 'allocate'
          ? storageService.allocateStockToPlatform(
              allocatingProduct.id,
              allocMarketplaceId,
              allocQuantity,
              settings.sellerName
            )
          : storageService.releasePlatformAllocation(
              allocatingProduct.id,
              allocMarketplaceId,
              allocQuantity,
              settings.sellerName
            );

      if (res.success) {
        showToast(
          allocDirection === 'allocate'
            ? isRtl
              ? 'تم تخصيص المخزون للمنصة دون المساس بالإجمالي الفعلي.'
              : 'Allocated stock to platform safely.'
            : isRtl
            ? 'تم استرجاع التخصيص غير المحجوز إلى المستودع المركزي.'
            : 'Released unreserved allocation back to central warehouse.',
          'success'
        );
        setAllocatingProduct(null);
        refreshData();
      } else {
        showToast(res.error || (isRtl ? 'تعذر تحديث التخصيص.' : 'Allocation update failed.'), 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getMovementBadge = (type: MovementType) => {
    const config: Record<MovementType, { label: string; style: string }> = {
      order_created: {
        label: t.inventory.movementTypes.order_created,
        style: 'bg-blue-50 text-[#2563EB] border-blue-200',
      },
      order_delivered: {
        label: t.inventory.movementTypes.order_delivered,
        style: 'bg-emerald-50 text-[#16A36A] border-emerald-200',
      },
      order_cancelled: {
        label: t.inventory.movementTypes.order_cancelled,
        style: 'bg-purple-50 text-purple-700 border-purple-200',
      },
      return_restocked: {
        label: t.inventory.movementTypes.return_restocked,
        style: 'bg-teal-50 text-teal-700 border-teal-200',
      },
      return_damaged: {
        label: t.inventory.movementTypes.return_damaged,
        style: 'bg-rose-50 text-[#DC5555] border-rose-200',
      },
      manual_adjustment: {
        label: t.inventory.movementTypes.manual_adjustment,
        style: 'bg-amber-50 text-[#D99A27] border-amber-200',
      },
      excel_import: {
        label: t.inventory.movementTypes.excel_import,
        style: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      },
      allocation_to_platform: {
        label: isRtl ? 'تخصيص لمنصة بيع' : 'Allocate to Platform',
        style: 'bg-blue-50 text-[#2563EB] border-blue-200',
      },
      allocation_returned_central: {
        label: isRtl ? 'استرجاع للمركز' : 'Return to Central',
        style: 'bg-slate-100 text-[#172033] border-slate-200',
      },
      handover_to_courier: {
        label: isRtl ? 'تسليم لشركة الشحن' : 'Handover to Courier',
        style: 'bg-sky-50 text-sky-700 border-sky-200',
      },
      return_initiated: {
        label: isRtl ? 'بدء إجراء المرتجع' : 'Return Initiated',
        style: 'bg-orange-50 text-orange-700 border-orange-200',
      },
      return_received_warehouse: {
        label: isRtl ? 'استلام بالمستودع' : 'Warehouse Received',
        style: 'bg-blue-50 text-blue-700 border-blue-200',
      },
      return_missing: {
        label: isRtl ? 'فقدان / طرد ناقص' : 'Item Missing',
        style: 'bg-rose-50 text-rose-700 border-rose-200',
      },
    };

    const c = config[type] || {
      label: type,
      style: 'bg-slate-100 text-[#64748B] border-slate-200',
    };

    return (
      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border whitespace-nowrap ${c.style}`}>
        {c.label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Strict 6-Custody Inventory Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Actual Warehouse Physical */}
        <div className="bg-white p-3.5 rounded-xl border border-[#E8ECF2] shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1.5">
            <span className="font-semibold">{locale === 'ar' ? 'إجمالي المستودع' : 'Warehouse Total'}</span>
            <Boxes className="w-4 h-4 text-[#172033]" />
          </div>
          <div className="text-xl font-bold text-[#172033] tabular-nums font-mono-code">
            {totalPhysical.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {locale === 'ar' ? 'الوحدات داخل المستودع' : 'Physical units inside'}
          </p>
        </div>

        {/* 2. Central Unallocated Available */}
        <div className="bg-white p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#16A36A] mb-1.5">
            <span className="font-semibold">{isRtl ? 'متاح مركزي (غير مخصص)' : 'Central Available'}</span>
            <CheckCircle className="w-4 h-4 text-[#16A36A]" />
          </div>
          <div className="text-xl font-bold text-[#16A36A] tabular-nums font-mono-code">
            {totalCentralAvailable.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {isRtl
              ? `+ ${totalPlatformAvailable.toLocaleString()} مخصص متاح بالمنصات`
              : `+ ${totalPlatformAvailable.toLocaleString()} platform allocated`}
          </p>
        </div>

        {/* 3. Reserved for orders */}
        <div className="bg-white p-3.5 rounded-xl border border-amber-200 bg-amber-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#D99A27] mb-1.5">
            <span className="font-semibold">{isRtl ? 'محجوز للطلبات' : 'Reserved (Locked)'}</span>
            <Clock className="w-4 h-4 text-[#D99A27]" />
          </div>
          <div className="text-xl font-bold text-[#D99A27] tabular-nums font-mono-code">
            {totalReserved.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {isRtl ? 'طلبات قيد التجهيز' : 'In open orders'}
          </p>
        </div>

        {/* 4. Awaiting inspection */}
        <div className="bg-white p-3.5 rounded-xl border border-blue-200 bg-blue-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#2563EB] mb-1.5">
            <span className="font-semibold">{isRtl ? 'بانتظار الفحص' : 'Awaiting Inspection'}</span>
            <Boxes className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="text-xl font-bold text-[#2563EB] tabular-nums font-mono-code">
            {totalAwaitingInspection.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {isRtl ? 'مستلمة بالمستودع ومعزولة' : 'Received, quarantined'}
          </p>
        </div>

        {/* 5. Damaged / Rejected From Resale Stock */}
        <div className="bg-white p-3.5 rounded-xl border border-rose-200 bg-rose-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#DC5555] mb-1.5">
            <span className="font-semibold">{isRtl ? 'تالف (مستبعد من البيع)' : 'Damaged (Excluded)'}</span>
            <ShieldAlert className="w-4 h-4 text-[#DC5555]" />
          </div>
          <div className="text-xl font-bold text-[#DC5555] tabular-nums font-mono-code">
            {totalDamaged.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {isRtl ? 'غير قابل لإعادة البيع' : 'Excluded from resale'}
          </p>
        </div>

        {/* 6. In Transit outside */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 bg-slate-50/40 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1.5">
            <span className="font-semibold">{isRtl ? 'ترانزيت خارجي' : 'In-Transit Outside'}</span>
            <Clock className="w-4 h-4 text-[#64748B]" />
          </div>
          <div className="text-xl font-bold text-[#172033] tabular-nums font-mono-code">
            {(totalOutboundTransit + totalReturnTransit).toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {isRtl
              ? `${totalOutboundTransit} تسليم / ${totalReturnTransit} عودة`
              : `${totalOutboundTransit} out / ${totalReturnTransit} ret`}
          </p>
        </div>
      </div>

      {/* Dismissible Custody Principle Banner */}
      {showCustodyNotice && (
        <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between gap-3 text-xs text-[#172033]">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-[#2563EB] shrink-0" />
            <div className="leading-relaxed">
              <strong>{isRtl ? 'مبدأ حيازة المستودع المركزي:' : 'Central Custody Rule:'}</strong>{' '}
              {isRtl
                ? 'تخصيص وحدات لمنصة يقتطع من الرصيد المركزي دون مضاعفة الإجمالي الفعلي. الوحدات التالفة أو قيد الفحص والترانزيت معزولة عن البيع.'
                : 'Allocating units to a platform moves capacity from Central Available without double-counting physical stock.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCustodyNotice(false)}
            className="p-1 text-[#64748B] hover:text-[#172033] rounded-md cursor-pointer shrink-0"
            aria-label="Close notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Master Inventory Separation Table */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-[#E8ECF2] flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-[#64748B] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.products.searchPlaceholder}
              className="w-full ps-9 pe-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>
          <span className="text-xs text-[#64748B] font-semibold">
            {filteredProducts.length} {t.overview.productsCount}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold">
                <th className="py-3 px-3 text-start">{t.products.sku}</th>
                <th className="py-3 px-3 text-start">{t.products.productColumn}</th>
                <th className="py-3 px-3 text-center text-[#16A36A]">{isRtl ? 'متاح مركزي' : 'Central Avail.'}</th>
                <th className="py-3 px-3 text-start text-[#2563EB]">{isRtl ? 'تخصيصات المنصات' : 'Platform Allocations'}</th>
                <th className="py-3 px-3 text-center text-[#D99A27]">{isRtl ? 'محجوز' : 'Reserved'}</th>
                <th className="py-3 px-3 text-center text-[#2563EB]">{isRtl ? 'بانتظار الفحص' : 'Awaiting Insp.'}</th>
                <th className="py-3 px-3 text-center text-[#DC5555]">{isRtl ? 'تالف' : 'Damaged'}</th>
                <th className="py-3 px-3 text-center text-slate-500">{isRtl ? 'ترانزيت' : 'Transit'}</th>
                <th className="py-3 px-3 text-center font-bold text-[#172033] bg-slate-50/60">{isRtl ? 'إجمالي المستودع' : 'Warehouse Total'}</th>
                <th className="py-3 px-3 text-center w-44">{t.products.actions}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredProducts.map((p) => {
                const allocEntries = Object.values(p.platformAllocations || {}).filter(
                  (a) => a && a.allocatedQty > 0
                );
                return (
                  <tr key={p.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                    <td className="py-2.5 px-3 font-mono-code font-bold text-[#172033]">
                      {p.sku}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[#172033] max-w-xs truncate">
                        {isRtl && p.nameAr ? p.nameAr : p.name}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#16A36A] tabular-nums font-mono-code bg-emerald-50/20">
                      {p.centralAvailableStock ?? p.availableStock}
                    </td>
                    <td className="py-2.5 px-3">
                      {allocEntries.length === 0 ? (
                        <span className="text-[11px] text-[#64748B]">
                          {isRtl ? 'يسحب من المركزي' : 'Central pool'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {allocEntries.map((a) => {
                            const mkt = allMarketplaces.find((m) => m.id === a.marketplaceId);
                            const isDisabled = mkt ? !mkt.isActive : true;
                            return (
                              <span
                                key={a.marketplaceId}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-code border"
                                style={{
                                  backgroundColor: isDisabled ? '#F1F5F9' : mkt?.badgeBg || '#F1F5F9',
                                  color: isDisabled ? '#475569' : mkt?.badgeText || '#475569',
                                  borderColor: '#E2E8F0',
                                }}
                              >
                                {mkt ? (isRtl ? mkt.nameAr : mkt.nameEn) : a.marketplaceId}:{' '}
                                <strong>{a.availableQty}</strong>/{a.allocatedQty}
                                {a.reservedQty > 0 ? ` (${a.reservedQty} ${isRtl ? 'محجوز' : 'res'})` : ''}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#D99A27] tabular-nums font-mono-code">
                      {p.reservedStock}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#2563EB] tabular-nums font-mono-code">
                      {p.awaitingInspectionStock || 0}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#DC5555] tabular-nums font-mono-code">
                      {p.rejectedResaleStock ?? p.damagedStock ?? 0}
                    </td>
                    <td className="py-2.5 px-3 text-center font-medium text-slate-600 tabular-nums font-mono-code">
                      {(p.outboundInTransitStock || 0) + (p.returnInTransitStock || 0)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#172033] tabular-nums font-mono-code bg-slate-50/60">
                      {p.physicalStock}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenAllocation(p)}
                          className="px-2 py-1 text-[11px] font-semibold text-[#172033] hover:bg-slate-100 border border-[#E8ECF2] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1"
                        >
                          <ArrowRightLeft className="w-3 h-3 text-[#2563EB]" />
                          <span>{isRtl ? 'تخصيص' : 'Allocate'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAdjust(p)}
                          className="px-2 py-1 text-[11px] font-semibold text-[#2563EB] hover:bg-blue-50 border border-blue-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {t.inventory.adjustStockBtn}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verified Stock Movements Audit Trail */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-xs overflow-hidden">
        <div className="p-4 border-b border-[#E8ECF2] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#2563EB]" />
            <h3 className="text-sm font-semibold text-[#172033]">
              {t.inventory.movementsLogTitle}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-[#64748B]" />
            <select
              value={movementFilter}
              onChange={(e) => setMovementFilter(e.target.value)}
              className="text-xs px-2.5 py-1 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none"
            >
              <option value="all">{isRtl ? 'جميع حركات المخزون' : 'All Movements'}</option>
              <option value="allocation_to_platform">{isRtl ? 'تخصيص لمنصة بيع' : 'Allocate to Platform'}</option>
              <option value="allocation_returned_central">{isRtl ? 'استرجاع للمركز' : 'Return to Central'}</option>
              <option value="order_created">{t.inventory.movementTypes.order_created}</option>
              <option value="handover_to_courier">{isRtl ? 'تسليم لشركة الشحن' : 'Handover to Courier'}</option>
              <option value="order_delivered">{t.inventory.movementTypes.order_delivered}</option>
              <option value="order_cancelled">{t.inventory.movementTypes.order_cancelled}</option>
              <option value="return_initiated">{isRtl ? 'بدء إجراء المرتجع' : 'Return Initiated'}</option>
              <option value="return_received_warehouse">{isRtl ? 'استلام بالمستودع' : 'Warehouse Received'}</option>
              <option value="return_restocked">{t.inventory.movementTypes.return_restocked}</option>
              <option value="return_damaged">{t.inventory.movementTypes.return_damaged}</option>
              <option value="return_missing">{isRtl ? 'فقدان / طرد ناقص' : 'Item Missing'}</option>
              <option value="manual_adjustment">{t.inventory.movementTypes.manual_adjustment}</option>
              <option value="excel_import">{t.inventory.movementTypes.excel_import}</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold">
                <th className="py-2.5 px-3 text-start">{t.inventory.timestamp}</th>
                <th className="py-2.5 px-3 text-start">{t.inventory.movementType}</th>
                <th className="py-2.5 px-3 text-start">{t.products.sku}</th>
                <th className="py-2.5 px-3 text-start">{isRtl ? 'المسار / المنصة' : 'Route / Platform'}</th>
                <th className="py-2.5 px-3 text-center">{t.inventory.qtyChange}</th>
                <th className="py-2.5 px-3 text-center">{isRtl ? 'المخزون بعد الحركة' : 'After'}</th>
                <th className="py-2.5 px-3 text-start">{t.inventory.reason}</th>
                <th className="py-2.5 px-3 text-start">{t.inventory.referenceOrder}</th>
                <th className="py-2.5 px-3 text-start">{t.inventory.operator}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredMovements.map((mov) => {
                const isPositive = mov.quantityChange > 0;
                const isZero = mov.quantityChange === 0;
                const mktId = mov.platformId || mov.marketplaceId;
                const mkt = mktId ? allMarketplaces.find((m) => m.id === mktId) : undefined;

                return (
                  <tr key={mov.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                    <td className="py-2.5 px-3 text-[#64748B] tabular-nums whitespace-nowrap">
                      {new Date(mov.timestamp).toLocaleDateString(
                        isRtl ? 'ar-SA' : 'en-US',
                        { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                      )}
                    </td>
                    <td className="py-2.5 px-3">{getMovementBadge(mov.type)}</td>
                    <td className="py-2.5 px-3 font-mono-code font-bold text-[#172033]">
                      {mov.productSku}
                    </td>
                    <td className="py-2.5 px-3 text-[11px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(mov.source || mov.destination) && (
                          <span className="font-mono-code text-[#64748B]">
                            {mov.source || '—'} → {mov.destination || '—'}
                          </span>
                        )}
                        {mktId && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold border"
                            style={{
                              backgroundColor: mkt && !mkt.isActive ? '#F1F5F9' : mkt?.badgeBg || '#F1F5F9',
                              color: mkt && !mkt.isActive ? '#475569' : mkt?.badgeText || '#475569',
                              borderColor: '#E2E8F0',
                            }}
                          >
                            {mkt ? (isRtl ? mkt.nameAr : mkt.nameEn) : mktId}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-flex items-center gap-0.5 font-bold tabular-nums ${
                          isPositive
                            ? 'text-[#16A36A]'
                            : isZero
                            ? 'text-[#64748B]'
                            : 'text-[#DC5555]'
                        }`}
                      >
                        {isPositive ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : isZero ? null : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {isPositive ? `+${mov.quantityChange}` : mov.quantityChange}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center tabular-nums text-[#64748B]">
                      <span className="text-[#172033] font-semibold">{mov.newPhysical}</span>{' '}
                      <span className="text-[10px]">({mov.newAvailable} {isRtl ? 'متاح' : 'avail'})</span>
                    </td>
                    <td className="py-2.5 px-3 text-[#172033] max-w-xs truncate">
                      {mov.reason}
                    </td>
                    <td className="py-2.5 px-3 font-mono-code text-[11px] text-[#2563EB]">
                      {mov.referenceOrderId || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-[#64748B] whitespace-nowrap">
                      {mov.operator}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Stock Adjustment Modal */}
      <Modal
        isOpen={adjustingProduct !== null}
        onClose={() => setAdjustingProduct(null)}
        title={t.inventory.adjustStockModalTitle}
        subtitle={adjustingProduct ? `${adjustingProduct.name} (SKU: ${adjustingProduct.sku})` : ''}
        maxWidth="sm"
      >
        {adjustingProduct && (
          <form onSubmit={handleCommitAdjust} className="space-y-4 text-xs">
            <div className="p-3 bg-[#F7F8FA] rounded-lg border border-[#E8ECF2] flex items-center justify-between">
              <div>
                <span className="text-[#64748B] block mb-0.5">{t.inventory.actualPhysical} (الحالي)</span>
                <span className="font-bold text-base text-[#172033] tabular-nums">
                  {adjustingProduct.physicalStock} {t.overview.units}
                </span>
              </div>
              <div>
                <span className="text-[#64748B] block mb-0.5">{t.inventory.available}</span>
                <span className="font-bold text-base text-[#16A36A] tabular-nums">
                  {adjustingProduct.availableStock} {t.overview.units}
                </span>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {locale === 'ar' ? 'الكمية الفعلية الجديدة بعد الجرد' : 'New Physical Count'} *
              </label>
              <input
                type="number"
                min="0"
                required
                value={newPhysicalStock}
                onChange={(e) => setNewPhysicalStock(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] font-bold text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {locale === 'ar' ? 'سبب التسوية وبيان الجرد' : 'Reason for Adjustment'} *
              </label>
              <textarea
                rows={3}
                required
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                placeholder="مثال: جرد دوري ربع سنوي، تسوية تلف بالمستودع، استلام شحنة جديدة..."
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                onClick={() => setAdjustingProduct(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t.actions.cancel}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t.actions.save}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Platform Allocation / Release Modal */}
      <Modal
        isOpen={allocatingProduct !== null}
        onClose={() => setAllocatingProduct(null)}
        title={isRtl ? 'تخصيص واسترجاع مخزون المنصات' : 'Platform Stock Allocation & Release'}
        subtitle={allocatingProduct ? `${allocatingProduct.name} (${allocatingProduct.sku})` : ''}
        maxWidth="sm"
      >
        {allocatingProduct && (
          <form onSubmit={handleCommitAllocation} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2 p-2.5 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2]">
              <div>
                <span className="text-[#64748B] block text-[10px]">
                  {isRtl ? 'متاح مركزي غير مخصص:' : 'Central Unallocated:'}
                </span>
                <strong className="text-sm font-mono-code text-[#16A36A] tabular-nums">
                  {allocatingProduct.centralAvailableStock ?? allocatingProduct.availableStock}
                </strong>
              </div>
              <div>
                <span className="text-[#64748B] block text-[10px]">
                  {isRtl ? 'مخصص متاح بالمنصة:' : 'Selected Platform Avail:'}
                </span>
                <strong className="text-sm font-mono-code text-[#2563EB] tabular-nums">
                  {allocatingProduct.platformAllocations?.[allocMarketplaceId]?.availableQty ?? 0}
                </strong>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAllocDirection('allocate')}
                className={`flex-1 py-2 px-3 rounded-lg border font-semibold cursor-pointer ${
                  allocDirection === 'allocate'
                    ? 'bg-blue-50 border-[#2563EB] text-[#2563EB]'
                    : 'bg-white border-[#E8ECF2] text-[#64748B]'
                }`}
              >
                {isRtl ? 'تخصيص من المركزي ← منصة' : 'Central → Platform'}
              </button>
              <button
                type="button"
                onClick={() => setAllocDirection('release')}
                className={`flex-1 py-2 px-3 rounded-lg border font-semibold cursor-pointer ${
                  allocDirection === 'release'
                    ? 'bg-slate-100 border-[#172033] text-[#172033]'
                    : 'bg-white border-[#E8ECF2] text-[#64748B]'
                }`}
              >
                {isRtl ? 'استرجاع للمركز ← من المنصة' : 'Platform → Central'}
              </button>
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {isRtl ? 'منصة البيع:' : 'Marketplace:'}
              </label>
              {activeMarketplaces.length === 0 && allocDirection === 'allocate' ? (
                <p className="text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                  {isRtl ? 'لا توجد منصات مفعّلة في الإعدادات لتخصيص المخزون لها.' : 'No active marketplaces enabled.'}
                </p>
              ) : (
                <select
                  value={allocMarketplaceId}
                  onChange={(e) => setAllocMarketplaceId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033]"
                >
                  {(allocDirection === 'allocate'
                    ? activeMarketplaces
                    : allMarketplaces.filter(
                        (m) => (allocatingProduct.platformAllocations?.[m.id]?.availableQty || 0) > 0
                      )
                  ).map((m) => (
                    <option key={m.id} value={m.id}>
                      {isRtl ? m.nameAr : m.nameEn}
                      {!m.isActive ? (isRtl ? ' [معطلة]' : ' [Disabled]') : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {isRtl ? 'الكمية:' : 'Quantity:'}
              </label>
              <input
                type="number"
                min="1"
                required
                value={allocQuantity}
                onChange={(e) => setAllocQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] font-bold font-mono-code tabular-nums"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                onClick={() => setAllocatingProduct(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t.actions.cancel}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || (allocDirection === 'allocate' && activeMarketplaces.length === 0)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t.actions.save}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
