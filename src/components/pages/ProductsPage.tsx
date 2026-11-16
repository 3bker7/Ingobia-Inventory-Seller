import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Boxes,
  ArrowUpDown,
  Filter,
  Eye,
  Tag,
  LayoutGrid,
  Table as TableIcon,
  CheckCircle2,
  AlertTriangle,
  Info,
  DollarSign,
  Star,
  ShoppingBag,
  ExternalLink,
  ShieldCheck,
  Package,
} from 'lucide-react';
import { Product, MarketplaceId } from '../../types';
import { storageService } from '../../services/storage';
import { computeEditedAvailableStock, getTotalPlatformAllocatedStock } from '../../domain/inventoryCustody';
import { resolveSafeProductImage } from '../../utils/productVisual';
import { translations, Locale } from '../../locales/translations';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useToast } from '../common/Toast';

interface ProductsPageProps {
  locale: Locale;
  isAddModalOpenInitially?: boolean;
  onCloseInitialAddModal?: () => void;
  onDataChange?: () => void;
}

export const ProductsPage: React.FC<ProductsPageProps> = ({
  locale,
  isAddModalOpenInitially = false,
  onCloseInitialAddModal,
  onDataChange,
}) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();
  const isRtl = locale === 'ar';

  const activeMarketplaces = storageService.getActiveMarketplaces();
  const allMarketplaces = storageService.getAllMarketplaces();

  const [products, setProducts] = useState<Product[]>(() => storageService.getProducts());
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'low' | 'out'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'storefront' | 'table'>('storefront');
  const [sortField, setSortField] = useState<'name' | 'physicalStock' | 'price' | 'sku'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(isAddModalOpenInitially);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);

  // Add / Edit form state
  const [formName, setFormName] = useState('');
  const [formNameAr, setFormNameAr] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formCategory, setFormCategory] = useState('Electronics');
  const [formBaseCost, setFormBaseCost] = useState<number>(0);
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formPhysicalStock, setFormPhysicalStock] = useState<number>(10);
  const [formMarketplacePrices, setFormMarketplacePrices] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    storageService.getActiveMarketplaces().forEach((m) => {
      initial[m.id] = 100;
    });
    return initial;
  });

  const refreshProducts = () => {
    setProducts(storageService.getProducts());
    onDataChange?.();
  };

  // Distinct categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        const query = searchQuery.trim().toLowerCase();
        const matchesSearch =
          !query ||
          p.name.toLowerCase().includes(query) ||
          (p.nameAr && p.nameAr.toLowerCase().includes(query)) ||
          (p.sku && p.sku.toLowerCase().includes(query)) ||
          (p.category && p.category.toLowerCase().includes(query));

        if (!matchesSearch) return false;

        if (categoryFilter !== 'all' && p.category !== categoryFilter) {
          return false;
        }

        if (stockFilter === 'in_stock') return p.availableStock > 0;
        if (stockFilter === 'low') return p.availableStock > 0 && p.availableStock <= 5;
        if (stockFilter === 'out') return p.availableStock === 0;

        return true;
      })
      .sort((a, b) => {
        if (sortField === 'name') {
          return sortAsc
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        }
        if (sortField === 'physicalStock') {
          return sortAsc
            ? a.availableStock - b.availableStock
            : b.availableStock - a.availableStock;
        }
        if (sortField === 'price') {
          return sortAsc
            ? a.currentPrice - b.currentPrice
            : b.currentPrice - a.currentPrice;
        }
        return sortAsc
          ? (a.sku || '').localeCompare(b.sku || '')
          : (b.sku || '').localeCompare(a.sku || '');
      });
  }, [products, searchQuery, stockFilter, categoryFilter, sortField, sortAsc]);

  const handleOpenAdd = () => {
    setFormName('');
    setFormNameAr('');
    setFormSku(`SKU-${Math.floor(1000 + Math.random() * 9000)}`);
    setFormCategory('Electronics');
    setFormBaseCost(50);
    setFormImageUrl('');
    setFormPhysicalStock(20);
    const prices: Record<string, number> = {};
    activeMarketplaces.forEach((m) => {
      prices[m.id] = 100;
    });
    setFormMarketplacePrices(prices);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (p: Product) => {
    setFormName(p.name);
    setFormNameAr(p.nameAr || '');
    setFormSku(p.sku || '');
    setFormCategory(p.category || 'General');
    setFormBaseCost(p.baseCost || 0);
    setFormImageUrl(p.imageUrl && !p.imageUrl.startsWith('data:image/svg+xml') ? p.imageUrl : '');
    setFormPhysicalStock(p.physicalStock);
    const prices: Record<string, number> = {};
    activeMarketplaces.forEach((m) => {
      prices[m.id] = p.marketplaceListings[m.id]?.price ?? p.currentPrice ?? 0;
    });
    setFormMarketplacePrices(prices);
    setEditingProduct(p);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!formName.trim()) {
      showToast(isRtl ? 'يرجى إدخال اسم المنتج.' : 'Product name is required.', 'warning');
      return;
    }

    const targetPhysical = Math.floor(Number(formPhysicalStock));
    if (!Number.isFinite(targetPhysical) || targetPhysical < 0) {
      showToast(isRtl ? 'المخزون الفعلي يجب أن يكون رقماً صحيحاً أكبر من أو يساوي 0.' : 'Physical stock must be >= 0.', 'warning');
      return;
    }

    let availableStock = targetPhysical;
    if (editingProduct) {
      const custodyCheck = computeEditedAvailableStock(editingProduct, targetPhysical);
      if (!custodyCheck.valid) {
        showToast(custodyCheck.error || (isRtl ? 'لا يمكن خفض المخزون عن الوحدات المحجوزة أو التالفة.' : 'Cannot reduce stock below locked custody.'), 'error');
        return;
      }
      availableStock = custodyCheck.newAvailable;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const safeImage = resolveSafeProductImage(formImageUrl, formName.trim(), formCategory.trim());
      const listings: Product['marketplaceListings'] = {
        ...(editingProduct?.marketplaceListings || {}),
      };

      activeMarketplaces.forEach((mkt) => {
        const priceVal = Math.max(0, Number(formMarketplacePrices[mkt.id]) || 0);
        const existingListing = listings[mkt.id];
        const allocatedAvail = editingProduct?.platformAllocations?.[mkt.id]?.availableQty;
        const nextQty = typeof allocatedAvail === 'number'
          ? allocatedAvail
          : existingListing?.quantity ?? 0;

        listings[mkt.id] = {
          marketplaceId: mkt.id,
          price: priceVal,
          quantity: nextQty,
          listingStatus: availableStock > 0 ? 'active' : 'out_of_stock',
          lastUpdated: nowIso,
        };
      });

      const activePrices = activeMarketplaces
        .map((m) => Number(formMarketplacePrices[m.id]) || 0)
        .filter((v) => v > 0);
      const fallbackPrice = activePrices[0] ?? editingProduct?.currentPrice ?? 0;

      if (editingProduct) {
        for (const mkt of activeMarketplaces) {
          const nextPrice = Math.max(0, Number(formMarketplacePrices[mkt.id]) || 0);
          const prevPrice = editingProduct.marketplaceListings[mkt.id]?.price;
          if (prevPrice !== undefined && prevPrice !== nextPrice) {
            const priceRes = storageService.updateProductPriceWithResult(
              editingProduct.id,
              mkt.id,
              nextPrice,
              `تعديل سعر ${mkt.nameAr} في نموذج المنتج`,
              settings.sellerName
            );
            if (!priceRes.success) {
              showToast(priceRes.error || t.toasts.error, 'error');
              return;
            }
          }
        }

        const physicalDiff = targetPhysical - editingProduct.physicalStock;
        const updated: Product = {
          ...editingProduct,
          name: formName.trim(),
          nameAr: formNameAr.trim() || undefined,
          sku: formSku.trim() || editingProduct.sku,
          category: formCategory.trim() || editingProduct.category,
          baseCost: Number(formBaseCost) || undefined,
          imageUrl: safeImage,
          currentPrice: fallbackPrice,
          physicalStock: targetPhysical,
          availableStock,
          marketplaceListings: listings,
        };

        const saveRes = storageService.saveProduct(updated);
        if (!saveRes.success) {
          showToast(saveRes.error || t.toasts.error, 'error');
          return;
        }

        if (physicalDiff !== 0) {
          const movRes = storageService.recordStockMovements([
            {
              id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              productId: updated.id,
              productSku: updated.sku || updated.name,
              productName: updated.name,
              source: physicalDiff > 0 ? 'external' : 'central_available',
              destination: physicalDiff > 0 ? 'central_available' : 'external',
              type: 'manual_adjustment',
              quantityChange: physicalDiff,
              previousPhysical: editingProduct.physicalStock,
              newPhysical: updated.physicalStock,
              previousAvailable: editingProduct.availableStock,
              newAvailable: updated.availableStock,
              reason: 'تعديل رصيد المخزون من بطاقة المنتج',
              operator: settings.sellerName,
              timestamp: nowIso,
            },
          ]);
          if (!movRes.success) {
            showToast(movRes.error || t.toasts.error, 'error');
            return;
          }
        }

        showToast(t.toasts.productUpdated, 'success');
        setEditingProduct(null);
      } else {
        const newSku = formSku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
        const newProd: Product = {
          id: `prod-${Date.now()}`,
          sku: newSku,
          name: formName.trim(),
          nameAr: formNameAr.trim() || undefined,
          category: formCategory.trim() || 'General',
          baseCost: Number(formBaseCost) || undefined,
          imageUrl: safeImage,
          currentPrice: fallbackPrice,
          physicalStock: targetPhysical,
          availableStock: targetPhysical,
          centralAvailableStock: targetPhysical,
          centralReservedStock: 0,
          reservedStock: 0,
          platformAllocations: {},
          awaitingInspectionStock: 0,
          damagedStock: 0,
          rejectedResaleStock: 0,
          outboundInTransitStock: 0,
          returnInTransitStock: 0,
          marketplaceListings: listings,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        const saveRes = storageService.saveProduct(newProd);
        if (!saveRes.success) {
          showToast(saveRes.error || t.toasts.error, 'error');
          return;
        }
        showToast(t.toasts.productAdded, 'success');
        setIsAddModalOpen(false);
        if (onCloseInitialAddModal) onCloseInitialAddModal();
      }

      refreshProducts();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = () => {
    if (!productToDelete || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const delRes = storageService.deleteProduct(productToDelete.id);
      if (!delRes.success) {
        showToast(delRes.error || t.toasts.error, 'error');
        return;
      }
      showToast(t.toasts.productDeleted, 'success');
      setProductToDelete(null);
      refreshProducts();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Top Controls Toolbar */}
      <div className="bg-white p-4 rounded-3xl border border-[#E8ECF2] shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="w-4 h-4 text-[#64748B] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isRtl ? 'بحث بالاسم، رمز SKU، أو الفئة...' : 'Search by name, SKU, category...'}
            className="w-full ps-9 pe-3 py-2 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
          />
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 bg-[#F7F8FA] p-1 rounded-2xl border border-[#E8ECF2]">
          <button
            type="button"
            onClick={() => setViewMode('storefront')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              viewMode === 'storefront'
                ? 'bg-white text-[#2563EB] shadow-xs'
                : 'text-[#64748B] hover:text-[#172033]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>{isRtl ? 'معاينة المتجر' : 'Storefront Preview'}</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              viewMode === 'table'
                ? 'bg-white text-[#2563EB] shadow-xs'
                : 'text-[#64748B] hover:text-[#172033]'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>{isRtl ? 'جدول المخزون' : 'Inventory Table'}</span>
          </button>
        </div>

        {/* Category & Stock Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="all">{isRtl ? 'جميع الفئات' : 'All Categories'}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as any)}
            className="px-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{isRtl ? 'جميع حالات التوفر' : 'All Availability'}</option>
            <option value="in_stock">{isRtl ? 'متوفر للبيع (>0)' : 'In Stock'}</option>
            <option value="low">{isRtl ? 'مخزون منخفض (≤5)' : 'Low Stock (≤5)'}</option>
            <option value="out">{isRtl ? 'نافد من المستودع' : 'Out of Stock'}</option>
          </select>

          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-xs shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{t.products.addNewProductBtn}</span>
          </button>
        </div>
      </div>

      {/* VIEW MODE 1: STOREFRONT PREVIEW (Section 7.1) */}
      {viewMode === 'storefront' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.length === 0 ? (
            <div className="col-span-full py-16 bg-white rounded-3xl border border-[#E8ECF2] text-center text-[#64748B]">
              <Boxes className="w-12 h-12 mx-auto text-[#64748B]/40 mb-3" />
              <h3 className="text-sm font-bold text-[#172033]">{t.products.noProducts}</h3>
              <p className="text-xs text-[#64748B] mt-1">
                {isRtl ? 'جرب تغيير عبارة البحث أو الفلتر أعلاه.' : 'Try adjusting your search filters.'}
              </p>
            </div>
          ) : (
            filteredProducts.map((p) => {
              const audit = storageService.auditProduct(p);
              const isLowStock = p.availableStock <= 5 && p.availableStock > 0;
              const isOutOfStock = p.availableStock === 0;

              return (
                <div
                  key={p.id}
                  onClick={() => setPreviewProduct(p)}
                  className="bg-white rounded-3xl border border-[#E8ECF2] hover:border-blue-300 hover:shadow-md transition-all overflow-hidden flex flex-col group cursor-pointer"
                >
                  {/* Product Image Frame */}
                  <div className="relative aspect-4/3 bg-slate-50 overflow-hidden border-b border-[#E8ECF2]">
                    <img
                      src={resolveSafeProductImage(p.imageUrl, p.name, p.category)}
                      alt={p.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    {/* Category pill */}
                    {p.category && (
                      <span className="absolute top-3 start-3 px-2.5 py-1 rounded-full text-[10px] font-bold bg-white/90 text-[#172033] backdrop-blur-xs shadow-2xs border border-[#E8ECF2]">
                        {p.category}
                      </span>
                    )}

                    {/* Stock Status Badge */}
                    <div className="absolute top-3 end-3">
                      {isOutOfStock ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-[#DC5555] border border-rose-200 shadow-2xs">
                          {isRtl ? 'نافد' : 'Sold Out'}
                        </span>
                      ) : isLowStock ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-[#D99A27] border border-amber-200 shadow-2xs">
                          {isRtl ? `متبقي ${p.availableStock} قطع` : `${p.availableStock} left`}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-[#16A36A] border border-emerald-200 shadow-2xs">
                          {isRtl ? `${p.availableStock} متاح` : `${p.availableStock} in stock`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body Details */}
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-[#64748B] font-mono-code">
                        <span>SKU: {p.sku || 'N/A'}</span>
                        <div className="flex items-center gap-1 text-[#64748B] font-sans">
                          <span>
                            {isRtl
                              ? `مركزي ${p.centralAvailableStock ?? p.availableStock} / مخصص ${getTotalPlatformAllocatedStock(p)}`
                              : `Central ${p.centralAvailableStock ?? p.availableStock} / Alloc ${getTotalPlatformAllocatedStock(p)}`}
                          </span>
                        </div>
                      </div>

                      <h3 className="font-bold text-sm text-[#172033] line-clamp-2 leading-snug group-hover:text-[#2563EB] transition-colors">
                        {isRtl && p.nameAr ? p.nameAr : p.name}
                      </h3>
                    </div>

                    {/* Marketplace Prices & Quality Score */}
                    <div className="pt-2 border-t border-[#E8ECF2] space-y-2">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <span className="text-[10px] text-[#64748B] block">
                            {isRtl ? 'سعر البيع المرجعي:' : 'Retail Price:'}
                          </span>
                          <strong className="text-base font-bold text-[#172033] font-mono-code tabular-nums">
                            {p.currentPrice.toFixed(2)} {settings.currency}
                          </strong>
                        </div>

                        {/* Quality pill */}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            audit.qualityScore >= 80
                              ? 'bg-emerald-50 text-[#16A36A] border-emerald-200'
                              : 'bg-amber-50 text-[#D99A27] border-amber-200'
                          }`}
                        >
                          {audit.qualityScore}% {isRtl ? 'جودة العرض' : 'quality'}
                        </span>
                      </div>

                      {/* Marketplace Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {Object.values(p.marketplaceListings || {}).map((listing) => {
                          const mkt = allMarketplaces.find((m) => m.id === listing.marketplaceId);
                          const isDisabledMkt = mkt ? !mkt.isActive : true;
                          return (
                            <span
                              key={listing.marketplaceId}
                              className="px-2 py-0.5 rounded text-[10px] font-mono-code font-bold border"
                              style={{
                                backgroundColor: isDisabledMkt ? '#F1F5F9' : mkt?.badgeBg || '#F1F5F9',
                                color: isDisabledMkt ? '#475569' : mkt?.badgeText || '#475569',
                                borderColor: '#E2E8F0',
                              }}
                            >
                              {mkt ? (isRtl ? mkt.nameAr : mkt.nameEn) : listing.marketplaceId}
                              {isDisabledMkt ? (isRtl ? ' [معطلة]' : ' [Disabled]') : ''}: {listing.price} {settings.currency}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW MODE 2: INVENTORY & PRICING TABLE */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-3xl border border-[#E8ECF2] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold select-none">
                  <th className="py-3.5 px-4 text-start">{t.products.productColumn}</th>
                  <th className="py-3.5 px-3 text-start">SKU</th>
                  <th className="py-3.5 px-3 text-start">{isRtl ? 'سعر التكلفة' : 'Base Cost'}</th>
                  {activeMarketplaces.map((mkt) => (
                    <th key={mkt.id} className="py-3.5 px-3 text-start whitespace-nowrap">
                      {isRtl ? `سعر ${mkt.nameAr}` : `${mkt.nameEn} Price`}
                    </th>
                  ))}
                  <th className="py-3.5 px-3 text-center">{isRtl ? 'مركزي متاح' : 'Central Avail.'}</th>
                  <th className="py-3.5 px-3 text-center">{isRtl ? 'مخصص للمنصات' : 'Allocated'}</th>
                  <th className="py-3.5 px-3 text-center">{isRtl ? 'المحجوز' : 'Reserved'}</th>
                  <th className="py-3.5 px-3 text-center">{isRtl ? 'في الطريق' : 'In Transit'}</th>
                  <th className="py-3.5 px-3 text-center">{isRtl ? 'المستودع الفعلي' : 'Warehouse Physical'}</th>
                  <th className="py-3.5 px-4 text-center w-36">{t.orders.actions}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#E8ECF2]">
                {filteredProducts.map((p) => {
                  const totalAllocated = getTotalPlatformAllocatedStock(p);

                  return (
                    <tr key={p.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={resolveSafeProductImage(p.imageUrl, p.name, p.category)}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-lg object-cover border border-[#E8ECF2] shrink-0"
                          />
                          <div className="min-w-0 max-w-[220px]">
                            <div className="font-bold text-[#172033] truncate">
                              {isRtl && p.nameAr ? p.nameAr : p.name}
                            </div>
                            <div className="text-[10px] text-[#64748B]">{p.category || 'General'}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 font-mono-code text-[11px] font-bold text-[#172033]">
                        {p.sku}
                      </td>

                      <td className="py-3.5 px-3 font-mono-code text-[11px] text-[#64748B] tabular-nums">
                        {p.baseCost ? `${p.baseCost} ${settings.currency}` : <span className="text-amber-700">{isRtl ? 'غير مسجل' : 'Missing'}</span>}
                      </td>

                      {activeMarketplaces.map((mkt) => {
                        const listing = p.marketplaceListings[mkt.id];
                        return (
                          <td key={mkt.id} className="py-3.5 px-3 font-mono-code text-[11px] font-semibold text-[#172033] tabular-nums">
                            {listing ? `${listing.price} ${settings.currency}` : '-'}
                          </td>
                        );
                      })}

                      <td className="py-3.5 px-3 text-center font-bold font-mono-code text-[#16A36A] tabular-nums">
                        {p.centralAvailableStock ?? p.availableStock}
                      </td>

                      <td className="py-3.5 px-3 text-center font-mono-code text-[#2563EB] tabular-nums">
                        {totalAllocated}
                      </td>

                      <td className="py-3.5 px-3 text-center font-mono-code text-[#D99A27] tabular-nums">
                        {p.reservedStock}
                      </td>

                      <td className="py-3.5 px-3 text-center font-mono-code text-[#2563EB] tabular-nums">
                        {(p.outboundInTransitStock || 0) + (p.returnInTransitStock || 0)}
                      </td>

                      <td className="py-3.5 px-3 text-center font-bold font-mono-code text-[#172033] tabular-nums">
                        {p.physicalStock}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setPreviewProduct(p)}
                            className="p-1.5 text-[#64748B] hover:text-[#2563EB] hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title={isRtl ? 'معاينة المتجر' : 'Preview'}
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(p)}
                            className="p-1.5 text-[#64748B] hover:text-[#172033] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title={isRtl ? 'تعديل' : 'Edit'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setProductToDelete(p)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title={isRtl ? 'حذف' : 'Delete'}
                          >
                            <Trash2 className="w-4 h-4" />
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
      )}

      {/* CUSTOMER-STYLE PRODUCT PREVIEW & QUALITY AUDIT MODAL (Section 7.2) */}
      <Modal
        isOpen={previewProduct !== null}
        onClose={() => setPreviewProduct(null)}
        title={isRtl ? 'معاينة المنتج كمتسوق وفحص الجودة' : 'Storefront Preview & Quality Audit'}
        subtitle={previewProduct ? `${previewProduct.name} (${previewProduct.sku})` : ''}
        maxWidth="lg"
      >
        {previewProduct && (
          <div className="space-y-4 text-xs">
            {/* Split layout: Customer storefront view on left, Merchant audit on right */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Customer View (7 cols) */}
              <div className="md:col-span-7 space-y-3">
                <div className="aspect-4/3 rounded-2xl bg-slate-50 overflow-hidden border border-[#E8ECF2]">
                  <img
                    src={resolveSafeProductImage(previewProduct.imageUrl, previewProduct.name, previewProduct.category)}
                    alt={previewProduct.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-[#64748B]">
                      {previewProduct.category || 'General'}
                    </span>
                    <span className="font-mono-code text-[11px] text-[#64748B]">
                      SKU: {previewProduct.sku}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-[#172033]">
                    {isRtl && previewProduct.nameAr ? previewProduct.nameAr : previewProduct.name}
                  </h3>

                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="text-xl font-black text-[#172033] font-mono-code tabular-nums">
                      {previewProduct.currentPrice.toFixed(2)} {settings.currency}
                    </span>
                    <span className="text-xs text-emerald-700 font-bold">
                      {previewProduct.availableStock > 0
                        ? isRtl
                          ? `متوفر (${previewProduct.availableStock} قطعة: مركزي ${previewProduct.centralAvailableStock ?? previewProduct.availableStock})`
                          : `In Stock (${previewProduct.availableStock} total / Central ${previewProduct.centralAvailableStock ?? previewProduct.availableStock})`
                        : isRtl
                        ? 'نافد حالياً'
                        : 'Out of Stock'}
                    </span>
                  </div>

                  {/* Channel specific prices */}
                  <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E8ECF2] space-y-1.5">
                    <span className="text-[10px] font-bold text-[#64748B] block">
                      {isRtl ? 'الأسعار والقوائم المتزامنة عبر المنصات:' : 'Channel Listings:'}
                    </span>
                    <div className="space-y-1">
                      {Object.values(previewProduct.marketplaceListings || {}).map((m) => {
                        const mkt = allMarketplaces.find((item) => item.id === m.marketplaceId);
                        const isDisabled = mkt ? !mkt.isActive : true;
                        return (
                          <div key={m.marketplaceId} className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-[#172033]">
                              {mkt ? (isRtl ? mkt.nameAr : mkt.nameEn) : m.marketplaceId}
                              {isDisabled ? (isRtl ? ' [معطلة]' : ' [Disabled]') : ''}
                            </span>
                            <span className="font-mono-code font-bold text-[#2563EB] tabular-nums">
                              {m.price} {settings.currency}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Merchant Quality Review Panel (5 cols) */}
              <div className="md:col-span-5 space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#172033] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#2563EB]" />
                    <span>{isRtl ? 'لوحة فحص جودة الإدراج' : 'Listing Quality Audit'}</span>
                  </span>

                  {(() => {
                    const audit = storageService.auditProduct(previewProduct);
                    return (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-[#16A36A] font-mono-code">
                        {audit.qualityScore}%
                      </span>
                    );
                  })()}
                </div>

                {/* Audit points checklist */}
                {(() => {
                  const audit = storageService.auditProduct(previewProduct);
                  return (
                    <div className="space-y-2">
                      {audit.issues.length === 0 ? (
                        <div className="p-3 bg-emerald-50 text-emerald-900 rounded-xl text-[11px] flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-[#16A36A] shrink-0" />
                          <span>{isRtl ? 'بيانات المنتج مكتملة ومثالية للعرض.' : 'Product listing is complete and ready.'}</span>
                        </div>
                      ) : (
                        audit.issues.map((iss, i) => (
                          <div
                            key={i}
                            className={`p-2.5 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2 ${
                              iss.type === 'critical'
                                ? 'bg-rose-50 border-rose-200 text-rose-950'
                                : iss.type === 'warning'
                                ? 'bg-amber-50 border-amber-200 text-amber-950'
                                : 'bg-blue-50 border-blue-200 text-blue-950'
                            }`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{isRtl ? iss.messageAr : iss.messageEn}</span>
                          </div>
                        ))
                      )}

                      {/* Financial info */}
                      <div className="pt-2 border-t border-slate-200 space-y-1 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[#64748B]">{isRtl ? 'سعر التكلفة المسجل:' : 'Recorded Base Cost:'}</span>
                          <strong className="font-mono-code text-[#172033]">
                            {previewProduct.baseCost ? `${previewProduct.baseCost} ${settings.currency}` : (
                              <span className="text-amber-800 font-bold">{isRtl ? 'غير محدد' : 'Missing'}</span>
                            )}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#64748B]">{isRtl ? 'هامش الربح التقديري:' : 'Estimated Margin:'}</span>
                          <strong className="font-mono-code text-[#16A36A]">
                            {previewProduct.baseCost
                              ? `${((previewProduct.currentPrice - previewProduct.baseCost) / previewProduct.currentPrice * 100).toFixed(1)}%`
                              : '-'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <button
                  type="button"
                  onClick={() => {
                    const p = previewProduct;
                    setPreviewProduct(null);
                    handleOpenEdit(p);
                  }}
                  className="w-full py-2 text-xs font-bold text-[#2563EB] bg-white hover:bg-blue-50 border border-blue-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'تعديل بيانات المنتج وسعر التكلفة' : 'Edit Product & Base Cost'}</span>
                </button>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                onClick={() => setPreviewProduct(null)}
                className="px-5 py-2 text-xs font-semibold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer"
              >
                {t.actions.close}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ADD / EDIT PRODUCT MODAL */}
      <Modal
        isOpen={isAddModalOpen || editingProduct !== null}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingProduct(null);
          if (onCloseInitialAddModal) onCloseInitialAddModal();
        }}
        title={editingProduct ? t.products.editProductModalTitle : t.products.addProductModalTitle}
        maxWidth="md"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.products.productColumn} (English) *
            </label>
            <input
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Smart Watch Series 8 Ultra"
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              اسم المنتج بالعربية (اختياري)
            </label>
            <input
              type="text"
              value={formNameAr}
              onChange={(e) => setFormNameAr(e.target.value)}
              placeholder="مثال: ساعة ذكية ألترا سيريز 8"
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                رمز SKU التعريفي *
              </label>
              <input
                type="text"
                required
                value={formSku}
                onChange={(e) => setFormSku(e.target.value)}
                placeholder="ELEC-WATCH-01"
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] font-mono-code font-bold"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {isRtl ? 'الفئة / التصنيف:' : 'Category:'}
              </label>
              <input
                type="text"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                placeholder="Electronics, Home..."
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {isRtl ? 'سعر التكلفة (Base Cost):' : 'Base Cost:'}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formBaseCost}
                onChange={(e) => setFormBaseCost(parseFloat(e.target.value) || 0)}
                placeholder="180"
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] font-mono-code"
              />
              <span className="text-[10px] text-[#64748B] block mt-0.5">
                {isRtl ? 'ضروري لاحتساب الأرباح الحقيقية' : 'Needed for profit calculation'}
              </span>
            </div>

            <div>
              <label className="block font-semibold text-[#172033] mb-1">
                {isRtl ? 'إجمالي المخزون بالمستودع:' : 'Warehouse physical stock:'}
              </label>
              <input
                type="number"
                min="0"
                required
                value={formPhysicalStock}
                onChange={(e) => setFormPhysicalStock(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] font-bold font-mono-code"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {isRtl ? 'رابط صورة المنتج (اختياري — يتم إنشاء أيقونة تلقائية عند الترك فارغاً)' : 'Product Image URL (Optional)'}
            </label>
            <input
              type="text"
              value={formImageUrl}
              onChange={(e) => setFormImageUrl(e.target.value)}
              placeholder="https://... (اختياري)"
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033]"
            />
          </div>

          <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-[#E8ECF2] space-y-3">
            <span className="font-bold text-[#172033] block">
              {isRtl ? 'تسعير المنصات المفعّلة:' : 'Active Marketplace Prices:'}
            </span>

            {activeMarketplaces.length === 0 ? (
              <p className="text-[11px] text-amber-800">
                {isRtl ? 'لا توجد منصات بيع مفعّلة في الإعدادات حالياً.' : 'No active marketplaces enabled in Settings.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeMarketplaces.map((mkt) => (
                  <div key={mkt.id}>
                    <label className="block text-[11px] text-[#64748B] mb-1">
                      {isRtl ? `${mkt.nameAr} (سعر البيع):` : `${mkt.nameEn} Price:`}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formMarketplacePrices[mkt.id] ?? 0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setFormMarketplacePrices((prev) => ({ ...prev, [mkt.id]: val }));
                      }}
                      className="w-full px-3 py-1.5 bg-white border border-[#E8ECF2] rounded-xl font-mono-code font-bold"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E8ECF2]">
            <button
              type="button"
              onClick={() => {
                setIsAddModalOpen(false);
                setEditingProduct(null);
                if (onCloseInitialAddModal) onCloseInitialAddModal();
              }}
              className="px-4 py-2 text-xs font-semibold text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {t.actions.cancel}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
            >
              {t.actions.save}
            </button>
          </div>
        </form>
      </Modal>

      {/* CONFIRM DELETE DIALOG */}
      <ConfirmDialog
        isOpen={productToDelete !== null}
        onClose={() => setProductToDelete(null)}
        onConfirm={handleDeleteConfirm}
        title={t.products.deleteConfirmTitle}
        description={
          productToDelete
            ? `${t.products.deleteConfirmDesc} "${productToDelete.name}" (${productToDelete.sku})؟`
            : ''
        }
        confirmText={t.actions.delete}
        cancelText={t.actions.cancel}
        isDestructive
      />
    </div>
  );
};
