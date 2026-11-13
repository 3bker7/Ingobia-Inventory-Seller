import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  ShoppingCart,
  Clock,
  Truck,
  CheckCircle2,
  XCircle,
  Eye,
  Trash2,
  AlertCircle,
  Info,
  DollarSign,
  Package,
  ArrowRight,
  Check,
  ShieldCheck,
  FileText,
  Tag,
  Receipt,
} from 'lucide-react';
import {
  Order,
  OrderStatus,
  MarketplaceId,
  OrderItem,
  Product,
  ShipmentRecord,
  OrderFinancialAdjustment,
} from '../../types';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';

interface OrdersPageProps {
  locale: Locale;
  isAddModalOpenInitially?: boolean;
  onCloseInitialAddModal?: () => void;
  initialStatusFilter?: string;
  onNavigateToCompleted?: () => void;
}

interface SkuLineItem {
  skuInput: string;
  matchedProduct: Product | null;
  quantity: number;
}

export const OrdersPage: React.FC<OrdersPageProps> = ({
  locale,
  isAddModalOpenInitially = false,
  onCloseInitialAddModal,
  initialStatusFilter,
  onNavigateToCompleted,
}) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();
  const isRtl = locale === 'ar';

  // Active orders only
  const [orders, setOrders] = useState<Order[]>(() => storageService.getActiveOrders());
  const [searchOrderId, setSearchOrderId] = useState('');
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>(initialStatusFilter || 'all');

  React.useEffect(() => {
    if (initialStatusFilter) {
      setSelectedStatus(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(isAddModalOpenInitially);
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [handoverModalOrder, setHandoverModalOrder] = useState<Order | null>(null);
  const [handoverCourier, setHandoverCourier] = useState('شركة الشحن السريع');
  const [handoverTracking, setHandoverTracking] = useState('');

  // SKU-First Add Order Form State
  const [formOrderId, setFormOrderId] = useState(`ORD-${Math.floor(1000 + Math.random() * 9000)}`);
  const [formMarketplace, setFormMarketplace] = useState<MarketplaceId>('noon');
  const [formCustomerName, setFormCustomerName] = useState('');
  const [formCustomerPhone, setFormCustomerPhone] = useState('');
  const [formShippingAddress, setFormShippingAddress] = useState('');
  const [formCourierName, setFormCourierName] = useState('أرامكس / Aramex');
  const [formTrackingNumber, setFormTrackingNumber] = useState('');
  const [formShippingCost, setFormShippingCost] = useState<number>(18);
  const [formPackagingCost, setFormPackagingCost] = useState<number>(3);
  const [formNotes, setFormNotes] = useState('');

  // Sku line items
  const [skuItems, setSkuItems] = useState<SkuLineItem[]>([
    {
      skuInput: 'ELEC-WATCH-01',
      matchedProduct: storageService.getProductBySku('ELEC-WATCH-01') || null,
      quantity: 1,
    },
  ]);

  // Optional adjustments
  const [extraShipping, setExtraShipping] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);

  const refreshOrders = () => {
    setOrders(storageService.getActiveOrders());
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (searchOrderId.trim()) {
        const query = searchOrderId.trim().toLowerCase();
        const matchesId = o.id.toLowerCase().includes(query);
        const matchesCustomer = o.customerName && o.customerName.toLowerCase().includes(query);
        const matchesItems = o.items.some(
          (i) => i.productName.toLowerCase().includes(query) || i.productSku.toLowerCase().includes(query)
        );
        if (!matchesId && !matchesCustomer && !matchesItems) return false;
      }

      if (selectedMarketplace !== 'all' && o.marketplaceId !== selectedMarketplace) {
        return false;
      }

      if (selectedStatus !== 'all' && o.status !== selectedStatus) {
        return false;
      }

      return true;
    });
  }, [orders, searchOrderId, selectedMarketplace, selectedStatus]);

  const handleOpenAddModal = () => {
    const products = storageService.getProducts();
    const firstInStock = products.find((p) => p.availableStock > 0) || products[0];

    setFormOrderId(`ORD-${Math.floor(1000 + Math.random() * 9000)}`);
    setFormMarketplace(settings.marketplaces[0]?.id || 'noon');
    setFormCustomerName('');
    setFormCustomerPhone('');
    setFormShippingAddress('');
    setFormNotes('');
    setExtraShipping(0);
    setDiscountAmount(0);

    if (firstInStock) {
      setSkuItems([
        {
          skuInput: firstInStock.sku || '',
          matchedProduct: firstInStock,
          quantity: 1,
        },
      ]);
    } else {
      setSkuItems([
        {
          skuInput: '',
          matchedProduct: null,
          quantity: 1,
        },
      ]);
    }

    setIsAddModalOpen(true);
  };

  const handleSkuInputChange = (index: number, val: string) => {
    const trimmed = val.trim();
    const matched = storageService.getProductBySku(trimmed);

    setSkuItems((prev) => {
      const copy = [...prev];
      copy[index] = {
        skuInput: val,
        matchedProduct: matched || null,
        quantity: copy[index].quantity || 1,
      };
      return copy;
    });
  };

  const handleAddSkuLine = () => {
    setSkuItems((prev) => [
      ...prev,
      {
        skuInput: '',
        matchedProduct: null,
        quantity: 1,
      },
    ]);
  };

  const handleRemoveSkuLine = (index: number) => {
    if (skuItems.length === 1) return;
    setSkuItems((prev) => prev.filter((_, i) => i !== index));
  };

  const calculateSubtotal = () => {
    return skuItems.reduce((sum, item) => {
      if (!item.matchedProduct) return sum;
      const price =
        item.matchedProduct.marketplaceListings[formMarketplace]?.price || item.matchedProduct.currentPrice || 0;
      return sum + price * item.quantity;
    }, 0);
  };

  const calculateOrderTotal = () => {
    const sub = calculateSubtotal();
    return Math.max(0, sub + extraShipping - discountAmount);
  };

  const handleCreateOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Validation: every line must match a product
    for (let i = 0; i < skuItems.length; i++) {
      const it = skuItems[i];
      if (!it.matchedProduct) {
        showToast(
          isRtl
            ? `رمز SKU في السطر ${i + 1} (${it.skuInput || 'فارغ'}) غير متطابق مع أي منتج مسجل بالمستودع.`
            : `SKU in row ${i + 1} does not match any registered product.`,
          'error'
        );
        return;
      }

      if (it.quantity <= 0) {
        showToast(isRtl ? 'الكمية يجب أن تكون 1 على الأقل.' : 'Quantity must be at least 1.', 'warning');
        return;
      }

      if (it.matchedProduct.availableStock < it.quantity) {
        showToast(
          isRtl
            ? `الكمية المطلوبة (${it.quantity}) للمنتج ${it.matchedProduct.name} تتجاوز المخزون المتاح للبيع (${it.matchedProduct.availableStock})!`
            : `Quantity exceeds available stock (${it.matchedProduct.availableStock})!`,
          'error'
        );
        return;
      }
    }

    const orderItems: OrderItem[] = skuItems.map((it) => {
      const prod = it.matchedProduct!;
      const listingPrice =
        prod.marketplaceListings[formMarketplace]?.price || prod.currentPrice;

      return {
        productId: prod.id,
        productSku: prod.sku || prod.name,
        productName: isRtl && prod.nameAr ? prod.nameAr : prod.name,
        imageUrl: prod.imageUrl,
        unitPrice: listingPrice,
        quantity: it.quantity,
      };
    });

    const adjustments: OrderFinancialAdjustment[] = [];
    if (extraShipping > 0) {
      adjustments.push({
        id: `adj-ship-${Date.now()}`,
        description: isRtl ? 'رسوم شحن إضافية' : 'Extra shipping fee',
        amount: extraShipping,
        type: 'extra_shipping',
        payer: 'customer',
      });
    }
    if (discountAmount > 0) {
      adjustments.push({
        id: `adj-disc-${Date.now()}`,
        description: isRtl ? 'خصم ترويجي' : 'Promotional discount',
        amount: discountAmount,
        type: 'discount',
        payer: 'seller',
      });
    }

    const totalAmount = calculateOrderTotal();

    const shipmentRecord: ShipmentRecord = {
      courierName: formCourierName.trim() || 'شركة الشحن',
      trackingNumber: formTrackingNumber.trim() || `TRK-${Math.floor(100000 + Math.random() * 900000)}`,
      shippingCost: formShippingCost,
      costPayer: 'seller',
      notes: formNotes.trim() || undefined,
    };

    const result = storageService.createOrder(
      {
        marketplaceId: formMarketplace,
        items: orderItems,
        totalAmount,
        status: 'preparing',
        customerName: formCustomerName.trim() || undefined,
        customerPhone: formCustomerPhone.trim() || undefined,
        shippingAddress: formShippingAddress.trim() || undefined,
        notes: formNotes.trim() || undefined,
        orderDate: new Date().toISOString(),
        shipment: shipmentRecord,
        courierName: shipmentRecord.courierName,
        trackingNumber: shipmentRecord.trackingNumber,
        shippingCost: formShippingCost,
        packagingCost: formPackagingCost,
        adjustments,
      },
      formOrderId,
      settings.sellerName
    );

    if (result.success) {
      showToast(t.toasts.orderCreated, 'success');
      setIsAddModalOpen(false);
      if (onCloseInitialAddModal) onCloseInitialAddModal();
      refreshOrders();
    } else {
      showToast(result.error || t.toasts.error, 'error');
    }
  };

  const handleConfirmHandoverToCourier = () => {
    if (!handoverModalOrder) return;

    const res = storageService.updateOrderStatus(
      handoverModalOrder.id,
      'with_delivery',
      settings.sellerName,
      {
        courierName: handoverCourier.trim() || 'شركة الشحن',
        trackingNumber: handoverTracking.trim() || handoverModalOrder.trackingNumber || 'TRK-EXP',
      }
    );

    if (res.success) {
      showToast(
        isRtl
          ? 'تم تسليم الشحنة لشركة التوصيل ونقل الحيازة من (محجوز) إلى (في الطريق مع المندوب).'
          : 'Handed to courier. Custody moved to In Transit.',
        'success'
      );
      setHandoverModalOrder(null);
      refreshOrders();
    } else {
      showToast(res.error || 'فشل التحديث', 'error');
    }
  };

  const handleUpdateStatus = (orderId: string, newStatus: OrderStatus) => {
    const order = orders.find((o) => o.id === orderId);
    if (newStatus === 'with_delivery') {
      setHandoverModalOrder(order || null);
      setHandoverCourier(order?.courierName || 'أرامكس / Aramex');
      setHandoverTracking(order?.trackingNumber || `TRK-${Math.floor(100000 + Math.random() * 900000)}`);
      return;
    }

    const res = storageService.updateOrderStatus(orderId, newStatus, settings.sellerName);
    if (res.success) {
      if (newStatus === 'delivered') {
        showToast(
          isRtl
            ? 'تم تأكيد تسليم الطلب ونقله إلى صفحة "الطلبات المكتملة بنجاح" وتسجيل الإيراد الفعلي.'
            : 'Order delivered and moved to Successfully Completed Orders.',
          'success'
        );
      } else if (newStatus === 'rejected') {
        showToast(
          isRtl
            ? 'تم تسجيل رفض استلام الطلب وبدء دورة المرتجع في صفحة المرتجعات.'
            : 'Delivery rejected. Return cycle initiated.',
          'warning'
        );
      } else {
        showToast(t.toasts.orderStatusUpdated, 'success');
      }
      refreshOrders();
      if (viewOrder && viewOrder.id === orderId) {
        setViewOrder(null);
      }
    } else {
      showToast(res.error || t.toasts.error, 'error');
    }
  };

  const renderStatusBadge = (status: OrderStatus) => {
    const config: Record<
      OrderStatus,
      { label: string; icon: React.ComponentType<{ className?: string }>; style: string }
    > = {
      preparing: {
        label: isRtl ? 'قيد التجهيز بالمستودع' : 'Preparing in Warehouse',
        icon: Clock,
        style: 'bg-blue-50 text-[#2563EB] border-blue-200',
      },
      with_delivery: {
        label: isRtl ? 'في الطريق مع المندوب' : 'With Courier (In Transit)',
        icon: Truck,
        style: 'bg-amber-50 text-[#D99A27] border-amber-200',
      },
      delivered: {
        label: isRtl ? 'تم التوصيل بنجاح' : 'Delivered',
        icon: CheckCircle2,
        style: 'bg-emerald-50 text-[#16A36A] border-emerald-200',
      },
      rejected: {
        label: isRtl ? 'مرفوض عند الاستلام (مرتجع)' : 'Rejected (Return Initiated)',
        icon: XCircle,
        style: 'bg-rose-50 text-[#DC5555] border-rose-200',
      },
      cancelled: {
        label: isRtl ? 'ملغي' : 'Cancelled',
        icon: XCircle,
        style: 'bg-slate-100 text-[#64748B] border-slate-200',
      },
    };

    const cfg = config[status] || {
      label: status,
      icon: Clock,
      style: 'bg-slate-100 text-[#64748B] border-slate-200',
    };
    const Icon = cfg.icon;

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.style}`}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{cfg.label}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Notice on active vs completed separation */}
      <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-blue-950">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-[#2563EB] shrink-0" />
          <span>{t.orders.closedNotice}</span>
        </div>
        {onNavigateToCompleted && (
          <button
            onClick={onNavigateToCompleted}
            className="text-xs font-bold text-[#2563EB] hover:underline shrink-0 ps-2 self-end sm:self-center cursor-pointer"
          >
            {isRtl ? 'عرض الطلبات المكتملة بنجاح ←' : 'View Completed Orders →'}
          </button>
        )}
      </div>

      {/* Toolbar: Search, Filters & Add Order button */}
      <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="w-4 h-4 text-[#64748B] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchOrderId}
              onChange={(e) => setSearchOrderId(e.target.value)}
              placeholder={isRtl ? 'بحث برقم الطلب، العميل، أو SKU...' : 'Search by ID, customer, SKU...'}
              className="w-full ps-9 pe-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <select
            value={selectedMarketplace}
            onChange={(e) => setSelectedMarketplace(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{isRtl ? 'جميع المنصات' : 'All Marketplaces'}</option>
            {settings.marketplaces.map((m) => (
              <option key={m.id} value={m.id}>
                {isRtl ? m.nameAr : m.nameEn}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{isRtl ? 'جميع الحالات' : 'All Statuses'}</option>
            <option value="preparing">{isRtl ? 'قيد التجهيز بالمستودع' : 'Preparing'}</option>
            <option value="with_delivery">{isRtl ? 'في الطريق مع المندوب' : 'With Delivery'}</option>
            <option value="rejected">{isRtl ? 'مرفوض عند الاستلام' : 'Rejected'}</option>
          </select>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>{isRtl ? 'إنشاء طلب جديد (SKU سريع)' : 'New Order (SKU Fast)'}</span>
        </button>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-2xl border border-[#E8ECF2] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold select-none">
                <th className="py-3 px-3.5 text-start">{t.orders.orderId}</th>
                <th className="py-3 px-3 text-start">{t.orders.marketplace}</th>
                <th className="py-3 px-3 text-start">{t.orders.items}</th>
                <th className="py-3 px-3 text-start">{t.orders.totalAmount}</th>
                <th className="py-3 px-3 text-start">{isRtl ? 'شركة التوصيل والتتبع' : 'Courier / Tracking'}</th>
                <th className="py-3 px-3 text-center">{t.orders.status}</th>
                <th className="py-3 px-3.5 text-center w-48">{t.orders.actions}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#64748B]">
                    <ShoppingCart className="w-8 h-8 mx-auto text-[#64748B]/60 mb-2" />
                    <p className="text-sm font-medium">{t.orders.noOrders}</p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const mkt = settings.marketplaces.find((m) => m.id === order.marketplaceId);
                  const firstItem = order.items[0];

                  return (
                    <tr key={order.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                      <td className="py-3 px-3.5">
                        <div className="font-mono-code font-bold text-[#172033]">{order.id}</div>
                        <div className="text-[10px] text-[#64748B]">
                          {new Date(order.orderDate).toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold border inline-block"
                          style={{
                            backgroundColor: mkt?.badgeBg || '#FEF9C3',
                            color: mkt?.badgeText || '#854D0E',
                            borderColor: '#E8ECF2',
                          }}
                        >
                          {isRtl ? mkt?.nameAr || order.marketplaceId : mkt?.nameEn || order.marketplaceId}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          {firstItem && (
                            <img
                              src={firstItem.imageUrl}
                              alt={firstItem.productName}
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 rounded-lg object-cover border border-[#E8ECF2] shrink-0"
                            />
                          )}
                          <div className="min-w-0 max-w-[200px]">
                            <div className="font-semibold text-[#172033] truncate" title={firstItem?.productName}>
                              {firstItem?.productName}
                            </div>
                            <div className="text-[10px] text-[#64748B] font-mono-code">
                              SKU: {firstItem?.productSku} · ×{firstItem?.quantity}
                              {order.items.length > 1 && (
                                <span className="ms-1 text-[#2563EB] font-bold">
                                  (+{order.items.length - 1} {isRtl ? 'إضافي' : 'more'})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-[#172033] tabular-nums font-mono-code">
                          {order.totalAmount.toFixed(2)} {settings.currency}
                        </div>
                        {order.customerName && (
                          <div className="text-[10px] text-[#64748B] truncate max-w-[120px]">
                            {order.customerName}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <div className="text-[11px] font-medium text-[#172033]">
                          {order.courierName || 'شركة الشحن'}
                        </div>
                        <div className="text-[10px] font-mono-code text-[#64748B]">
                          {order.trackingNumber || 'غير محدد'}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        {renderStatusBadge(order.status)}
                      </td>

                      <td className="py-3 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {order.status === 'preparing' && (
                            <button
                              onClick={() => handleUpdateStatus(order.id, 'with_delivery')}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center gap-1"
                              title={isRtl ? 'تسليم للمندوب ونقل الحيازة خارج المستودع' : 'Handover to courier'}
                            >
                              <Truck className="w-3 h-3" />
                              <span>{isRtl ? 'تسليم للشحن' : 'Handover'}</span>
                            </button>
                          )}

                          {order.status === 'with_delivery' && (
                            <button
                              onClick={() => handleUpdateStatus(order.id, 'delivered')}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-[#16A36A] hover:bg-emerald-700 rounded-lg transition-colors shadow-2xs cursor-pointer flex items-center gap-1"
                              title={isRtl ? 'تأكيد التسليم للعميل ونقل للطلبات المكتملة' : 'Confirm delivered'}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{isRtl ? 'تم التوصيل' : 'Delivered'}</span>
                            </button>
                          )}

                          {order.status === 'with_delivery' && (
                            <button
                              onClick={() => handleUpdateStatus(order.id, 'rejected')}
                              className="px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                              title={isRtl ? 'رفض الاستلام وبدء المرتجع' : 'Reject delivery'}
                            >
                              {isRtl ? 'رفض الاستلام' : 'Rejected'}
                            </button>
                          )}

                          <button
                            onClick={() => setViewOrder(order)}
                            className="p-1.5 text-[#64748B] hover:text-[#172033] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title={isRtl ? 'عرض التفاصيل والتحليل المالي' : 'View order details'}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
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

      {/* Handover to Courier Modal */}
      <Modal
        isOpen={handoverModalOrder !== null}
        onClose={() => setHandoverModalOrder(null)}
        title={isRtl ? 'تسليم الشحنة لشركة التوصيل ونقل الحيازة' : 'Handover Shipment to Courier'}
        subtitle={handoverModalOrder ? `الطلب #${handoverModalOrder.id}` : ''}
        maxWidth="md"
      >
        {handoverModalOrder && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-950 space-y-1">
              <strong className="block font-bold">
                {isRtl ? 'تأكيد خروج المنتجات من عهدة المستودع:' : 'Warehouse Custody Transition:'}
              </strong>
              <p className="leading-relaxed">
                {isRtl
                  ? `سيتم نقل كمية المنتجات من "المخزون المحجوز بالمستودع" إلى "خارج المستودع (في الطريق مع المندوب)".`
                  : 'Moves reserved stock to Outbound In Transit outside warehouse custody.'}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-[#172033] mb-1">
                  {isRtl ? 'اسم شركة التوصيل / المندوب:' : 'Courier Name:'}
                </label>
                <input
                  type="text"
                  required
                  value={handoverCourier}
                  onChange={(e) => setHandoverCourier(e.target.value)}
                  placeholder={isRtl ? 'مثال: أرامكس، سبل، مندوب المتجر...' : 'e.g. Aramex, DHL...'}
                  className="w-full px-3 py-2 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#172033] mb-1">
                  {isRtl ? 'رقم التتبع / بوليصة الشحن:' : 'Tracking Number / AWB:'}
                </label>
                <input
                  type="text"
                  required
                  value={handoverTracking}
                  onChange={(e) => setHandoverTracking(e.target.value)}
                  placeholder="TRK-982182"
                  className="w-full px-3 py-2 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] font-mono-code"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                onClick={() => setHandoverModalOrder(null)}
                className="px-4 py-2 text-xs font-semibold text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-xl transition-colors cursor-pointer"
              >
                {t.actions.cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirmHandoverToCourier}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Truck className="w-4 h-4" />
                <span>{isRtl ? 'تأكيد التسليم للشحن' : 'Confirm Handover'}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* SKU-First Fast Order Creation Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          if (onCloseInitialAddModal) onCloseInitialAddModal();
        }}
        title={isRtl ? 'إنشاء طلب يدوي سريع بالرمز التعريفي (SKU)' : 'Fast SKU-First Order Creation'}
        subtitle={isRtl ? 'إدخال سريع يحدد المنتج وسعر المنصة والمخزون المتاح تلقائياً' : 'Instant product matching and stock validation by SKU'}
        maxWidth="lg"
      >
        <form onSubmit={handleCreateOrderSubmit} className="space-y-4 text-xs">
          {/* Top row: Order ID & Marketplace */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-[#F8FAFC] rounded-2xl border border-[#E8ECF2]">
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {isRtl ? 'المنصة المختارة للبيع:' : 'Sales Marketplace:'} *
              </label>
              <select
                value={formMarketplace}
                onChange={(e) => setFormMarketplace(e.target.value as MarketplaceId)}
                className="w-full px-3 py-2 text-xs bg-white border border-[#E8ECF2] rounded-xl text-[#172033] font-semibold"
              >
                {settings.marketplaces.map((m) => (
                  <option key={m.id} value={m.id}>
                    {isRtl ? m.nameAr : m.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {t.orders.orderId} *
              </label>
              <input
                type="text"
                required
                value={formOrderId}
                onChange={(e) => setFormOrderId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-[#E8ECF2] rounded-xl text-[#172033] font-mono-code font-bold"
              />
            </div>
          </div>

          {/* SKU-First Line Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-bold text-[#172033] flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-[#2563EB]" />
                <span>{isRtl ? 'إدخال المنتجات برمز SKU:' : 'Product Line Items by SKU:'}</span>
              </label>

              <button
                type="button"
                onClick={handleAddSkuLine}
                className="text-[11px] font-bold text-[#2563EB] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isRtl ? 'إضافة منتج آخر' : 'Add another SKU'}</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {skuItems.map((item, idx) => {
                const prod = item.matchedProduct;
                const channelListing = prod?.marketplaceListings[formMarketplace];
                const unitPrice = channelListing ? channelListing.price : prod?.currentPrice || 0;
                const isOutOfStock = prod ? item.quantity > prod.availableStock : false;

                return (
                  <div
                    key={idx}
                    className="p-3 bg-white rounded-2xl border border-[#E8ECF2] shadow-2xs space-y-2"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start">
                      {/* SKU Input */}
                      <div className="sm:col-span-5">
                        <label className="block text-[10px] font-semibold text-[#64748B] mb-1">
                          {isRtl ? 'أدخل أو امسح رمز SKU:' : 'Enter / Scan SKU:'}
                        </label>
                        <input
                          type="text"
                          required
                          value={item.skuInput}
                          onChange={(e) => handleSkuInputChange(idx, e.target.value)}
                          placeholder="مثال: ELEC-WATCH-01"
                          className="w-full px-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] font-mono-code font-bold focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                        />
                      </div>

                      {/* Quantity Input */}
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-semibold text-[#64748B] mb-1">
                          {isRtl ? 'الكمية المطلوبة:' : 'Quantity:'}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={prod ? prod.availableStock : 999}
                          required
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 1;
                            setSkuItems((prev) => {
                              const copy = [...prev];
                              copy[idx].quantity = val;
                              return copy;
                            });
                          }}
                          className={`w-full px-3 py-1.5 text-xs rounded-xl font-bold font-mono-code ${
                            isOutOfStock
                              ? 'bg-rose-50 border-rose-300 text-[#DC5555]'
                              : 'bg-[#F7F8FA] border-[#E8ECF2] text-[#172033]'
                          }`}
                        />
                      </div>

                      {/* Unit Price snapshot */}
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-semibold text-[#64748B] mb-1">
                          {isRtl ? 'سعر البيع على المنصة:' : 'Channel Price:'}
                        </label>
                        <div className="font-bold font-mono-code text-[#172033] py-1.5">
                          {(unitPrice * item.quantity).toFixed(2)} {settings.currency}
                          <span className="text-[10px] text-[#64748B] font-normal ms-1">
                            ({unitPrice} للقطعة)
                          </span>
                        </div>
                      </div>

                      {/* Delete row */}
                      <div className="sm:col-span-1 pt-5 text-end">
                        {skuItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSkuLine(idx)}
                            className="text-slate-400 hover:text-[#DC5555] p-1 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Matched Product Details Card */}
                    {prod ? (
                      <div className="p-2.5 bg-[#F8FAFC] rounded-xl border border-blue-100 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={prod.imageUrl}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-lg object-cover border border-[#E8ECF2]"
                          />
                          <div>
                            <span className="font-bold text-[#172033] block truncate max-w-[280px]">
                              {isRtl && prod.nameAr ? prod.nameAr : prod.name}
                            </span>
                            <span className="text-[10px] text-emerald-700 font-semibold">
                              {isRtl ? 'المخزون المتاح للبيع بالمستودع:' : 'Available in warehouse:'}{' '}
                              <strong className="font-mono-code">{prod.availableStock}</strong> {isRtl ? 'قطعة' : 'units'}
                            </span>
                          </div>
                        </div>

                        {isOutOfStock && (
                          <span className="text-[11px] font-bold text-[#DC5555] flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{isRtl ? 'تجاوز المخزون المتاح!' : 'Exceeds stock!'}</span>
                          </span>
                        )}
                      </div>
                    ) : (
                      item.skuInput.trim() !== '' && (
                        <div className="p-2 bg-rose-50 text-[#DC5555] rounded-xl border border-rose-200 text-[11px] flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {isRtl
                              ? `رمز SKU "${item.skuInput}" غير موجود بالنظام. يرجى التأكد من الرمز المسجل في صفحة المنتجات.`
                              : `SKU "${item.skuInput}" not found.`}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shipping & Customer Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-[#F8FAFC] rounded-2xl border border-[#E8ECF2]">
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {t.orders.customerName}
              </label>
              <input
                type="text"
                value={formCustomerName}
                onChange={(e) => setFormCustomerName(e.target.value)}
                placeholder={isRtl ? 'اسم المشتري' : 'Customer Name'}
                className="w-full px-3 py-1.5 text-xs bg-white border border-[#E8ECF2] rounded-xl text-[#172033]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {isRtl ? 'شركة الشحن المقررة:' : 'Courier Service:'}
              </label>
              <input
                type="text"
                value={formCourierName}
                onChange={(e) => setFormCourierName(e.target.value)}
                placeholder="أرامكس / نون إكسبريس"
                className="w-full px-3 py-1.5 text-xs bg-white border border-[#E8ECF2] rounded-xl text-[#172033]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {isRtl ? 'عنوان التوصيل' : 'Shipping Address'}
              </label>
              <input
                type="text"
                value={formShippingAddress}
                onChange={(e) => setFormShippingAddress(e.target.value)}
                placeholder={isRtl ? 'المدينة، الحي، الشارع' : 'City, district...'}
                className="w-full px-3 py-1.5 text-xs bg-white border border-[#E8ECF2] rounded-xl text-[#172033]"
              />
            </div>
          </div>

          {/* Optional Extra Charges & Discounts */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <span className="font-bold text-[#172033] block text-[11px]">
              {isRtl ? 'رسوم وتعديلات مالية إضافية (اختياري):' : 'Additional charges & adjustments (optional):'}
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] text-[#64748B] mb-0.5">
                  {isRtl ? 'تكلفة الشحن (ر.س):' : 'Shipping fee:'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={formShippingCost}
                  onChange={(e) => setFormShippingCost(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg font-mono-code"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#64748B] mb-0.5">
                  {isRtl ? 'تكلفة التغليف (ر.س):' : 'Packaging fee:'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={formPackagingCost}
                  onChange={(e) => setFormPackagingCost(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg font-mono-code"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#64748B] mb-0.5">
                  {isRtl ? 'شحن إضافي للعميل:' : 'Extra charge:'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={extraShipping}
                  onChange={(e) => setExtraShipping(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg font-mono-code"
                />
              </div>

              <div>
                <label className="block text-[10px] text-[#64748B] mb-0.5">
                  {isRtl ? 'خصم مالي (ر.س):' : 'Discount:'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg font-mono-code text-emerald-700"
                />
              </div>
            </div>
          </div>

          {/* Calculation Summary Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-[#E8ECF2]">
            <div>
              <span className="text-[#64748B] text-xs">{isRtl ? 'إجمالي الطلب النهائي:' : 'Order Total:'} </span>
              <strong className="text-base font-bold text-[#172033] font-mono-code">
                {calculateOrderTotal().toFixed(2)} {settings.currency}
              </strong>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  if (onCloseInitialAddModal) onCloseInitialAddModal();
                }}
                className="px-4 py-2 text-xs font-semibold text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-xl transition-colors cursor-pointer"
              >
                {t.actions.cancel}
              </button>

              <button
                type="submit"
                className="px-6 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{isRtl ? 'حفظ الطلب وحجز المخزون' : 'Save & Reserve'}</span>
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* View Order & Financial Accounting Breakdown Modal */}
      <Modal
        isOpen={viewOrder !== null}
        onClose={() => setViewOrder(null)}
        title={viewOrder ? `${t.orders.orderId}: ${viewOrder.id}` : ''}
        subtitle={isRtl ? 'البيانات التشغيلية والتفصيل المالي وسجل الحيازة' : 'Operational, financial, and tracking details'}
        maxWidth="lg"
      >
        {viewOrder && (
          <div className="space-y-4 text-xs">
            {/* Top Operational Status Header */}
            <div className="flex items-center justify-between p-3.5 bg-[#F8FAFC] rounded-2xl border border-[#E8ECF2]">
              <div>
                <span className="text-[11px] text-[#64748B] block mb-0.5">{t.orders.marketplace}</span>
                <span className="font-bold text-[#172033] uppercase">
                  {viewOrder.marketplaceId}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-[#64748B] block mb-0.5">{t.orders.status}</span>
                {renderStatusBadge(viewOrder.status)}
              </div>
              <div className="text-end">
                <span className="text-[11px] text-[#64748B] block mb-0.5">{t.orders.totalAmount}</span>
                <span className="font-bold text-base text-[#172033] font-mono-code">
                  {viewOrder.totalAmount.toFixed(2)} {settings.currency}
                </span>
              </div>
            </div>

            {/* Courier & Tracking Section */}
            <div className="p-3 bg-white rounded-2xl border border-[#E8ECF2] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-[#D99A27] flex items-center justify-center">
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <strong className="text-[#172033] block">{viewOrder.courierName || 'شركة الشحن'}</strong>
                  <span className="text-[10px] text-[#64748B] font-mono-code">
                    {isRtl ? 'بوليصة الشحن:' : 'AWB:'} {viewOrder.trackingNumber || 'غير محدد'}
                  </span>
                </div>
              </div>

              {viewOrder.shippingCost ? (
                <div className="text-end">
                  <span className="text-[10px] text-[#64748B] block">{isRtl ? 'رسوم التوصيل:' : 'Shipping fee:'}</span>
                  <span className="font-bold text-[#172033] font-mono-code">{viewOrder.shippingCost} ر.س</span>
                </div>
              ) : null}
            </div>

            {/* Items list */}
            <div className="divide-y divide-[#E8ECF2] border border-[#E8ECF2] rounded-2xl overflow-hidden">
              {viewOrder.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-white">
                  <div className="flex items-center gap-2.5">
                    <img
                      src={item.imageUrl}
                      alt={item.productName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-cover border border-[#E8ECF2]"
                    />
                    <div>
                      <div className="font-bold text-[#172033]">{item.productName}</div>
                      <div className="text-[10px] text-[#64748B] font-mono-code">
                        SKU: {item.productSku} · {item.unitPrice} {settings.currency}
                      </div>
                    </div>
                  </div>
                  <span className="font-bold font-mono-code text-[#172033] text-sm">×{item.quantity}</span>
                </div>
              ))}
            </div>

            {/* Financial Breakdown (Section 4 Requirement) */}
            {(() => {
              const fin = storageService.getOrderFinancialBreakdown(viewOrder.id);
              if (!fin) return null;

              return (
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between font-bold text-[#172033]">
                    <span className="flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-[#2563EB]" />
                      <span>{isRtl ? 'التحليل المالي المعتمد للطلب:' : 'Financial Breakdown:'}</span>
                    </span>
                    {fin.isProfitCalculable ? (
                      <span className="text-xs text-[#16A36A] font-semibold">
                        {isRtl ? 'صافي ربح مؤكد' : 'Verified Net Profit'}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-800 font-semibold">
                        {isRtl ? 'أرباح غير مكتملة الحساب' : 'Uncalculated Profit'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                    <div className="p-2 bg-white rounded-xl border border-slate-200">
                      <span className="text-[#64748B] block text-[10px]">{isRtl ? 'قيمة البيع:' : 'Gross sale:'}</span>
                      <strong className="font-mono-code text-[#172033]">{fin.sellingPriceTotal} ر.س</strong>
                    </div>

                    <div className="p-2 bg-white rounded-xl border border-slate-200">
                      <span className="text-[#64748B] block text-[10px]">{isRtl ? 'عمولة المنصة المقدرة:' : 'Commission:'}</span>
                      <strong className="font-mono-code text-rose-700">-{fin.marketplaceCommission} ر.س</strong>
                    </div>

                    <div className="p-2 bg-white rounded-xl border border-slate-200">
                      <span className="text-[#64748B] block text-[10px]">{isRtl ? 'تكلفة الشحن والتغليف:' : 'Shipping & pack:'}</span>
                      <strong className="font-mono-code text-rose-700">
                        -{(fin.originalShippingFee + fin.packagingCost).toFixed(2)} ر.س
                      </strong>
                    </div>

                    <div className="p-2 bg-white rounded-xl border border-slate-200">
                      <span className="text-[#64748B] block text-[10px]">{isRtl ? 'تكلفة شراء البضاعة:' : 'Cost of Goods:'}</span>
                      {fin.productCostOfGoods !== null ? (
                        <strong className="font-mono-code text-rose-700">-{fin.productCostOfGoods} ر.س</strong>
                      ) : (
                        <span className="text-[10px] text-amber-700 font-bold">{isRtl ? 'غير مسجل' : 'Missing'}</span>
                      )}
                    </div>
                  </div>

                  {fin.isProfitCalculable && fin.confirmedNet !== null ? (
                    <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                      <span className="font-bold text-emerald-900">{isRtl ? 'صافي الربح التقديري المعتمد:' : 'Net Profit:'}</span>
                      <strong className="font-mono-code text-sm font-bold text-[#16A36A]">
                        +{fin.confirmedNet.toFixed(2)} {settings.currency}
                      </strong>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-[#D99A27]" />
                      <span>
                        {fin.uncalculatedReason ||
                          (isRtl
                            ? 'لا يتم حساب الربح الفعلي لأن سعر التكلفة غير مسجل.'
                            : 'Profit cannot be calculated without cost of goods.')}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Close modal */}
            <div className="flex justify-end pt-2 border-t border-[#E8ECF2]">
              <button
                onClick={() => setViewOrder(null)}
                className="px-5 py-2 text-xs font-semibold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer"
              >
                {t.actions.close}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
