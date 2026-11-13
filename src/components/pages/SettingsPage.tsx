import React, { useState } from 'react';
import {
  Settings,
  Plus,
  Store,
  DollarSign,
  User,
  Database,
  Download,
  RotateCcw,
  CheckCircle2,
  Trash2,
  GraduationCap,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';
import { MarketplaceConfig } from '../../types';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useToast } from '../common/Toast';

interface SettingsPageProps {
  locale: Locale;
  onDataReset: () => void;
  onNavigateToTab?: (tab: string) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ locale, onDataReset, onNavigateToTab }) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const [settings, setSettings] = useState(() => storageService.getSettings());
  const [profile, setProfile] = useState(() => storageService.getMerchantProfile());

  // Add marketplace modal
  const [isAddMktModalOpen, setIsAddMktModalOpen] = useState(false);
  const [newMktNameEn, setNewMktNameEn] = useState('');
  const [newMktNameAr, setNewMktNameAr] = useState('');
  const [newMktColor, setNewMktColor] = useState('#2563EB');

  // Reset confirmation
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // Form state
  const [sellerName, setSellerName] = useState(profile.merchantName || settings.sellerName);
  const [storeName, setStoreName] = useState(profile.storeName || settings.storeName);
  const [currency, setCurrency] = useState(settings.currency);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = {
      ...settings,
      sellerName: sellerName.trim(),
      storeName: storeName.trim(),
      currency,
    };
    storageService.saveSettings(updated);
    storageService.saveMerchantProfile({
      ...profile,
      merchantName: sellerName.trim(),
      storeName: storeName.trim(),
    });
    setSettings(updated);
    setProfile(storageService.getMerchantProfile());
    showToast(t.toasts.settingsSaved, 'success');
  };

  const handleRemoveMarketplace = (id: string) => {
    if (settings.marketplaces.length <= 1) {
      showToast(
        locale === 'ar' ? 'يجب الإبقاء على منصة واحدة على الأقل.' : 'At least one marketplace is required.',
        'error'
      );
      return;
    }
    storageService.removeMarketplace(id);
    setSettings(storageService.getSettings());
    showToast(
      locale === 'ar' ? 'تمت إزالة المنصة بنجاح.' : 'Marketplace removed successfully.',
      'success'
    );
  };

  const handleResetTutorials = () => {
    storageService.resetTutorial();
    showToast(
      locale === 'ar'
        ? 'تمت إعادة ضبط سجل الجولات التفاعلية بنجاح.'
        : 'All tutorials have been reset.',
      'success'
    );
  };

  const handleAddMarketplace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMktNameEn.trim()) return;

    const id = newMktNameEn.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (settings.marketplaces.some((m) => m.id === id)) {
      showToast(
        locale === 'ar' ? 'هذه المنصة مضافة مسبقاً.' : 'Marketplace already exists.',
        'error'
      );
      return;
    }

    const newMkt: MarketplaceConfig = {
      id,
      nameEn: newMktNameEn.trim(),
      nameAr: newMktNameAr.trim() || newMktNameEn.trim(),
      color: newMktColor,
      badgeBg: '#EFF6FF',
      badgeText: '#1E40AF',
      isActive: true,
    };

    storageService.addMarketplace(newMkt);
    setSettings(storageService.getSettings());
    setIsAddMktModalOpen(false);
    setNewMktNameEn('');
    setNewMktNameAr('');
    showToast(
      locale === 'ar'
        ? `تمت إضافة منصة (${newMkt.nameAr}) وأعمدتها أصبحت متوفرة في الجداول.`
        : `Added ${newMkt.nameEn} marketplace.`,
      'success'
    );
  };

  const handleExportBackup = () => {
    const backupData = {
      products: storageService.getProducts(),
      orders: storageService.getOrders(),
      movements: storageService.getMovements(),
      returns: storageService.getReturns(),
      priceHistory: storageService.getPriceHistory(),
      settings: storageService.getSettings(),
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SellerOps_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(locale === 'ar' ? 'تم تصدير النسخة الاحتياطية بنجاح.' : 'Backup exported successfully.', 'success');
  };

  const handleConfirmReset = () => {
    storageService.resetToSample();
    setSettings(storageService.getSettings());
    setSellerName(storageService.getSettings().sellerName);
    setStoreName(storageService.getSettings().storeName);
    setCurrency(storageService.getSettings().currency);
    showToast(t.toasts.dataReset, 'success');
    onDataReset();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Connected Marketplaces Section */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8ECF2] mb-4">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-[#2563EB]" />
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {t.settings.marketplacesSection}
              </h3>
              <p className="text-xs text-[#64748B]">
                {locale === 'ar'
                  ? 'إدارة المنصات التي تعرض أعمدة مخصصة في جدول المنتجات والمخزون'
                  : 'Manage active channels and dynamic table columns'}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsAddMktModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.settings.addMarketplace}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {settings.marketplaces.map((mkt) => (
            <div
              key={mkt.id}
              className="p-3 bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10"
                  style={{ backgroundColor: mkt.color }}
                />
                <div className="min-w-0">
                  <div className="font-bold text-xs text-[#172033] truncate">
                    {locale === 'ar' ? mkt.nameAr : mkt.nameEn}
                  </div>
                  <div className="text-[10px] text-[#64748B] font-mono-code truncate">
                    {mkt.nameEn} · id: {mkt.id}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-semibold text-[#16A36A] flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3" />
                  {locale === 'ar' ? 'متصل' : 'Active'}
                </span>
                {settings.marketplaces.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMarketplace(mkt.id)}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                    title={locale === 'ar' ? 'حذف المنصة' : 'Remove channel'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Google Account & Merchant Profile */}
      <form
        onSubmit={handleSaveProfile}
        className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#E8ECF2]">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-[#2563EB]" />
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {t.settings.sellerProfileSection}
              </h3>
              <p className="text-xs text-[#64748B]">
                {locale === 'ar' ? 'بيانات التاجر وحساب Google الموثق' : 'Merchant identity and verified Google account'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#F8FAFC] px-3 py-1 rounded-full border border-[#E8ECF2] text-xs">
            <div className="w-2 h-2 rounded-full bg-[#16A36A]" />
            <span className="font-mono text-[#475569] text-[11px]">a7med3bker@gmail.com</span>
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
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs"
          >
            {t.actions.save}
          </button>
        </div>
      </form>

      {/* Data Controls & Backup */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8ECF2]">
          <Database className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h3 className="text-sm font-bold text-[#172033]">
              {t.settings.dataManagement}
            </h3>
            <p className="text-xs text-[#64748B]">
              {locale === 'ar' ? 'تصدير نسخة احتياطية أو استعادة البيانات الأولية' : 'Data export and sample database restore'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-semibold text-[#172033] block">
              {t.settings.backupJson}
            </span>
            <span className="text-[#64748B] text-[11px]">
              {locale === 'ar'
                ? 'تحميل ملف JSON كامل يحتوي على كافة الكتالوجات، والطلبات، والمرتجعات، وسجلات الأسعار'
                : 'Download full JSON dump of catalog, orders, returns, and movements'}
            </span>
          </div>

          <button
            onClick={handleExportBackup}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/70 border border-[#E8ECF2] rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>{t.actions.export} (JSON)</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E8ECF2] text-xs">
          <div>
            <span className="font-semibold text-[#DC5555] block">
              {t.settings.resetSampleData}
            </span>
            <span className="text-[#64748B] text-[11px]">
              {locale === 'ar'
                ? 'إعادة ضبط النظام إلى المنتجات والطلبات النموذجية للتجربة والاختبار'
                : 'Reset database to realistic default state for sandbox testing'}
            </span>
          </div>

          <button
            onClick={() => setIsResetConfirmOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#DC5555] bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.settings.resetSampleData}</span>
          </button>
        </div>
      </div>

      {/* Interactive Guidance & Learning Center Settings */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8ECF2]">
          <GraduationCap className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h3 className="text-sm font-bold text-[#172033]">
              {locale === 'ar' ? 'الجولات الإرشادية ومركز التدريب' : 'Interactive Guidance & Training'}
            </h3>
            <p className="text-xs text-[#64748B]">
              {locale === 'ar'
                ? 'إدارة الجولات الإرشادية والمساعد التفاعلي ثلاثي الأبعاد'
                : 'Manage interactive 3D assistant guides and walk-throughs'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-semibold text-[#172033] block">
              {locale === 'ar' ? 'إعادة تشغيل الجولات الإرشادية التلقائية' : 'Reset Walk-through History'}
            </span>
            <span className="text-[#64748B] text-[11px]">
              {locale === 'ar'
                ? 'إعادة تعيين سجل المشاهدات لكي يبدأ المساعد بشرح كل صفحة عند زيارتها لأول مرة'
                : 'Reset tour completion status so guides display automatically on each view'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleResetTutorials}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#2563EB] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{locale === 'ar' ? 'إعادة تعيين الجولات' : 'Reset Tours'}</span>
          </button>
        </div>
      </div>

      {/* Developer Center & Text Export Section */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8ECF2]">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-purple-600" />
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {locale === 'ar' ? 'مركز المطورين والتصدير النصي الشامل' : 'Developer Center & Text Export'}
              </h3>
              <p className="text-xs text-[#64748B]">
                {locale === 'ar'
                  ? 'فحص شامل لبنية المشروع وشيفرته المصدرية وتصديرها كنصوص مرقمة دون ملفات مضغوطة'
                  : 'Full text-only inspection and numbered sections export of the codebase'}
              </p>
            </div>
          </div>

          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-mono-code">
            DEVELOPER ACCESS
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-semibold text-[#172033] block">
              {locale === 'ar' ? 'الوصول لمركز الفحص النصي وتوليد اللقطات' : 'Access Text-First Developer Center'}
            </span>
            <span className="text-[#64748B] text-[11px]">
              {locale === 'ar'
                ? 'يتيح نسخ أجزاء الكود والمعمارية المحاسبية ونماذج العهدة المخزنية دفعة واحدة أو جزءاً جزءاً'
                : 'Inspect actual source code, financial ledger schemas, and custody architecture'}
            </span>
          </div>

          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('developerCenter')}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{locale === 'ar' ? 'فتح مركز المطورين' : 'Open Developer Center'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Add Marketplace Modal */}
      <Modal
        isOpen={isAddMktModalOpen}
        onClose={() => setIsAddMktModalOpen(false)}
        title={t.settings.addMarketplace}
        subtitle={
          locale === 'ar'
            ? 'إضافة منصة جديدة يتيح تخصيص أسعارها وكمياتها فوراً في جدول المنتجات'
            : 'Add new marketplace channel'
        }
        maxWidth="sm"
      >
        <form onSubmit={handleAddMarketplace} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-[#172033] mb-1">
              {t.settings.marketplaceNameEn} *
            </label>
            <input
              type="text"
              required
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
              className="px-3.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors"
            >
              {t.actions.cancel}
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-xs"
            >
              {t.actions.confirm}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reset Confirmation */}
      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        onConfirm={handleConfirmReset}
        title={t.settings.resetSampleData}
        description={t.settings.resetConfirm}
        confirmText={t.actions.confirm}
        cancelText={t.actions.cancel}
        isDestructive
      />
    </div>
  );
};
