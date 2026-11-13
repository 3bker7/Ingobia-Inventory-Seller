import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Download,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCheck,
  RefreshCw,
  Info,
  ShieldCheck,
  Package,
} from 'lucide-react';
import { ExcelValidationResult } from '../../types';
import { storageService } from '../../services/storage';
import {
  generateExcelTemplate,
  parseAndValidateExcel,
  executeExcelImport,
  OFFICIAL_TEMPLATE_COLUMNS,
} from '../../services/excel';
import { translations, Locale } from '../../locales/translations';
import { useToast } from '../common/Toast';

interface ExcelImportPageProps {
  locale: Locale;
  onNavigateToProducts: () => void;
}

export const ExcelImportPage: React.FC<ExcelImportPageProps> = ({
  locale,
  onNavigateToProducts,
}) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ExcelValidationResult | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'new' | 'existing' | 'duplicate' | 'invalid'>('all');
  const [importSummary, setImportSummary] = useState<{
    importedNew: number;
    updatedExisting: number;
    totalProcessed: number;
  } | null>(null);

  // Template Download Handler - 100% EMPTY HEADERS ONLY
  const handleDownloadTemplate = () => {
    generateExcelTemplate();
    showToast(
      locale === 'ar'
        ? 'تم تحميل نموذج إكسيل المعتمد (فارغ تماماً وجاهز لتعبئة البيانات)'
        : 'Official blank Excel template downloaded with standard headers only.',
      'success'
    );
  };

  // Process File Upload
  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      showToast(
        locale === 'ar' ? 'يرجى اختيار ملف بصيغة .xlsx فقط.' : 'Please upload a .xlsx file only.',
        'error'
      );
      return;
    }

    setIsProcessing(true);
    setCurrentFile(file);
    setImportSummary(null);

    try {
      const result = await parseAndValidateExcel(file);
      setValidationResult(result);
      if (result.isValid) {
        showToast(
          locale === 'ar'
            ? `تم فحص الملف بنجاح. جاهز لاستيراد ${result.validCount} منتجاً مركزياً.`
            : `File parsed successfully. ${result.validCount} valid products ready.`,
          'success'
        );
      } else {
        showToast(
          locale === 'ar'
            ? `تم العثور على أخطاء أو تكرار في ${result.invalidCount + result.duplicateCount} أسطر.`
            : `Found issues in ${result.invalidCount + result.duplicateCount} rows.`,
          'warning'
        );
      }
    } catch (e) {
      console.error(e);
      showToast(locale === 'ar' ? 'تعذر قراءة ملف الإكسيل.' : 'Failed to parse Excel file.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Drag and Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  // Confirm Import
  const handleConfirmImport = () => {
    if (!validationResult) return;

    const validRows = validationResult.rows
      .filter((r) => (r.status === 'new' || r.status === 'existing') && r.data)
      .map((r) => r.data!);

    if (validRows.length === 0) {
      showToast(
        locale === 'ar' ? 'لا توجد سجلات صالحة للاستيراد.' : 'No valid records to import.',
        'warning'
      );
      return;
    }

    const summary = executeExcelImport(validRows, settings.sellerName);
    setImportSummary(summary);
    showToast(t.toasts.excelImported, 'success');
  };

  // Filter preview rows by selected tab
  const displayedRows = validationResult
    ? validationResult.rows.filter((r) => {
        if (activeTab === 'all') return true;
        if (activeTab === 'new') return r.status === 'new';
        if (activeTab === 'existing') return r.status === 'existing';
        if (activeTab === 'duplicate') return r.status === 'duplicate_in_file';
        if (activeTab === 'invalid') return r.status === 'invalid';
        return true;
      })
    : [];

  return (
    <div className="space-y-6">
      {/* 3 Step Guide Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Step 1: Template */}
        <div className="bg-white p-4 rounded-xl border border-[#E8ECF2] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#172033] mb-1.5">
              <Download className="w-4 h-4 text-[#2563EB]" />
              <span>{locale === 'ar' ? 'تحميل نموذج إكسيل المعتمد' : 'Download Blank Template'}</span>
            </div>
            <p className="text-[11px] text-[#64748B] leading-relaxed">
              {locale === 'ar'
                ? 'نموذج فارغ تماماً يتضمن الـ 8 أعمدة المعتمدة فقط دون أي صفوف أو بيانات تجريبية.'
                : 'A clean 8-column empty template with headers only and zero dummy rows.'}
            </p>
          </div>
          <button
            onClick={handleDownloadTemplate}
            className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#2563EB] bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t.excelImport.downloadBtn}</span>
          </button>
        </div>

        {/* Step 2: Unified 8-Column Architecture */}
        <div className="bg-white p-4 rounded-xl border border-[#E8ECF2] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#172033] mb-1.5">
              <Package className="w-4 h-4 text-[#16A36A]" />
              <span>{locale === 'ar' ? 'هيكلية السجل المركزي' : 'Unified Central Record'}</span>
            </div>
            <p className="text-[11px] text-[#64748B] leading-relaxed">
              {locale === 'ar'
                ? 'ملف واحد يحتوي على 8 أعمدة معتمدة يجمع المخزون الفعلي بالمستودع مع أسعار وكميات منصتي نون وأمازون بشكل مستقل تماماً.'
                : 'A single 8-column spreadsheet unites physical stock with independent Noon and Amazon listings.'}
            </p>
          </div>
          <div className="mt-2 text-[10px] text-[#64748B] bg-[#F7F8FA] p-2 rounded border border-[#E8ECF2] font-mono-code truncate">
            {OFFICIAL_TEMPLATE_COLUMNS.slice(0, 4).join(' | ')}...
          </div>
        </div>

        {/* Step 3: Rules & Safe Guarding */}
        <div className="bg-white p-4 rounded-xl border border-[#E8ECF2] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#172033] mb-1.5">
              <ShieldCheck className="w-4 h-4 text-[#D99A27]" />
              <span>{locale === 'ar' ? 'ضمانات التحديث الآمن' : 'Safe Update Guarantees'}</span>
            </div>
            <ul className="text-[11px] text-[#64748B] space-y-1 list-disc ps-4">
              <li>{t.excelImport.importantRule1}</li>
              <li>{t.excelImport.importantRule2}</li>
              <li>{t.excelImport.importantRule3}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Upload Zone */}
      {!validationResult && !importSummary && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`bg-white rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-[#2563EB] bg-blue-50/30'
              : 'border-[#E8ECF2] hover:border-slate-300 hover:bg-[#F7F8FA]/60'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFile(e.target.files[0]);
              }
            }}
          />

          <div className="w-12 h-12 rounded-xl bg-blue-50 text-[#2563EB] mx-auto flex items-center justify-center mb-3">
            {isProcessing ? (
              <RefreshCw className="w-6 h-6 animate-spin" />
            ) : (
              <UploadCloud className="w-6 h-6" />
            )}
          </div>

          <h3 className="text-sm font-bold text-[#172033] mb-1">
            {isProcessing ? t.excelImport.analyzing : t.excelImport.dragDropText}
          </h3>
          <p className="text-xs text-[#64748B]">{t.excelImport.fileSupported}</p>

          <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-[#2563EB] font-semibold bg-white border border-[#E8ECF2] px-3 py-1.5 rounded-lg shadow-xs">
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              {locale === 'ar'
                ? 'استيراد كتالوج المنتجات الموحد (8 أعمدة معتمدة)'
                : 'Unified 8-Column Products Catalog Import'}
            </span>
          </div>
        </div>
      )}

      {/* Import Completion Summary */}
      {importSummary && (
        <div className="bg-white rounded-xl border border-[#E8ECF2] p-6 shadow-xs text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-[#16A36A] mx-auto flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7" />
          </div>

          <div>
            <h3 className="text-base font-bold text-[#172033]">
              {t.excelImport.importSuccessTitle}
            </h3>
            <p className="text-xs text-[#64748B] mt-1">
              {locale === 'ar'
                ? `تم بنجاح تحديث وتخصيص المخزون الفعلي وإدراجات نون وأمازون (${importSummary.totalProcessed} منتج)`
                : `Successfully processed physical stock and marketplace listings (${importSummary.totalProcessed} items)`}
            </p>
          </div>

          <div className="grid grid-cols-2 max-w-md mx-auto gap-3 text-start">
            <div className="p-3 bg-[#F7F8FA] rounded-lg border border-[#E8ECF2]">
              <span className="text-[11px] text-[#64748B] block mb-0.5">
                {t.excelImport.summaryNew}
              </span>
              <span className="text-xl font-bold text-[#16A36A] tabular-nums">
                +{importSummary.importedNew}
              </span>
            </div>

            <div className="p-3 bg-[#F7F8FA] rounded-lg border border-[#E8ECF2]">
              <span className="text-[11px] text-[#64748B] block mb-0.5">
                {t.excelImport.summaryUpdated}
              </span>
              <span className="text-xl font-bold text-[#2563EB] tabular-nums">
                {importSummary.updatedExisting}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => {
                setValidationResult(null);
                setImportSummary(null);
                setCurrentFile(null);
              }}
              className="px-4 py-2 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer"
            >
              {locale === 'ar' ? 'استيراد ملف آخر' : 'Import another file'}
            </button>

            <button
              onClick={onNavigateToProducts}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              {locale === 'ar' ? 'الذهاب لجدول المنتجات' : 'View products catalog'}
            </button>
          </div>
        </div>
      )}

      {/* File Validation Results & Pre-Import Preview Table */}
      {validationResult && !importSummary && (
        <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-xs overflow-hidden space-y-4 p-5">
          {/* Header Stats */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2]">
            <div>
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-[#2563EB]" />
                <h3 className="text-sm font-bold text-[#172033]">
                  {t.excelImport.previewTitle}
                </h3>
              </div>
              <p className="text-xs text-[#64748B] mt-0.5 font-mono-code">
                {currentFile?.name}
              </p>
            </div>

            {/* Overall Validity Status */}
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                  validationResult.isValid
                    ? 'bg-emerald-50 text-[#16A36A] border-emerald-200'
                    : 'bg-amber-50 text-[#D99A27] border-amber-200'
                }`}
              >
                {validationResult.isValid
                  ? (locale === 'ar' ? 'جاهز للاعتماد بالكامل' : 'Ready for import')
                  : (locale === 'ar' ? 'يحتوي على أخطاء أو تكرار' : 'Contains errors / duplicates')}
              </span>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="p-2.5 bg-[#F7F8FA] rounded-lg border border-[#E8ECF2]">
              <span className="text-[10px] text-[#64748B] block">{locale === 'ar' ? 'إجمالي الأسطر' : 'Total'}</span>
              <span className="text-base font-bold text-[#172033] tabular-nums">
                {validationResult.totalRows}
              </span>
            </div>
            <div className="p-2.5 bg-emerald-50/50 rounded-lg border border-emerald-100">
              <span className="text-[10px] text-[#16A36A] block">{t.excelImport.tabNew}</span>
              <span className="text-base font-bold text-[#16A36A] tabular-nums">
                {validationResult.newProductsCount}
              </span>
            </div>
            <div className="p-2.5 bg-blue-50/50 rounded-lg border border-blue-100">
              <span className="text-[10px] text-[#2563EB] block">{t.excelImport.tabExisting}</span>
              <span className="text-base font-bold text-[#2563EB] tabular-nums">
                {validationResult.existingProductsCount}
              </span>
            </div>
            <div className="p-2.5 bg-amber-50/50 rounded-lg border border-amber-100">
              <span className="text-[10px] text-[#D99A27] block">{t.excelImport.tabDuplicates}</span>
              <span className="text-base font-bold text-[#D99A27] tabular-nums">
                {validationResult.duplicateCount}
              </span>
            </div>
            <div className="p-2.5 bg-rose-50/50 rounded-lg border border-rose-100">
              <span className="text-[10px] text-[#DC5555] block">{t.excelImport.tabInvalid}</span>
              <span className="text-base font-bold text-[#DC5555] tabular-nums">
                {validationResult.invalidCount}
              </span>
            </div>
          </div>

          {/* Tab Filter Controls */}
          <div className="flex items-center gap-1 bg-[#F7F8FA] p-1 rounded-lg border border-[#E8ECF2] overflow-x-auto">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-white text-[#172033] shadow-xs font-semibold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {t.excelImport.tabAll} ({validationResult.totalRows})
            </button>
            <button
              onClick={() => setActiveTab('new')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'new'
                  ? 'bg-white text-[#16A36A] shadow-xs font-semibold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {t.excelImport.tabNew} ({validationResult.newProductsCount})
            </button>
            <button
              onClick={() => setActiveTab('existing')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'existing'
                  ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {t.excelImport.tabExisting} ({validationResult.existingProductsCount})
            </button>
            {validationResult.duplicateCount > 0 && (
              <button
                onClick={() => setActiveTab('duplicate')}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === 'duplicate'
                    ? 'bg-white text-[#D99A27] shadow-xs font-semibold'
                    : 'text-[#64748B] hover:text-[#172033]'
                }`}
              >
                {t.excelImport.tabDuplicates} ({validationResult.duplicateCount})
              </button>
            )}
            {validationResult.invalidCount > 0 && (
              <button
                onClick={() => setActiveTab('invalid')}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === 'invalid'
                    ? 'bg-white text-[#DC5555] shadow-xs font-semibold'
                    : 'text-[#64748B] hover:text-[#172033]'
                }`}
              >
                {t.excelImport.tabInvalid} ({validationResult.invalidCount})
              </button>
            )}
          </div>

          {/* Centralized 8-Column Preview Table */}
          <div className="border border-[#E8ECF2] rounded-lg overflow-x-auto max-h-96">
            <table className="w-full text-start text-xs border-collapse">
              <thead className="sticky top-0 bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-2.5 px-3 text-start w-14">{locale === 'ar' ? 'السطر' : 'Row'}</th>
                  <th className="py-2.5 px-3 text-start">{t.products.productColumn}</th>
                  <th className="py-2.5 px-3 text-start">SKU</th>
                  <th className="py-2.5 px-3 text-center">{locale === 'ar' ? 'المخزون الفعلي' : 'Physical'}</th>
                  <th className="py-2.5 px-3 text-center bg-amber-50/40 text-amber-900">
                    {locale === 'ar' ? 'نون (سعر | كمية)' : 'Noon (Price | Qty)'}
                  </th>
                  <th className="py-2.5 px-3 text-center bg-sky-50/40 text-sky-900">
                    {locale === 'ar' ? 'أمازون (سعر | كمية)' : 'Amazon (Price | Qty)'}
                  </th>
                  <th className="py-2.5 px-3 text-start">{locale === 'ar' ? 'التصنيف' : 'Classification'}</th>
                  <th className="py-2.5 px-3 text-start">{locale === 'ar' ? 'النتيجة والملاحظات' : 'Remarks'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8ECF2]">
                {displayedRows.map((row) => {
                  const isNew = row.status === 'new';
                  const isExisting = row.status === 'existing';
                  const isDup = row.status === 'duplicate_in_file';
                  const isInvalid = row.status === 'invalid';

                  return (
                    <tr
                      key={row.rowNumber}
                      className={
                        isInvalid
                          ? 'bg-rose-50/40'
                          : isDup
                          ? 'bg-amber-50/40'
                          : 'hover:bg-[#F7F8FA]/60'
                      }
                    >
                      <td className="py-2 px-3 text-[#64748B] tabular-nums font-mono-code">
                        #{row.rowNumber}
                      </td>
                      <td className="py-2 px-3 font-semibold text-[#172033] max-w-xs truncate">
                        {row.data?.productName || String(row.raw.name || '—')}
                      </td>
                      <td className="py-2 px-3 font-mono-code text-[#64748B]">
                        {row.data?.sku || String(row.raw.sku || '—')}
                      </td>
                      <td className="py-2 px-3 text-center font-bold tabular-nums text-[#172033]">
                        {row.data?.physicalStock !== undefined
                          ? row.data.physicalStock
                          : String(row.raw.physicalStock || '0')}
                      </td>
                      {/* Noon */}
                      <td className="py-2 px-3 text-center tabular-nums bg-amber-50/20">
                        {row.data ? (
                          <span className="font-mono-code">
                            {row.data.noonPrice} {settings.currency} | <strong>{row.data.noonQuantity}</strong>
                          </span>
                        ) : (
                          `${row.raw.noonPrice || 0} | ${row.raw.noonQty || 0}`
                        )}
                      </td>
                      {/* Amazon */}
                      <td className="py-2 px-3 text-center tabular-nums bg-sky-50/20">
                        {row.data ? (
                          <span className="font-mono-code">
                            {row.data.amazonPrice} {settings.currency} | <strong>{row.data.amazonQuantity}</strong>
                          </span>
                        ) : (
                          `${row.raw.amazonPrice || 0} | ${row.raw.amazonQty || 0}`
                        )}
                      </td>
                      {/* Classification Badge */}
                      <td className="py-2 px-3">
                        {isNew && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-[#16A36A] border border-emerald-200">
                            {t.excelImport.tabNew}
                          </span>
                        )}
                        {isExisting && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#2563EB] border border-blue-200">
                            {t.excelImport.tabExisting}
                          </span>
                        )}
                        {isDup && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-[#D99A27] border border-amber-200">
                            {t.excelImport.tabDuplicates}
                          </span>
                        )}
                        {isInvalid && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-50 text-[#DC5555] border border-rose-200">
                            {t.excelImport.tabInvalid}
                          </span>
                        )}
                      </td>
                      {/* Remarks */}
                      <td className="py-2 px-3 text-[11px]">
                        {row.errors.length > 0 ? (
                          <div className="text-[#DC5555] space-y-0.5">
                            {row.errors.map((err, errIdx) => (
                              <p key={errIdx}>• {err}</p>
                            ))}
                          </div>
                        ) : isNew ? (
                          <span className="text-[#16A36A]">
                            {locale === 'ar' ? 'سيتم تسجيله كمنتج جديد وتعيين القنوات' : 'Will register new product & channels'}
                          </span>
                        ) : (
                          <span className="text-[#2563EB]">
                            {locale === 'ar' ? 'سيتم تحديث المخزون وقنوات البيع' : 'Will update physical stock & channels'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Action Confirmation Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E8ECF2]">
            <button
              onClick={() => {
                setValidationResult(null);
                setCurrentFile(null);
              }}
              className="px-4 py-2 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer"
            >
              {t.excelImport.cancelBtn}
            </button>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[#64748B]">
                {locale === 'ar' ? 'السجلات الصالحة للاستيراد:' : 'Valid rows to import:'}{' '}
                <strong className="text-[#16A36A] tabular-nums font-bold">
                  {validationResult.validCount}
                </strong>
              </span>

              <button
                disabled={validationResult.validCount === 0}
                onClick={handleConfirmImport}
                className={`px-5 py-2 text-xs font-semibold text-white rounded-lg transition-colors shadow-sm cursor-pointer ${
                  validationResult.validCount > 0
                    ? 'bg-[#2563EB] hover:bg-blue-700'
                    : 'bg-slate-300 cursor-not-allowed'
                }`}
              >
                {t.excelImport.confirmImportBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
