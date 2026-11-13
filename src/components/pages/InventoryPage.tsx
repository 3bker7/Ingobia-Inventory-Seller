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
} from 'lucide-react';
import { Product, MovementType } from '../../types';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';

interface InventoryPageProps {
  locale: Locale;
}

export const InventoryPage: React.FC<InventoryPageProps> = ({ locale }) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();

  // State
  const [products, setProducts] = useState<Product[]>(() => storageService.getProducts());
  const [movements, setMovements] = useState(() => storageService.getMovements());
  const [searchQuery, setSearchQuery] = useState('');
  const [movementFilter, setMovementFilter] = useState<string>('all');

  // Manual adjust modal
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [newPhysicalStock, setNewPhysicalStock] = useState<number>(0);
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const refreshData = () => {
    setProducts(storageService.getProducts());
    setMovements(storageService.getMovements());
  };

  // Metrics
  const totalPhysical = products.reduce((acc, p) => acc + p.physicalStock, 0);
  const totalAvailable = products.reduce((acc, p) => acc + p.availableStock, 0);
  const totalReserved = products.reduce((acc, p) => acc + p.reservedStock, 0);
  const totalAwaitingInspection = products.reduce((acc, p) => acc + (p.awaitingInspectionStock || 0), 0);
  const totalDamaged = products.reduce((acc, p) => acc + (p.damagedStock || 0), 0);
  const totalOutboundTransit = products.reduce((acc, p) => acc + (p.outboundInTransitStock || 0), 0);
  const totalReturnTransit = products.reduce((acc, p) => acc + (p.returnInTransitStock || 0), 0);
  const totalChannelsListed = products.reduce((acc, p) => {
    return (
      acc +
      Object.values(p.marketplaceListings).reduce((mAcc, l) => mAcc + l.quantity, 0)
    );
  }, 0);

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

  const handleCommitAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct) return;
    if (!adjustmentReason.trim()) {
      showToast(
        locale === 'ar' ? 'يرجى كتابة سبب التسوية الجردية.' : 'Adjustment reason is required.',
        'warning'
      );
      return;
    }

    const success = storageService.manualStockAdjustment(
      adjustingProduct.id,
      newPhysicalStock,
      adjustmentReason.trim(),
      settings.sellerName
    );

    if (success) {
      showToast(
        locale === 'ar' ? 'تمت تسوية المخزون وتسجيل حركة التدقيق بنجاح.' : 'Stock adjusted successfully.',
        'success'
      );
      setAdjustingProduct(null);
      refreshData();
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
      handover_to_courier: {
        label: locale === 'ar' ? 'تسليم لشركة الشحن' : 'Handover to Courier',
        style: 'bg-sky-50 text-sky-700 border-sky-200',
      },
      return_initiated: {
        label: locale === 'ar' ? 'بدء إجراء المرتجع' : 'Return Initiated',
        style: 'bg-orange-50 text-orange-700 border-orange-200',
      },
      return_received_warehouse: {
        label: locale === 'ar' ? 'استلام بالمستودع' : 'Warehouse Received',
        style: 'bg-blue-50 text-blue-700 border-blue-200',
      },
      return_missing: {
        label: locale === 'ar' ? 'فقدان / طرد ناقص' : 'Item Missing',
        style: 'bg-rose-50 text-rose-700 border-rose-200',
      },
    };

    const c = config[type] || {
      label: type,
      style: 'bg-slate-100 text-[#64748B] border-slate-200',
    };

    return (
      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${c.style}`}>
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

        {/* 2. Sellable Available */}
        <div className="bg-white p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#16A36A] mb-1.5">
            <span className="font-semibold">{locale === 'ar' ? 'متاح للبيع' : 'Available (Sellable)'}</span>
            <CheckCircle className="w-4 h-4 text-[#16A36A]" />
          </div>
          <div className="text-xl font-bold text-[#16A36A] tabular-nums font-mono-code">
            {totalAvailable.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {locale === 'ar' ? 'جاهز للتخصيص والطلب' : 'Ready to fulfill'}
          </p>
        </div>

        {/* 3. Reserved for orders */}
        <div className="bg-white p-3.5 rounded-xl border border-amber-200 bg-amber-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#D99A27] mb-1.5">
            <span className="font-semibold">{locale === 'ar' ? 'محجوز للطلبات' : 'Reserved (Locked)'}</span>
            <Clock className="w-4 h-4 text-[#D99A27]" />
          </div>
          <div className="text-xl font-bold text-[#D99A27] tabular-nums font-mono-code">
            {totalReserved.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {locale === 'ar' ? 'طلبات قيد التجهيز' : 'In open orders'}
          </p>
        </div>

        {/* 4. Awaiting inspection */}
        <div className="bg-white p-3.5 rounded-xl border border-blue-200 bg-blue-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#2563EB] mb-1.5">
            <span className="font-semibold">{locale === 'ar' ? 'بانتظار الفحص' : 'Awaiting Inspection'}</span>
            <Boxes className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="text-xl font-bold text-[#2563EB] tabular-nums font-mono-code">
            {totalAwaitingInspection.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {locale === 'ar' ? 'مستلمة بالمستودع وغير متاحة' : 'Received, quarantined'}
          </p>
        </div>

        {/* 5. Damaged Stock */}
        <div className="bg-white p-3.5 rounded-xl border border-rose-200 bg-rose-50/20 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#DC5555] mb-1.5">
            <span className="font-semibold">{locale === 'ar' ? 'تالف / معدوم' : 'Damaged / Writeoff'}</span>
            <ShieldAlert className="w-4 h-4 text-[#DC5555]" />
          </div>
          <div className="text-xl font-bold text-[#DC5555] tabular-nums font-mono-code">
            {totalDamaged.toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {locale === 'ar' ? 'غير صالح للبيع نهائياً' : 'Non-sellable loss'}
          </p>
        </div>

        {/* 6. In Transit outside */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 bg-slate-50/40 shadow-xs">
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1.5">
            <span className="font-semibold">{locale === 'ar' ? 'ترانزيت خارجي' : 'In-Transit Outside'}</span>
            <Clock className="w-4 h-4 text-[#64748B]" />
          </div>
          <div className="text-xl font-bold text-[#172033] tabular-nums font-mono-code">
            {(totalOutboundTransit + totalReturnTransit).toLocaleString()}
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {locale === 'ar'
              ? `${totalOutboundTransit} تسليم / ${totalReturnTransit} عودة`
              : `${totalOutboundTransit} out / ${totalReturnTransit} ret`}
          </p>
        </div>
      </div>

      {/* Strict Business Rule Banner */}
      <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl flex items-center gap-3 text-xs text-[#172033]">
        <ShieldAlert className="w-5 h-5 text-[#2563EB] shrink-0" />
        <div className="leading-relaxed">
          <strong>{locale === 'ar' ? 'قاعدة النزاهة الرقابية للمخزون:' : 'Stock Custody Principle:'}</strong>{' '}
          {locale === 'ar'
            ? 'المستودع الفيزيائي = (المتاح + المحجوز + بانتظار الفحص + التالف). شحنات الترانزيت الخارجي لدى شركة الشحن لا تحتسب في المستودع ولا تدخل إطلاقاً في المخزون المتاح للبيع.'
            : 'Warehouse Physical = (Available + Reserved + Awaiting Inspection + Damaged). Outbound & return transit shipments remain strictly quarantined outside warehouse inventory.'}
        </div>
      </div>

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
                <th className="py-3 px-3 text-center text-[#16A36A]">{locale === 'ar' ? 'متاح للبيع' : 'Available'}</th>
                <th className="py-3 px-3 text-center text-[#D99A27]">{locale === 'ar' ? 'محجوز' : 'Reserved'}</th>
                <th className="py-3 px-3 text-center text-[#2563EB]">{locale === 'ar' ? 'بانتظار الفحص' : 'Awaiting Insp.'}</th>
                <th className="py-3 px-3 text-center text-[#DC5555]">{locale === 'ar' ? 'تالف' : 'Damaged'}</th>
                <th className="py-3 px-3 text-center text-slate-500">{locale === 'ar' ? 'ترانزيت توصيل' : 'Outbound Tr.'}</th>
                <th className="py-3 px-3 text-center text-amber-700">{locale === 'ar' ? 'ترانزيت إرجاع' : 'Return Tr.'}</th>
                <th className="py-3 px-3 text-center font-bold text-[#172033] bg-slate-50/60">{locale === 'ar' ? 'إجمالي المستودع' : 'Warehouse Total'}</th>
                <th className="py-3 px-3 text-center w-28">{t.products.actions}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredProducts.map((p) => (
                <tr key={p.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                  <td className="py-2.5 px-3 font-mono-code font-bold text-[#172033]">
                    {p.sku}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-[#172033] max-w-xs truncate">
                      {locale === 'ar' && p.nameAr ? p.nameAr : p.name}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-[#16A36A] tabular-nums font-mono-code bg-emerald-50/20">
                    {p.availableStock}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-[#D99A27] tabular-nums font-mono-code">
                    {p.reservedStock}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-[#2563EB] tabular-nums font-mono-code">
                    {p.awaitingInspectionStock || 0}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-[#DC5555] tabular-nums font-mono-code">
                    {p.damagedStock || 0}
                  </td>
                  <td className="py-2.5 px-3 text-center font-medium text-slate-600 tabular-nums font-mono-code">
                    {p.outboundInTransitStock || 0}
                  </td>
                  <td className="py-2.5 px-3 text-center font-medium text-amber-700 tabular-nums font-mono-code">
                    {p.returnInTransitStock || 0}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-[#172033] tabular-nums font-mono-code bg-slate-50/60">
                    {p.physicalStock}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      onClick={() => handleOpenAdjust(p)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-[#2563EB] hover:bg-blue-50 border border-blue-200 rounded-md transition-colors cursor-pointer"
                    >
                      {t.inventory.adjustStockBtn}
                    </button>
                  </td>
                </tr>
              ))}
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
              <option value="all">{locale === 'ar' ? 'جميع حركات المخزون' : 'All Movements'}</option>
              <option value="order_created">{t.inventory.movementTypes.order_created}</option>
              <option value="order_delivered">{t.inventory.movementTypes.order_delivered}</option>
              <option value="order_cancelled">{t.inventory.movementTypes.order_cancelled}</option>
              <option value="return_restocked">{t.inventory.movementTypes.return_restocked}</option>
              <option value="return_damaged">{t.inventory.movementTypes.return_damaged}</option>
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
                <th className="py-2.5 px-3 text-center">{t.inventory.qtyChange}</th>
                <th className="py-2.5 px-3 text-center">{locale === 'ar' ? 'المخزون بعد الحركة' : 'After'}</th>
                <th className="py-2.5 px-3 text-start">{t.inventory.reason}</th>
                <th className="py-2.5 px-3 text-start">{t.inventory.referenceOrder}</th>
                <th className="py-2.5 px-3 text-start">{t.inventory.operator}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredMovements.map((mov) => {
                const isPositive = mov.quantityChange > 0;
                const isZero = mov.quantityChange === 0;

                return (
                  <tr key={mov.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                    <td className="py-2.5 px-3 text-[#64748B] tabular-nums whitespace-nowrap">
                      {new Date(mov.timestamp).toLocaleDateString(
                        locale === 'ar' ? 'ar-SA' : 'en-US',
                        { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                      )}
                    </td>
                    <td className="py-2.5 px-3">{getMovementBadge(mov.type)}</td>
                    <td className="py-2.5 px-3 font-mono-code font-bold text-[#172033]">
                      {mov.productSku}
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
                      <span className="text-[10px]">({mov.newAvailable} {locale === 'ar' ? 'متاح' : 'avail'})</span>
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
                className="px-3.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors"
              >
                {t.actions.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
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
