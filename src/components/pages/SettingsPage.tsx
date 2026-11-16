import React, { useRef, useState } from 'react';
import {
  Plus,
  Store,
  User,
  Database,
  Download,
  Upload,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  Trash2,
  GraduationCap,
  Sparkles,
  Terminal,
  Lock,
  Unlock,
  Users,
  ShieldAlert,
} from 'lucide-react';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';
import { MarketplaceConfig } from '../../types';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';

interface SettingsPageProps {
  locale: Locale;
  onDataReset: () => void;
  onNavigateToTab?: (tab: string) => void;
}

const buildMarketplaceSlug = (nameEn: string, nameAr: string): string => {
  const ascii = nameEn
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (ascii.length >= 2) return ascii;
  const source = (nameAr || nameEn).trim();
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mkt_${(hash >>> 0).toString(36)}`;
};

export const SettingsPage: React.FC<SettingsPageProps> = ({
  locale,
  onDataReset,
  onNavigateToTab,
}) => {
  const isRtl = locale === 'ar';
  const t = translations[locale];
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [settings, setSettings] = useState(() => storageService.getSettings());
  const [profile, setProfile] = useState(() => storageService.getMerchantProfile());
  const [marketplaces, setMarketplaces] = useState<MarketplaceConfig[]>(() =>
    storageService.getAllMarketplaces()
  );
  const [accounts, setAccounts] = useState(() => storageService.getMerchantAccounts());
  const [activeMerchantId, setActiveMerchantId] = useState(() =>
    storageService.getActiveMerchantId()
  );
  const [isDevUnlocked, setIsDevUnlocked] = useState(() => storageService.isDeveloperMode());

  // Add marketplace modal
  const [isAddMktModalOpen, setIsAddMktModalOpen] = useState(false);
  const [newMktNameEn, setNewMktNameEn] = useState('');
  const [newMktNameAr, setNewMktNameAr] = useState('');
  const [newMktColor, setNewMktColor] = useState('#2563EB');

  // Create merchant account modal
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [newAccountStoreName, setNewAccountStoreName] = useState('');
  const [newAccountMerchantName, setNewAccountMerchantName] = useState('');
  const [newAccountEmail, setNewAccountEmail] = useState('');

  // Developer unlock gate state
  const [showDevGateForm, setShowDevGateForm] = useState(false);
  const [devPasscode, setDevPasscode] = useState('');

  // Form state
  const [sellerName, setSellerName] = useState(profile.merchantName || settings.sellerName);
  const [storeName, setStoreName] = useState(profile.storeName || settings.storeName);
  const [currency, setCurrency] = useState(settings.currency);

  const syncLocalSnapshots = () => {
    const nextSettings = storageService.getSettings();
    const nextProfile = storageService.getMerchantProfile();
    setSettings(nextSettings);
    setProfile(nextProfile);
    setMarketplaces(storageService.getAllMarketplaces());
    setAccounts(storageService.getMerchantAccounts());
    setActiveMerchantId(storageService.getActiveMerchantId());
    setIsDevUnlocked(storageService.isDeveloperMode());
    setSellerName(nextProfile.merchantName || nextSettings.sellerName);
    setStoreName(nextProfile.storeName || nextSettings.storeName);
    setCurrency(nextSettings.currency);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = {
      ...settings,
      sellerName: sellerName.trim(),
      storeName: storeName.trim(),
      currency,
    };
    const settingsRes = storageService.saveSettings(updated);
    if (!settingsRes.success) {
      showToast(settingsRes.error || t.toasts.error, 'error');
      return;
    }
    const profileRes = storageService.saveMerchantProfile({
      ...profile,
      merchantName: sellerName.trim(),
      storeName: storeName.trim(),
    });
    if (!profileRes.success) {
      showToast(profileRes.error || t.toasts.error, 'error');
      return;
    }
    syncLocalSnapshots();
    onDataReset();
    showToast(t.toasts.settingsSaved, 'success');
  };

  const handleToggleMarketplaceActive = (mkt: MarketplaceConfig) => {
    const nextActive = mkt.isActive === false;
    const res = storageService.setMarketplaceActive(mkt.id, nextActive);
    if (!res.success) {
      showToast(res.error || t.toasts.error, 'error');
      return;
    }
    syncLocalSnapshots();
    onDataReset();
    showToast(
      isRtl
        ? nextActive
          ? `تم تفعيل منصة (${mkt.nameAr}).`
          : `تم تعطيل منصة (${mkt.nameAr}) مع الحفاظ على السجلات التاريخية.`
        : nextActive
        ? `Enabled ${mkt.nameEn}.`
        : `Disabled ${mkt.nameEn} while preserving historical records.`,
      'success'
    );
  };

  const handleRemoveMarketplace = (id: string) => {
    const res = storageService.removeMarketplace(id);
    if (!res.success) {
      showToast(res.error || t.toasts.error, 'error');
      return;
    }
    syncLocalSnapshots();
    onDataReset();
    showToast(
      isRtl ? 'تمت إزالة المنصة غير المرتبطة بسجلات بنجاح.' : 'Marketplace removed successfully.',
      'success'
    );
  };

  const handleResetTutorials = () => {
    storageService.resetTutorial();
    showToast(
      isRtl
        ? 'تمت إعادة ضبط سجل الجولات التفاعلية بنجاح.'
        : 'All tutorials have been reset.',
      'success'
    );
  };

  const handleAddMarketplace = (e: React.FormEvent) => {
    e.preventDefault();
    const enTrimmed = newMktNameEn.trim();
    const arTrimmed = newMktNameAr.trim();
    if (!enTrimmed && !arTrimmed) {
      showToast(
        isRtl ? 'يرجى إدخال اسم المنصة بالعربية أو الإنجليزية.' : 'Please enter a marketplace name.',
        'error'
      );
      return;
    }

    const id = buildMarketplaceSlug(enTrimmed, arTrimmed);
    if (marketplaces.some((m) => m.id === id)) {
      showToast(
        isRtl ? 'هذه المنصة مضافة مسبقاً.' : 'Marketplace already exists.',
        'error'
      );
      return;
    }

    const newMkt: MarketplaceConfig = {
      id,
      nameEn: enTrimmed || arTrimmed,
      nameAr: arTrimmed || enTrimmed,
      color: newMktColor,
      badgeBg: '#EFF6FF',
      badgeText: '#1E40AF',
      isActive: true,
    };

    const res = storageService.addMarketplace(newMkt);
    if (!res.success) {
      showToast(res.error || t.toasts.error, 'error');
      return;
    }
    syncLocalSnapshots();
    onDataReset();
    setIsAddMktModalOpen(false);
    setNewMktNameEn('');
    setNewMktNameAr('');
    showToast(
      isRtl
        ? `تمت إضافة منصة (${newMkt.nameAr}) وأعمدتها أصبحت متوفرة في الجداول.`
        : `Added ${newMkt.nameEn} marketplace.`,
      'success'
    );
  };

  const handleSwitchAccount = (merchantId: string) => {
    if (merchantId === activeMerchantId) return;
    const res = storageService.switchMerchantAccount(merchantId);
    if (!res.success) {
      showToast(res.error || t.toasts.error, 'error');
      return;
    }
    syncLocalSnapshots();
    onDataReset();
    showToast(
      isRtl ? 'تم التبديل إلى مساحة التاجر المعزولة بنجاح.' : 'Switched to isolated merchant space.',
      'success'
    );
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const res = storageService.createMerchantAccount({
      storeName: newAccountStoreName,
      merchantName: newAccountMerchantName,
      email: newAccountEmail,
      language: locale,
      currency,
      switchTo: true,
    });
    if (!res.success) {
      showToast(res.error || t.toasts.error, 'error');
      return;
    }
    setIsAccountModalOpen(false);
    setNewAccountStoreName('');
    setNewAccountMerchantName('');
    setNewAccountEmail('');
    syncLocalSnapshots();
    onDataReset();
    showToast(
      isRtl
        ? `تم إنشاء وعزل حساب المتجر (${res.account?.storeName}) والتبديل إليه.`
        : `Created and switched to isolated store (${res.account?.storeName}).`,
      'success'
    );
  };

  const handleExportBackup = () => {
    const json = storageService.exportMerchantBackupJson();
    const blob = new Blob([json], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ingobia_Backup_${activeMerchantId}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(
      isRtl ? 'تم تصدير النسخة الاحتياطية الكاملة بنجاح.' : 'Backup exported successfully.',
      'success'
    );
  };

  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = storageService.importMerchantBackupJson(text);
      if (!res.success) {
        showToast(res.error || t.toasts.error, 'error');
        return;
      }
      syncLocalSnapshots();
      onDataReset();
      showToast(
        isRtl
          ? 'تم استيراد النسخة الاحتياطية JSON واستعادة البيانات بأمان.'
          : 'JSON backup imported and verified safely.',
        'success'
      );
    } catch {
      showToast(
        isRtl ? 'تعذر قراءة ملف النسخة الاحتياطية.' : 'Failed to read backup file.',
        'error'
      );
    }
  };

  const handleUnlockDeveloper = (e: React.FormEvent) => {
    e.preventDefault();
    const res = storageService.unlockDeveloperMode(devPasscode);
    if (!res.success) {
      showToast(res.error || (isRtl ? 'رمز المطور غير صحيح.' : 'Invalid developer passcode.'), 'error');
      return;
    }
    setDevPasscode('');
    setShowDevGateForm(false);
    syncLocalSnapshots();
    onDataReset();
    showToast(
      isRtl ? 'تم تفعيل وضع المطور في هذه الجلسة.' : 'Developer mode unlocked for this session.',
      'success'
    );
  };

  const handleLockDeveloper = () => {
    storageService.lockDeveloperMode();
    syncLocalSnapshots();
    onDataReset();
    showToast(
      isRtl ? 'تم قفل وضع المطور والعودة لصلاحيات التاجر.' : 'Developer mode locked.',
      'success'
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Connected Marketplaces Section */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2] mb-4">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-[#2563EB]" />
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {t.settings.marketplacesSection}
              </h3>
              <p className="text-xs text-[#64748B]">
                {isRtl
                  ? 'مصدر الحقيقة الوحيد للقنوات: المنصات النشطة فقط تظهر في الإنشاء وإكسيل، بينما تظل السجلات التاريخية للمنصات المعطلة محفوظة'
                  : 'Single source of truth: active channels appear in creation forms & Excel; disabled channels preserve historical logs'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAddMktModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.settings.addMarketplace}</span>
          </button>
        </div>

        {marketplaces.length === 0 ? (
          <div className="p-4 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2] text-xs text-[#64748B] text-center">
            {isRtl
              ? 'لا توجد منصات مضافة حالياً. أضف منصة بيع أو استخدم المتجر المستقل.'
              : 'No marketplaces configured. Add a channel to manage platform allocations.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {marketplaces.map((mkt) => {
              const isActive = mkt.isActive !== false;
              return (
                <div
                  key={mkt.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                    isActive
                      ? 'bg-[#F7F8FA] border-[#E8ECF2]'
                      : 'bg-slate-50/70 border-slate-200 opacity-85'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10"
                      style={{ backgroundColor: isActive ? mkt.color : '#94A3B8' }}
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-[#172033] truncate">
                        {isRtl ? mkt.nameAr : mkt.nameEn}
                      </div>
                      <div className="text-[10px] text-[#64748B] font-mono-code truncate">
                        {mkt.nameEn} · {mkt.id}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isActive ? (
                      <span className="text-[10px] font-semibold text-[#16A36A] flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 whitespace-nowrap shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        {isRtl ? 'نشطة' : 'Active'}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-600 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded border border-slate-300 whitespace-nowrap shrink-0">
                        <PauseCircle className="w-3 h-3" />
                        {isRtl ? 'معطلة' : 'Disabled'}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleToggleMarketplaceActive(mkt)}
                      className="p-1.5 text-slate-500 hover:text-[#2563EB] hover:bg-white rounded border border-transparent hover:border-[#E8ECF2] transition-colors cursor-pointer"
                      title={
                        isActive
                          ? isRtl
                            ? 'تعطيل المنصة مع حفظ السجلات'
                            : 'Disable channel'
                          : isRtl
                          ? 'إعادة تفعيل المنصة'
                          : 'Activate channel'
                      }
                    >
                      {isActive ? (
                        <PauseCircle className="w-3.5 h-3.5" />
                      ) : (
                        <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveMarketplace(mkt.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                      title={
                        isRtl
                          ? 'حذف المنصة (يُسمح فقط إذا لم تكن مرتبطة بسجلات تاريخية)'
                          : 'Delete channel if unused'
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Isolated Multi-Merchant Workspaces */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2]">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#2563EB]" />
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {isRtl ? 'حسابات التجار المعزولة محلياً' : 'Isolated Merchant Workspaces'}
              </h3>
              <p className="text-xs text-[#64748B]">
                {isRtl
                  ? 'كل حساب تاجر يمتلك مساحة تخزين معزولة بالكامل للمنتجات والطلبات والمخزون والدفتر المالي'
                  : 'Each merchant workspace has isolated local storage for products, orders, inventory, and ledger'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAccountModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isRtl ? 'إنشاء حساب تاجر جديد' : 'New Merchant Space'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {accounts.map((acc) => {
            const isCurrent = acc.id === activeMerchantId;
            return (
              <div
                key={acc.id}
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'bg-blue-50/60 border-[#2563EB]'
                    : 'bg-[#F7F8FA] border-[#E8ECF2]'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-[#172033] truncate">
                      {acc.storeName || (isRtl ? 'متجر غير مسمى' : 'Untitled Store')}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] font-bold text-[#2563EB] bg-white px-2 py-0.5 rounded border border-blue-200 whitespace-nowrap shrink-0">
                        {isRtl ? 'النشط' : 'Active'}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#64748B] truncate mt-0.5">
                    {acc.merchantName || (isRtl ? 'تاجر' : 'Merchant')} ·{' '}
                    <span className="font-mono-code">{acc.id}</span>
                  </div>
                </div>

                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => handleSwitchAccount(acc.id)}
                    className="px-3 py-1.5 text-xs font-semibold text-[#172033] bg-white hover:bg-slate-100 border border-[#E8ECF2] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isRtl ? 'تبديل' : 'Switch'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Merchant Profile */}
      <form
        onSubmit={handleSaveProfile}
        className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E8ECF2]">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-[#2563EB]" />
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {t.settings.sellerProfileSection}
              </h3>
              <p className="text-xs text-[#64748B]">
                {isRtl ? 'بيانات التاجر والهوية التشغيلية للمتجر' : 'Merchant identity and store configuration'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#F8FAFC] px-3 py-1 rounded-full border border-[#E8ECF2] text-xs">
            <div className="w-2 h-2 rounded-full bg-[#16A36A]" />
            <span className="font-mono text-[#475569] text-[11px]">
              {profile.email || (isRtl ? 'جلسة متجر محلية' : 'Local Store Session')}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.settings.sellerName}
            </label>
            <input
              type="text"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              placeholder={isRtl ? 'اسم مسؤول العمليات' : 'Operator name'}
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.settings.storeName}
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder={isRtl ? 'اسم المتجر التجاري' : 'Store name'}
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.settings.currencySection}
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] font-bold focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="SAR">SAR (ريال سعودي)</option>
              <option value="AED">AED (درهم إماراتي)</option>
              <option value="EGP">EGP (جنيه مصري)</option>
              <option value="USD">USD ($)</option>
              <option value="KWD">KWD (دينار كويتي)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
          >
            {t.actions.save}
          </button>
        </div>
      </form>

      {/* Data Controls & Backup (Export & Verified Import) */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8ECF2]">
          <Database className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h3 className="text-sm font-bold text-[#172033]">
              {isRtl ? 'النسخ الاحتياطي والاستعادة (JSON)' : 'Store Data Backup & Restore'}
            </h3>
            <p className="text-xs text-[#64748B]">
              {isRtl
                ? 'تصدير نسخة احتياطية كاملة أو استعادتها مع التحقق من البنية وحفظ لقطة احتياطية قبل الاستبدال'
                : 'Export or restore verified JSON backups with automatic pre-restore snapshot protection'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-semibold text-[#172033] block">
              {t.settings.backupJson}
            </span>
            <span className="text-[#64748B] text-[11px]">
              {isRtl
                ? 'يشمل الكتالوج، والطلبات، والمرتجعات، والحركات، والقيود المالية لهذا المتجر فقط'
                : 'Includes catalog, orders, returns, movements, and ledger scoped to this store'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleExportBackup}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/70 border border-[#E8ECF2] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>{t.actions.export} (JSON)</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportBackupFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#172033] bg-white hover:bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-[#16A36A]" />
              <span>{isRtl ? 'استيراد نسخة احتياطية (JSON)' : 'Import Backup (JSON)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Guidance & Learning Center Settings */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8ECF2]">
          <GraduationCap className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h3 className="text-sm font-bold text-[#172033]">
              {isRtl ? 'الجولات الإرشادية ومركز التدريب' : 'Interactive Guidance & Training'}
            </h3>
            <p className="text-xs text-[#64748B]">
              {isRtl
                ? 'إدارة الجولات الإرشادية والمساعد التفاعلي ثلاثي الأبعاد'
                : 'Manage interactive assistant guides and walk-throughs'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-semibold text-[#172033] block">
              {isRtl ? 'إعادة تشغيل الجولات الإرشادية التلقائية' : 'Reset Walk-through History'}
            </span>
            <span className="text-[#64748B] text-[11px]">
              {isRtl
                ? 'إعادة تعيين سجل المشاهدات لكي يبدأ المساعد بشرح كل صفحة عند زيارتها لأول مرة'
                : 'Reset tour completion status so guides display automatically on each view'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleResetTutorials}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#2563EB] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isRtl ? 'إعادة تعيين الجولات' : 'Reset Tours'}</span>
          </button>
        </div>
      </div>

      {/* Developer Mode Passcode Gate */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E8ECF2]">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-slate-700" />
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {isRtl ? 'صلاحية المطور وأدوات التشخيص' : 'Developer Access & Diagnostics'}
              </h3>
              <p className="text-xs text-[#64748B]">
                {isRtl
                  ? 'مخفية عن التاجر العادي ولا تُفتح إلا عبر رمز جلسة المطور'
                  : 'Hidden from ordinary merchant workflows and gated by developer session passcode'}
              </p>
            </div>
          </div>

          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono-code whitespace-nowrap shrink-0 ${
              isDevUnlocked
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {isDevUnlocked ? 'DEVELOPER SESSION ACTIVE' : 'MERCHANT ROLE (LOCKED)'}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-[#F7F8FA] border border-[#E8ECF2] flex items-start gap-2 text-[11px] text-[#64748B]">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            {isRtl
              ? 'تنبيه شفافية: التطبيق يعمل محلياً داخل المتصفح (Client-side localStorage)، لذا يمثل رمز المطور بوابة فصل واجهة وصلاحية جلسة محلية وليس مصادقة خادم (Server-side RBAC).'
              : 'Transparency note: This app runs client-side in browser localStorage; the developer passcode enforces UI/session role separation, not server-side RBAC.'}
          </span>
        </div>

        {!isDevUnlocked ? (
          <div className="space-y-3 text-xs">
            {!showDevGateForm ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[#64748B]">
                  {isRtl
                    ? 'مركز المطورين والبيانات التجريبية وسجل التدقيق مقفل حالياً.'
                    : 'Developer Center, sandbox tools, and audit logs are currently locked.'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowDevGateForm(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/70 border border-[#E8ECF2] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Lock className="w-3.5 h-3.5 text-[#64748B]" />
                  <span>{isRtl ? 'فتح وضع المطور' : 'Unlock Developer Mode'}</span>
                </button>
              </div>
            ) : (
              <form
                onSubmit={handleUnlockDeveloper}
                className="flex flex-wrap items-center gap-2 bg-[#F7F8FA] p-3 rounded-xl border border-[#E8ECF2]"
              >
                <input
                  type="password"
                  required
                  value={devPasscode}
                  onChange={(e) => setDevPasscode(e.target.value)}
                  placeholder={isRtl ? 'أدخل رمز المطور...' : 'Enter developer passcode...'}
                  className="flex-1 min-w-[200px] px-3 py-2 bg-white border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'تفعيل الجلسة' : 'Unlock'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDevGateForm(false);
                    setDevPasscode('');
                  }}
                  className="px-3 py-2 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-white border border-[#E8ECF2] rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  {t.actions.cancel}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <span className="font-semibold text-[#172033] block">
                {isRtl ? 'جلسة المطور مفعلة' : 'Developer Session Unlocked'}
              </span>
              <span className="text-[#64748B] text-[11px]">
                {isRtl
                  ? 'يمكنك فتح مركز المطورين أو قفل الصلاحية للعودة لواجهة التاجر القياسية.'
                  : 'You can open the Developer Center or lock developer mode to return to standard merchant mode.'}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {onNavigateToTab && (
                <button
                  type="button"
                  onClick={() => onNavigateToTab('developerCenter')}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'فتح مركز المطورين' : 'Open Developer Center'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleLockDeveloper}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/70 border border-[#E8ECF2] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{isRtl ? 'قفل وضع المطور' : 'Lock Developer Mode'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Marketplace Modal */}
      <Modal
        isOpen={isAddMktModalOpen}
        onClose={() => setIsAddMktModalOpen(false)}
        title={t.settings.addMarketplace}
        subtitle={
          isRtl
            ? 'إضافة منصة جديدة يتيح تخصيص مخزونها وأسعارها فوراً في الكتالوج'
            : 'Add new marketplace channel'
        }
        maxWidth="sm"
      >
        <form onSubmit={handleAddMarketplace} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.settings.marketplaceNameEn}
            </label>
            <input
              type="text"
              value={newMktNameEn}
              onChange={(e) => setNewMktNameEn(e.target.value)}
              placeholder="e.g. TikTok Shop, Carrefour, Trendyol"
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.settings.marketplaceNameAr}
            </label>
            <input
              type="text"
              value={newMktNameAr}
              onChange={(e) => setNewMktNameAr(e.target.value)}
              placeholder="مثال: تيك توك شوب، كارفور، ترينديول"
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.settings.brandColor}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={newMktColor}
                onChange={(e) => setNewMktColor(e.target.value)}
                className="w-10 h-8 rounded border border-[#E8ECF2] cursor-pointer"
              />
              <span className="font-mono-code text-[11px] text-[#64748B]">
                {newMktColor}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8ECF2]">
            <button
              type="button"
              onClick={() => setIsAddMktModalOpen(false)}
              className="px-3.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer"
            >
              {t.actions.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              {t.actions.confirm}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Isolated Merchant Account Modal */}
      <Modal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        title={isRtl ? 'إنشاء حساب تاجر معزول جديد' : 'Create Isolated Merchant Space'}
        subtitle={
          isRtl
            ? 'سيبدأ المتجر الجديد ببيانات فارغة معزولة تماماً عن المتاجر الأخرى.'
            : 'Creates an isolated empty store workspace.'
        }
        maxWidth="sm"
      >
        <form onSubmit={handleCreateAccount} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {isRtl ? 'اسم المتجر *' : 'Store Name *'}
            </label>
            <input
              type="text"
              required
              value={newAccountStoreName}
              onChange={(e) => setNewAccountStoreName(e.target.value)}
              placeholder={isRtl ? 'مثال: متجر النخبة' : 'e.g. Elite Store'}
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {isRtl ? 'اسم التاجر / المسؤول *' : 'Merchant Name *'}
            </label>
            <input
              type="text"
              required
              value={newAccountMerchantName}
              onChange={(e) => setNewAccountMerchantName(e.target.value)}
              placeholder={isRtl ? 'اسم مدير الحساب' : 'Account owner'}
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {isRtl ? 'البريد الإلكتروني (اختياري)' : 'Email (Optional)'}
            </label>
            <input
              type="email"
              value={newAccountEmail}
              onChange={(e) => setNewAccountEmail(e.target.value)}
              placeholder="merchant@store.example"
              className="w-full px-3 py-2 bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8ECF2]">
            <button
              type="button"
              onClick={() => setIsAccountModalOpen(false)}
              className="px-3.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer"
            >
              {t.actions.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              {isRtl ? 'إنشاء والتبديل' : 'Create & Switch'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
