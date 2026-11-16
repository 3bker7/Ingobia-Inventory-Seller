/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ToastProvider } from './components/common/Toast';
import { OverviewPage } from './components/pages/OverviewPage';
import { ProductsPage } from './components/pages/ProductsPage';
import { OrdersPage } from './components/pages/OrdersPage';
import { CompletedOrdersPage } from './components/pages/CompletedOrdersPage';
import { InventoryPage } from './components/pages/InventoryPage';
import { ReturnsPage } from './components/pages/ReturnsPage';
import { PriceHistoryPage } from './components/pages/PriceHistoryPage';
import { ExcelImportPage } from './components/pages/ExcelImportPage';
import { SmartImportPage } from './components/pages/SmartImportPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { MerchantGuidancePage } from './components/pages/MerchantGuidancePage';
import { DeveloperCenterPage } from './components/pages/DeveloperCenterPage';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { TestSuiteModal } from './components/common/TestSuiteModal';
import { storageService } from './services/storage';
import { Locale } from './locales/translations';
import { TutorialGuide } from './types';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { TutorialOverlay } from './components/tutorial/TutorialOverlay';
import { LearningCenterModal } from './components/tutorial/LearningCenterModal';
import { getGuideById, getGuideByTab } from './components/tutorial/tutorialData';
import { X } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<ActiveTab>('overview');
  const [locale, setLocale] = useState<Locale>('ar');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTestSuiteOpen, setIsTestSuiteOpen] = useState(false);

  // Store reactivity, account scope, and role gating state
  const [storeRevision, setStoreRevision] = useState(0);
  const [activeMerchantId, setActiveMerchantId] = useState(() =>
    storageService.getActiveMerchantId()
  );
  const [isDeveloperMode, setIsDeveloperMode] = useState(() =>
    storageService.isDeveloperMode()
  );

  // Merchant Onboarding & Interactive Tutorials State
  const [isOnboarded, setIsOnboarded] = useState(
    () => storageService.getMerchantProfile().isOnboarded
  );
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(
    () => !storageService.getMerchantProfile().isOnboarded
  );
  const [activeGuide, setActiveGuide] = useState<TutorialGuide | null>(null);
  const [isLearningCenterOpen, setIsLearningCenterOpen] = useState(false);

  // Global modal triggers from Overview / Quick Navigation
  const [openNewOrderModal, setOpenNewOrderModal] = useState(false);
  const [openAddProductModal, setOpenAddProductModal] = useState(false);

  // Deep-link filters from status cards in Overview
  const [ordersFilter, setOrdersFilter] = useState<string | undefined>(undefined);
  const [returnsFilter, setReturnsFilter] = useState<string | undefined>(undefined);

  // Live state tracking for badges
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [pendingReturnsCount, setPendingReturnsCount] = useState(0);

  // Sync document dir and lang with current locale
  useEffect(() => {
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale]);

  const refreshState = useCallback(() => {
    const activeOrders = storageService.getActiveOrders();
    const returns = storageService.getReturns();
    const profile = storageService.getMerchantProfile();
    const devMode = storageService.isDeveloperMode();
    const merchantId = storageService.getActiveMerchantId();

    const pendingOrders = activeOrders.filter(
      (o) => o.status === 'preparing' || o.status === 'with_delivery'
    ).length;

    const pendingReturns = returns.filter(
      (r) => !r.isCompleted && r.returnStatus !== 'closed'
    ).length;

    setActiveOrdersCount(pendingOrders);
    setPendingReturnsCount(pendingReturns);
    setIsDeveloperMode(devMode);
    setActiveMerchantId(merchantId);
    setIsOnboarded(profile.isOnboarded);
    setIsOnboardingOpen(!profile.isOnboarded);
    setStoreRevision((rev) => rev + 1);
  }, []);

  useEffect(() => {
    refreshState();
  }, [currentTab, refreshState]);

  useEffect(() => {
    if (currentTab === 'developerCenter' && !isDeveloperMode) {
      setCurrentTab('settings');
    }
  }, [currentTab, isDeveloperMode]);

  const handleToggleLocale = () => {
    setLocale((prev) => (prev === 'ar' ? 'en' : 'ar'));
  };

  const handleNavigateFromOverview = (tab: ActiveTab, filterState?: Record<string, string>) => {
    const resolvedTab: ActiveTab =
      tab === 'developerCenter' && !storageService.isDeveloperMode() ? 'settings' : tab;
    if (resolvedTab === 'orders') {
      setOrdersFilter(filterState?.status);
    } else if (resolvedTab === 'returns') {
      setReturnsFilter(filterState?.status);
    }
    setCurrentTab(resolvedTab);
    refreshState();
  };

  // Tutorial and Onboarding Handlers
  const handleOnboardingComplete = () => {
    refreshState();
    // Launch dashboard guide immediately upon onboarding completion
    const dashGuide = getGuideById('dashboard');
    if (dashGuide && !storageService.isTutorialCompleted(dashGuide.id)) {
      setTimeout(() => {
        setActiveGuide(dashGuide);
      }, 400);
    }
  };

  const handleStartGuide = (guideId: string, tab: ActiveTab) => {
    setCurrentTab(tab);
    const guide = getGuideById(guideId);
    if (guide) {
      setTimeout(() => {
        setActiveGuide(guide);
      }, 200);
    }
  };

  const handleCompleteTutorial = () => {
    if (activeGuide) {
      storageService.completeTutorial(activeGuide.id);
      setActiveGuide(null);
    }
  };

  const handleSkipTutorial = () => {
    if (activeGuide) {
      storageService.completeTutorial(activeGuide.id);
      setActiveGuide(null);
    }
  };

  const handleResetAllGuides = () => {
    storageService.resetTutorial();
    setIsLearningCenterOpen(false);
  };

  const handleSelectTab = (tab: ActiveTab) => {
    if (tab === 'developerCenter' && !storageService.isDeveloperMode()) {
      setCurrentTab('settings');
      refreshState();
      return;
    }

    if (tab !== 'orders') setOrdersFilter(undefined);
    if (tab !== 'returns') setReturnsFilter(undefined);
    setCurrentTab(tab);
    refreshState();

    // Check if contextual tutorial should trigger on first tab visit
    if (isOnboarded && !activeGuide) {
      const guide = getGuideByTab(tab);
      if (guide && !storageService.isTutorialCompleted(guide.id)) {
        setTimeout(() => {
          setActiveGuide(guide);
        }, 500);
      }
    }
  };

  const sidebarWidthClass = isSidebarCollapsed ? 'lg:pe-18' : 'lg:pe-64';
  const sidebarWidthClassLtr = isSidebarCollapsed ? 'lg:ps-18' : 'lg:ps-64';

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#F7F8FA] text-[#172033] flex flex-col">
        {/* Desktop Fixed Sidebar (RTL: right side; LTR: left side) */}
        <div className="hidden lg:block">
          <Sidebar
            currentTab={currentTab}
            onSelectTab={handleSelectTab}
            locale={locale}
            onToggleLocale={handleToggleLocale}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            activeOrdersCount={activeOrdersCount}
            pendingReturnsCount={pendingReturnsCount}
            isDeveloperMode={isDeveloperMode}
            storeRevision={storeRevision}
          />
        </div>

        {/* Mobile Sidebar Overlay Drawer */}
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-[#172033]/40 backdrop-blur-[2px]"
              onClick={() => setIsMobileMenuOpen(false)}
            />

            <div
              className={`relative z-10 w-72 bg-white h-full shadow-2xl flex flex-col ${
                locale === 'ar' ? 'ms-auto' : 'me-auto'
              }`}
            >
              <div className="absolute top-4 end-4 z-20">
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 text-[#64748B] hover:text-[#172033] rounded-md cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <Sidebar
                currentTab={currentTab}
                onSelectTab={(tab) => {
                  setIsMobileMenuOpen(false);
                  handleSelectTab(tab);
                }}
                locale={locale}
                onToggleLocale={handleToggleLocale}
                isCollapsed={false}
                onToggleCollapse={() => {}}
                activeOrdersCount={activeOrdersCount}
                pendingReturnsCount={pendingReturnsCount}
                isDeveloperMode={isDeveloperMode}
                storeRevision={storeRevision}
              />
            </div>
          </div>
        )}

        {/* Main Content Workspace */}
        <div
          className={`flex-1 flex flex-col min-h-screen transition-all duration-200 ${
            locale === 'ar' ? sidebarWidthClass : sidebarWidthClassLtr
          }`}
        >
          {/* Top Bar Header (Streamlined: Brand & Store Name Only) */}
          <Header
            locale={locale}
            storeRevision={storeRevision}
            onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          />

          {/* Main Views Container keyed by activeMerchantId for full workspace isolation */}
          <main key={activeMerchantId} className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto pb-24 lg:pb-8">
            {currentTab === 'overview' && (
              <OverviewPage
                locale={locale}
                storeRevision={storeRevision}
                onNavigate={handleNavigateFromOverview}
              />
            )}

            {currentTab === 'products' && (
              <ProductsPage
                locale={locale}
                isAddModalOpenInitially={openAddProductModal}
                onCloseInitialAddModal={() => setOpenAddProductModal(false)}
                onDataChange={refreshState}
              />
            )}

            {currentTab === 'orders' && (
              <OrdersPage
                locale={locale}
                isAddModalOpenInitially={openNewOrderModal}
                onCloseInitialAddModal={() => setOpenNewOrderModal(false)}
                initialStatusFilter={ordersFilter}
                onOrdersChange={refreshState}
                onNavigateToCompleted={() => {
                  setCurrentTab('completedOrders');
                  refreshState();
                }}
              />
            )}

            {currentTab === 'completedOrders' && (
              <CompletedOrdersPage
                locale={locale}
                onDataChange={refreshState}
                onNavigateToReturns={() => {
                  setReturnsFilter(undefined);
                  setCurrentTab('returns');
                  refreshState();
                }}
              />
            )}

            {currentTab === 'inventory' && (
              <InventoryPage locale={locale} onDataChange={refreshState} />
            )}

            {currentTab === 'returns' && (
              <ReturnsPage
                locale={locale}
                initialStatusFilter={returnsFilter}
                onReturnsChange={refreshState}
              />
            )}

            {currentTab === 'priceHistory' && <PriceHistoryPage locale={locale} />}

            {currentTab === 'excelImport' && (
              <ExcelImportPage
                locale={locale}
                onDataChange={refreshState}
                onNavigateToProducts={() => {
                  setCurrentTab('products');
                  refreshState();
                }}
              />
            )}

            {currentTab === 'smartImport' && (
              <SmartImportPage
                locale={locale}
                onOrdersImported={refreshState}
                onNavigateToOrders={() => {
                  setCurrentTab('orders');
                  refreshState();
                }}
                onNavigateToCompleted={() => {
                  setCurrentTab('completedOrders');
                  refreshState();
                }}
              />
            )}

            {currentTab === 'guidance' && (
              <MerchantGuidancePage
                locale={locale}
                onNavigateToTab={(tab, filter) =>
                  handleNavigateFromOverview(tab as ActiveTab, filter)
                }
              />
            )}

            {currentTab === 'settings' && (
              <SettingsPage
                locale={locale}
                onDataReset={refreshState}
                onNavigateToTab={(tab) => handleSelectTab(tab as ActiveTab)}
              />
            )}

            {currentTab === 'developerCenter' && isDeveloperMode && (
              <DeveloperCenterPage
                locale={locale}
                onOpenTestSuite={() => setIsTestSuiteOpen(true)}
                onDataChange={refreshState}
                onLockDeveloperMode={() => {
                  setCurrentTab('settings');
                  refreshState();
                }}
              />
            )}
          </main>
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <MobileBottomNav
          currentTab={currentTab}
          onSelectTab={(tab) => handleSelectTab(tab as ActiveTab)}
          locale={locale}
          isDeveloperMode={isDeveloperMode}
          storeRevision={storeRevision}
        />

        {/* In-App Operations Logic Test Suite Modal (Developer Only) */}
        <TestSuiteModal
          isOpen={isTestSuiteOpen && isDeveloperMode}
          onClose={() => setIsTestSuiteOpen(false)}
          locale={locale}
        />

        {/* 1. Merchant Onboarding Modal */}
        <OnboardingModal
          isOpen={isOnboardingOpen}
          locale={locale}
          onComplete={handleOnboardingComplete}
        />

        {/* 2. Interactive Learning Assistant Overlay */}
        {activeGuide && (
          <TutorialOverlay
            guide={activeGuide}
            locale={locale}
            onComplete={handleCompleteTutorial}
            onSkip={handleSkipTutorial}
          />
        )}

        {/* 3. Interactive Learning Center Modal */}
        <LearningCenterModal
          isOpen={isLearningCenterOpen}
          locale={locale}
          onClose={() => setIsLearningCenterOpen(false)}
          onStartGuide={handleStartGuide}
          onResetAllGuides={handleResetAllGuides}
        />
      </div>
    </ToastProvider>
  );
}
