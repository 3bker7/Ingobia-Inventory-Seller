import React from 'react';
import {
  GraduationCap,
  Play,
  CheckCircle2,
  RotateCcw,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Boxes,
  RotateCcw as ReturnIcon,
  FileSpreadsheet,
  Sparkles,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { tutorialGuides } from './tutorialData';
import { storageService } from '../../services/storage';
import { Locale } from '../../locales/translations';
import { ActiveTab } from '../layout/Sidebar';
import { Assistant3D } from './Assistant3D';
import { TutorialGuide } from '../../types';

interface LearningCenterModalProps {
  isOpen: boolean;
  locale: Locale;
  onClose: () => void;
  onStartGuide: (guideId: string, tab: ActiveTab) => void;
  onResetAllGuides: () => void;
}

const guideIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  products: Package,
  orders: ShoppingCart,
  inventory: Boxes,
  returns: ReturnIcon,
  excel: FileSpreadsheet,
};

const guideTabMapping: Record<string, ActiveTab> = {
  dashboard: 'overview',
  products: 'products',
  orders: 'orders',
  inventory: 'inventory',
  returns: 'returns',
  excel: 'excelImport',
};

export const LearningCenterModal: React.FC<LearningCenterModalProps> = ({
  isOpen,
  locale,
  onClose,
  onStartGuide,
  onResetAllGuides,
}) => {
  const isRtl = locale === 'ar';
  const profile = storageService.getMerchantProfile();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isRtl ? 'مركز التدريب والتعلم التفاعلي' : 'Interactive Learning Center'}
      subtitle={
        isRtl
          ? 'استكشف جولات إرشادية تفاعلية وتعرف على كيفية إدارة منصات التجارة الإلكترونية باحترافية'
          : 'Explore interactive walk-throughs to master multi-channel e-commerce operations'
      }
      maxWidth="lg"
    >
      <div className="space-y-6">
        {/* Top Banner with 3D Assistant */}
        <div className="bg-gradient-to-r from-[#172033] to-[#1E3A8A] text-white p-5 rounded-2xl flex items-center justify-between gap-4 overflow-hidden relative">
          <div className="relative z-10 space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                {isRtl ? 'نظام الإرشاد التفاعلي' : 'Interactive Guidance'}
              </span>
            </div>
            <h3 className="text-base font-bold">
              {isRtl ? `أهلاً بك يا ${profile.merchantName || profile.name}` : `Welcome, ${profile.merchantName || profile.name}`}
            </h3>
            <p className="text-xs text-slate-300 max-w-md leading-relaxed">
              {isRtl
                ? 'مرشد العمليات الثلاثي الأبعاد يرافقك في كل قسم من أقسام المنصة ليشرح لك طريقة مراقبة الطلبات والمخزون وحساب الأرباح والخسائر بدقة.'
                : 'Our 3D Operations Advisor guides you across each platform module to monitor inventory, orders, and financial loss.'}
            </p>
          </div>

          <div className="shrink-0 relative hidden sm:block">
            <Assistant3D width={100} height={110} />
          </div>
        </div>

        {/* Guides List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {tutorialGuides.map((guide: TutorialGuide) => {
            const Icon = guideIcons[guide.id] || Sparkles;
            const isCompleted = storageService.isTutorialCompleted(guide.id);
            const targetTab = guideTabMapping[guide.id] || 'overview';

            return (
              <div
                key={guide.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isCompleted
                    ? 'bg-[#F8FAFC] border-[#E2E8F0]'
                    : 'bg-white border-[#CBD5E1] shadow-2xs hover:border-[#2563EB]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-[#172033]">
                          {isRtl ? guide.titleAr : guide.titleEn}
                        </h4>
                        <span className="text-[10px] text-[#64748B]">
                          {guide.steps.length} {isRtl ? 'خطوات إرشادية' : 'steps'}
                        </span>
                      </div>
                    </div>

                    {isCompleted ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-[#16A36A] bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{isRtl ? 'تمت المشاهدة' : 'Completed'}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                        {isRtl ? 'جديد' : 'New'}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-[#64748B] leading-relaxed line-clamp-2 mb-3">
                    {isRtl ? guide.descriptionAr : guide.descriptionEn}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between">
                  <span className="text-[10px] text-[#94A3B8] font-mono">
                    ID: {guide.id}
                  </span>

                  <button
                    onClick={() => {
                      onClose();
                      onStartGuide(guide.id, targetTab);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-xl transition-colors shadow-2xs cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{isRtl ? 'ابدأ الجولة التفاعلية' : 'Start Tour'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Reset Option */}
        <div className="pt-3 border-t border-[#E8ECF2] flex items-center justify-between text-xs">
          <div className="text-[11px] text-[#64748B]">
            {isRtl
              ? 'هل ترغب في إعادة ضبط سجل المشاهدات لتظهر الجولات تلقائياً عند أول زيارة لكل صفحة؟'
              : 'Want to reset completion history so tours trigger on first visit?'}
          </div>

          <button
            onClick={onResetAllGuides}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:text-[#DC5555] hover:bg-rose-50 rounded-lg transition-colors cursor-pointer border border-[#E8ECF2]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{isRtl ? 'إعادة ضبط كافة الجولات' : 'Reset All Tours'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
