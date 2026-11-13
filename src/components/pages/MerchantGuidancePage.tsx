import React, { useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  Clock,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Package,
  RotateCcw,
  DollarSign,
  TrendingUp,
  Filter,
  Check,
  XCircle,
  ExternalLink,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import {
  MerchantRecommendation,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationStatus,
} from '../../types';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';
import { useToast } from '../common/Toast';

interface MerchantGuidancePageProps {
  locale: Locale;
  onNavigateToTab?: (tab: string, filter?: Record<string, string>) => void;
}

export const MerchantGuidancePage: React.FC<MerchantGuidancePageProps> = ({
  locale,
  onNavigateToTab,
}) => {
  const { showToast } = useToast();
  const isRtl = locale === 'ar';

  const [recommendations, setRecommendations] = useState<MerchantRecommendation[]>(() =>
    storageService.getMerchantRecommendations()
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const refreshRecs = () => {
    setRecommendations(storageService.getMerchantRecommendations());
  };

  const handleUpdateStatus = (id: string, status: RecommendationStatus) => {
    storageService.updateRecommendationStatus(id, status);
    refreshRecs();
    showToast(
      isRtl
        ? status === 'resolved'
          ? 'تم تمييز التوجيه كمنجز.'
          : status === 'dismissed'
          ? 'تم استبعاد التوجيه.'
          : 'تم تحديث حالة التوجيه.'
        : 'Recommendation status updated.',
      'success'
    );
  };

  const filteredRecs = recommendations.filter((r) => {
    if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
    if (selectedPriority !== 'all' && r.priority !== selectedPriority) return false;
    if (selectedStatus !== 'all' && r.status !== selectedStatus) return false;
    return true;
  });

  const getPriorityBadge = (priority: RecommendationPriority) => {
    const config: Record<RecommendationPriority, { label: string; style: string }> = {
      critical: {
        label: isRtl ? 'حرج وعاجل' : 'Critical',
        style: 'bg-rose-50 text-[#DC5555] border-rose-200',
      },
      high: {
        label: isRtl ? 'أولوية عالية' : 'High Priority',
        style: 'bg-amber-50 text-[#D99A27] border-amber-200',
      },
      medium: {
        label: isRtl ? 'متوسط' : 'Medium',
        style: 'bg-blue-50 text-[#2563EB] border-blue-200',
      },
      info: {
        label: isRtl ? 'معلوماتي' : 'Info',
        style: 'bg-slate-100 text-[#64748B] border-slate-200',
      },
    };

    const cfg = config[priority] || config.info;
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${cfg.style}`}>
        {cfg.label}
      </span>
    );
  };

  const getCategoryLabel = (category: RecommendationCategory) => {
    const map: Record<RecommendationCategory, string> = {
      urgent: isRtl ? 'إجراءات عاجلة' : 'Urgent',
      orders: isRtl ? 'الطلبات والشحن' : 'Orders',
      returns: isRtl ? 'المرتجعات والفحص' : 'Returns',
      shipping: isRtl ? 'شركات التوصيل' : 'Shipping',
      inventory: isRtl ? 'المخزون والنفاد' : 'Inventory',
      products: isRtl ? 'المنتجات والتسعير' : 'Products',
      financial: isRtl ? 'الأداء المالي' : 'Financial',
      opportunities: isRtl ? 'فرص تحسين' : 'Opportunities',
    };
    return map[category] || category;
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header Advisor Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-[#1E3A8A] to-[#2563EB] text-white p-6 rounded-3xl relative overflow-hidden shadow-sm">
        <div className="absolute -end-10 -bottom-10 w-44 h-44 rounded-full bg-white/10 blur-2xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/15 backdrop-blur-xs border border-white/20 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>{isRtl ? 'المستشار التشغيلي الذكي المعتمد' : 'Operational Store Advisor'}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              {isRtl ? 'دليل وقرارات التاجر التشغيلية' : 'Merchant Guidance & Actions'}
            </h2>
            <p className="text-xs text-blue-100 leading-relaxed">
              {isRtl
                ? 'تحليل حقيقي ومحدد لحالة متجرك بناءً على بيانات المخزون الفعلي، الشحنات في الطريق، المرتجعات المعلقة، وحسابات الأرباح.'
                : 'Deterministic recommendations derived strictly from real store stock, transit custody, returns, and financials.'}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <div className="px-4 py-2.5 rounded-2xl bg-white/15 backdrop-blur-xs border border-white/20 text-center">
              <span className="block text-[10px] text-blue-200">{isRtl ? 'تنبيهات عاجلة' : 'Urgent'}</span>
              <strong className="text-lg font-bold font-mono-code">
                {recommendations.filter((r) => r.priority === 'critical' || r.priority === 'high').length}
              </strong>
            </div>

            <div className="px-4 py-2.5 rounded-2xl bg-white/15 backdrop-blur-xs border border-white/20 text-center">
              <span className="block text-[10px] text-blue-200">{isRtl ? 'إجمالي التوجيهات' : 'Total'}</span>
              <strong className="text-lg font-bold font-mono-code">{recommendations.length}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-[#E8ECF2] shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{isRtl ? 'جميع التصنيفات' : 'All Categories'}</option>
            <option value="urgent">{isRtl ? 'إجراءات عاجلة' : 'Urgent'}</option>
            <option value="returns">{isRtl ? 'المرتجعات والفحص' : 'Returns'}</option>
            <option value="inventory">{isRtl ? 'المخزون والنفاد' : 'Inventory'}</option>
            <option value="orders">{isRtl ? 'الطلبات والشحن' : 'Orders'}</option>
            <option value="financial">{isRtl ? 'الأداء المالي' : 'Financial'}</option>
          </select>

          {/* Priority Filter */}
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{isRtl ? 'جميع الأولويات' : 'All Priorities'}</option>
            <option value="critical">{isRtl ? 'حرج وعاجل' : 'Critical'}</option>
            <option value="high">{isRtl ? 'أولوية عالية' : 'High'}</option>
            <option value="medium">{isRtl ? 'متوسط' : 'Medium'}</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-xl text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{isRtl ? 'كل الحالات' : 'All Statuses'}</option>
            <option value="new">{isRtl ? 'جديد' : 'New'}</option>
            <option value="in_progress">{isRtl ? 'قيد التنفيذ' : 'In Progress'}</option>
            <option value="resolved">{isRtl ? 'منجز ومكتمل' : 'Resolved'}</option>
          </select>
        </div>

        <span className="text-xs text-[#64748B] font-semibold">
          {filteredRecs.length} {isRtl ? 'توجيه تشغيلي' : 'recommendations'}
        </span>
      </div>

      {/* Recommendations Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredRecs.length === 0 ? (
          <div className="col-span-full py-16 bg-white rounded-3xl border border-[#E8ECF2] text-center text-[#64748B]">
            <CheckCircle2 className="w-12 h-12 mx-auto text-[#16A36A]/60 mb-3" />
            <h3 className="text-base font-bold text-[#172033]">
              {isRtl ? 'عمليات المتجر تسير بانتظام وانضباط تام' : 'All Store Operations Healthy'}
            </h3>
            <p className="text-xs text-[#64748B] mt-1 max-w-md mx-auto">
              {isRtl
                ? 'لا توجد تنبيهات أو شحنات متأخرة أو وحدات غير مفحوصة ضمن الفلتر المختار.'
                : 'No pending critical actions detected under the selected filter.'}
            </p>
          </div>
        ) : (
          filteredRecs.map((rec) => {
            const isResolved = rec.status === 'resolved';

            return (
              <div
                key={rec.id}
                className={`p-5 rounded-3xl border transition-all flex flex-col justify-between space-y-4 ${
                  isResolved
                    ? 'bg-slate-50 border-[#E8ECF2] opacity-75'
                    : rec.priority === 'critical'
                    ? 'bg-white border-rose-200 shadow-xs hover:border-rose-300 ring-1 ring-rose-100'
                    : 'bg-white border-[#E8ECF2] shadow-xs hover:border-slate-300'
                }`}
              >
                {/* Top metadata row */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-[#F8FAFC] text-[#64748B] border border-[#E8ECF2]">
                        {getCategoryLabel(rec.category)}
                      </span>
                      {getPriorityBadge(rec.priority)}
                    </div>

                    <span className="text-[10px] text-[#64748B] font-mono-code">
                      {new Date(rec.createdAt).toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-bold text-[#172033] mb-2 leading-snug">
                    {isRtl ? rec.titleAr : rec.titleEn}
                  </h3>

                  {/* What happened */}
                  <div className="space-y-2 text-xs">
                    <div className="p-2.5 bg-[#F8FAFC] rounded-xl border border-[#E8ECF2] space-y-1">
                      <span className="text-[10px] font-bold text-[#64748B] block">
                        {isRtl ? 'ما الذي حدث في المتجر؟' : 'What Happened:'}
                      </span>
                      <p className="text-[#172033] leading-relaxed">
                        {isRtl ? rec.whatHappenedAr : rec.whatHappenedEn}
                      </p>
                    </div>

                    {/* Why it matters */}
                    <div className="p-2.5 bg-blue-50/50 rounded-xl border border-blue-100 space-y-1">
                      <span className="text-[10px] font-bold text-[#2563EB] block">
                        {isRtl ? 'لماذا هذا الأمر مهم تشغيلياً؟' : 'Why It Matters:'}
                      </span>
                      <p className="text-[#172033] leading-relaxed">
                        {isRtl ? rec.whyItMattersAr : rec.whyItMattersEn}
                      </p>
                    </div>

                    {/* Measurable Impact */}
                    {(rec.measurableImpactAr || rec.measurableImpactEn) && (
                      <div className="flex items-center justify-between text-[11px] p-2 bg-amber-50/50 rounded-xl border border-amber-200 font-medium text-amber-950">
                        <span>{isRtl ? 'الأثر المقاس:' : 'Measurable Impact:'}</span>
                        <strong className="font-mono-code font-bold">
                          {isRtl ? rec.measurableImpactAr : rec.measurableImpactEn}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions & Resolution */}
                <div className="pt-3 border-t border-[#E8ECF2] flex items-center justify-between gap-2 flex-wrap">
                  {/* Jump button */}
                  {rec.actionTab && onNavigateToTab ? (
                    <button
                      onClick={() => onNavigateToTab(rec.actionTab!, rec.actionFilter)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-2xs cursor-pointer"
                    >
                      <span>{isRtl ? rec.recommendedActionAr : rec.recommendedActionEn}</span>
                      {isRtl ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-[#172033]">
                      {isRtl ? rec.recommendedActionAr : rec.recommendedActionEn}
                    </span>
                  )}

                  {/* Status buttons */}
                  <div className="flex items-center gap-1">
                    {!isResolved ? (
                      <button
                        onClick={() => handleUpdateStatus(rec.id, 'resolved')}
                        className="p-1.5 text-[#64748B] hover:text-[#16A36A] hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        title={isRtl ? 'تمييز كمنجز ومكتمل' : 'Mark as resolved'}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-[10px] text-[#16A36A] font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>{isRtl ? 'مكتمل' : 'Resolved'}</span>
                      </span>
                    )}

                    {rec.status !== 'dismissed' && (
                      <button
                        onClick={() => handleUpdateStatus(rec.id, 'dismissed')}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        title={isRtl ? 'استبعاد' : 'Dismiss'}
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
