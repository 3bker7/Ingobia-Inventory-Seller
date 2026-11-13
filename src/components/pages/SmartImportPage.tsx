import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  Info,
  Check,
  X,
  Boxes,
  Clock,
  Layers,
  History,
} from 'lucide-react';
import {
  MarketplaceId,
  ColumnMappingItem,
  SmartOrderGroup,
  SmartImportValidationResult,
  Order,
  OrderItem,
} from '../../types';
import { storageService } from '../../services/storage';
import { analyzeOrderFile, processMappedOrderRows } from '../../services/smartImport';
import { translations, Locale } from '../../locales/translations';
import { useToast } from '../common/Toast';

interface SmartImportPageProps {
  locale: Locale;
  onNavigateToOrders: () => void;
  onNavigateToCompleted: () => void;
  onOrdersImported?: () => void;
}

export const SmartImportPage: React.FC<SmartImportPageProps> = ({
  locale,
  onNavigateToOrders,
  onNavigateToCompleted,
  onOrdersImported,
}) => {
  const t = translations[locale];
  const { showToast } = useToast();
  const settings = storageService.getSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Workflow steps: 'upload' -> 'mapping' -> 'preview' -> 'completed'
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'completed'>('upload');
  const [selectedMarketplace, setSelectedMarketplace] = useState<MarketplaceId>('noon');
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Analysis result state
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mappings, setMappings] = useState<ColumnMappingItem[]>([]);
  const [previewResult, setPreviewResult] = useState<SmartImportValidationResult | null>(null);

  // Historical handling preference: don't double deduct stock for past delivered orders
  const [deductHistoricalStock, setDeductHistoricalStock] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<'all' | 'new' | 'historical' | 'duplicate'>('all');

  // Import completion stats
  const [importSummary, setImportSummary] = useState<{
    importedCount: number;
    historicalCount: number;
    duplicateCount: number;
  } | null>(null);

  // 1. Handle File Upload
  const handleFileUpload = async (file: File) => {
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const hasValidExt = validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));

    if (!hasValidExt) {
      showToast(
        locale === 'ar' ? 'يرجى رفع ملف بصيغة Excel أو CSV فقط.' : 'Please upload an Excel or CSV file only.',
        'error'
      );
      return;
    }

    setIsAnalyzing(true);
    setUploadedFileName(file.name);

    try {
      const analysis = await analyzeOrderFile(file, selectedMarketplace);
      setAvailableColumns(analysis.columns);
      setMappings(analysis.mappings);
      setRawRows(analysis.rawRows);
      setStep('mapping');

      showToast(
        locale === 'ar'
          ? `تم تحليل ${analysis.columns.length} أعمدة في التقرير. راجع مطابقة الحقول.`
          : `Analyzed ${analysis.columns.length} columns in report. Review field mappings.`,
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر قراءة ملف الطلبات.';
      showToast(msg, 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // 2. Change column mapping manually
  const handleUpdateMapping = (field: string, newCol: string) => {
    setMappings((prev) =>
      prev.map((item) => {
        if (item.field === field) {
          const sample = newCol && rawRows.length > 0 ? String(rawRows[0][newCol] ?? '—') : '—';
          return {
            ...item,
            userConfirmedColumn: newCol || null,
            sampleValue: sample,
          };
        }
        return item;
      })
    );
  };

  // 3. Move from Mapping to Preview
  const handleProceedToPreview = () => {
    // Check if required fields have assigned columns
    const missingRequired = mappings.filter(
      (m) => m.required && !m.userConfirmedColumn && !m.detectedColumn
    );

    if (missingRequired.length > 0) {
      showToast(
        locale === 'ar'
          ? `يرجى تحديد أعمدة للحقول الإلزامية: ${missingRequired.map((m) => m.fieldLabelAr).join('، ')}`
          : `Please map required fields: ${missingRequired.map((m) => m.fieldLabelEn).join(', ')}`,
        'warning'
      );
      return;
    }

    const processed = processMappedOrderRows(
      rawRows,
      mappings,
      selectedMarketplace,
      uploadedFileName,
      availableColumns
    );

    setPreviewResult(processed);
    setStep('preview');
  };

  // 4. Confirm and Execute Import
  const handleConfirmImport = () => {
    if (!previewResult) return;

    // Build Order models to import
    const ordersToSave: Order[] = previewResult.orders
      .filter((grp) => !grp.isDuplicate)
      .map((grp) => {
        const orderItems: OrderItem[] = grp.items.map((it) => ({
          productId: it.productId,
          productSku: it.sku,
          productName: it.productName,
          imageUrl: it.imageUrl,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
        }));

        const isDelivered = grp.normalizedStatus === 'delivered';

        return {
          id: grp.orderId,
          marketplaceId: grp.marketplaceId,
          items: orderItems,
          totalAmount: grp.totalAmount,
          status: grp.normalizedStatus,
          customerName: grp.customerName,
          orderDate: grp.orderDate,
          deliveredDate: isDelivered ? grp.orderDate : undefined,
          stockDeducted: true,
          deliveredProcessed: isDelivered,
          isClosed: isDelivered,
          closedReason: isDelivered ? 'delivered' : undefined,
          closedAt: isDelivered ? grp.orderDate : undefined,
          notes: `تم الاستيراد عبر ميزة الاستيراد الذكي (${uploadedFileName})`,
          createdAt: grp.orderDate || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

    const res = storageService.saveSmartImportOrders(
      ordersToSave,
      deductHistoricalStock,
      uploadedFileName,
      settings.sellerName
    );

    setImportSummary(res);
    setStep('completed');
    onOrdersImported?.();
    showToast(
      locale === 'ar'
        ? `تم استيراد ${res.importedCount} طلب نشط و ${res.historicalCount} طلب تاريخي بنجاح.`
        : `Successfully imported ${res.importedCount} active and ${res.historicalCount} historical orders.`,
      'success'
    );
  };

  // Filter preview orders by tab
  const displayedOrders = previewResult
    ? previewResult.orders.filter((ord) => {
        if (activePreviewTab === 'all') return true;
        if (activePreviewTab === 'new') return !ord.isDuplicate && !ord.isHistorical;
        if (activePreviewTab === 'historical') return !ord.isDuplicate && ord.isHistorical;
        if (activePreviewTab === 'duplicate') return ord.isDuplicate;
        return true;
      })
    : [];

  return (
    <div className="space-y-6">
      {/* Feature Header Strip */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-6 text-white shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-amber-950 uppercase tracking-wider">
              {locale === 'ar' ? 'تجريبي - Beta' : 'Beta Feature'}
            </span>
            <Sparkles className="w-4 h-4 text-amber-300" />
            <h2 className="text-lg font-bold">
              {locale === 'ar' ? 'الاستيراد الذكي للطلبات' : 'Smart Orders Import'}
            </h2>
          </div>
          <p className="text-xs text-blue-100 max-w-2xl leading-relaxed">
            {locale === 'ar'
              ? 'استيراد تقارير الطلبات المحملة يدوياً من نون سيلر لاب (Noon Seller Lab) وأمازون سيلر سنترال (Amazon Seller Central) مع التعرف الذكي على الأعمدة وتجميع البنود المتعددة ومنع التكرار نهائياً دون الحاجة لربط API.'
              : 'Directly import orders reports downloaded from Noon Seller Lab and Amazon Seller Central with intelligent column mapping, multi-item consolidation, and duplicate prevention without requiring APIs.'}
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 text-xs font-semibold bg-white/10 px-3.5 py-1.5 rounded-xl backdrop-blur-xs">
          <span className={step === 'upload' ? 'text-amber-300 underline' : 'text-blue-200'}>
            1. {locale === 'ar' ? 'الرفع' : 'Upload'}
          </span>
          <span className="text-blue-300">→</span>
          <span className={step === 'mapping' ? 'text-amber-300 underline' : 'text-blue-200'}>
            2. {locale === 'ar' ? 'المطابقة' : 'Mapping'}
          </span>
          <span className="text-blue-300">→</span>
          <span className={step === 'preview' ? 'text-amber-300 underline' : 'text-blue-200'}>
            3. {locale === 'ar' ? 'المعاينة' : 'Preview'}
          </span>
        </div>
      </div>

      {/* STEP 1: Upload & Platform Selection */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-[#E8ECF2] shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-[#172033] uppercase tracking-wider">
              {locale === 'ar' ? '1. اختر منصة التقرير المُحمّل' : '1. Select Source Marketplace'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
              <button
                type="button"
                onClick={() => setSelectedMarketplace('noon')}
                className={`p-3.5 rounded-xl border-2 flex items-center gap-3 transition-all cursor-pointer text-start ${
                  selectedMarketplace === 'noon'
                    ? 'border-[#2563EB] bg-blue-50/40 text-[#172033]'
                    : 'border-[#E8ECF2] hover:border-slate-300 bg-white text-[#64748B]'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-[#FEEC00] flex items-center justify-center font-bold text-[#854D0E] text-xs shrink-0">
                  noon
                </div>
                <div>
                  <div className="font-bold text-xs text-[#172033]">
                    {locale === 'ar' ? 'تقرير طلبات نون (Noon)' : 'Noon Orders Report'}
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    {locale === 'ar' ? 'ملفات Seller Lab (Excel / CSV)' : 'Seller Lab Orders (XLSX / CSV)'}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMarketplace('amazon')}
                className={`p-3.5 rounded-xl border-2 flex items-center gap-3 transition-all cursor-pointer text-start ${
                  selectedMarketplace === 'amazon'
                    ? 'border-[#2563EB] bg-blue-50/40 text-[#172033]'
                    : 'border-[#E8ECF2] hover:border-slate-300 bg-white text-[#64748B]'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-[#FF9900] flex items-center justify-center font-bold text-white text-xs shrink-0">
                  amz
                </div>
                <div>
                  <div className="font-bold text-xs text-[#172033]">
                    {locale === 'ar' ? 'تقرير طلبات أمازون (Amazon)' : 'Amazon Orders Report'}
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    {locale === 'ar' ? 'ملفات Seller Central (XLSX / CSV)' : 'Seller Central Orders (XLSX / CSV)'}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Upload Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`bg-white rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-[#2563EB] bg-blue-50/40'
                : 'border-[#E8ECF2] hover:border-slate-400 hover:bg-[#F7F8FA]/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileUpload(e.target.files[0]);
                }
              }}
            />

            <div className="w-12 h-12 rounded-xl bg-blue-50 text-[#2563EB] mx-auto flex items-center justify-center mb-3">
              {isAnalyzing ? (
                <RefreshCw className="w-6 h-6 animate-spin" />
              ) : (
                <UploadCloud className="w-6 h-6" />
              )}
            </div>

            <h3 className="text-sm font-bold text-[#172033] mb-1">
              {isAnalyzing
                ? locale === 'ar' ? 'جاري فحص التقرير والتعرف على الأعمدة...' : 'Analyzing report structure...'
                : locale === 'ar' ? 'اسحب تقرير طلبات نون أو أمازون وأفلته هنا' : 'Drag & drop your Noon or Amazon orders file'}
            </h3>
            <p className="text-xs text-[#64748B]">
              {locale === 'ar' ? 'يدعم ملفات Excel (.xlsx, .xls) أو ملفات (.csv)' : 'Supports .xlsx, .xls, and .csv files'}
            </p>

            <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-[#2563EB] font-semibold bg-[#F7F8FA] border border-[#E8ECF2] px-3.5 py-1.5 rounded-lg shadow-xs">
              <ShieldCheck className="w-4 h-4 text-[#16A36A]" />
              <span>
                {locale === 'ar'
                  ? 'حماية كاملة: لن يتم تعديل المخزون أو تسجيل الطلبات إلا بعد مراجعتك واعتمادك'
                  : 'Safe: No stock deduction occurs until you explicitly review & confirm'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Intelligent Column Detection & Confidence Review */}
      {step === 'mapping' && (
        <div className="bg-white p-5 rounded-xl border border-[#E8ECF2] shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2]">
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {locale === 'ar' ? '2. مراجعة وتأكيد مطابقة أعمدة التقرير' : '2. Review & Confirm Column Mappings'}
              </h3>
              <p className="text-xs text-[#64748B] mt-0.5">
                {locale === 'ar'
                  ? `قام النظام بالتعرف الآلي على الحقول بناءً على تقرير (${selectedMarketplace.toUpperCase()}). يمكنك تعديل أي عمود يدوياً.`
                  : `Automated detection matched columns based on your ${selectedMarketplace.toUpperCase()} report. Modify any mapping as needed.`}
              </p>
            </div>

            <span className="text-xs font-mono-code text-[#64748B] bg-[#F7F8FA] px-2.5 py-1 rounded-md border border-[#E8ECF2]">
              {uploadedFileName}
            </span>
          </div>

          {/* Mappings Table */}
          <div className="border border-[#E8ECF2] rounded-lg overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-2.5 px-3 text-start">{locale === 'ar' ? 'الحقل المطلوب' : 'Required Field'}</th>
                  <th className="py-2.5 px-3 text-start">{locale === 'ar' ? 'العمود المكتشف في الملف' : 'Detected Column in File'}</th>
                  <th className="py-2.5 px-3 text-center">{locale === 'ar' ? 'درجة الثقة' : 'Confidence'}</th>
                  <th className="py-2.5 px-3 text-start">{locale === 'ar' ? 'نموذج من السطر الأول' : 'Sample Value (Row 1)'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8ECF2]">
                {mappings.map((m) => {
                  const currentChoice = m.userConfirmedColumn ?? m.detectedColumn ?? '';
                  const isHigh = m.confidence === 'high';
                  const isMed = m.confidence === 'medium';

                  return (
                    <tr key={m.field} className="hover:bg-[#F7F8FA]/60">
                      {/* Required Field */}
                      <td className="py-2.5 px-3 font-semibold text-[#172033]">
                        {locale === 'ar' ? m.fieldLabelAr : m.fieldLabelEn}
                        {m.required && <span className="text-[#DC5555] ms-1">*</span>}
                      </td>

                      {/* Detected Column Selector */}
                      <td className="py-2.5 px-3">
                        <select
                          value={currentChoice}
                          onChange={(e) => handleUpdateMapping(m.field, e.target.value)}
                          className={`w-full max-w-xs px-2.5 py-1.5 text-xs rounded-lg border font-medium focus:outline-none focus:ring-1 focus:ring-[#2563EB] ${
                            currentChoice
                              ? 'bg-white border-[#E8ECF2] text-[#172033]'
                              : 'bg-rose-50 border-rose-200 text-[#DC5555]'
                          }`}
                        >
                          <option value="">{locale === 'ar' ? '— غير محدد —' : '— Not Mapped —'}</option>
                          {availableColumns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Confidence Badge */}
                      <td className="py-2.5 px-3 text-center">
                        {isHigh ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-[#16A36A] border border-emerald-200">
                            <Check className="w-3 h-3" />
                            <span>{locale === 'ar' ? 'عالية (High)' : 'High'}</span>
                          </span>
                        ) : isMed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-[#D99A27] border border-amber-200">
                            <span>{locale === 'ar' ? 'متوسطة (تأكيد)' : 'Medium'}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-[#DC5555] border border-rose-200">
                            <span>{locale === 'ar' ? 'منخفضة (حدد يدوياً)' : 'Low'}</span>
                          </span>
                        )}
                      </td>

                      {/* Sample Value */}
                      <td className="py-2.5 px-3 text-[#64748B] font-mono-code truncate max-w-xs">
                        {m.sampleValue}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setStep('upload')}
              className="px-4 py-2 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer"
            >
              {locale === 'ar' ? 'إلغاء واختيار ملف آخر' : 'Cancel & Choose Another File'}
            </button>

            <button
              onClick={handleProceedToPreview}
              className="flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              <span>{locale === 'ar' ? 'المتابعة لمعاينة الطلبات وتجميعها' : 'Proceed to Grouped Orders Preview'}</span>
              <ArrowLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Preview Grouped Orders */}
      {step === 'preview' && previewResult && (
        <div className="bg-white p-5 rounded-xl border border-[#E8ECF2] shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8ECF2]">
            <div>
              <h3 className="text-sm font-bold text-[#172033]">
                {locale === 'ar' ? '3. معاينة الطلبات المجمعة قبل الاعتماد' : '3. Grouped Orders Pre-Import Preview'}
              </h3>
              <p className="text-xs text-[#64748B] mt-0.5">
                {locale === 'ar'
                  ? `تم تجميع أسطر المنتجات المتعددة لكل طلب برقم فريد، وفصل الطلبات المكررة والتاريخية.`
                  : `Multi-row items grouped per order ID; duplicates and historical records separated.`}
              </p>
            </div>

            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-blue-50 text-[#2563EB] border border-blue-200">
              {previewResult.marketplace.toUpperCase()} · {previewResult.totalOrdersDetected} {locale === 'ar' ? 'طلب مكتشف' : 'Orders'}
            </span>
          </div>

          {/* Metrics Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-2.5 bg-emerald-50/60 rounded-lg border border-emerald-200">
              <span className="text-[10px] text-[#16A36A] font-semibold block">
                {locale === 'ar' ? 'طلبات نشطة جديدة' : 'New Active Orders'}
              </span>
              <span className="text-base font-bold text-[#16A36A] tabular-nums">
                {previewResult.newOrdersCount}
              </span>
            </div>

            <div className="p-2.5 bg-blue-50/60 rounded-lg border border-blue-200">
              <span className="text-[10px] text-[#2563EB] font-semibold block">
                {locale === 'ar' ? 'طلبات تاريخية / مسلمة' : 'Historical Orders'}
              </span>
              <span className="text-base font-bold text-[#2563EB] tabular-nums">
                {previewResult.historicalOrdersCount}
              </span>
            </div>

            <div className="p-2.5 bg-amber-50/60 rounded-lg border border-amber-200">
              <span className="text-[10px] text-[#D99A27] font-semibold block">
                {locale === 'ar' ? 'طلبات مكررة مسجلة مسبقاً' : 'Duplicate Orders (Skipped)'}
              </span>
              <span className="text-base font-bold text-[#D99A27] tabular-nums">
                {previewResult.duplicateOrdersCount}
              </span>
            </div>

            <div className="p-2.5 bg-[#F7F8FA] rounded-lg border border-[#E8ECF2]">
              <span className="text-[10px] text-[#64748B] font-semibold block">
                {locale === 'ar' ? 'إجمالي الأسطر الأصلية' : 'Raw File Rows'}
              </span>
              <span className="text-base font-bold text-[#172033] tabular-nums">
                {previewResult.totalRows}
              </span>
            </div>
          </div>

          {/* Historical Safety Option Banner */}
          {previewResult.historicalOrdersCount > 0 && (
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-950">
              <Info className="w-4 h-4 text-[#D99A27] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">
                  {locale === 'ar' ? 'معاملة الطلبات التاريخية / المسلمة سابقاً:' : 'Handling Historical Orders:'}
                </p>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  {locale === 'ar'
                    ? 'الملف يحتوي على طلبات مكتملة أو مسلمة في السابق. افتراضياً، يتم إضافتها للأرشيف التاريخي والتقارير دون خصم المخزون الحالي لتفادي الخصم المزدوج.'
                    : 'The file contains previously delivered orders. By default, they will be archived without modifying current physical stock.'}
                </p>
                <label className="flex items-center gap-2 pt-1 font-semibold cursor-pointer text-amber-950">
                  <input
                    type="checkbox"
                    checked={deductHistoricalStock}
                    onChange={(e) => setDeductHistoricalStock(e.target.checked)}
                    className="rounded border-[#E8ECF2] text-[#2563EB] focus:ring-0"
                  />
                  <span>
                    {locale === 'ar'
                      ? 'خصم المخزون الفعلي أيضاً لهذه الطلبات التاريخية (استخدم فقط إذا لم تكن قد خصمتها مسبقاً)'
                      : 'Also deduct physical stock for these historical orders (only if not deducted before)'}
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Tab Filter Controls */}
          <div className="flex items-center gap-1 bg-[#F7F8FA] p-1 rounded-lg border border-[#E8ECF2] overflow-x-auto">
            <button
              onClick={() => setActivePreviewTab('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activePreviewTab === 'all'
                  ? 'bg-white text-[#172033] shadow-xs font-semibold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'جميع الطلبات' : 'All'} ({previewResult.totalOrdersDetected})
            </button>
            <button
              onClick={() => setActivePreviewTab('new')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activePreviewTab === 'new'
                  ? 'bg-white text-[#16A36A] shadow-xs font-semibold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'الطلبات النشطة الجديدة' : 'New Active'} ({previewResult.newOrdersCount})
            </button>
            <button
              onClick={() => setActivePreviewTab('historical')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                activePreviewTab === 'historical'
                  ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                  : 'text-[#64748B] hover:text-[#172033]'
              }`}
            >
              {locale === 'ar' ? 'تاريخية / مسلمة' : 'Historical'} ({previewResult.historicalOrdersCount})
            </button>
            {previewResult.duplicateOrdersCount > 0 && (
              <button
                onClick={() => setActivePreviewTab('duplicate')}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                  activePreviewTab === 'duplicate'
                    ? 'bg-white text-[#D99A27] shadow-xs font-semibold'
                    : 'text-[#64748B] hover:text-[#172033]'
                }`}
              >
                {locale === 'ar' ? 'مكررة (سيتم تخطيها)' : 'Duplicate (Skipped)'} ({previewResult.duplicateOrdersCount})
              </button>
            )}
          </div>

          {/* Grouped Orders Table */}
          <div className="border border-[#E8ECF2] rounded-lg overflow-x-auto max-h-96">
            <table className="w-full text-start text-xs border-collapse">
              <thead className="sticky top-0 bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-2.5 px-3 text-start">{t.orders.orderId}</th>
                  <th className="py-2.5 px-3 text-start">{t.orders.items}</th>
                  <th className="py-2.5 px-3 text-end">{t.orders.totalAmount}</th>
                  <th className="py-2.5 px-3 text-start">{t.orders.status}</th>
                  <th className="py-2.5 px-3 text-start">{t.orders.date}</th>
                  <th className="py-2.5 px-3 text-start">{locale === 'ar' ? 'التصنيف والمصير' : 'Classification'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8ECF2]">
                {displayedOrders.map((ord) => {
                  const firstItem = ord.items[0];

                  return (
                    <tr
                      key={ord.orderId}
                      className={
                        ord.isDuplicate
                          ? 'bg-amber-50/40 text-[#64748B]'
                          : ord.isHistorical
                          ? 'hover:bg-blue-50/20'
                          : 'hover:bg-[#F7F8FA]/60'
                      }
                    >
                      {/* Order ID */}
                      <td className="py-2.5 px-3 font-mono-code font-bold text-[#172033]">
                        {ord.orderId}
                        {ord.customerName && (
                          <span className="block text-[10px] text-[#64748B] font-sans font-normal truncate max-w-xs">
                            {ord.customerName}
                          </span>
                        )}
                      </td>

                      {/* Items Consolidated */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          {firstItem && (
                            <img
                              src={firstItem.imageUrl}
                              alt={firstItem.productName}
                              referrerPolicy="no-referrer"
                              className="w-7 h-7 rounded object-cover border border-[#E8ECF2]"
                            />
                          )}
                          <div className="min-w-0 max-w-xs">
                            <span className="font-semibold text-[#172033] block truncate">
                              {firstItem?.productName}
                            </span>
                            <span className="text-[10px] text-[#64748B] font-mono-code">
                              SKU: {firstItem?.sku} · ×{firstItem?.quantity}
                              {ord.items.length > 1 && (
                                <span className="ms-1 font-sans text-[#2563EB] font-bold">
                                  (+{ord.items.length - 1} {locale === 'ar' ? 'أصناف أخرى' : 'more items'})
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Total Amount */}
                      <td className="py-2.5 px-3 text-end font-bold tabular-nums text-[#172033]">
                        {ord.totalAmount.toFixed(2)} {settings.currency}
                      </td>

                      {/* Normalized Status */}
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#F7F8FA] border border-[#E8ECF2] text-[#172033]">
                          {t.orders.statuses[ord.normalizedStatus] || ord.rawStatus}
                        </span>
                      </td>

                      {/* Order Date */}
                      <td className="py-2.5 px-3 text-[#64748B] text-[11px] whitespace-nowrap">
                        {new Date(ord.orderDate).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>

                      {/* Classification Badge */}
                      <td className="py-2.5 px-3">
                        {ord.isDuplicate ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-[#D99A27] border border-amber-200">
                            {locale === 'ar' ? 'مكرر (تخطي تلقائي)' : 'Duplicate (Skip)'}
                          </span>
                        ) : ord.isHistorical ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#2563EB] border border-blue-200">
                            {locale === 'ar' ? 'أرشيف تاريخي مكتمل' : 'Historical Archive'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-[#16A36A] border border-emerald-200">
                            {locale === 'ar' ? 'تسجيل جديد وحجز مخزون' : 'Register & Reserve'}
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
          <div className="flex items-center justify-between pt-3 border-t border-[#E8ECF2]">
            <button
              onClick={() => setStep('mapping')}
              className="px-4 py-2 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer"
            >
              {locale === 'ar' ? 'رجوع لتعديل المطابقة' : 'Back to Mapping'}
            </button>

            <button
              onClick={handleConfirmImport}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              {locale === 'ar'
                ? `تأكيد واعتماد استيراد ${previewResult.newOrdersCount + previewResult.historicalOrdersCount} طلب`
                : `Confirm & Import ${previewResult.newOrdersCount + previewResult.historicalOrdersCount} Orders`}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Completed Summary */}
      {step === 'completed' && importSummary && (
        <div className="bg-white rounded-xl border border-[#E8ECF2] p-8 shadow-xs text-center space-y-5">
          <div className="w-14 h-14 rounded-full bg-emerald-50 text-[#16A36A] mx-auto flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div>
            <h3 className="text-base font-bold text-[#172033]">
              {locale === 'ar' ? 'اكتمل استيراد تقرير الطلبات بنجاح!' : 'Smart Orders Import Completed!'}
            </h3>
            <p className="text-xs text-[#64748B] mt-1">
              {locale === 'ar'
                ? `تم بنجاح تحديث بيانات منصة (${selectedMarketplace.toUpperCase()}) وتحديث حركات المخزون بدقة تامة.`
                : `Successfully updated ${selectedMarketplace.toUpperCase()} orders and accurately synced inventory.`}
            </p>
          </div>

          <div className="grid grid-cols-3 max-w-lg mx-auto gap-3 text-start">
            <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200">
              <span className="text-[11px] text-[#16A36A] block mb-0.5">
                {locale === 'ar' ? 'طلبات نشطة جديدة' : 'New Active Orders'}
              </span>
              <span className="text-xl font-bold text-[#16A36A] tabular-nums">
                +{importSummary.importedCount}
              </span>
            </div>

            <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200">
              <span className="text-[11px] text-[#2563EB] block mb-0.5">
                {locale === 'ar' ? 'طلبات تاريخية مؤرشفة' : 'Historical Orders'}
              </span>
              <span className="text-xl font-bold text-[#2563EB] tabular-nums">
                +{importSummary.historicalCount}
              </span>
            </div>

            <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200">
              <span className="text-[11px] text-[#D99A27] block mb-0.5">
                {locale === 'ar' ? 'طلبات مكررة تم تخطيها' : 'Duplicates Skipped'}
              </span>
              <span className="text-xl font-bold text-[#D99A27] tabular-nums">
                {importSummary.duplicateCount}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => {
                setStep('upload');
                setPreviewResult(null);
                setImportSummary(null);
                setRawRows([]);
              }}
              className="px-4 py-2 text-xs font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] rounded-lg transition-colors cursor-pointer"
            >
              {locale === 'ar' ? 'استيراد تقرير آخر' : 'Import Another Report'}
            </button>

            <button
              onClick={onNavigateToOrders}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              {locale === 'ar' ? 'الذهاب للطلبات النشطة' : 'View Active Orders'}
            </button>

            <button
              onClick={onNavigateToCompleted}
              className="px-4 py-2 text-xs font-semibold text-[#172033] bg-white border border-[#E8ECF2] hover:bg-[#F7F8FA] rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              {locale === 'ar' ? 'الطلبات المكتملة بنجاح' : 'View Completed Orders'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
