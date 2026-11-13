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
  AlertTriangle,
  Layers,
  Terminal,
  Hash,
  Clock,
  Sparkles,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { DeveloperExportService, ProjectSnapshot, SnapshotSection } from '../../services/developerExport';
import { Locale } from '../../locales/translations';
import { useToast } from '../common/Toast';

interface DeveloperCenterPageProps {
  locale: Locale;
}

export const DeveloperCenterPage: React.FC<DeveloperCenterPageProps> = ({ locale }) => {
  const isRtl = locale === 'ar';
  const { showToast } = useToast();

  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(() =>
    DeveloperExportService.getLatestOrGenerateSnapshot()
  );
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [copiedSectionIndex, setCopiedSectionIndex] = useState<number | null>(null);
  const [copiedBatchType, setCopiedBatchType] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      {/* 1. Header & Identity Bar */}
      <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-xl bg-purple-50 text-purple-700 border border-purple-200">
              <Terminal className="w-5 h-5" />
            </span>
            <h2 className="text-base font-bold text-[#172033]">
              {isRtl ? 'مركز المطورين – التصدير النصي الشامل للمشروع' : 'Developer Center – Full Text-Based Project Export'}
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white font-mono-code">
              TEXT-ONLY INSPECTION
            </span>
          </div>
          <p className="text-xs text-[#64748B]">
            {isRtl
              ? 'فحص وتصدير شامل لشيفرة المشروع ومعماريته مقسمة إلى أجزاء مرقمة قابلة للنسخ دون ملفات مضغوطة.'
              : 'Complete text-based project inspection and export divided into numbered sections without ZIP archives.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleGenerateNewSnapshot}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#172033] hover:text-[#2563EB] bg-[#F7F8FA] hover:bg-blue-50 border border-[#E8ECF2] rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isRtl ? 'توليد لقطة جديدة' : 'New Snapshot'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyAllSnapshot}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-xs cursor-pointer"
          >
            {copiedBatchType === 'all' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{isRtl ? 'نسخ كامل لقطة المشروع' : 'Copy Full Snapshot'}</span>
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
            {isRtl ? 'حساب المطور المصرح' : 'Authorized Developer'}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs font-bold font-mono-code text-[#172033] truncate">
              {snapshot.manifest.developerAccount}
            </span>
          </div>
          <span className="text-[10px] text-emerald-700 block mt-1 font-semibold">
            {isRtl ? 'وصول كامل موثق' : 'Full access granted'}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs">
          <span className="text-[10px] font-semibold text-[#64748B] block mb-1">
            {isRtl ? 'الأجزاء المرقمة' : 'Numbered Sections'}
          </span>
          <span className="text-xl font-bold font-mono-code text-[#2563EB]">
            {snapshot.manifest.totalSections} {isRtl ? 'أقسام' : 'Parts'}
          </span>
          <span className="text-[10px] text-[#64748B] block mt-0.5">
            {snapshot.manifest.totalSourceFiles} {isRtl ? 'ملف مصدري' : 'source files'}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs">
          <span className="text-[10px] font-semibold text-[#64748B] block mb-1">
            {isRtl ? 'حالة الاكتمال' : 'Integrity Status'}
          </span>
          <div className="flex items-center gap-1.5 text-emerald-600">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold font-mono-code">
              {snapshot.manifest.systemIntegrityHash.slice(0, 14)}
            </span>
          </div>
          <span className="text-[10px] text-[#64748B] block mt-0.5">
            {new Date(snapshot.manifest.exportTimestamp).toLocaleTimeString(
              isRtl ? 'ar-SA' : 'en-US',
              { hour: '2-digit', minute: '2-digit' }
            )}
          </span>
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
            className="px-3 py-1.5 rounded-lg border border-[#E8ECF2] bg-white hover:bg-slate-50 font-semibold text-[#172033] flex items-center gap-1.5 cursor-pointer"
          >
            {copiedBatchType === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Code2 className="w-3.5 h-3.5 text-purple-600" />}
            <span>{isRtl ? 'نسخ الأكواد البرمجية فقط' : 'Copy Source Code Only'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyAllDocumentation}
            className="px-3 py-1.5 rounded-lg border border-[#E8ECF2] bg-white hover:bg-slate-50 font-semibold text-[#172033] flex items-center gap-1.5 cursor-pointer"
          >
            {copiedBatchType === 'docs' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <FileCode className="w-3.5 h-3.5 text-blue-600" />}
            <span>{isRtl ? 'نسخ التوثيق والمعمارية فقط' : 'Copy Documentation Only'}</span>
          </button>
        </div>
      </div>

      {/* 4. Section Selector & Active Section Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Sidebar: Numbered Sections List */}
        <div className="lg:col-span-4 space-y-2">
          <div className="text-xs font-bold text-[#172033] px-1 flex items-center justify-between">
            <span>{isRtl ? 'فهرس أقسام المشروع' : 'Section Index'}</span>
            <span className="text-[11px] text-[#64748B]">
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
                            ? 'bg-purple-100 text-purple-800'
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

        {/* Main Content: Current Section Details & Text Viewer */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-3xl border border-[#E8ECF2] p-5 shadow-xs space-y-4">
            {/* Section Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#2563EB] font-mono-code">
                    SECTION {currentSection.sectionNumber} OF {currentSection.totalSections}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      currentSection.classification === 'ACTUAL_SOURCE_CODE'
                        ? 'bg-purple-100 text-purple-800'
                        : currentSection.classification === 'VERIFIED_AUDIT'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {currentSection.classification}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#172033] mt-1">
                  {isRtl ? currentSection.titleAr : currentSection.titleEn}
                </h3>
              </div>

              {/* Action: Copy this section */}
              <button
                type="button"
                onClick={() => handleCopySection(currentSection, currentSectionIndex)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-[#172033] hover:text-white bg-[#F7F8FA] hover:bg-[#2563EB] border border-[#E8ECF2] hover:border-[#2563EB] rounded-xl transition-all cursor-pointer shadow-2xs"
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

            {/* Source files pills */}
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

            {/* Content text viewer */}
            <div className="relative rounded-2xl bg-slate-950 text-slate-100 p-4 font-mono text-xs overflow-x-auto leading-relaxed max-h-[500px] border border-slate-800 select-text">
              <pre className="whitespace-pre-wrap break-words">{currentSection.content}</pre>
            </div>

            {/* Completion marker if last section */}
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

            {/* Stepper Controls: Previous / Next Section */}
            <div className="flex items-center justify-between pt-3 border-t border-[#E8ECF2]">
              <button
                type="button"
                disabled={currentSectionIndex === 0}
                onClick={() => setCurrentSectionIndex((prev) => Math.max(0, prev - 1))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  currentSectionIndex === 0
                    ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                    : 'text-[#172033] bg-[#F7F8FA] hover:bg-slate-200 border border-[#E8ECF2]'
                }`}
              >
                {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                <span>{isRtl ? 'الجزء السابق' : 'Previous Section'}</span>
              </button>

              <span className="text-xs text-[#64748B] font-mono-code">
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
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
    </div>
  );
};
