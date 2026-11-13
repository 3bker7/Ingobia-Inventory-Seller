import React, { useState } from 'react';
import {
  Home,
  ShoppingCart,
  Boxes,
  Package,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  TrendingUp,
  FileSpreadsheet,
  Settings,
  X,
  FlaskConical,
  Terminal,
} from 'lucide-react';
import { Locale } from '../../locales/translations';
import { storageService } from '../../services/storage';

interface MobileBottomNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  locale: Locale;
  onOpenTestSuite?: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentTab,
  onSelectTab,
  locale,
  onOpenTestSuite,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const isRtl = locale === 'ar';

  const returns = storageService.getActiveReturns();
  const pendingReturnsCount = returns.length;

  const urgentRecs = storageService
    .getMerchantRecommendations()
    .filter((r) => r.priority === 'critical' || r.priority === 'high');

  const mainNavItems = [
    {
      id: 'overview',
      labelAr: 'الرئيسية',
      labelEn: 'Home',
      icon: Home,
    },
    {
      id: 'orders',
      labelAr: 'الطلبات',
      labelEn: 'Orders',
      icon: ShoppingCart,
    },
    {
      id: 'products',
      labelAr: 'المنتجات',
      labelEn: 'Products',
      icon: Boxes,
    },
    {
      id: 'inventory',
      labelAr: 'المخزون',
      labelEn: 'Inventory',
      icon: Package,
    },
  ];

  const moreItems = [
    {
      id: 'returns',
      labelAr: 'إدارة المرتجعات',
      labelEn: 'Returns Management',
      icon: RotateCcw,
      badge: pendingReturnsCount > 0 ? pendingReturnsCount : undefined,
      color: 'text-[#DC5555]',
    },
    {
      id: 'guidance',
      labelAr: 'دليل التاجر الذكي (Advisor)',
      labelEn: 'Merchant Guidance (Advisor)',
      icon: Sparkles,
      badge: urgentRecs.length > 0 ? urgentRecs.length : undefined,
      color: 'text-[#2563EB]',
    },
    {
      id: 'completed_orders',
      labelAr: 'الطلبات المكتملة بنجاح',
      labelEn: 'Completed Orders',
      icon: CheckCircle2,
      color: 'text-[#16A36A]',
    },
    {
      id: 'price_history',
      labelAr: 'سجل وتاريخ الأسعار',
      labelEn: 'Price History',
      icon: TrendingUp,
      color: 'text-[#D99A27]',
    },
    {
      id: 'smart_import',
      labelAr: 'الاستيراد الذكي للطلبات',
      labelEn: 'Smart Order Import',
      icon: FileSpreadsheet,
      color: 'text-indigo-600',
    },
    {
      id: 'excel',
      labelAr: 'استيراد إكسل للمنتجات',
      labelEn: 'Excel Product Import',
      icon: FileSpreadsheet,
      color: 'text-emerald-700',
    },
    {
      id: 'settings',
      labelAr: 'إعدادات المتجر والحساب',
      labelEn: 'Settings',
      icon: Settings,
      color: 'text-[#64748B]',
    },
    {
      id: 'developerCenter',
      labelAr: 'مركز المطورين (تصدير نصي)',
      labelEn: 'Developer Center (Export)',
      icon: Terminal,
      color: 'text-purple-600',
    },
  ];

  return (
    <>
      {/* Expandable "More" sheet on mobile */}
      {isMoreOpen && (
        <div className="fixed inset-0 z-50 bg-[#172033]/60 backdrop-blur-xs flex flex-col justify-end lg:hidden animate-in fade-in duration-150">
          <div
            className="fixed inset-0"
            onClick={() => setIsMoreOpen(false)}
          />

          <div className="bg-white rounded-t-3xl border-t border-[#E8ECF2] shadow-2xl p-5 relative z-10 space-y-4 max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8ECF2]">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[#172033]">
                  {isRtl ? 'الأقسام الإضافية والعمليات' : 'More Modules & Tools'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsMoreOpen(false)}
                className="p-1.5 text-[#64748B] hover:text-[#172033] rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const isCurrent = currentTab === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id);
                      setIsMoreOpen(false);
                    }}
                    className={`p-3 rounded-2xl border text-start transition-all flex items-start gap-2.5 relative cursor-pointer ${
                      isCurrent
                        ? 'border-[#2563EB] bg-blue-50/60 shadow-xs'
                        : 'border-[#E8ECF2] bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className={`p-2 rounded-xl bg-slate-50 ${item.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-xs text-[#172033] truncate">
                        {isRtl ? item.labelAr : item.labelEn}
                      </div>
                      <span className="text-[10px] text-[#64748B] block mt-0.5">
                        {item.id === 'returns' ? (isRtl ? 'مستودع وفحص' : 'Custody') : (isRtl ? 'إدارة' : 'Manage')}
                      </span>
                    </div>

                    {item.badge !== undefined && (
                      <span className="absolute top-2.5 end-2.5 px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[#DC5555] text-white font-mono-code">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Test suite button in More sheet */}
            {onOpenTestSuite && (
              <button
                type="button"
                onClick={() => {
                  setIsMoreOpen(false);
                  onOpenTestSuite();
                }}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-[#172033] rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <FlaskConical className="w-4 h-4 text-purple-600" />
                <span>{isRtl ? 'تشغيل حزمة اختبارات منطق العمليات' : 'Run In-App Logic Test Suite'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Fixed Bottom Bar on Mobile */}
      <nav className="fixed bottom-0 start-0 end-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E8ECF2] shadow-lg lg:hidden px-2 py-1.5">
        <div className="flex items-center justify-around">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isCurrent = currentTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setIsMoreOpen(false);
                  onSelectTab(item.id);
                }}
                className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all cursor-pointer relative ${
                  isCurrent
                    ? 'text-[#2563EB] font-bold'
                    : 'text-[#64748B] hover:text-[#172033]'
                }`}
              >
                <div
                  className={`p-1 rounded-xl transition-colors ${
                    isCurrent ? 'bg-blue-50 text-[#2563EB]' : 'text-[#64748B]'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] mt-0.5 tracking-tight">
                  {isRtl ? item.labelAr : item.labelEn}
                </span>

                {isCurrent && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] mt-0.5" />
                )}
              </button>
            );
          })}

          {/* Quick Returns shortcut button if active */}
          <button
            type="button"
            onClick={() => {
              setIsMoreOpen(false);
              onSelectTab('returns');
            }}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all cursor-pointer relative ${
              currentTab === 'returns'
                ? 'text-[#DC5555] font-bold'
                : 'text-[#64748B] hover:text-[#172033]'
            }`}
          >
            <div
              className={`p-1 rounded-xl transition-colors relative ${
                currentTab === 'returns' ? 'bg-rose-50 text-[#DC5555]' : 'text-[#64748B]'
              }`}
            >
              <RotateCcw className="w-5 h-5" />
              {pendingReturnsCount > 0 && (
                <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-[#DC5555] text-white text-[9px] font-bold flex items-center justify-center font-mono-code">
                  {pendingReturnsCount}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight">
              {isRtl ? 'المرتجعات' : 'Returns'}
            </span>
            {currentTab === 'returns' && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#DC5555] mt-0.5" />
            )}
          </button>

          {/* More button */}
          <button
            type="button"
            onClick={() => setIsMoreOpen((prev) => !prev)}
            className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all cursor-pointer ${
              isMoreOpen
                ? 'text-[#2563EB] font-bold'
                : 'text-[#64748B] hover:text-[#172033]'
            }`}
          >
            <div className={`p-1 rounded-xl ${isMoreOpen ? 'bg-blue-50 text-[#2563EB]' : ''}`}>
              <MoreHorizontal className="w-5 h-5" />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight">
              {isRtl ? 'المزيد' : 'More'}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
};
