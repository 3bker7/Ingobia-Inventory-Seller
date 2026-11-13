import React, { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  RotateCcw,
  Eye,
  Calendar,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import { Order } from '../../types';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';

interface CompletedOrdersPageProps {
  locale: Locale;
  onNavigateToReturns?: () => void;
}

export const CompletedOrdersPage: React.FC<CompletedOrdersPageProps> = ({
  locale,
  onNavigateToReturns,
}) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();

  const [orders, setOrders] = useState<Order[]>(() => storageService.getCompletedOrders());
  const [searchQuery, setSearchQuery] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState<'all' | 'delivered' | 'return_completed'>('all');

  // Modals state
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [orderForReturn, setOrderForReturn] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');

  const refreshOrders = () => {
    setOrders(storageService.getCompletedOrders());
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesId = o.id.toLowerCase().includes(q);
        const matchesCustomer = o.customerName && o.customerName.toLowerCase().includes(q);
        const matchesSku = o.items.some((it) => it.productSku.toLowerCase().includes(q) || it.productName.toLowerCase().includes(q));
        if (!matchesId && !matchesCustomer && !matchesSku) return false;
      }

      if (workflowFilter !== 'all' && o.closedReason !== workflowFilter) {
        return false;
      }

      return true;
    });
  }, [orders, searchQuery, workflowFilter]);

  // Handle post-delivery return registration
  const handleRegisterPostDeliveryReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForReturn) return;
    if (!returnReason.trim()) {
      showToast(locale === 'ar' ? 'يرجى كتابة سبب الإرجاع.' : 'Return reason is required.', 'warning');
      return;
    }

    const res = storageService.registerPostDeliveryReturn(
      orderForReturn.id,
      returnReason.trim(),
      returnNotes.trim()
    );

    if (res.success) {
      showToast(t.toasts.postDeliveryReturnRegistered, 'success');
      setOrderForReturn(null);
      setReturnReason('');
      setReturnNotes('');
      refreshOrders();
      if (onNavigateToReturns) {
        // Optionally notify user they can track in Returns page
      }
    } else {
      showToast(res.error || t.toasts.error, 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Notice Banner */}
      <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-950 shadow-xs">
        <div className="flex items-center gap-2.5">
          <FileCheck className="w-5 h-5 text-[#16A36A] shrink-0" />
          <p className="leading-relaxed">
            {locale === 'ar'
              ? 'الطلبات في هذه الصفحة مغلقة نهائياً ومحمية من التعديل العرضي. في حال رغبة العميل بالإرجاع بعد التسليم، يمكنك استخدام زر "تسجيل مرتجع جديد" لبدء دورة فحص موثقة دون المساس بسجل التسليم التاريخي.'
              : 'Orders here are permanently closed. If a customer requests a return post-delivery, use "Register New Return" to initiate tracked inspection while preserving original delivery history.'}
          </p>
        </div>
        <span className="font-bold tabular-nums shrink-0 ps-3">
          {orders.length} {locale === 'ar' ? 'طلب مكتمل' : 'completed'}
        </span>
      </div>

      {/* Toolbar: Search and Filter */}
      <div className="bg-white p-3.5 rounded-xl border border-[#E8ECF2] shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-[#64748B] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={locale === 'ar' ? 'بحث برقم الطلب أو اسم العميل أو SKU...' : 'Search Order ID, customer, or SKU...'}
            className="w-full ps-9 pe-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        <div className="flex items-center gap-1 bg-[#F7F8FA] p-1 rounded-lg border border-[#E8ECF2]">
          <button
            onClick={() => setWorkflowFilter('all')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              workflowFilter === 'all'
                ? 'bg-white text-[#172033] shadow-xs'
                : 'text-[#64748B] hover:text-[#172033]'
            }`}
          >
            {t.actions.all} ({orders.length})
          </button>
          <button
            onClick={() => setWorkflowFilter('delivered')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              workflowFilter === 'delivered'
                ? 'bg-white text-[#16A36A] shadow-xs font-semibold'
                : 'text-[#64748B] hover:text-[#172033]'
            }`}
          >
            {t.completedOrders.deliveredWorkflow}
          </button>
          <button
            onClick={() => setWorkflowFilter('return_completed')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              workflowFilter === 'return_completed'
                ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                : 'text-[#64748B] hover:text-[#172033]'
            }`}
          >
            {t.completedOrders.returnCompletedWorkflow}
          </button>
        </div>
      </div>

      {/* Completed Orders Table */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold select-none">
                <th className="py-3 px-3.5 text-start">{t.completedOrders.orderId}</th>
                <th className="py-3 px-3 text-start">{t.completedOrders.marketplace}</th>
                <th className="py-3 px-3 text-start">{t.completedOrders.items}</th>
                <th className="py-3 px-3 text-end">{t.completedOrders.totalAmount}</th>
                <th className="py-3 px-3 text-center">{t.completedOrders.completionType}</th>
                <th className="py-3 px-3 text-start">{t.completedOrders.completionDate}</th>
                <th className="py-3 px-3 text-center w-40">{t.actions.filter}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#64748B]">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-[#64748B]/60 mb-2" />
                    <p className="text-sm font-medium">{t.completedOrders.noCompletedOrders}</p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const mkt = settings.marketplaces.find((m) => m.id === order.marketplaceId);
                  const firstItem = order.items[0];
                  const isDelivered = order.closedReason === 'delivered';

                  return (
                    <tr key={order.id} className="hover:bg-[#F7F8FA]/60 transition-colors">
                      {/* Order ID */}
                      <td className="py-3 px-3.5 font-mono-code font-bold text-[#172033]">
                        {order.id}
                        {order.hasPostDeliveryReturn && (
                          <span className="block text-[10px] text-purple-700 font-sans font-semibold">
                            {locale === 'ar' ? 'مرتجع لاحق مسجل' : 'Post-return filed'}
                          </span>
                        )}
                      </td>

                      {/* Marketplace */}
                      <td className="py-3 px-3">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold border"
                          style={{
                            backgroundColor: mkt?.badgeBg || '#FEF9C3',
                            color: mkt?.badgeText || '#854D0E',
                            borderColor: '#E8ECF2',
                          }}
                        >
                          {locale === 'ar' ? mkt?.nameAr || order.marketplaceId : mkt?.nameEn || order.marketplaceId}
                        </span>
                      </td>

                      {/* Items */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          {firstItem && (
                            <img
                              src={firstItem.imageUrl}
                              alt={firstItem.productName}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded object-cover border border-[#E8ECF2] shrink-0"
                            />
                          )}
                          <div className="min-w-0 max-w-xs">
                            <div className="font-semibold text-[#172033] truncate">
                              {firstItem?.productName}
                            </div>
                            <div className="text-[11px] text-[#64748B] font-mono-code">
                              SKU: {firstItem?.productSku} · ×{firstItem?.quantity}
                              {order.items.length > 1 && (
                                <span className="ms-1 text-[#2563EB] font-sans">
                                  (+{order.items.length - 1})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Total Amount */}
                      <td className="py-3 px-3 text-end font-bold text-[#172033] tabular-nums">
                        {order.totalAmount.toFixed(2)} {settings.currency}
                      </td>

                      {/* Workflow Closure Type Badge */}
                      <td className="py-3 px-3 text-center">
                        {isDelivered ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-[#16A36A] border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{t.completedOrders.deliveredWorkflow}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-[#2563EB] border border-blue-200">
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{t.completedOrders.returnCompletedWorkflow}</span>
                          </span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="py-3 px-3 text-[#64748B] text-[11px] tabular-nums whitespace-nowrap">
                        {new Date(order.closedAt || order.updatedAt).toLocaleDateString(
                          locale === 'ar' ? 'ar-SA' : 'en-US',
                          { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setViewOrder(order)}
                            className="p-1.5 text-[#64748B] hover:text-[#172033] hover:bg-[#F7F8FA] rounded transition-colors"
                            title={t.actions.viewDetails}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Specific Action: Register New Return (for delivered orders) */}
                          {isDelivered && (
                            <button
                              onClick={() => {
                                setOrderForReturn(order);
                                setReturnReason('');
                                setReturnNotes('');
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#2563EB] hover:bg-blue-50 border border-blue-200 rounded-md transition-colors"
                              title={t.completedOrders.registerReturnBtn}
                            >
                              {t.completedOrders.registerReturnBtn}
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

      {/* View Order Modal */}
      <Modal
        isOpen={viewOrder !== null}
        onClose={() => setViewOrder(null)}
        title={viewOrder ? `${t.orders.orderId}: ${viewOrder.id} (${locale === 'ar' ? 'مكتمل ومغلق' : 'Completed & Closed'})` : ''}
        maxWidth="md"
      >
        {viewOrder && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-[#F7F8FA] rounded-lg border border-[#E8ECF2] flex items-center justify-between">
              <div>
                <span className="text-[#64748B] block text-[11px]">{t.completedOrders.completionType}</span>
                <span className="font-bold text-[#172033]">
                  {viewOrder.closedReason === 'delivered'
                    ? t.completedOrders.deliveredWorkflow
                    : t.completedOrders.returnCompletedWorkflow}
                </span>
              </div>
              <div className="text-end">
                <span className="text-[#64748B] block text-[11px]">{t.orders.totalAmount}</span>
                <span className="font-bold text-[#172033] tabular-nums text-sm">
                  {viewOrder.totalAmount.toFixed(2)} {settings.currency}
                </span>
              </div>
            </div>

            {viewOrder.customerName && (
              <div className="p-2.5 bg-white rounded border border-[#E8ECF2]">
                <span className="text-[#64748B]">{t.orders.customerName}:</span>{' '}
                <strong className="text-[#172033]">{viewOrder.customerName}</strong>
                {viewOrder.shippingAddress && (
                  <p className="text-[#64748B] mt-0.5">{viewOrder.shippingAddress}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <h4 className="font-semibold text-[#172033]">
                {locale === 'ar' ? 'المنتجات المسجلة في الطلب' : 'Line Items'}
              </h4>
              <div className="divide-y divide-[#E8ECF2] border border-[#E8ECF2] rounded-lg overflow-hidden">
                {viewOrder.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-white">
                    <div className="flex items-center gap-2">
                      <img
                        src={item.imageUrl}
                        alt={item.productName}
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded object-cover border border-[#E8ECF2]"
                      />
                      <div>
                        <div className="font-semibold text-[#172033]">{item.productName}</div>
                        <div className="text-[10px] text-[#64748B] font-mono-code">
                          SKU: {item.productSku} · {item.unitPrice} {settings.currency}
                        </div>
                      </div>
                    </div>
                    <span className="font-bold tabular-nums text-[#172033]">×{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#E8ECF2]">
              <button
                onClick={() => setViewOrder(null)}
                className="px-4 py-1.5 text-xs font-medium text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/70 rounded-lg transition-colors"
              >
                {t.actions.close}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Register New Return Modal (Exclusive to Completed Orders) */}
      <Modal
        isOpen={orderForReturn !== null}
        onClose={() => setOrderForReturn(null)}
        title={t.completedOrders.registerReturnModalTitle}
        subtitle={orderForReturn ? `الطلب #${orderForReturn.id} (${orderForReturn.marketplaceId})` : ''}
        maxWidth="md"
      >
        {orderForReturn && (
          <form onSubmit={handleRegisterPostDeliveryReturn} className="space-y-4 text-xs">
            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-900 leading-relaxed">
              {t.completedOrders.registerReturnDesc}
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {t.completedOrders.returnReasonLabel}
              </label>
              <input
                type="text"
                required
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder={locale === 'ar' ? 'مثال: مقاس غير مناسب، رغبة في الاستبدال، منتج معيب...' : 'e.g. Size mismatch, defective unit, customer change of mind...'}
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {locale === 'ar' ? 'ملاحظات إضافية أو رقم بوليصة الإرجاع' : 'Additional Notes / Return AWB'}
              </label>
              <textarea
                rows={2}
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="أدخل أي ملاحظات شحن أو تفاصيل حول حالة الطرد المتوقعة..."
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                onClick={() => setOrderForReturn(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors"
              >
                {t.actions.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
              >
                {locale === 'ar' ? 'بدء دورة المرتجع' : 'Initiate Return Cycle'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
