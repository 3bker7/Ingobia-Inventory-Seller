import React, { useEffect, useState, useRef } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  X,
  CheckCircle2,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import { TutorialGuide, TutorialStep } from '../../types';
import { Assistant3D } from './Assistant3D';
import { Locale } from '../../locales/translations';

interface TutorialOverlayProps {
  guide: TutorialGuide;
  locale: Locale;
  onComplete: () => void;
  onSkip: () => void;
}

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({
  guide,
  locale,
  onComplete,
  onSkip,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep: TutorialStep | undefined = guide.steps[currentStepIndex];
  const isRtl = locale === 'ar';

  // Highlight target element calculation
  useEffect(() => {
    if (!currentStep) return;

    const updateRect = () => {
      const el = currentStep.targetSelector ? document.querySelector(currentStep.targetSelector) : null;
      if (el) {
        // Scroll element into view smoothly if needed
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const rect = el.getBoundingClientRect();
        setTargetRect(rect);
      } else {
        setTargetRect(null);
      }
    };

    updateRect();
    const handleResize = () => updateRect();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);

    const timer = setTimeout(updateRect, 300);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
      clearTimeout(timer);
    };
  }, [currentStepIndex, currentStep]);

  if (!currentStep) return null;

  const isLastStep = currentStepIndex === guide.steps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none select-none">
      {/* Target Element Spotlight Highlight */}
      {targetRect && (
        <div
          className="fixed rounded-2xl pointer-events-none transition-all duration-300 ring-4 ring-[#2563EB]/50 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}

      {/* Interactive Assistant Floating Card (Always interactive pointer-events-auto) */}
      <div
        className={`fixed bottom-6 ${
          isRtl ? 'left-6' : 'right-6'
        } z-50 pointer-events-auto max-w-md w-full sm:w-[440px] bg-white rounded-3xl border border-[#CBD5E1] shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300`}
      >
        {/* Top Header */}
        <div className="bg-[#172033] text-white px-5 py-3 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-[#2563EB] flex items-center justify-center text-white">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-xs font-bold tracking-tight block">
                {isRtl ? 'مرشد إنجوبيا التفاعلي' : 'Ingobia Interactive Guide'}
              </span>
              <span className="text-[10px] text-slate-400">
                {isRtl ? guide.titleAr : guide.titleEn}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {currentStepIndex + 1} / {guide.steps.length}
            </span>
            <button
              onClick={onSkip}
              className="p-1 text-slate-400 hover:text-white rounded-md transition-colors cursor-pointer"
              title={isRtl ? 'تخطي الجولة' : 'Skip Tour'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 3D Character & Speech Bubble Layout */}
        <div className="p-5 flex items-center gap-4 bg-gradient-to-b from-white to-[#F8FAFC]">
          {/* 3D Character Canvas */}
          <div className="relative shrink-0">
            <Assistant3D width={110} height={130} />
            <div className="absolute -bottom-1 inset-x-0 text-center">
              <span className="text-[9px] font-semibold text-[#64748B] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shadow-2xs">
                {isRtl ? 'مستشار العمليات' : 'Ops Advisor'}
              </span>
            </div>
          </div>

          {/* Dialogue Speech Content */}
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-[#172033] mb-1.5 flex items-center gap-1.5">
              <span>{isRtl ? currentStep.titleAr : currentStep.titleEn}</span>
            </h4>
            <p className="text-xs text-[#475569] leading-relaxed max-h-36 overflow-y-auto pe-1">
              {isRtl ? currentStep.instructionAr : currentStep.instructionEn}
            </p>
          </div>
        </div>

        {/* Footer Navigation Bar */}
        <div className="px-5 py-3.5 bg-[#F1F5F9] border-t border-[#E2E8F0] flex items-center justify-between gap-3">
          <button
            onClick={onSkip}
            className="text-[11px] font-medium text-[#64748B] hover:text-[#172033] hover:underline cursor-pointer"
          >
            {isRtl ? 'تخطي الشرح' : 'Skip'}
          </button>

          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:text-[#172033] bg-white border border-[#CBD5E1] rounded-xl transition-colors cursor-pointer"
              >
                {isRtl ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                <span>{isRtl ? 'السابق' : 'Back'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white rounded-xl transition-colors shadow-xs cursor-pointer ${
                isLastStep
                  ? 'bg-[#16A36A] hover:bg-emerald-700'
                  : 'bg-[#2563EB] hover:bg-blue-700'
              }`}
            >
              <span>
                {isLastStep
                  ? isRtl ? 'فهمت ذلك، تم' : 'I Understand, Finish'
                  : isRtl ? 'التالي' : 'Next'}
              </span>
              {isLastStep ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : isRtl ? (
                <ChevronLeft className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
