import { TutorialGuide } from '../../types';

export const TUTORIAL_GUIDES: Record<string, TutorialGuide> = {
  dashboard: {
    id: 'dashboard',
    section: 'overview',
    titleAr: 'دليل مركز العمليات واللوحة الرئيسية',
    titleEn: 'Dashboard & Operations Guide',
    descriptionAr: 'تعرف على كيفية مراقبة مبيعاتك، تنبيهات المخزون العاجلة، ومقارنة المنصات في لمحة واحدة.',
    descriptionEn: 'Learn how to monitor sales, act on inventory warnings, and compare marketplace results.',
    steps: [
      {
        targetSelector: '#tour-overview-stats',
        titleAr: 'مؤشرات أداء المتجر الرئيسية',
        titleEn: 'Store Overview Metrics',
        instructionAr:
          'هنا تتابع أهم أرقام متجرك في بطاقات واضحة ومباشرة: إجمالي الطلبات، المسلم منها بنجاح، الطلبات النشطة، وإجمالي المبيعات المحققة فعلياً.',
        instructionEn:
          'Monitor primary store indicators in clear cards: Total Orders, Delivered Success, Active Orders, and Confirmed Revenue.',
        position: 'bottom',
      },
      {
        targetSelector: '#tour-attention-center',
        titleAr: 'ما يحتاج انتباهك الآن؟',
        titleEn: 'Things That Need Your Attention',
        instructionAr:
          'ينبهك النظام تلقائياً لأي شحنات مرتجعة قيد العودة، أو طرود بانتظار الفحص، أو منتجات سريعة البيع قاربت على النفاد، مع زر إجراء مباشر.',
        instructionEn:
          'Actionable operational alerts for returns in transit, uninspected packages, and fast sellers nearing stockouts with a direct action button.',
        position: 'bottom',
      },
      {
        targetSelector: '#tour-marketplaces',
        titleAr: 'مقارنة أداء منصات البيع',
        titleEn: 'Marketplace Performance Comparison',
        instructionAr:
          'قارن بسهولة بين مبيعات ونسب نجاح كل منصة متصلة بمتجرك (نون، أمازون، أو أي منصة أخرى أضفتها) لمعرفة أين تحقق أفضل النتائج.',
        instructionEn:
          'Compare sales, delivery rates, and unit volumes across all your connected marketplaces (Noon, Amazon, and custom channels).',
        position: 'top',
      },
      {
        targetSelector: '#tour-best-sellers',
        titleAr: 'المنتجات الأكثر مبيعاً وصحة المخزون',
        titleEn: 'Top Selling Products & Stock Health',
        instructionAr:
          'قائمة بالمنتجات الأكثر مبيعاً (المسلمة بنجاح فقط دون احتساب الملغي أو المرفوض)، مع تقدير دقيق لأيام نفاذ المخزون بناءً على وتيرة المبيعات.',
        instructionEn:
          'Top selling products ranked strictly by delivered orders, alongside calculated days to depletion based on real sales velocity.',
        position: 'top',
      },
      {
        targetSelector: '#tour-financial-summary',
        titleAr: 'التحليل المالي وتفكيك الخسائر',
        titleEn: 'Financial Breakdown & Loss Transparency',
        instructionAr:
          'فصل صارم بين الإيرادات الفعلية المسلمة وقيمة المرتجعات والخسائر المثبتة للمنتجات التالفة دون اختلاق أرقام غير موثقة.',
        instructionEn:
          'Strict separation between delivered cashflow, potential returns, and confirmed write-off losses without guesswork.',
        position: 'bottom',
      },
    ],
  },

  products: {
    id: 'products',
    section: 'products',
    titleAr: 'دليل إدارة المنتجات والكتالوج الموحد',
    titleEn: 'Products Management Guide',
    descriptionAr: 'تعرف على هيكلية السجل المركزي الواحد وكيفية ربط مخزون المستودع بالمنصات.',
    descriptionEn: 'Learn how single central product records link warehouse stock with dynamic channels.',
    steps: [
      {
        targetSelector: '#tour-products-table',
        titleAr: 'الكتالوج المركزي الموحد',
        titleEn: 'Unified Product Catalog',
        instructionAr:
          'كل منتج فيزيائي له سجل مركزي واحد يربط مخزون المستودع الفعلي بأسعار وكميات كل منصة بيع بشكل مستقل، دون تكرار السجلات.',
        instructionEn:
          'Each physical item has one central record uniting warehouse inventory with independent prices and quantities across platforms.',
        position: 'bottom',
      },
      {
        targetSelector: '#tour-add-product-btn',
        titleAr: 'إضافة منتج جديد للكتالوج',
        titleEn: 'Add New Product',
        instructionAr:
          'اضغط هنا لتسجيل منتج جديد، إدخال مخزونه بالمستودع، وتحديد كمياته وأسعاره على نون وأمازون والمنصات الأخرى.',
        instructionEn:
          'Click here to register a new product, enter its warehouse stock, and assign prices and quantities for each channel.',
        position: 'bottom',
      },
    ],
  },

  orders: {
    id: 'orders',
    section: 'orders',
    titleAr: 'دليل إدارة الطلبات والشحن',
    titleEn: 'Active Orders Management Guide',
    descriptionAr: 'تتبع الطلبات الجارية وحجز المخزون ومنع الخصم المزدوج.',
    descriptionEn: 'Track active orders, automatic inventory reservations, and idempotent fulfillment.',
    steps: [
      {
        targetSelector: '#tour-orders-table',
        titleAr: 'جدول الطلبات النشطة',
        titleEn: 'Active Orders Workspace',
        instructionAr:
          'بمجرد تسجيل أي طلب، يُحجز مخزونه فوراً من المتاح. وعند تأكيد التسليم يُخصم المخزون الفعلي مرة واحدة وينتقل الطلب لصفحة المكتملة.',
        instructionEn:
          'Creating an order immediately reserves available stock. Delivering finalizes physical deduction and moves the order to completed archive.',
        position: 'top',
      },
      {
        targetSelector: '#tour-new-order-btn',
        titleAr: 'تسجيل طلب يدوي جديد',
        titleEn: 'Register New Order',
        instructionAr:
          'يمكنك تسجيل طلب يدوي لأي منصة لاختبار حجز المخزون وتحديث بيانات الشحن.',
        instructionEn:
          'Manually record an order for any marketplace to test stock reservation and tracking.',
        position: 'bottom',
      },
    ],
  },

  inventory: {
    id: 'inventory',
    section: 'inventory',
    titleAr: 'دليل إدارة وفصل المخزون',
    titleEn: 'Inventory Segregation Guide',
    descriptionAr: 'الفصل الصارم بين المخزون الفعلي، المتاح للبيع، والمحجوز للطلبات.',
    descriptionEn: 'Strict isolation of physical, available, and reserved inventory with audit log.',
    steps: [
      {
        targetSelector: '#tour-inventory-cards',
        titleAr: 'الفصل الثلاثي للمخزون',
        titleEn: 'Tri-Tier Stock Segregation',
        instructionAr:
          'المخزون الفعلي بالمستودع = المتاح للبيع الجديد + المحجوز للطلبات الجارية. هذا الفصل يحميك من البيع الزائد تماماً.',
        instructionEn:
          'Physical stock in warehouse equals available stock plus reserved stock for pending shipments, eliminating overselling risks.',
        position: 'bottom',
      },
      {
        targetSelector: '#tour-movements-log',
        titleAr: 'سجل الحركات التدقيقي المعتمد',
        titleEn: 'Immutable Stock Movements Ledger',
        instructionAr:
          'كل حركة مخزون موثقة بالوقت والسبب والمسؤول لمنع أي تسريب أو تغيير غير موثق للكميات.',
        instructionEn:
          'Every stock delta is audited with timestamp, reason, reference order ID, and operator name.',
        position: 'top',
      },
    ],
  },

  returns: {
    id: 'returns',
    section: 'returns',
    titleAr: 'دليل دورة المرتجعات وبوابة الفحص',
    titleEn: 'Returns Lifecycle & Inspection Gatekeeper',
    descriptionAr: 'مسار عمل موثق يمنع عودة المنتجات المرتجعة للمخزون إلا بعد الفحص.',
    descriptionEn: 'Controlled return workflow ensuring units re-enter inventory only after inspection approval.',
    steps: [
      {
        targetSelector: '#tour-returns-table',
        titleAr: 'مراحل الشحنات المرتجعة',
        titleEn: 'Return Shipments Stages',
        instructionAr:
          'تبدأ الدورة برفض الاستلام ثم انتقال الطرد لشركة الشحن، ثم استلامه في مستودعك، وصولاً لمرحلة الفحص.',
        instructionEn:
          'Tracks rejection at customer door, transit back with courier, warehouse receipt, and physical inspection.',
        position: 'top',
      },
      {
        targetSelector: '#tour-returns-inspect',
        titleAr: 'بوابة الفحص وإعادة الإدراج',
        titleEn: 'Inspection Gatekeeper',
        instructionAr:
          'المنتجات المرتجعة لا تزيد المخزون المتاح تلقائياً. عند فحص المنتج واعتماده كـ "سليم" يعود للمخزون، أما التالف فيتم شطبه نهائياً.',
        instructionEn:
          'Units never restock automatically. Upon inspection approval, sellable units return to available stock; damaged units are written off.',
        position: 'top',
      },
    ],
  },

  excelImport: {
    id: 'excelImport',
    section: 'excelImport',
    titleAr: 'دليل استيراد إكسيل الديناميكي',
    titleEn: 'Dynamic Excel Import Guide',
    descriptionAr: 'توليد نماذج إكسيل فارغة تتكيف تلقائياً مع كافة المنصات المضافة لمتجرك.',
    descriptionEn: 'Generate empty templates dynamically adapted to all your configured marketplaces.',
    steps: [
      {
        targetSelector: '#tour-excel-download',
        titleAr: 'تحميل النموذج المعتمد الفارغ',
        titleEn: 'Download Empty Official Template',
        instructionAr:
          'حمّل نموذج إكسيل فارغاً تماماً بدون أي بيانات تجريبية. الأعمدة تتولد ديناميكياً لتشمل نون وأمازون وأي منصة جديدة أضفتها لمتجرك.',
        instructionEn:
          'Download a 100% blank template. Column headers are generated dynamically to include all your configured channels.',
        position: 'bottom',
      },
      {
        targetSelector: '#tour-excel-upload',
        titleAr: 'الرفع والمعاينة المسبقة',
        titleEn: 'Safe Upload & Preview',
        instructionAr:
          'يقوم النظام بفحص الملف، كشف التكرارات والبيانات غير الصالحة، وعرض النتائج للمراجعة قبل اعتماد الاستيراد بنقرة واحدة.',
        instructionEn:
          'The system parses records, flags in-file duplicates, and previews updates before committing with a single click.',
        position: 'top',
      },
    ],
  },
};

export const tutorialGuides: TutorialGuide[] = Object.values(TUTORIAL_GUIDES);

export function getGuideById(id: string): TutorialGuide | undefined {
  return TUTORIAL_GUIDES[id];
}

export function getGuideByTab(tab: string): TutorialGuide | undefined {
  if (tab === 'overview') return TUTORIAL_GUIDES['dashboard'];
  if (tab === 'excelImport') return TUTORIAL_GUIDES['excelImport'];
  return TUTORIAL_GUIDES[tab];
}
