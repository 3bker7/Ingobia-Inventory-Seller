import React, { useState } from 'react';
import {
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Truck,
  Eye,
  Check,
  Search,
  Package,
  Calendar,
  HelpCircle,
  Clock,
  ArrowRight,
  ShieldAlert,
  FileText,
  DollarSign,
  ChevronDown,
} from 'lucide-react';
import { ReturnRecord, ReturnStatus, InspectionOutcome, ShipmentRecord } from '../../types';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';

interface ReturnsPageProps {
  locale: Locale;
  initialStatusFilter?: string;
  onReturnsChange?: () => void;
}

export const ReturnsPage: React.FC<ReturnsPageProps> = ({
  locale,
  initialStatusFilter,
  onReturnsChange,
}) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();

  const [returns, setReturns] = useState<ReturnRecord[]>(() => storageService.getReturns());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || 'all');

  React.useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  // Inspection modal state
  const [inspectingReturn, setInspectingReturn] = useState<ReturnRecord | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<InspectionOutcome>('restockable');
  const [condition, setCondition] = useState<'like_new' | 'opened_good' | 'damaged' | 'lost'>('like_new');
  const [inspectionNotes, setInspectionNotes] = useState('');

  // Warehouse Receipt confirmation modal
  const [receiptConfirmReturn, setReceiptConfirmReturn] = useState<ReturnRecord | null>(null);
  const [receiptNotes, setReceiptNotes] = useState('');

  // Return activities & details modal
  const [detailReturn, setDetailReturn] = useState<ReturnRecord | null>(null);
  const [newNoteInput, setNewNoteInput] = useState('');

  const refreshReturns = () => {
    setReturns(storageService.getReturns());
    onReturnsChange?.();
  };

  const isRtl = locale === 'ar';

  const filteredReturns = returns.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      r.id.toLowerCase().includes(q) ||
      r.orderId.toLowerCase().includes(q) ||
      (r.courierName && r.courierName.toLowerCase().includes(q)) ||
      (r.trackingNumber && r.trackingNumber.toLowerCase().includes(q)) ||
      r.items.some(
        (item) => item.productSku.toLowerCase().includes(q) || item.productName.toLowerCase().includes(q)
      );

    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'in_transit_back') return r.returnStatus === 'in_transit_back' || r.returnStatus === 'pickup_pending' || r.returnStatus === 'return_initiated';
    if (statusFilter === 'received_at_warehouse') return r.returnStatus === 'received_at_warehouse';
    if (statusFilter === 'under_inspection') return r.returnStatus === 'under_inspection';
    if (statusFilter === 'restocked') return r.returnStatus === 'restocked' || r.inspectionOutcome === 'restockable';
    if (statusFilter === 'damaged') return r.returnStatus === 'damaged' || r.inspectionOutcome === 'damaged';

    return r.returnStatus === statusFilter;
  });

  // Calculate counts for tabs
  const tabCounts = {
    all: returns.length,
    in_transit: returns.filter((r) => !r.isCompleted && (r.returnStatus === 'in_transit_back' || r.returnStatus === 'pickup_pending' || r.returnStatus === 'return_initiated')).length,
    received: returns.filter((r) => !r.isCompleted && r.returnStatus === 'received_at_warehouse').length,
    under_inspection: returns.filter((r) => !r.isCompleted && r.returnStatus === 'under_inspection').length,
    restocked: returns.filter((r) => r.isCompleted && (r.inspectionOutcome === 'restockable' || r.returnStatus === 'restocked')).length,
    damaged: returns.filter((r) => r.isCompleted && (r.inspectionOutcome === 'damaged' || r.returnStatus === 'damaged')).length,
  };

  const handleOpenInspect = (ret: ReturnRecord) => {
    setInspectingReturn(ret);
    setSelectedOutcome(ret.inspectionOutcome || 'restockable');
    setCondition(ret.physicalCondition || 'like_new');
    setInspectionNotes(ret.notes || '');
  };

  const handleCommitInspection = () => {
    if (!inspectingReturn) return;

    const res = storageService.processReturnInspection(
      inspectingReturn.id,
      selectedOutcome,
      condition,
      inspectionNotes.trim(),
      settings.sellerName
    );

    if (res.success) {
      showToast(res.message, 'success');
      setInspectingReturn(null);
      refreshReturns();
    } else {
      showToast(res.message, 'error');
    }
  };

  const handleConfirmWarehouseReceipt = () => {
    if (!receiptConfirmReturn) return;

    const res = storageService.advanceReturnStatus(
      receiptConfirmReturn.id,
      'received_at_warehouse',
      settings.sellerName,
      receiptNotes.trim() || (isRtl ? 'تم الاستلام الفعلي بالمستودع ونقل الحيازة لبانتظار الفحص' : 'Physically received at warehouse')
    );

    if (res.success) {
      showToast(
        isRtl
          ? 'تم تأكيد استلام الطرد بالمستودع. الوحدات أصبحت في حالة (بانتظار الفحص) ولن تُضاف للمخزون المتاح إلا بعد اعتماد الفحص.'
          : 'Return marked received at warehouse. Held in awaiting inspection.',
        'success'
      );
      setReceiptConfirmReturn(null);
      setReceiptNotes('');
      refreshReturns();
    } else {
      showToast(res.error || 'فشل تحديث الحالة', 'error');
    }
  };

  const handleStartInspection = (ret: ReturnRecord) => {
    const res = storageService.advanceReturnStatus(
      ret.id,
      'under_inspection',
      settings.sellerName,
      isRtl ? 'بدء الفحص الفني وتقييم حالة المنتج' : 'Started technical inspection'
    );
    if (res.success) {
      showToast(isRtl ? 'تم تحويل المرتجع لحالة (قيد الفحص الفني).' : 'Moved to Under Inspection.', 'success');
      refreshReturns();
    } else {
      showToast(res.error || (isRtl ? 'تعذر بدء الفحص الفني.' : 'Failed to start inspection'), 'error');
    }
  };

  const handleAddManualNote = () => {
    if (!detailReturn || !newNoteInput.trim()) return;

    const res = storageService.addReturnNote(
      detailReturn.id,
      newNoteInput.trim(),
      settings.sellerName
    );
    if (res.success && res.returnRecord) {
      setDetailReturn({ ...res.returnRecord });
      setNewNoteInput('');
      refreshReturns();
      showToast(isRtl ? 'تمت إضافة الملاحظة بنجاح.' : 'Note added.', 'success');
    } else {
      showToast(res.error || (isRtl ? 'تعذر حفظ الملاحظة.' : 'Failed to save note.'), 'error');
    }
  };

  const getReturnStatusBadge = (status: ReturnStatus, outcome?: InspectionOutcome) => {
    if (outcome === 'restockable' || status === 'restocked') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-[#16A36A] border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{isRtl ? 'معتمد بالمخزون المتاح' : 'Restocked & Available'}</span>
        </span>
      );
    }

    if (outcome === 'damaged' || status === 'damaged') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-[#DC5555] border border-rose-200">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{isRtl ? 'تالف ومستبعد (خسارة)' : 'Damaged / Unsellable'}</span>
        </span>
      );
    }

    if (outcome === 'missing') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-[#64748B] border border-slate-300">
          <HelpCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{isRtl ? 'طرد مفقود من الشحن' : 'Missing from Courier'}</span>
        </span>
      );
    }

    if (status === 'received_at_warehouse') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-[#D99A27] border border-amber-300">
          <Package className="w-3.5 h-3.5 shrink-0" />
          <span>{isRtl ? 'مستلم بالمستودع (بانتظار الفحص)' : 'Received at Warehouse'}</span>
        </span>
      );
    }

    if (status === 'under_inspection') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          <span>{isRtl ? 'قيد الفحص الفني' : 'Under Technical Inspection'}</span>
        </span>
      );
    }

    // Default / in transit
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-[#2563EB] border border-blue-200">
        <Truck className="w-3.5 h-3.5 shrink-0" />
        <span>{isRtl ? 'في مسار العودة (مع الشحن)' : 'In Transit Back'}</span>
      </span>
    );
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* 1. Core Custody & Rules Notice */}
      <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#2563EB] text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="space-y-0.5">
            <h4 className="font-bold text-[#172033]">
              {isRtl ? 'نظام حيازة المرتجعات ودورة الفحص الفني (7 مراحل)' : '7-Stage Returns Custody Management System'}
            </h4>
            <p className="text-[#64748B] leading-relaxed">
              {isRtl
                ? 'قاعدة أمان صارمة: المرتجع في الطريق أو المستلم بانتظار الفحص لا يُضاف أبداً للمخزون المتاح للبيع حتى يتم فحصه واعتماده صراحة.'
                : 'Strict rule: In-transit and uninspected returns are strictly excluded from available inventory until explicit approval.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <span className="px-3 py-1 rounded-lg bg-white border border-blue-200 text-[#2563EB] font-bold font-mono-code text-xs">
            {tabCounts.in_transit + tabCounts.received + tabCounts.under_inspection} {isRtl ? 'نشط خارج المتاح' : 'active outside available'}
          </span>
        </div>
      </div>

      {/* 2. Operational Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-[#E8ECF2]">
        <button
          onClick={() => setStatusFilter('all')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer ${
            statusFilter === 'all'
              ? 'bg-white text-[#2563EB] border-t-2 border-x border-[#E8ECF2] border-t-[#2563EB] shadow-2xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/50'
          }`}
        >
          <span>{isRtl ? 'جميع المرتجعات' : 'All Returns'}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-[#64748B] font-mono-code font-bold">
            {tabCounts.all}
          </span>
        </button>

        <button
          onClick={() => setStatusFilter('in_transit_back')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer ${
            statusFilter === 'in_transit_back'
              ? 'bg-white text-[#2563EB] border-t-2 border-x border-[#E8ECF2] border-t-[#2563EB] shadow-2xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/50'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>{isRtl ? 'في طريق العودة' : 'In Transit Back'}</span>
          {tabCounts.in_transit > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-[#2563EB] font-mono-code font-bold">
              {tabCounts.in_transit}
            </span>
          )}
        </button>

        <button
          onClick={() => setStatusFilter('received_at_warehouse')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer ${
            statusFilter === 'received_at_warehouse'
              ? 'bg-white text-[#D99A27] border-t-2 border-x border-[#E8ECF2] border-t-[#D99A27] shadow-2xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/50'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span>{isRtl ? 'مستلم بالمستودع' : 'Received at Warehouse'}</span>
          {tabCounts.received > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-[#D99A27] font-mono-code font-bold">
              {tabCounts.received}
            </span>
          )}
        </button>

        <button
          onClick={() => setStatusFilter('under_inspection')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer ${
            statusFilter === 'under_inspection'
              ? 'bg-white text-purple-700 border-t-2 border-x border-[#E8ECF2] border-t-purple-600 shadow-2xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/50'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{isRtl ? 'قيد الفحص الفني' : 'Under Inspection'}</span>
          {tabCounts.under_inspection > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 text-purple-700 font-mono-code font-bold">
              {tabCounts.under_inspection}
            </span>
          )}
        </button>

        <button
          onClick={() => setStatusFilter('restocked')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer ${
            statusFilter === 'restocked'
              ? 'bg-white text-[#16A36A] border-t-2 border-x border-[#E8ECF2] border-t-[#16A36A] shadow-2xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/50'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{isRtl ? 'معتمد بالمخزون' : 'Restocked & Closed'}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-[#16A36A] font-mono-code font-bold">
            {tabCounts.restocked}
          </span>
        </button>

        <button
          onClick={() => setStatusFilter('damaged')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer ${
            statusFilter === 'damaged'
              ? 'bg-white text-[#DC5555] border-t-2 border-x border-[#E8ECF2] border-t-[#DC5555] shadow-2xs'
              : 'text-[#64748B] hover:text-[#172033] hover:bg-slate-100/50'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{isRtl ? 'تالف ومستبعد' : 'Damaged / Unsellable'}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-100 text-[#DC5555] font-mono-code font-bold">
            {tabCounts.damaged}
          </span>
        </button>
      </div>

      {/* 3. Toolbar: Search and summary */}
      <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search className="w-4 h-4 text-[#64748B] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isRtl
                ? 'بحث برقم الطلب، رقم المرتجع، SKU، أو شركة التوصيل...'
                : 'Search by Order ID, Return ID, SKU, Courier...'
            }
            className="w-full ps-9 pe-3 py-2 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
          />
        </div>

        <span className="text-xs text-[#64748B] font-semibold">
          {filteredReturns.length} {isRtl ? 'حالة مرتجع مطابقة' : 'returns matching'}
        </span>
      </div>

      {/* 4. Returns List Table */}
      <div className="bg-white rounded-2xl border border-[#E8ECF2] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold select-none">
                <th className="py-3.5 px-4 text-start">{t.returns.orderId}</th>
                <th className="py-3.5 px-3 text-start">{t.returns.marketplace}</th>
                <th className="py-3.5 px-3 text-start">{t.returns.product}</th>
                <th className="py-3.5 px-3 text-start">{isRtl ? 'شركة التوصيل والتتبع' : 'Courier & Tracking'}</th>
                <th className="py-3.5 px-3 text-start">{t.returns.reason}</th>
                <th className="py-3.5 px-3 text-center">{isRtl ? 'مرحلة الحيازة الفعالة' : 'Custody Stage'}</th>
                <th className="py-3.5 px-4 text-center w-52">{t.orders.actions}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-[#64748B]">
                    <RotateCcw className="w-10 h-10 mx-auto text-[#64748B]/40 mb-3" />
                    <p className="text-sm font-semibold text-[#172033]">{t.returns.noReturns}</p>
                    <p className="text-xs text-[#64748B] mt-1">
                      {isRtl ? 'لا توجد شحنات مرتجعة في هذا القسم حالياً.' : 'No return shipments found in this category.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredReturns.map((ret) => {
                  const firstItem = ret.items[0];
                  const mkt = settings.marketplaces.find((m) => m.id === ret.marketplaceId);
                  const isClosed = ret.isCompleted === true || ret.returnStatus === 'closed';

                  return (
                    <tr key={ret.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                      {/* Order and Return ID */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono-code font-bold text-[#172033]">
                          {ret.orderId}
                        </div>
                        <div className="text-[10px] text-[#64748B] font-mono-code flex items-center gap-1.5 mt-0.5">
                          <span>{ret.id}</span>
                          {ret.isPostDeliveryReturn && (
                            <span className="px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 font-sans font-semibold text-[9px] border border-purple-200">
                              {isRtl ? 'مرتجع لاحق' : 'Post-Delivery'}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Marketplace badge */}
                      <td className="py-3.5 px-3">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold border inline-block"
                          style={{
                            backgroundColor: mkt?.badgeBg || '#FEF9C3',
                            color: mkt?.badgeText || '#854D0E',
                            borderColor: '#E8ECF2',
                          }}
                        >
                          {isRtl ? mkt?.nameAr || ret.marketplaceId : mkt?.nameEn || ret.marketplaceId}
                        </span>
                      </td>

                      {/* Product snapshot */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2.5">
                          {firstItem && (
                            <img
                              src={firstItem.imageUrl}
                              alt={firstItem.productName}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-lg object-cover border border-[#E8ECF2] shrink-0"
                            />
                          )}
                          <div className="min-w-0 max-w-[200px]">
                            <div className="font-semibold text-[#172033] truncate" title={firstItem?.productName}>
                              {firstItem?.productName}
                            </div>
                            <div className="text-[10px] text-[#64748B] font-mono-code">
                              SKU: {firstItem?.productSku} · ×{firstItem?.quantity}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Courier & Tracking */}
                      <td className="py-3.5 px-3">
                        <div className="text-[11px] font-medium text-[#172033]">
                          {ret.courierName || 'شركة الشحن'}
                        </div>
                        <div className="text-[10px] font-mono-code text-[#64748B]">
                          {ret.trackingNumber || 'TRK-NOT-PROVIDED'}
                        </div>
                        {ret.returnShippingCost ? (
                          <div className="text-[10px] text-amber-800 font-medium mt-0.5">
                            {ret.returnShippingCost} {settings.currency} ({isRtl ? 'رسوم المرتجع' : 'return fee'})
                          </div>
                        ) : null}
                      </td>

                      {/* Reason & Notes */}
                      <td className="py-3.5 px-3 max-w-[220px]">
                        <p className="text-[11px] text-[#172033] truncate font-medium" title={ret.returnReason}>
                          {ret.returnReason}
                        </p>
                        {ret.notes && (
                          <span className="text-[10px] text-[#64748B] truncate block mt-0.5" title={ret.notes}>
                            {ret.notes}
                          </span>
                        )}
                      </td>

                      {/* Custody Stage Badge */}
                      <td className="py-3.5 px-3 text-center">
                        {getReturnStatusBadge(ret.returnStatus, ret.inspectionOutcome)}
                      </td>

                      {/* Operational Actions */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {/* Case 1: In Transit -> Confirm Warehouse Receipt */}
                          {(ret.returnStatus === 'in_transit_back' ||
                            ret.returnStatus === 'pickup_pending' ||
                            ret.returnStatus === 'return_initiated') && (
                            <button
                              onClick={() => setReceiptConfirmReturn(ret)}
                              className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center gap-1"
                            >
                              <Package className="w-3 h-3" />
                              <span>{isRtl ? 'تأكيد الاستلام بالمستودع' : 'Confirm Warehouse Receipt'}</span>
                            </button>
                          )}

                          {/* Case 2: Received at Warehouse -> Start Inspection */}
                          {ret.returnStatus === 'received_at_warehouse' && (
                            <button
                              onClick={() => handleStartInspection(ret)}
                              className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>{isRtl ? 'بدء الفحص الفني' : 'Start Inspection'}</span>
                            </button>
                          )}

                          {/* Case 3: Under Inspection -> Decide outcome */}
                          {ret.returnStatus === 'under_inspection' && (
                            <button
                              onClick={() => handleOpenInspect(ret)}
                              className="px-3 py-1.5 text-[11px] font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{isRtl ? 'قرار الفحص النهائي' : 'Inspection Decision'}</span>
                            </button>
                          )}

                          {/* Case 4: Closed / Historical -> View Details & Auditable Timeline */}
                          {isClosed && (
                            <button
                              onClick={() => setDetailReturn(ret)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#64748B] hover:text-[#172033] bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                            >
                              {isRtl ? 'سجل الإجراءات' : 'Activity Log'}
                            </button>
                          )}

                          {/* Quick details button for active */}
                          {!isClosed && (
                            <button
                              onClick={() => setDetailReturn(ret)}
                              className="p-1.5 text-[#64748B] hover:text-[#172033] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                              title={isRtl ? 'عرض تفاصيل الشحنة والملاحظات' : 'View details'}
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Warehouse Physical Receipt Confirmation Modal */}
      <Modal
        isOpen={receiptConfirmReturn !== null}
        onClose={() => setReceiptConfirmReturn(null)}
        title={isRtl ? 'تأكيد الاستلام الفعلي بالمستودع' : 'Confirm Warehouse Receipt'}
        subtitle={receiptConfirmReturn ? `الطلب #${receiptConfirmReturn.orderId} (المرتجع ${receiptConfirmReturn.id})` : ''}
        maxWidth="md"
      >
        {receiptConfirmReturn && (
          <div className="space-y-4 text-xs">
            {/* Real Impact explanation */}
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <AlertTriangle className="w-4 h-4 text-[#D99A27] shrink-0" />
                <span>{isRtl ? 'الآثار المترتبة على تأكيد استلام الطرد:' : 'Custody & Inventory Impact:'}</span>
              </div>
              <ul className="space-y-1.5 text-[#172033] ps-6 list-disc leading-relaxed">
                <li>
                  {isRtl
                    ? `نقل (${receiptConfirmReturn.items.reduce((s, i) => s + i.quantity, 0)}) قطعة من "مرتجع في طريق العودة" إلى "بانتظار الفحص بالمستودع".`
                    : `Moves ${receiptConfirmReturn.items.reduce((s, i) => s + i.quantity, 0)} units from Return-In-Transit to Awaiting-Inspection.`}
                </li>
                <li>
                  <strong className="text-amber-900">
                    {isRtl
                      ? 'المخزون المتاح للبيع: لا يتغير إطلاقاً (يبقى محجوباً لحين الفحص واعتماده كصالح).'
                      : 'Available-to-sell inventory remains strictly unchanged.'}
                  </strong>
                </li>
                <li>
                  {isRtl
                    ? 'تسجيل تاريخ الاستلام الفعلي بالمستودع وتمكين الفريق من بدء الفحص الفني.'
                    : 'Records physical warehouse receipt date and enables technical inspection.'}
                </li>
              </ul>
            </div>

            {/* Courier Info */}
            <div className="p-3 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2] flex items-center justify-between">
              <div>
                <span className="text-[10px] text-[#64748B] block">{isRtl ? 'شركة التوصيل والتتبع:' : 'Courier:'}</span>
                <strong className="text-[#172033]">{receiptConfirmReturn.courierName || 'شركة الشحن'}</strong>
              </div>
              <span className="font-mono-code text-[11px] font-bold text-[#2563EB]">
                {receiptConfirmReturn.trackingNumber || 'TRK-AUTO'}
              </span>
            </div>

            {/* Receipt Notes */}
            <div>
              <label className="block font-semibold text-[#172033] mb-1.5">
                {isRtl ? 'ملاحظات الاستلام بالمستودع (اختياري):' : 'Warehouse receipt notes:'}
              </label>
              <textarea
                rows={2}
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
                placeholder={isRtl ? 'مثال: تم استلام الطرد من المندوب بحالة مغلقة جيدة...' : 'e.g. Received intact from courier...'}
                className="w-full px-3 py-2 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                onClick={() => setReceiptConfirmReturn(null)}
                className="px-4 py-2 text-xs font-semibold text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-xl transition-colors cursor-pointer"
              >
                {t.actions.cancel}
              </button>

              <button
                type="button"
                onClick={handleConfirmWarehouseReceipt}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{isRtl ? 'تأكيد الاستلام بالمستودع' : 'Confirm Receipt'}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 6. Technical Inspection Decision Modal */}
      <Modal
        isOpen={inspectingReturn !== null}
        onClose={() => setInspectingReturn(null)}
        title={isRtl ? 'قرار الفحص الفني للمرتجع وتحديد الحيازة' : 'Technical Inspection & Restock Decision'}
        subtitle={inspectingReturn ? `الطلب #${inspectingReturn.orderId} (المرتجع ${inspectingReturn.id})` : ''}
        maxWidth="lg"
      >
        {inspectingReturn && (
          <div className="space-y-4 text-xs">
            {/* Header Product Card */}
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-[#E8ECF2] flex items-center justify-between">
              <div className="flex items-center gap-3">
                {inspectingReturn.items[0]?.imageUrl && (
                  <img
                    src={inspectingReturn.items[0].imageUrl}
                    alt={inspectingReturn.items[0].productName}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-xl object-cover border border-[#E8ECF2]"
                  />
                )}
                <div>
                  <h4 className="font-bold text-[#172033]">{inspectingReturn.items[0]?.productName}</h4>
                  <span className="font-mono-code text-[11px] text-[#64748B]">
                    SKU: {inspectingReturn.items[0]?.productSku} · ×{inspectingReturn.items[0]?.quantity}
                  </span>
                </div>
              </div>

              <div className="text-end">
                <span className="text-[10px] text-[#64748B] block">{isRtl ? 'قيمة البيع الأصلية:' : 'Original price:'}</span>
                <span className="font-bold text-[#2563EB] font-mono-code text-sm">
                  {inspectingReturn.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)} {settings.currency}
                </span>
              </div>
            </div>

            {/* Decision Outcomes Selector (4 mutually exclusive options) */}
            <div>
              <label className="block font-bold text-[#172033] mb-2">
                {isRtl ? 'اختر نتيجة الفحص الفني المعتمدة:' : 'Select Inspection Outcome:'}
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* 1. Restockable */}
                <div
                  onClick={() => setSelectedOutcome('restockable')}
                  className={`p-3 rounded-2xl border-2 transition-all cursor-pointer ${
                    selectedOutcome === 'restockable'
                      ? 'border-[#16A36A] bg-emerald-50/50 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-bold text-[#16A36A] flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isRtl ? 'صالح لإعادة البيع (سليم)' : 'Restockable / Sellable'}</span>
                    </div>
                    {selectedOutcome === 'restockable' && <Check className="w-4 h-4 text-[#16A36A] stroke-[3]" />}
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    {isRtl
                      ? 'المنتج بحالة ممتازة وكامل العبوة. يُعاد رسمياً للمخزون المتاح للبيع.'
                      : 'Product verified sellable and returned to available inventory.'}
                  </p>
                </div>

                {/* 2. Damaged */}
                <div
                  onClick={() => setSelectedOutcome('damaged')}
                  className={`p-3 rounded-2xl border-2 transition-all cursor-pointer ${
                    selectedOutcome === 'damaged'
                      ? 'border-[#DC5555] bg-rose-50/50 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-bold text-[#DC5555] flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{isRtl ? 'تالف وغير صالح للبيع' : 'Damaged / Unsellable'}</span>
                    </div>
                    {selectedOutcome === 'damaged' && <Check className="w-4 h-4 text-[#DC5555] stroke-[3]" />}
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    {isRtl
                      ? 'المنتج مكسور أو متضرر. يُنقل للمخزون التالف ولا يدخل المتاح نهائياً.'
                      : 'Product damaged. Moves to damaged inventory, never sellable.'}
                  </p>
                </div>

                {/* 3. Missing */}
                <div
                  onClick={() => setSelectedOutcome('missing')}
                  className={`p-3 rounded-2xl border-2 transition-all cursor-pointer ${
                    selectedOutcome === 'missing'
                      ? 'border-slate-600 bg-slate-100 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-bold text-slate-800 flex items-center gap-1.5">
                      <HelpCircle className="w-4 h-4" />
                      <span>{isRtl ? 'طرد مفقود من شركة الشحن' : 'Missing / Lost in Transit'}</span>
                    </div>
                    {selectedOutcome === 'missing' && <Check className="w-4 h-4 text-slate-800 stroke-[3]" />}
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    {isRtl
                      ? 'الطرد لم يصل فيزيائياً للمستودع ومفقود لدى شركة الشحن.'
                      : 'Package confirmed lost by courier and written off.'}
                  </p>
                </div>

                {/* 4. Requires Action */}
                <div
                  onClick={() => setSelectedOutcome('requires_action')}
                  className={`p-3 rounded-2xl border-2 transition-all cursor-pointer ${
                    selectedOutcome === 'requires_action'
                      ? 'border-purple-600 bg-purple-50/50 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-bold text-purple-700 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>{isRtl ? 'يحتاج إجراء إضافي أو توثيق' : 'Requires Action / Hold'}</span>
                    </div>
                    {selectedOutcome === 'requires_action' && <Check className="w-4 h-4 text-purple-700 stroke-[3]" />}
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    {isRtl
                      ? 'يبقى محجوزاً بانتظار تصوير الأضرار أو فتح نزاع مع المنصة.'
                      : 'Held in awaiting inspection pending documentation or dispute.'}
                  </p>
                </div>
              </div>
            </div>

            {/* PRE-CONFIRMATION CONSEQUENCE AUDIT BOX */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1.5">
              <div className="font-bold text-[#172033] flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-[#2563EB]" />
                <span>{isRtl ? 'الأثر التشغيلي والمالي قبل التأكيد:' : 'Operational & Financial Consequence Preview:'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 bg-white rounded-xl border border-slate-200">
                  <span className="text-[#64748B] block text-[10px]">{isRtl ? 'حركة المخزون الفعلي:' : 'Inventory Move:'}</span>
                  {selectedOutcome === 'restockable' && (
                    <strong className="text-[#16A36A]">
                      {isRtl ? '+1 إلى المخزون المتاح للبيع فوراً' : '+1 to Available Stock immediately'}
                    </strong>
                  )}
                  {selectedOutcome === 'damaged' && (
                    <strong className="text-[#DC5555]">
                      {isRtl ? '+1 إلى المخزون التالف (0 إلى المتاح)' : '+1 to Damaged Stock (0 to Available)'}
                    </strong>
                  )}
                  {selectedOutcome === 'missing' && (
                    <strong className="text-slate-700">
                      {isRtl ? 'شطب القطعة نهائياً من العهدة' : 'Written off from custody'}
                    </strong>
                  )}
                  {selectedOutcome === 'requires_action' && (
                    <strong className="text-purple-700">
                      {isRtl ? 'يبقى في بانتظار الفحص بالمستودع' : 'Held in Awaiting Inspection'}
                    </strong>
                  )}
                </div>

                <div className="p-2 bg-white rounded-xl border border-slate-200">
                  <span className="text-[#64748B] block text-[10px]">{isRtl ? 'الأثر المحاسبي:' : 'Accounting Effect:'}</span>
                  {selectedOutcome === 'restockable' && (
                    <strong className="text-[#16A36A]">
                      {isRtl ? 'استعادة قيمة الأصل البضاعي وإغلاق دورة الطلب' : 'Asset value preserved, cycle closed'}
                    </strong>
                  )}
                  {selectedOutcome === 'damaged' && (
                    <strong className="text-[#DC5555]">
                      {isRtl ? 'تسجيل خسارة هالك مخزون بسعر التكلفة' : 'Write-off loss recorded at base cost'}
                    </strong>
                  )}
                  {selectedOutcome === 'missing' && (
                    <strong className="text-slate-700">
                      {isRtl ? 'مطالبة شركة الشحن بالتعويض' : 'Claim against courier'}
                    </strong>
                  )}
                  {selectedOutcome === 'requires_action' && (
                    <strong className="text-purple-700">
                      {isRtl ? 'معلق لحين استكمال التوثيق' : 'Financials pending resolution'}
                    </strong>
                  )}
                </div>
              </div>
            </div>

            {/* Condition assessment */}
            <div>
              <label className="block font-semibold text-[#172033] mb-1.5">
                {isRtl ? 'التقييم الفيزيائي للعبوة:' : 'Packaging condition:'}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'like_new', label: isRtl ? 'كالجديد (سليم 100%)' : 'Like New' },
                  { id: 'opened_good', label: isRtl ? 'مفتوح بحالة مقبولة' : 'Opened Good' },
                  { id: 'damaged', label: isRtl ? 'تالف / متضرر' : 'Damaged' },
                  { id: 'lost', label: isRtl ? 'مفقود / غير مستلم' : 'Lost' },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCondition(c.id as any)}
                    className={`p-2 text-center rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                      condition === c.id
                        ? 'border-[#2563EB] bg-blue-50/50 text-[#2563EB] ring-1 ring-[#2563EB]'
                        : 'border-[#E8ECF2] bg-white text-[#64748B] hover:text-[#172033]'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {isRtl ? 'تقرير الفحص والملاحظات الموثقة:' : 'Inspection Notes:'}
              </label>
              <textarea
                rows={2}
                value={inspectionNotes}
                onChange={(e) => setInspectionNotes(e.target.value)}
                placeholder={isRtl ? 'أدخل ملاحظات دقيقة عن حالة الكرتون، الملحقات، أو سبب التلف...' : 'Detailed observations...'}
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                onClick={() => setInspectingReturn(null)}
                className="px-4 py-2 text-xs font-semibold text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-xl transition-colors cursor-pointer"
              >
                {t.actions.cancel}
              </button>

              <button
                type="button"
                onClick={handleCommitInspection}
                className="px-6 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{isRtl ? 'اعتماد النتيجة وإغلاق دورة الفحص' : 'Commit & Finalize Return'}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 7. Auditable Return History & Activity Notes Modal */}
      <Modal
        isOpen={detailReturn !== null}
        onClose={() => setDetailReturn(null)}
        title={isRtl ? 'سجل حيازة المرتجع والملاحظات والوقائع' : 'Return Custody & Activity Timeline'}
        subtitle={detailReturn ? `المرتجع #${detailReturn.id} (الطلب ${detailReturn.orderId})` : ''}
        maxWidth="md"
      >
        {detailReturn && (
          <div className="space-y-4 text-xs">
            {/* Quick summary info */}
            <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-[#E8ECF2] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">{isRtl ? 'حالة المرتجع الحالية:' : 'Status:'}</span>
                {getReturnStatusBadge(detailReturn.returnStatus, detailReturn.inspectionOutcome)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">{isRtl ? 'شركة الشحن ورقم التتبع:' : 'Courier & Tracking:'}</span>
                <span className="font-mono-code font-bold text-[#172033]">
                  {detailReturn.courierName || 'شركة الشحن'} ({detailReturn.trackingNumber || 'غير متوفر'})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">{isRtl ? 'سبب الإرجاع المسجل:' : 'Return Reason:'}</span>
                <span className="font-medium text-[#172033]">{detailReturn.returnReason}</span>
              </div>
            </div>

            {/* Activity Timeline */}
            <div>
              <h4 className="font-bold text-[#172033] mb-2">
                {isRtl ? 'الوقائع والقرارات المسجلة زمنياً:' : 'Audit Timeline:'}
              </h4>
              <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
                {(!detailReturn.activities || detailReturn.activities.length === 0) ? (
                  <div className="p-3 text-center text-[#64748B] bg-slate-50 rounded-xl">
                    {isRtl ? 'لا توجد أحداث إضافية مسجلة.' : 'No activity logged yet.'}
                  </div>
                ) : (
                  detailReturn.activities.map((act) => (
                    <div
                      key={act.id}
                      className={`p-3 rounded-xl border text-xs ${
                        act.type === 'manual'
                          ? 'bg-amber-50/50 border-amber-200'
                          : 'bg-white border-[#E8ECF2]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <strong className="text-[#172033]">{isRtl ? act.actionAr : act.action}</strong>
                        <span className="text-[10px] text-[#64748B] font-mono-code">
                          {new Date(act.timestamp).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {act.notes && <p className="text-[11px] text-[#64748B]">{act.notes}</p>}
                      <div className="text-[10px] text-slate-400 mt-1">
                        {isRtl ? 'المسؤول:' : 'By:'} {act.operator}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add note */}
            <div className="pt-2 border-t border-[#E8ECF2] space-y-2">
              <label className="block font-semibold text-[#172033]">
                {isRtl ? 'إضافة ملاحظة توثيقية جديدة:' : 'Add auditable note:'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newNoteInput}
                  onChange={(e) => setNewNoteInput(e.target.value)}
                  placeholder={isRtl ? 'اكتب ملاحظة حول التواصل مع شركة الشحن أو العميل...' : 'Enter note...'}
                  className="flex-1 px-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                />
                <button
                  type="button"
                  onClick={handleAddManualNote}
                  disabled={!newNoteInput.trim()}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
                >
                  {isRtl ? 'إضافة' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
