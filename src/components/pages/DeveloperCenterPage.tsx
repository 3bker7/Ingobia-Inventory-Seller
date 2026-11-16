import React, { useState } from 'react';
import {
  Code2,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  FileCode,
  ShieldCheck,
  RefreshCw,
  Layers,
  Terminal,
  Sparkles,
  ExternalLink,
  BookOpen,
  Globe,
  Database,
  Trash2,
  FlaskConical,
  Play,
  Lock,
  RotateCcw,
  History,
  Archive,
} from 'lucide-react';
import { DeveloperExportService, ProjectSnapshot, SnapshotSection } from '../../services/developerExport';
import { storageService } from '../../services/storage';
import { Locale } from '../../locales/translations';
import { useToast } from '../common/Toast';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface DeveloperCenterPageProps {
  locale: Locale;
  onOpenTestSuite?: () => void;
  onDataChange?: () => void;
  onLockDeveloperMode?: () => void;
}

export const DeveloperCenterPage: React.FC<DeveloperCenterPageProps> = ({
  locale,
  onOpenTestSuite,
  onDataChange,
  onLockDeveloperMode,
}) => {
  const isRtl = locale === 'ar';
  const { showToast } = useToast();
  const [dataRefreshTick, setDataRefreshTick] = useState(0);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    mode: 'load_demo' | 'clear_all' | 'restore_backup';
    backupId?: string;
  } | null>(null);

  const isDevAuthorized = storageService.isDeveloperMode();

  const liveCounts = {
    products: storageService.getProducts().length,
    orders: storageService.getOrders().length,
    returns: storageService.getReturns().length,
    transactions: storageService.getFinancialTransactions().length,
  };

  const backups = storageService.getPreDestructiveBackups();
  const auditLogs = storageService.getAdminAuditLog();

  const publishUrl =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  void dataRefreshTick;

  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(() =>
    DeveloperExportService.getLatestOrGenerateSnapshot()
  );
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [copiedSectionIndex, setCopiedSectionIndex] = useState<number | null>(null);
  const [copiedBatchType, setCopiedBatchType] = useState<string | null>(null);

  if (!isDevAuthorized) {
    return (
      <div className="bg-white rounded-2xl border border-[#E8ECF2] p-8 shadow-xs text-center space-y-3 max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-[#172033]">
          {isRtl ? 'مركز المطورين مقفل حالياً' : 'Developer Center Is Locked'}
        </h2>
        <p className="text-xs text-[#64748B] leading-relaxed">
          {isRtl
            ? 'للوصول إلى أدوات الفحص والتصدير النصي والبيانات التجريبية، يرجى تفعيل وضع المطور أولاً من صفحة الإعدادات.'
            : 'Unlock Developer Mode from the Settings page to access diagnostics, backups, sandbox controls, and text exports.'}
        </p>
      </div>
    );
  }

  const currentSection = snapshot.sections[currentSectionIndex] || snapshot.sections[0];

  const handleGenerateNewSnapshot = () => {
    const fresh = DeveloperExportService.createFullSnapshot();
    setSnapshot(fresh);
    setCurrentSectionIndex(0);
    showToast(
      isRtl
        ? `تم إنشاء لقطة مشروع جديدة بنجاح (${fresh.manifest.snapshotId})`
        : `Generated new project snapshot (${fresh.manifest.snapshotId})`,
      'success'
    );
  };

  const handleCopySection = async (section: SnapshotSection, index: number) => {
    const text = DeveloperExportService.formatSectionForExport(section);
    const ok = await DeveloperExportService.copyToClipboard(text);
    if (ok) {
      setCopiedSectionIndex(index);
      setTimeout(() => setCopiedSectionIndex(null), 2500);
      showToast(
        isRtl
          ? `تم نسخ الجزء (${section.sectionNumber}) إلى الحافظة بنجاح.`
          : `Copied section ${section.sectionNumber} to clipboard.`,
        'success'
      );
    } else {
      showToast(isRtl ? 'تعذر النسخ إلى الحافظة.' : 'Failed to copy to clipboard.', 'error');
    }
  };

  const handleCopyAllSnapshot = async () => {
    const fullText = DeveloperExportService.formatFullProjectText(snapshot);
    const ok = await DeveloperExportService.copyToClipboard(fullText);
    if (ok) {
      setCopiedBatchType('all');
      setTimeout(() => setCopiedBatchType(null), 3000);
      showToast(
        isRtl
          ? 'تم نسخ كامل لقطة المشروع بكافة الأجزاء إلى الحافظة بنجاح!'
          : 'Full project snapshot copied to clipboard successfully!',
        'success'
      );
    } else {
      showToast(
        isRtl
          ? 'الملف كبير جداً؛ يرجى نسخ كل جزء على حدة لضمان اكتمال النص.'
          : 'Snapshot is large; please copy sections individually.',
        'warning'
      );
    }
  };

  const handleCopyAllSourceCode = async () => {
    const codeSections = snapshot.sections.filter(
      (s) => s.classification === 'ACTUAL_SOURCE_CODE'
    );
    const text = codeSections
      .map((s) => DeveloperExportService.formatSectionForExport(s))
      .join('\n\n');
    const ok = await DeveloperExportService.copyToClipboard(text);
    if (ok) {
      setCopiedBatchType('code');
      setTimeout(() => setCopiedBatchType(null), 3000);
      showToast(
        isRtl
          ? 'تم نسخ كامل الأكواد البرمجية الفعلية إلى الحافظة.'
          : 'Copied all verified source code to clipboard.',
        'success'
      );
    }
  };

  const handleCopyAllDocumentation = async () => {
    const docSections = snapshot.sections.filter(
      (s) => s.classification !== 'ACTUAL_SOURCE_CODE'
    );
    const text = docSections
      .map((s) => DeveloperExportService.formatSectionForExport(s))
      .join('\n\n');
    const ok = await DeveloperExportService.copyToClipboard(text);
    if (ok) {
      setCopiedBatchType('docs');
      setTimeout(() => setCopiedBatchType(null), 3000);
      showToast(
        isRtl
          ? 'تم نسخ كامل التوثيق التقني والمعماري إلى الحافظة.'
          : 'Copied all technical documentation to clipboard.',
        'success'
      );
    }
  };

  const handleCopyPublishUrl = async (urlToCopy: string) => {
    if (!urlToCopy) return;
    const ok = await DeveloperExportService.copyToClipboard(urlToCopy);
    if (ok) {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
      showToast(
        isRtl ? 'تم نسخ رابط الجلسة الحالية بنجاح.' : 'Session URL copied to clipboard.',
        'success'
      );
    } else {
      showToast(isRtl ? 'تعذر نسخ الرابط.' : 'Failed to copy URL.', 'error');
    }
  };

  const handleLoadDemoData = () => {
    const res = storageService.loadDemoSampleData();
    if (!res.success) {
      showToast(res.error || (isRtl ? 'فشل توليد البيانات التجريبية.' : 'Failed to load demo data.'), 'error');
      return;
    }
    setDataRefreshTick((t) => t + 1);
    onDataChange?.();
    showToast(
      isRtl
        ? 'تم توليد بيانات المنتجات والطلبات التجريبية بنجاح داخل بيئة التجربة (مع حفظ نسخة احتياطية قبل الاستبدال إن وجدت بيانات).'
        : 'Demo catalog, orders, returns, and ledger generated successfully.',
      'success'
    );
  };

  const handleClearAllData = () => {
    const res = storageService.clearAllStoreData();
    if (!res.success) {
      showToast(res.error || (isRtl ? 'فشل مسح البيانات.' : 'Failed to clear store data.'), 'error');
      return;
    }
    setDataRefreshTick((t) => t + 1);
    onDataChange?.();
    showToast(
      isRtl
        ? 'تم تفريغ المتجر والعودة للحالة الفارغة النظيفة (مع حفظ نسخة احتياطية مسبقة).'
        : 'All store operational data cleared cleanly to empty production state.',
      'success'
    );
  };

  const handleCreateManualBackup = () => {
    storageService.createPreDestructiveBackup('نسخة يدوية من مركز المطور');
    setDataRefreshTick((t) => t + 1);
    showToast(
      isRtl ? 'تم التقاط نسخة احتياطية فورية في السجل.' : 'Snapshot captured in backup history.',
      'success'
    );
  };

  const handleRestoreBackup = (backupId: string) => {
    const res = storageService.restorePreDestructiveBackup(backupId);
    if (!res.success) {
      showToast(res.error || (isRtl ? 'فشل استعادة النسخة.' : 'Failed to restore backup.'), 'error');
      return;
    }
    setDataRefreshTick((t) => t + 1);
    onDataChange?.();
    showToast(
      isRtl ? 'تمت استعادة النسخة الاحتياطية بنجاح.' : 'Pre-destructive backup restored successfully.',
      'success'
    );
  };

  const handleLockDeveloper = () => {
    storageService.lockDeveloperMode();
    onLockDeveloperMode?.();
    onDataChange?.();
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Identity Bar */}
      <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="p-1.5 rounded-xl bg-slate-100 text-[#172033] border border-[#E8ECF2]">
              <Terminal className="w-5 h-5" />
            </span>
            <h2 className="text-base font-bold text-[#172033]">
              {isRtl ? 'مركز المطورين – الفحص والتشخيص والتصدير النصي' : 'Developer Center – Diagnostics & Text Export'}
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white font-mono-code">
              TEXT-ONLY INSPECTION
            </span>
          </div>
          <p className="text-xs text-[#64748B]">
            {isRtl
              ? 'فحص وتصدير شامل للمشروع، النسخ الاحتياطي قبل التعديل، سجل التدقيق، وبيئة الاختبار المعزولة.'
              : 'Text-based inspection, pre-destructive backups, admin audit trail, and isolated sandbox controls.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleGenerateNewSnapshot}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#172033] hover:text-[#2563EB] bg-[#F7F8FA] hover:bg-blue-50 border border-[#E8ECF2] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isRtl ? 'توليد لقطة جديدة' : 'New Snapshot'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyAllSnapshot}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedBatchType === 'all' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{isRtl ? 'نسخ كامل لقطة المشروع' : 'Copy Full Snapshot'}</span>
          </button>

          <button
            type="button"
            onClick={handleLockDeveloper}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200 border border-[#E8ECF2] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{isRtl ? 'قفل وضع المطور' : 'Lock Developer Mode'}</span>
          </button>
        </div>
      </div>

      {/* 2. Snapshot Manifest & Verification Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs">
          <span className="text-[10px] font-semibold text-[#64748B] block mb-1">
            {isRtl ? 'معرف اللقطة (Snapshot ID)' : 'Snapshot ID'}
          </span>
          <span className="text-xs font-bold font-mono-code text-[#172033] block truncate">
            {snapshot.manifest.snapshotId}
          </span>
          <span className="text-[10px] text-slate-500 block mt-1 font-mono-code">
            {snapshot.manifest.projectVersion}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs">
          <span className="text-[10px] font-semibold text-[#64748B] block mb-1">
            {isRtl ? 'دور الجلسة المصرحة' : 'Session Role'}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs font-bold font-mono-code text-[#172033] truncate">
              {snapshot.manifest.developerAccount}
            </span>
          </div>
          <span className="text-[10px] text-emerald-700 block mt-1 font-semibold">
            {isRtl ? 'وصول محلي مصرح به' : 'Authorized local session'}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs">
          <span className="text-[10px] font-semibold text-[#64748B] block mb-1">
            {isRtl ? 'الأجزاء المرقمة' : 'Numbered Sections'}
          </span>
          <span className="text-xl font-bold font-mono-code text-[#2563EB] tabular-nums">
            {snapshot.manifest.totalSections} {isRtl ? 'أقسام' : 'Parts'}
          </span>
          <span className="text-[10px] text-[#64748B] block mt-0.5 tabular-nums">
            {snapshot.manifest.totalSourceFiles} {isRtl ? 'ملف مصدري' : 'source files'}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs">
          <span className="text-[10px] font-semibold text-[#64748B] block mb-1">
            {isRtl ? 'توقيع الحزمة الحتمي' : 'Deterministic Hash'}
          </span>
          <div className="flex items-center gap-1.5 text-emerald-600">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold font-mono-code">
              {snapshot.manifest.systemIntegrityHash.slice(0, 14)}
            </span>
          </div>
          <span className="text-[10px] text-[#64748B] block mt-0.5 tabular-nums">
            {new Date(snapshot.manifest.exportTimestamp).toLocaleTimeString(
              isRtl ? 'ar-SA' : 'en-US',
              { hour: '2-digit', minute: '2-digit' }
            )}
          </span>
        </div>
      </div>

      {/* 2.5 Runtime Session Link & Isolated QA/Demo Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs space-y-3.5">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-blue-50 text-[#2563EB] border border-blue-200">
              <Globe className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {isRtl ? 'رابط الجلسة الحية والدخول من المتصفح' : 'Live Session Origin URL'}
              </h3>
              <p className="text-[11px] text-[#64748B]">
                {isRtl
                  ? 'يتم توليد الرابط ديناميكياً من عنوان النشر الفعلي الحالي دون أي روابط ثابتة.'
                  : 'Dynamically resolved from window.location.origin with zero hardcoded deployment URLs.'}
              </p>
            </div>
          </div>

          {publishUrl ? (
            <div className="p-3 bg-[#F7F8FA] rounded-2xl border border-[#E8ECF2] flex flex-wrap items-center justify-between gap-2.5">
              <code className="text-xs font-mono-code text-[#172033] break-all flex-1 min-w-[200px]" dir="ltr">
                {publishUrl}
              </code>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopyPublishUrl(publishUrl)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#172033] bg-white hover:bg-slate-100 border border-[#E8ECF2] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[#2563EB]" />}
                  <span>{isRtl ? 'نسخ الرابط' : 'Copy URL'}</span>
                </button>
                <a
                  href={publishUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors whitespace-nowrap shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{isRtl ? 'فتح نافذة' : 'Open Tab'}</span>
                </a>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-[#F7F8FA] rounded-2xl border border-[#E8ECF2] text-xs text-[#64748B]">
              {isRtl ? 'لا يتوفر عنوان متصفح نشط في هذه البيئة.' : 'No active browser origin detected.'}
            </div>
          )}
        </div>

        {/* Developer-Only Demo Data & Logic Test Suite */}
        <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs space-y-3.5">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
              <Database className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {isRtl ? 'بيئة التجربة والاختبار (للمطور فقط)' : 'Developer QA & Demo Data Sandbox'}
              </h3>
              <p className="text-[11px] text-[#64748B]">
                {isRtl
                  ? 'يحفظ النظام نسخة احتياطية قبل أي توليد بيانات تجريبية أو تفريغ للمتجر.'
                  : 'Automatic pre-destructive backup is captured before seeding demo data or clearing store records.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
            <div className="p-2 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2]">
              <span className="text-[#64748B] block">{isRtl ? 'المنتجات' : 'Products'}</span>
              <strong className="text-sm font-mono-code text-[#172033] tabular-nums">{liveCounts.products}</strong>
            </div>
            <div className="p-2 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2]">
              <span className="text-[#64748B] block">{isRtl ? 'الطلبات' : 'Orders'}</span>
              <strong className="text-sm font-mono-code text-[#172033] tabular-nums">{liveCounts.orders}</strong>
            </div>
            <div className="p-2 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2]">
              <span className="text-[#64748B] block">{isRtl ? 'المرتجعات' : 'Returns'}</span>
              <strong className="text-sm font-mono-code text-[#172033] tabular-nums">{liveCounts.returns}</strong>
            </div>
            <div className="p-2 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2]">
              <span className="text-[#64748B] block">{isRtl ? 'القيود' : 'Ledger'}</span>
              <strong className="text-sm font-mono-code text-[#172033] tabular-nums">{liveCounts.transactions}</strong>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                liveCounts.products > 0 || liveCounts.orders > 0
                  ? setConfirmState({ mode: 'load_demo' })
                  : handleLoadDemoData()
              }
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isRtl ? 'توليد بيانات تجريبية' : 'Generate Demo Data'}</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmState({ mode: 'clear_all' })}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-[#DC5555] bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isRtl ? 'تفريغ المتجر (صفر بيانات)' : 'Clear Store'}</span>
            </button>

            {onOpenTestSuite && (
              <button
                type="button"
                onClick={onOpenTestSuite}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-[#172033] bg-[#F7F8FA] hover:bg-slate-200 border border-[#E8ECF2] rounded-xl transition-colors cursor-pointer ms-auto whitespace-nowrap shrink-0"
              >
                <FlaskConical className="w-3.5 h-3.5 text-[#2563EB]" />
                <span>{isRtl ? 'اختبارات قواعد العمليات' : 'Operations Test Suite'}</span>
                <Play className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2.75 Pre-Destructive Backups & Admin Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Backups Viewer */}
        <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#E8ECF2]">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-[#2563EB]" />
              <h3 className="text-sm font-bold text-[#172033]">
                {isRtl ? 'النسخ الاحتياطية قبل التعديل (Pre-Destructive)' : 'Pre-Destructive Backups'}
              </h3>
            </div>
            <button
              type="button"
              onClick={handleCreateManualBackup}
              className="px-3 py-1 text-[11px] font-semibold text-[#2563EB] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              {isRtl ? 'التقاط نسخة الآن' : 'Capture Snapshot'}
            </button>
          </div>

          {backups.length === 0 ? (
            <div className="text-xs text-[#64748B] py-4 text-center">
              {isRtl
                ? 'لا توجد نسخ احتياطية مسبقة مسجلة لهذا المتجر بعد.'
                : 'No pre-destructive backups captured for this workspace yet.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
              {backups.map((bkp) => (
                <div
                  key={bkp.id}
                  className="p-3 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2] flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[#172033] truncate">{bkp.reason}</div>
                    <div className="text-[10px] text-[#64748B] font-mono-code mt-0.5">
                      {new Date(bkp.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US')} ·{' '}
                      {bkp.data.products.length} SKU / {bkp.data.orders.length} ORD
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmState({ mode: 'restore_backup', backupId: bkp.id })}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-[#2563EB] bg-white hover:bg-blue-50 border border-blue-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{isRtl ? 'استعادة' : 'Restore'}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Admin Audit Log Viewer */}
        <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#E8ECF2]">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#172033]" />
              <h3 className="text-sm font-bold text-[#172033]">
                {isRtl ? 'سجل التدقيق الإداري والعمليات الحساسة' : 'Admin & Security Audit Log'}
              </h3>
            </div>
            <span className="text-[11px] font-mono-code text-[#64748B] tabular-nums">
              {auditLogs.length} {isRtl ? 'قيد' : 'entries'}
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <div className="text-xs text-[#64748B] py-4 text-center">
              {isRtl ? 'السجل الإداري فارغ حالياً.' : 'No admin audit events recorded yet.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
              {auditLogs.slice(0, 20).map((entry) => (
                <div
                  key={entry.id}
                  className="p-2.5 bg-[#F7F8FA] rounded-xl border border-[#E8ECF2] text-[11px] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-code font-bold text-[#172033]">
                      {entry.action}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        entry.success
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {entry.success ? 'OK' : 'DENIED'}
                    </span>
                  </div>
                  <div className="text-[#475569]">{entry.details}</div>
                  <div className="text-[10px] text-[#64748B] font-mono-code">
                    {new Date(entry.timestamp).toLocaleString(isRtl ? 'ar-SA' : 'en-US')} ·{' '}
                    {entry.actorRole} · {entry.merchantId}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Batch Copy Tools */}
      <div className="bg-[#F8FAFC] p-3.5 rounded-2xl border border-[#E8ECF2] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-[#64748B]">
          <BookOpen className="w-4 h-4 text-[#2563EB]" />
          <span>
            {isRtl
              ? 'أدوات النسخ المباشر المخصص (لتجاوز حدود النسخ الدفعة الواحدة عند الحاجة):'
              : 'Direct batch copying tools (to prevent truncation on large clipboards):'}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleCopyAllSourceCode}
            className="px-3 py-1.5 rounded-lg border border-[#E8ECF2] bg-white hover:bg-slate-50 font-semibold text-[#172033] flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedBatchType === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Code2 className="w-3.5 h-3.5 text-[#2563EB]" />}
            <span>{isRtl ? 'نسخ الأكواد البرمجية فقط' : 'Copy Source Code Only'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyAllDocumentation}
            className="px-3 py-1.5 rounded-lg border border-[#E8ECF2] bg-white hover:bg-slate-50 font-semibold text-[#172033] flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedBatchType === 'docs' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <FileCode className="w-3.5 h-3.5 text-blue-600" />}
            <span>{isRtl ? 'نسخ التوثيق والمعمارية فقط' : 'Copy Documentation Only'}</span>
          </button>
        </div>
      </div>

      {/* 4. Section Selector & Active Section Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 space-y-2">
          <div className="text-xs font-bold text-[#172033] px-1 flex items-center justify-between">
            <span>{isRtl ? 'فهرس أقسام المشروع' : 'Section Index'}</span>
            <span className="text-[11px] text-[#64748B] tabular-nums">
              {currentSectionIndex + 1} / {snapshot.sections.length}
            </span>
          </div>

          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pe-1">
            {snapshot.sections.map((sec, idx) => {
              const isSelected = idx === currentSectionIndex;
              return (
                <button
                  key={sec.sectionNumber}
                  type="button"
                  onClick={() => setCurrentSectionIndex(idx)}
                  className={`w-full p-3 rounded-2xl border text-start transition-all cursor-pointer flex items-start gap-3 ${
                    isSelected
                      ? 'bg-blue-50/70 border-[#2563EB] shadow-xs'
                      : 'bg-white border-[#E8ECF2] hover:border-slate-300'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-lg text-[11px] font-bold font-mono-code flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-slate-100 text-[#64748B]'
                    }`}
                  >
                    {sec.sectionNumber}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#172033] truncate">
                      {isRtl ? sec.titleAr : sec.titleEn}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                          sec.classification === 'ACTUAL_SOURCE_CODE'
                            ? 'bg-blue-100 text-blue-800'
                            : sec.classification === 'VERIFIED_AUDIT'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {sec.classification}
                      </span>
                      <span className="text-[10px] text-[#64748B] font-mono-code truncate">
                        {sec.sourceFiles.length} files
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#2563EB] font-mono-code">
                    SECTION {currentSection.sectionNumber} OF {currentSection.totalSections}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      currentSection.classification === 'ACTUAL_SOURCE_CODE'
                        ? 'bg-blue-100 text-blue-800'
                        : currentSection.classification === 'VERIFIED_AUDIT'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {currentSection.classification}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#172033] mt-1">
                  {isRtl ? currentSection.titleAr : currentSection.titleEn}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => handleCopySection(currentSection, currentSectionIndex)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-[#172033] hover:text-white bg-[#F7F8FA] hover:bg-[#2563EB] border border-[#E8ECF2] hover:border-[#2563EB] rounded-xl transition-all cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              >
                {copiedSectionIndex === currentSectionIndex ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isRtl ? 'تم النسخ!' : 'Copied!'}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{isRtl ? 'نسخ هذا الجزء' : 'Copy Section'}</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="font-semibold text-[#64748B]">
                {isRtl ? 'الملفات المرجعية:' : 'Source Files:'}
              </span>
              {currentSection.sourceFiles.map((sf) => (
                <span
                  key={sf}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 font-mono-code text-[10px] border border-slate-200"
                >
                  {sf}
                </span>
              ))}
            </div>

            <div className="relative rounded-2xl bg-slate-950 text-slate-100 p-4 font-mono text-xs overflow-x-auto leading-relaxed max-h-[500px] border border-slate-800 select-text">
              <pre className="whitespace-pre-wrap break-words">{currentSection.content}</pre>
            </div>

            {currentSection.sectionNumber === currentSection.totalSections && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-800 font-bold">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <span>PROJECT SNAPSHOT COMPLETE</span>
                </div>
                <span className="text-[11px] font-mono-code font-normal text-emerald-700">
                  {isRtl ? 'كافة الأجزاء مكتملة وموثقة بالكامل' : 'All sections verified and present'}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                disabled={currentSectionIndex === 0}
                onClick={() => setCurrentSectionIndex((prev) => Math.max(0, prev - 1))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  currentSectionIndex === 0
                    ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                    : 'text-[#172033] bg-[#F7F8FA] hover:bg-slate-200 border border-[#E8ECF2]'
                }`}
              >
                {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                <span>{isRtl ? 'الجزء السابق' : 'Previous Section'}</span>
              </button>

              <span className="text-xs text-[#64748B] font-mono-code tabular-nums">
                {currentSectionIndex + 1} / {snapshot.sections.length}
              </span>

              <button
                type="button"
                disabled={currentSectionIndex === snapshot.sections.length - 1}
                onClick={() =>
                  setCurrentSectionIndex((prev) =>
                    Math.min(snapshot.sections.length - 1, prev + 1)
                  )
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  currentSectionIndex === snapshot.sections.length - 1
                    ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                    : 'text-[#172033] bg-[#F7F8FA] hover:bg-slate-200 border border-[#E8ECF2]'
                }`}
              >
                <span>{isRtl ? 'الجزء التالي' : 'Next Section'}</span>
                {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmState !== null}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          if (confirmState?.mode === 'load_demo') handleLoadDemoData();
          if (confirmState?.mode === 'clear_all') handleClearAllData();
          if (confirmState?.mode === 'restore_backup' && confirmState.backupId) {
            handleRestoreBackup(confirmState.backupId);
          }
          setConfirmState(null);
        }}
        title={
          confirmState?.mode === 'load_demo'
            ? isRtl
              ? 'توليد بيانات تجريبية داخل بيئة المطور'
              : 'Generate Demo Trial Dataset'
            : confirmState?.mode === 'restore_backup'
            ? isRtl
              ? 'استعادة نسخة احتياطية مسبقة'
              : 'Restore Pre-Destructive Backup'
            : isRtl
            ? 'تفريغ المتجر والعودة للحالة الفارغة'
            : 'Clear All Operational Store Data'
        }
        description={
          confirmState?.mode === 'load_demo'
            ? isRtl
              ? 'سيتم حفظ نسخة احتياطية من البيانات الحالية تلقائياً ثم استبدالها ببيانات تجريبية متزامنة للاختبار.'
              : 'Automatically snapshots current store data first, then replaces it with synchronized demo data for QA.'
            : confirmState?.mode === 'restore_backup'
            ? isRtl
              ? 'سيتم استرجاع جميع المنتجات والطلبات والمرتجعات والقيود المالية من هذه اللقطة.'
              : 'All products, orders, returns, movements, and financial ledger entries from this snapshot will be restored.'
            : isRtl
            ? 'سيتم حفظ نسخة احتياطية مسبقة ثم مسح جميع المنتجات والطلبات والمرتجعات والحركات والقيود المالية ليصبح المتجر فارغاً.'
            : 'Automatically snapshots current records first, then clears operational entities back to an empty production state.'
        }
        confirmText={isRtl ? 'تأكيد التنفيذ' : 'Confirm'}
        cancelText={isRtl ? 'إلغاء' : 'Cancel'}
        isDestructive={confirmState?.mode === 'clear_all'}
      />
    </div>
  );
};
