import React from 'react';
import { Menu, Store } from 'lucide-react';
import { Locale } from '../../locales/translations';
import { storageService } from '../../services/storage';

interface HeaderProps {
  locale: Locale;
  storeRevision?: number;
  onOpenMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  locale,
  storeRevision = 0,
  onOpenMobileMenu,
}) => {
  void storeRevision;
  const isRtl = locale === 'ar';
  const settings = storageService.getSettings();
  const profile = storageService.getMerchantProfile();

  const merchantStoreName =
    profile.storeName ||
    settings.storeName ||
    (isRtl ? 'متجر غير مسمى' : 'Untitled Store');

  return (
    <header className="h-14 bg-white border-b border-[#E8ECF2] sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-[#64748B] hover:text-[#172033] hover:bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer shrink-0"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-[#2563EB] flex items-center justify-center text-white">
              <Store className="w-4 h-4" />
            </div>
            <span className="font-bold text-xs sm:text-sm text-[#172033] tracking-tight whitespace-nowrap">
              {isRtl ? 'إنجوبيا · عمليات البائع' : 'Ingobia Seller Ops'}
            </span>
          </div>

          <span className="text-[#CBD5E1] text-xs font-light shrink-0">/</span>

          <span className="font-semibold text-xs sm:text-sm text-[#2563EB] truncate max-w-[180px] sm:max-w-[360px]">
            {merchantStoreName}
          </span>
        </div>
      </div>
    </header>
  );
};

