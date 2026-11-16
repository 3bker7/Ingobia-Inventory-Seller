import React, { useState } from 'react';
import {
  Store,
  Check,
  Plus,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  ShoppingBag,
  Globe,
  User,
  CheckCircle2,
} from 'lucide-react';
import { storageService } from '../../services/storage';
import { MarketplaceConfig } from '../../types';
import { Locale } from '../../locales/translations';

interface OnboardingModalProps {
  isOpen: boolean;
  locale: Locale;
  onComplete: () => void;
}

interface CustomMarketplace {
  id: string;
  nameEn: string;
  nameAr: string;
}

function buildMarketplaceSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (ascii && ascii.replace(/_/g, '').length > 0) {
    return ascii;
  }
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mkt_${(hash >>> 0).toString(36)}`;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  locale,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Marketplace selections (starts empty by default)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [customMarketplaces, setCustomMarketplaces] = useState<CustomMarketplace[]>([]);
  const [currentCustomInput, setCurrentCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [ownStoreName, setOwnStoreName] = useState('');

  // Step 2: Identity (strictly clean empty inputs — zero hardcoded personal values)
  const [merchantName, setMerchantName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [merchantEmail, setMerchantEmail] = useState('');
  const [identityError, setIdentityError] = useState('');

  if (!isOpen) return null;

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(id)) {
        return prev.filter((p) => p !== id);
      } else {
        return [...prev, id];
      }
    });

    if (id === 'other') {
      setShowCustomInput(true);
    }
  };

  const handleConfirmCustomMarketplace = () => {
    const trimmed = currentCustomInput.trim();
    if (!trimmed) return;

    const id = buildMarketplaceSlug(trimmed);
    if (customMarketplaces.some((m) => m.nameEn.toLowerCase() === trimmed.toLowerCase() || m.id === id)) {
      return;
    }

    setCustomMarketplaces((prev) => [
      ...prev,
      {
        id,
        nameEn: trimmed,
        nameAr: trimmed,
      },
    ]);
    setCurrentCustomInput('');
  };

  const handleRemoveCustomMarketplace = (id: string) => {
    setCustomMarketplaces((prev) => prev.filter((m) => m.id !== id));
  };

  const handleFinishOnboarding = () => {
    // 1. Build marketplaces array
    const configuredMarketplaces: MarketplaceConfig[] = [];

    if (selectedPlatforms.includes('amazon')) {
      configuredMarketplaces.push({
        id: 'amazon',
        nameEn: 'Amazon',
        nameAr: 'أمازون',
        color: '#FF9900',
        badgeBg: '#FFF7ED',
        badgeText: '#C2410C',
        isActive: true,
      });
    }

    if (selectedPlatforms.includes('noon')) {
      configuredMarketplaces.push({
        id: 'noon',
        nameEn: 'Noon',
        nameAr: 'نون',
        color: '#FEEC00',
        badgeBg: '#FEF9C3',
        badgeText: '#854D0E',
        isActive: true,
      });
    }

    if (selectedPlatforms.includes('own_store')) {
      const siteName = ownStoreName.trim() || (isRtl ? 'متجري الخاص' : 'My Store');
      configuredMarketplaces.push({
        id: 'own_store',
        nameEn: ownStoreName.trim() || 'My Store',
        nameAr: ownStoreName.trim() || 'متجري الخاص',
        color: '#2563EB',
        badgeBg: '#EFF6FF',
        badgeText: '#1D4ED8',
        isActive: true,
      });
    }

    const palette = ['#0EA5E9', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#6366F1'];
    customMarketplaces.forEach((m, idx) => {
      const color = palette[idx % palette.length];
      configuredMarketplaces.push({
        id: m.id,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        color,
        badgeBg: '#F1F5F9',
        badgeText: '#334155',
        isActive: true,
      });
    });

    const safeMerchantName = merchantName.trim() || (isRtl ? 'مدير المتجر' : 'Store Manager');
    const safeStoreName = storeName.trim() || (isRtl ? 'متجري' : 'My Store');

    const onboardingRes = storageService.completeOnboarding(
      configuredMarketplaces,
      safeMerchantName,
      safeStoreName
    );

    if (!onboardingRes.success) {
      console.error('Failed to persist onboarding:', onboardingRes.error);
      return;
    }

    if (merchantEmail.trim()) {
      const currentProfile = storageService.getMerchantProfile();
      storageService.saveMerchantProfile({
        ...currentProfile,
        email: merchantEmail.trim(),
      });
    }

    onComplete();
  };

  const isRtl = locale === 'ar';

  const handleNextStep = () => {
    if (step === 2) {
      if (!merchantName.trim() || !storeName.trim()) {
        setIdentityError(
          isRtl
            ? 'يرجى إدخال اسم التاجر واسم المتجر التجاري للمتابعة.'
            : 'Please enter both your name and store name to continue.'
        );
        return;
      }
      setIdentityError('');
    }
    setStep((prev) => (prev + 1) as 2 | 3);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#172033]/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-[#E8ECF2] shadow-xl max-w-xl w-full overflow-hidden flex flex-col my-auto">
        {/* Clean Light Header Bar */}
        <div className="bg-[#F8FAFC] border-b border-[#E8ECF2] text-[#172033] p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#2563EB] flex items-center justify-center text-white font-bold">
                <Store className="w-4 h-4" />
              </div>
              <span className="font-bold tracking-tight text-sm text-[#172033]">
                INGOBIA <span className="text-[#64748B] font-normal">| إنجوبيا</span>
              </span>
            </div>

            <span className="text-[11px] font-semibold text-[#64748B] bg-white px-2.5 py-1 rounded-lg border border-[#E8ECF2]">
              {isRtl ? 'إعداد المتجر الجديد' : 'Store Setup'}
            </span>
          </div>

          <h2 className="text-lg font-bold tracking-tight text-[#172033]">
            {isRtl ? 'مرحباً بك في إنجوبيا' : 'Welcome to Ingobia'}
          </h2>
          <p className="text-xs text-[#64748B] mt-1 max-w-md">
            {isRtl
              ? 'خصص قنوات البيع وهوية متجرك في خطوات سريعة للبدء بنظام مخزون موحد ودقيق.'
              : 'Configure your sales channels and store identity to start with unified warehouse custody.'}
          </p>

          {/* Progress Indicator */}
          <div className="flex items-center gap-2 mt-4">
            <div
              className={`h-1.5 flex-1 rounded-full transition-all ${
                step >= 1 ? 'bg-[#2563EB]' : 'bg-[#E2E8F0]'
              }`}
            />
            <div
              className={`h-1.5 flex-1 rounded-full transition-all ${
                step >= 2 ? 'bg-[#2563EB]' : 'bg-[#E2E8F0]'
              }`}
            />
            <div
              className={`h-1.5 flex-1 rounded-full transition-all ${
                step >= 3 ? 'bg-[#2563EB]' : 'bg-[#E2E8F0]'
              }`}
            />
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {/* STEP 1: MARKETPLACE SELECTION */}
          {step === 1 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div>
                <span className="text-[11px] font-bold text-[#2563EB] uppercase tracking-wider block mb-1">
                  {isRtl ? 'الخطوة 1 من 3' : 'Step 1 of 3'}
                </span>
                <h3 className="text-lg font-bold text-[#172033]">
                  {isRtl ? 'أين تبيع منتجاتك حالياً؟' : 'Where do you currently sell your products?'}
                </h3>
                <p className="text-xs text-[#64748B] mt-1">
                  {isRtl
                    ? 'يمكنك تحديد أكثر من منصة، كما يمكنك إضافة منصات أخرى غير محدودة.'
                    : 'Select all platforms where you operate. You can add as many custom platforms as needed.'}
                </p>
              </div>

              {/* Selection Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1. Amazon */}
                <div
                  onClick={() => togglePlatform('amazon')}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                    selectedPlatforms.includes('amazon')
                      ? 'border-[#FF9900] bg-amber-50/40 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-[#FF9900] flex items-center justify-center font-black text-white text-xs shadow-xs">
                      amz
                    </span>
                    <div>
                      <div className="font-bold text-xs text-[#172033]">
                        {isRtl ? 'أمازون' : 'Amazon'}
                      </div>
                      <span className="text-[10px] text-[#64748B]">Amazon Seller Central</span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                      selectedPlatforms.includes('amazon')
                        ? 'bg-[#FF9900] border-[#FF9900] text-white'
                        : 'border-[#CBD5E1]'
                    }`}
                  >
                    {selectedPlatforms.includes('amazon') && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>

                {/* 2. Noon */}
                <div
                  onClick={() => togglePlatform('noon')}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                    selectedPlatforms.includes('noon')
                      ? 'border-[#EAB308] bg-yellow-50/40 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-[#FEEC00] flex items-center justify-center font-black text-[#854D0E] text-xs shadow-xs border border-yellow-300">
                      noon
                    </span>
                    <div>
                      <div className="font-bold text-xs text-[#172033]">
                        {isRtl ? 'نون' : 'Noon'}
                      </div>
                      <span className="text-[10px] text-[#64748B]">Noon Seller Lab</span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                      selectedPlatforms.includes('noon')
                        ? 'bg-[#EAB308] border-[#EAB308] text-white'
                        : 'border-[#CBD5E1]'
                    }`}
                  >
                    {selectedPlatforms.includes('noon') && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>

                {/* 3. My Own Store / Website */}
                <div
                  onClick={() => togglePlatform('own_store')}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                    selectedPlatforms.includes('own_store')
                      ? 'border-[#2563EB] bg-blue-50/40 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center font-bold text-xs border border-blue-200">
                      <Globe className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-xs text-[#172033]">
                        {isRtl ? 'متجري الخاص / موقعي الإلكتروني' : 'My Own Store / Website'}
                      </div>
                      <span className="text-[10px] text-[#64748B]">Shopify, Salla, Zid, Custom</span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                      selectedPlatforms.includes('own_store')
                        ? 'bg-[#2563EB] border-[#2563EB] text-white'
                        : 'border-[#CBD5E1]'
                    }`}
                  >
                    {selectedPlatforms.includes('own_store') && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>

                {/* 4. Other Marketplace */}
                <div
                  onClick={() => {
                    togglePlatform('other');
                    setShowCustomInput(true);
                  }}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                    showCustomInput || selectedPlatforms.includes('other') || customMarketplaces.length > 0
                      ? 'border-[#8B5CF6] bg-purple-50/40 shadow-xs'
                      : 'border-[#E8ECF2] hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 text-[#8B5CF6] flex items-center justify-center font-bold text-xs border border-purple-200">
                      <ShoppingBag className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-xs text-[#172033]">
                        {isRtl ? 'منصة أخرى' : 'Other Marketplace'}
                      </div>
                      <span className="text-[10px] text-[#64748B]">Trendyol, TikTok, Carrefour...</span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                      showCustomInput || customMarketplaces.length > 0
                        ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                        : 'border-[#CBD5E1]'
                    }`}
                  >
                    {(showCustomInput || customMarketplaces.length > 0) && (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    )}
                  </div>
                </div>
              </div>

              {/* Own Store / Website Name Input Section (Section 8.2) */}
              {selectedPlatforms.includes('own_store') && (
                <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-200 space-y-2 animate-in fade-in duration-150">
                  <label className="block text-xs font-bold text-[#172033]">
                    {isRtl ? 'أدخل اسم متجرك أو موقعك الإلكتروني:' : 'Enter your website or store name:'}
                  </label>
                  <input
                    type="text"
                    value={ownStoreName}
                    onChange={(e) => setOwnStoreName(e.target.value)}
                    placeholder={isRtl ? 'مثال: متجر رواء، zstore.sa، منصة سلة/زد...' : 'e.g. MyStore, brand.com, Salla store...'}
                    className="w-full px-3.5 py-2 text-xs bg-white border border-[#CBD5E1] rounded-xl text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
                  />
                  <span className="text-[10px] text-[#64748B] block">
                    {isRtl ? 'سيتم حفظ المتجر كقناة بيع مستقلة لها معرف نظام ثابت.' : 'Will be saved as a dedicated channel with stable ID.'}
                  </span>
                </div>
              )}

              {/* Custom Marketplace Input Section */}
              {(showCustomInput || selectedPlatforms.includes('other')) && (
                <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-purple-200 space-y-3">
                  <label className="block text-xs font-bold text-[#172033]">
                    {isRtl ? 'أدخل اسم المنصة:' : 'Enter your marketplace name:'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={currentCustomInput}
                      onChange={(e) => setCurrentCustomInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleConfirmCustomMarketplace();
                        }
                      }}
                      placeholder={isRtl ? 'مثال: ترينديول (Trendyol), تيك توك شوب...' : 'e.g. Trendyol, TikTok Shop, Jumia...'}
                      className="flex-1 px-3.5 py-2 text-xs bg-white border border-[#CBD5E1] rounded-xl text-[#172033] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/30 focus:border-[#8B5CF6]"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmCustomMarketplace}
                      disabled={!currentCustomInput.trim()}
                      className="px-4 py-2 text-xs font-semibold text-white bg-[#8B5CF6] hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
                    >
                      {isRtl ? 'تأكيد هذه المنصة' : 'Confirm Marketplace'}
                    </button>
                  </div>

                  {/* List of confirmed custom marketplaces */}
                  {customMarketplaces.length > 0 && (
                    <div className="pt-2">
                      <span className="text-[10px] text-[#64748B] block mb-1.5 font-semibold">
                        {isRtl ? 'المنصات الإضافية المؤكدة:' : 'Confirmed custom channels:'}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {customMarketplaces.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center gap-2 px-3 py-1 bg-white border border-purple-200 rounded-lg text-xs font-medium text-[#172033] shadow-2xs"
                          >
                            <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                            <span>{m.nameAr}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomMarketplace(m.id)}
                              className="text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: MERCHANT & STORE IDENTITY */}
          {step === 2 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div>
                <span className="text-[11px] font-bold text-[#2563EB] uppercase tracking-wider block mb-1">
                  {isRtl ? 'الخطوة 2 من 3' : 'Step 2 of 3'}
                </span>
                <h3 className="text-lg font-bold text-[#172033]">
                  {isRtl ? 'هوية التاجر والمتجر' : 'Merchant & Store Identity'}
                </h3>
                <p className="text-xs text-[#64748B] mt-1">
                  {isRtl
                    ? 'سيظهر اسم المتجر بجوار علامة إنجوبيا، ويمكنك تغيير هذه البيانات لاحقاً من الإعدادات.'
                    : 'The store name will appear prominently beside Ingobia branding. You can edit both anytime in Settings.'}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#172033] mb-1.5 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#2563EB]" />
                    <span>{isRtl ? 'اسم التاجر / صاحب العمل:' : 'Merchant / Business Owner Name:'}</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    placeholder={isRtl ? 'أدخل اسمك أو اسم المسؤول' : 'Enter merchant name'}
                    className="w-full px-3.5 py-2.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#172033] mb-1.5 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-[#2563EB]" />
                    <span>{isRtl ? 'اسم المتجر التجاري:' : 'Store Name:'}</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => {
                      setStoreName(e.target.value);
                      setIdentityError('');
                    }}
                    placeholder={isRtl ? 'مثال: متجر النخبة للتجارة' : 'Enter store name'}
                    className="w-full px-3.5 py-2.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#172033] mb-1.5">
                    {isRtl ? 'البريد الإلكتروني للتاجر (اختياري):' : 'Merchant Email (optional):'}
                  </label>
                  <input
                    type="email"
                    value={merchantEmail}
                    onChange={(e) => setMerchantEmail(e.target.value)}
                    placeholder="merchant@example.com"
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                  {identityError && (
                    <p className="text-xs text-rose-600 font-semibold mt-2">{identityError}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: READY TO LAUNCH */}
          {step === 3 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div>
                <span className="text-[11px] font-bold text-[#16A36A] uppercase tracking-wider block mb-1">
                  {isRtl ? 'الخطوة 3 من 3' : 'Step 3 of 3'}
                </span>
                <h3 className="text-lg font-bold text-[#172033]">
                  {isRtl ? 'جاهز للانطلاق!' : 'Ready to Launch!'}
                </h3>
                <p className="text-xs text-[#64748B] mt-1">
                  {isRtl
                    ? 'تم تهيئة مساحة العمل الخاصة بك وفقاً للمنصات المختارة.'
                    : 'Your workspace has been customized according to your channels.'}
                </p>
              </div>

              {/* Summary Card */}
              <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E8ECF2] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">{isRtl ? 'اسم التاجر:' : 'Merchant:'}</span>
                  <strong className="text-[#172033]">{merchantName}</strong>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">{isRtl ? 'اسم المتجر:' : 'Store Name:'}</span>
                  <strong className="text-[#2563EB] font-bold">{storeName}</strong>
                </div>
                {merchantEmail.trim() && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#64748B]">{isRtl ? 'البريد الإلكتروني:' : 'Email:'}</span>
                    <span className="font-mono text-[#172033]">{merchantEmail.trim()}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-[#E8ECF2]">
                  <span className="text-[11px] text-[#64748B] block mb-1.5 font-semibold">
                    {isRtl ? 'المنصات المتزامنة والجاهزة:' : 'Synced Marketplaces:'}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPlatforms.includes('amazon') && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#FF9900]/10 text-[#C2410C] border border-[#FF9900]/30">
                        {isRtl ? 'أمازون' : 'Amazon'}
                      </span>
                    )}
                    {selectedPlatforms.includes('noon') && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#FEEC00]/30 text-[#854D0E] border border-yellow-300">
                        {isRtl ? 'نون' : 'Noon'}
                      </span>
                    )}
                    {selectedPlatforms.includes('own_store') && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-[#1D4ED8] border border-blue-200">
                        {isRtl ? 'متجري الخاص' : 'My Store'}
                      </span>
                    )}
                    {customMarketplaces.map((m) => (
                      <span
                        key={m.id}
                        className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-50 text-purple-800 border border-purple-200"
                      >
                        {m.nameAr}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Assistant introduction banner */}
              <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-200 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#2563EB] flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="text-xs">
                  <strong className="text-[#172033] font-bold block mb-0.5">
                    {isRtl ? 'مساعد إنجوبيا التفاعلي بانتظارك' : 'Ingobia Interactive Assistant Ready'}
                  </strong>
                  <p className="text-[#64748B] leading-relaxed">
                    {isRtl
                      ? 'فور الضغط على الزر أدناه، ستنطلق جولة توجيهية مرئية تشرح لك كيفية استثمار لوحة المراقبة والأقسام خطوة بخطوة.'
                      : 'Upon launching, our interactive guide will walk you through the dashboard step-by-step.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-6 bg-[#F8FAFC] border-t border-[#E8ECF2] flex items-center justify-between gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((prev) => (prev - 1) as 1 | 2)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#64748B] hover:text-[#172033] bg-white border border-[#CBD5E1] rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
              <span>{isRtl ? 'السابق' : 'Back'}</span>
            </button>
          ) : (
            <div />
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={handleNextStep}
              className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{isRtl ? 'متابعة' : 'Next'}</span>
              {isRtl ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinishOnboarding}
              className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-[#16A36A] hover:bg-emerald-700 rounded-xl transition-colors shadow-sm cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isRtl ? 'ابدأ استخدام إنجوبيا والجولة التفاعلية' : 'Launch Ingobia & Start Tour'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
