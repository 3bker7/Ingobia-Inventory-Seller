import React from 'react';
import { Menu, Store, ShieldCheck } from 'lucide-react';
import { Locale } from '../../locales/translations';
import { storageService } from '../../services/storage';

interface HeaderProps {
  locale: Locale;
  onOpenMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ locale, onOpenMobileMenu }) => {
  const isRtl = locale === 'ar';
  const settings = storageService.getSettings();
  const profile = storageService.getMerchantProfile();

  // Dynamic merchant store name or custom storefront
  const merchantStoreName =
    profile.storeName || settings.storeName || (isRtl ? 'روابي إكسبريس للتجارة' : 'Rawabi Express');

  return (
    <header className="h-14 bg-white/95 backdrop-blur-md border-b border-[#E8ECF2] sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between transition-all">
      {/* Platform Name & Merchant Store Name ONLY (Strictly uncluttered as requested) */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-[#64748B] hover:text-[#172033] hover:bg-[#F7F8FA] rounded-xl transition-colors cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 truncate">
          {/* Platform Identity */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-[#2563EB] flex items-center justify-center text-white shadow-xs">
              <Store className="w-4 h-4" />
            </div>
            <span className="font-bold text-xs sm:text-sm text-[#172033] tracking-tight">
              {isRtl ? 'عمليات البائع' : 'Ingobia'}
            </span>
          </div>

          {/* Minimalist Divider */}
          <span className="text-[#CBD5E1] text-xs font-light">/</span>

          {/* Merchant Store / Website Name */}
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-semibold text-xs sm:text-sm text-[#2563EB] truncate max-w-[170px] sm:max-w-[340px]">
              {merchantStoreName}
            </span>
          </div>
        </div>
      </div>

      {/* Discreet Live State Indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 bg-[#F7F8FA] px-2.5 py-1 rounded-full border border-[#E8ECF2] text-[11px] text-[#64748B]">
          <span className="w-2 h-2 rounded-full bg-[#16A36A] animate-pulse" />
          <span className="font-medium hidden sm:inline">
            {isRtl ? 'العمليات متزامنة' : 'Synced'}
          </span>
        </div>
      </div>
    </header>
  );
};
