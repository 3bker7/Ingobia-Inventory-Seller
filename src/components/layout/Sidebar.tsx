import React from 'react';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  CheckCircle2,
  Boxes,
  RotateCcw,
  History,
  FileSpreadsheet,
  Settings,
  Store,
  ChevronLeft,
  ChevronRight,
  Globe,
  Sparkles,
  FlaskConical,
  Terminal,
} from 'lucide-react';
import { translations, Locale } from '../../locales/translations';
import { storageService } from '../../services/storage';

export type ActiveTab =
  | 'overview'
  | 'products'
  | 'orders'
  | 'completedOrders'
  | 'inventory'
  | 'returns'
  | 'guidance'
  | 'priceHistory'
  | 'excelImport'
  | 'smartImport'
  | 'settings'
  | 'developerCenter';

interface SidebarProps {
  currentTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  locale: Locale;
  onToggleLocale: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeOrdersCount: number;
  pendingReturnsCount: number;
  onOpenTestSuite?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  locale,
  onToggleLocale,
  isCollapsed,
  onToggleCollapse,
  activeOrdersCount,
  pendingReturnsCount,
  onOpenTestSuite,
}) => {
  const t = translations[locale];
  const settings = storageService.getSettings();

  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    badgeText?: string;
    badgeColor?: string;
  }[] = [
    {
      id: 'overview',
      label: t.nav.overview,
      icon: LayoutDashboard,
    },
    {
      id: 'products',
      label: t.nav.products,
      icon: Package,
    },
    {
      id: 'orders',
      label: t.nav.orders,
      icon: ShoppingCart,
      badge: activeOrdersCount > 0 ? activeOrdersCount : undefined,
      badgeColor: 'bg-blue-50 text-[#2563EB]',
    },
    {
      id: 'completedOrders',
      label: t.nav.completedOrders,
      icon: CheckCircle2,
    },
    {
      id: 'inventory',
      label: t.nav.inventory,
      icon: Boxes,
    },
    {
      id: 'returns',
      label: t.nav.returns,
      icon: RotateCcw,
      badge: pendingReturnsCount > 0 ? pendingReturnsCount : undefined,
      badgeColor: 'bg-amber-50 text-[#D99A27]',
    },
    {
      id: 'guidance',
      label: t.nav.guidance,
      icon: Sparkles,
      badgeColor: 'bg-blue-50 text-[#2563EB]',
    },
    {
      id: 'priceHistory',
      label: t.nav.priceHistory,
      icon: History,
    },
    {
      id: 'excelImport',
      label: t.nav.excelImport,
      icon: FileSpreadsheet,
    },
    {
      id: 'smartImport',
      label: locale === 'ar' ? 'الاستيراد الذكي للطلبات' : 'Smart Import (Beta)',
      icon: Sparkles,
      badgeText: 'Beta',
      badgeColor: 'bg-amber-100 text-amber-900',
    },
    {
      id: 'settings',
      label: t.nav.settings,
      icon: Settings,
    },
    {
      id: 'developerCenter',
      label: t.nav.developerCenter,
      icon: Terminal,
      badgeText: 'Dev',
      badgeColor: 'bg-purple-100 text-purple-900',
    },
  ];

  return (
    <aside
      className={`fixed top-0 bottom-0 z-40 bg-white border-e border-[#E8ECF2] flex flex-col transition-all duration-200 select-none ${
        locale === 'ar' ? 'right-0' : 'left-0'
      } ${isCollapsed ? 'w-18' : 'w-64'}`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-[#E8ECF2]">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-lg bg-[#2563EB] flex items-center justify-center text-white shrink-0 shadow-sm">
            <Store className="w-5 h-5" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-[#172033] truncate tracking-tight">
                {t.brandName}
              </span>
              <span className="text-[11px] text-[#64748B] truncate">
                {settings.storeName || t.brandTagline}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex p-1.5 text-[#64748B] hover:text-[#172033] hover:bg-[#F7F8FA] rounded-md transition-colors"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {locale === 'ar' ? (
            isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Marketplaces quick status bar (when expanded) */}
      {!isCollapsed && (
        <div className="px-4 py-2.5 bg-[#F7F8FA]/80 border-b border-[#E8ECF2] flex items-center justify-between text-xs">
          <span className="text-[#64748B] font-medium text-[11px]">
            {locale === 'ar' ? 'المنصات المتزامنة' : 'Synced Channels'}
          </span>
          <div className="flex items-center gap-1.5">
            {settings.marketplaces.map((m) => (
              <span
                key={m.id}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-[#E8ECF2] bg-white text-[#172033]"
                title={`${m.nameEn} - Active`}
              >
                {locale === 'ar' ? m.nameAr : m.nameEn}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Navigation List */}
      <nav className="flex-1 px-2.5 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[#2563EB] text-white shadow-sm'
                  : 'text-[#64748B] hover:text-[#172033] hover:bg-[#F7F8FA]'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#64748B]'}`} />
              {!isCollapsed && (
                <span className="flex-1 text-start truncate">{item.label}</span>
              )}
              {!isCollapsed && item.badge !== undefined && (
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                    isActive ? 'bg-white/20 text-white' : item.badgeColor
                  }`}
                >
                  {item.badge}
                </span>
              )}
              {!isCollapsed && item.badgeText !== undefined && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                    isActive ? 'bg-white/20 text-white' : item.badgeColor
                  }`}
                >
                  {item.badgeText}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer controls: Language Toggle & User info */}
      <div className="p-3 border-t border-[#E8ECF2] space-y-2">
        <button
          onClick={onToggleLocale}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-[#64748B] hover:text-[#172033] hover:bg-[#F7F8FA] rounded-lg transition-colors border border-[#E8ECF2] ${
            isCollapsed ? 'justify-center px-0' : ''
          }`}
          title="Toggle Language"
        >
          <Globe className="w-4 h-4 text-[#2563EB] shrink-0" />
          {!isCollapsed && (
            <div className="flex items-center justify-between flex-1">
              <span>{locale === 'ar' ? 'اللغة: العربية' : 'Language: English'}</span>
              <span className="text-[11px] font-semibold text-[#2563EB]">
                {locale === 'ar' ? 'English' : 'عربي'}
              </span>
            </div>
          )}
        </button>

        {onOpenTestSuite && (
          <button
            onClick={onOpenTestSuite}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-purple-700 hover:text-purple-900 bg-purple-50/60 hover:bg-purple-100/60 rounded-lg transition-colors border border-purple-200 cursor-pointer ${
              isCollapsed ? 'justify-center px-0' : ''
            }`}
            title={locale === 'ar' ? 'فحص واختبار منطق العمليات' : 'Run Operations Test Suite'}
          >
            <FlaskConical className="w-4 h-4 text-purple-600 shrink-0" />
            {!isCollapsed && (
              <span className="truncate">
                {locale === 'ar' ? 'اختبار قواعد العمليات' : 'Logic Test Suite'}
              </span>
            )}
          </button>
        )}

        {!isCollapsed && (
          <div className="px-2 py-1.5 flex items-center gap-2 text-[11px] text-[#64748B]">
            <div className="w-2 h-2 rounded-full bg-[#16A36A]" />
            <span className="truncate">{settings.sellerName}</span>
          </div>
        )}
      </div>
    </aside>
  );
};
