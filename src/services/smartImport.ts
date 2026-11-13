/**
 * Smart Import (Beta) – Automated Order File Import Engine
 * Analyzes Excel and CSV files from Noon Seller Lab and Amazon Seller Central.
 * Performs intelligent column name recognition, fuzzy matching, cell content heuristics,
 * multi-row order grouping, duplicate detection (Platform + Order ID), and historical order segregation.
 */

import * as XLSX from 'xlsx';
import {
  MarketplaceId,
  OrderStatus,
  ColumnMappingItem,
  DetectedFieldType,
  ConfidenceLevel,
  SmartOrderGroup,
  SmartOrderItem,
  SmartImportValidationResult,
} from '../types';
import { storageService } from './storage';

// Multilingual synonym dictionary for order reports
const FIELD_SYNONYMS: Record<DetectedFieldType, { nameAr: string; nameEn: string; keywords: string[] }> = {
  orderId: {
    nameAr: 'رقم / معرّف الطلب',
    nameEn: 'Order ID',
    keywords: [
      'order id',
      'order-id',
      'orderid',
      'order_id',
      'order number',
      'order no',
      'order-no',
      'order reference',
      'order ref',
      'order #',
      'purchase order',
      'purchase order number',
      'amazon order id',
      'amazon-order-id',
      'noon order id',
      'noon order number',
      'noon order nr',
      'shipment id',
      'tracking id',
      'رقم الطلب',
      'كود الطلب',
      'معرف الطلب',
      'الطلب',
      'مرجع الطلب',
    ],
  },
  sku: {
    nameAr: 'رمز الصنف (SKU)',
    nameEn: 'Product SKU',
    keywords: [
      'sku',
      'seller sku',
      'seller-sku',
      'sellersku',
      'seller_sku',
      'merchant sku',
      'merchant-sku',
      'merchantsku',
      'product sku',
      'item sku',
      'partner sku',
      'asin',
      'noon sku',
      'item code',
      'product code',
      'رمز المنتج',
      'رمز sku',
      'كود الصنف',
      'الرمز التعريفي',
      'الباركود',
    ],
  },
  quantity: {
    nameAr: 'الكمية المطلوبة',
    nameEn: 'Quantity',
    keywords: [
      'quantity',
      'qty',
      'item qty',
      'units',
      'item quantity',
      'quantity purchased',
      'shipped quantity',
      'ordered quantity',
      'number of items',
      'count',
      'الكمية',
      'عدد الوحدات',
      'العدد',
      'كمية الطلب',
    ],
  },
  price: {
    nameAr: 'سعر الوحدة / القيمة',
    nameEn: 'Unit Price',
    keywords: [
      'price',
      'item price',
      'selling price',
      'unit price',
      'item subtotal',
      'order item price',
      'total price',
      'item amount',
      'amount',
      'sales price',
      'product sales',
      'order total',
      'السعر',
      'سعر الوحدة',
      'قيمة المنتج',
      'المبلغ',
      'إجمالي السعر',
    ],
  },
  status: {
    nameAr: 'حالة الطلب',
    nameEn: 'Order Status',
    keywords: [
      'status',
      'order status',
      'shipment status',
      'fulfillment status',
      'current status',
      'order_status',
      'state',
      'حالة الطلب',
      'حالة الشحنة',
      'الحالة',
      'وضع الطلب',
    ],
  },
  orderDate: {
    nameAr: 'تاريخ الطلب',
    nameEn: 'Order Date',
    keywords: [
      'order date',
      'purchase date',
      'created date',
      'date',
      'order timestamp',
      'order-date',
      'created_at',
      'purchase-date',
      'order creation date',
      'datetime',
      'time',
      'تاريخ الطلب',
      'تاريخ الشراء',
      'التاريخ',
      'تاريخ الإسناد',
    ],
  },
  customerName: {
    nameAr: 'اسم العميل / المستلم',
    nameEn: 'Customer Name',
    keywords: [
      'customer name',
      'buyer name',
      'recipient name',
      'ship to name',
      'customer',
      'buyer',
      'recipient',
      'ship-to-name',
      'contact name',
      'اسم العميل',
      'المشتري',
      'المستلم',
      'الاسم',
    ],
  },
};

/**
 * Normalizes text for lenient comparisons
 */
function normalizeHeader(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[_\-\/\.:#]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Inspects a cell sample value to corroborate expected content type
 */
function inspectCellType(value: unknown, field: DetectedFieldType): boolean {
  if (value === undefined || value === null || value === '') return false;
  const strVal = String(value).trim();

  switch (field) {
    case 'orderId':
      // Usually alphanumeric, hyphens, or digits (length 4+)
      return /^[A-Za-z0-9\-_]{4,}$/.test(strVal) || /^\d{5,}$/.test(strVal);
    case 'sku':
      // Usually uppercase/alphanumeric code
      return /^[A-Za-z0-9\-_]{3,}$/.test(strVal);
    case 'quantity':
      // Integer >= 1
      return /^\d+$/.test(strVal) && parseInt(strVal, 10) > 0;
    case 'price':
      // Float or currency
      return !isNaN(parseFloat(strVal.replace(/[^0-9.-]/g, '')));
    case 'orderDate':
      // Date string or ISO or timestamp
      return !isNaN(Date.parse(strVal)) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(strVal);
    case 'status':
      return strVal.length > 2 && isNaN(Number(strVal));
    default:
      return true;
  }
}

/**
 * Detects best matching column for a given field
 */
function detectColumnForField(
  field: DetectedFieldType,
  headers: string[],
  sampleRows: Record<string, unknown>[],
  marketplace: MarketplaceId,
  usedColumns: Set<string>
): { column: string | null; confidence: ConfidenceLevel; sampleValue: string } {
  const definition = FIELD_SYNONYMS[field];
  let bestColumn: string | null = null;
  let bestScore = 0;
  let sampleValue = '—';

  for (const header of headers) {
    if (usedColumns.has(header)) continue;
    const normalized = normalizeHeader(header);
    let score = 0;

    // 1. Keyword synonym match
    for (const kw of definition.keywords) {
      if (normalized === kw) {
        score = 100;
        break;
      } else if (normalized.includes(kw) || kw.includes(normalized)) {
        score = Math.max(score, 70);
      }
    }

    // Marketplace specific boosts
    if (marketplace === 'amazon') {
      if (field === 'orderId' && normalized.includes('amazon order id')) score = 100;
      if (field === 'sku' && (normalized.includes('merchant sku') || normalized === 'asin')) score = Math.max(score, 90);
    } else if (marketplace === 'noon') {
      if (field === 'orderId' && normalized.includes('noon order')) score = 100;
      if (field === 'sku' && normalized.includes('partner sku')) score = Math.max(score, 90);
    }

    // 2. Cell content verification across up to 5 sample rows
    if (score > 0 && sampleRows.length > 0) {
      const matchCount = sampleRows.filter((r) => inspectCellType(r[header], field)).length;
      if (matchCount >= Math.min(2, sampleRows.length)) {
        score += 20;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestColumn = header;
    }
  }

  let confidence: ConfidenceLevel = 'low';
  if (bestScore >= 90) {
    confidence = 'high';
  } else if (bestScore >= 50) {
    confidence = 'medium';
  }

  if (bestColumn && sampleRows.length > 0) {
    sampleValue = String(sampleRows[0][bestColumn] ?? '—');
  }

  return { column: bestColumn, confidence, sampleValue };
}

/**
 * Normalizes marketplace order status into our domain OrderStatus
 */
export function normalizeOrderStatus(rawStatus: string): {
  status: OrderStatus;
  isHistorical: boolean;
} {
  const norm = (rawStatus || '').toLowerCase().trim();

  if (
    norm.includes('delivered') ||
    norm.includes('completed') ||
    norm.includes('received') ||
    norm.includes('تم التوصيل') ||
    norm.includes('تم التسليم') ||
    norm.includes('مكتمل')
  ) {
    return { status: 'delivered', isHistorical: true };
  }

  if (
    norm.includes('shipped') ||
    norm.includes('with courier') ||
    norm.includes('out for delivery') ||
    norm.includes('in transit') ||
    norm.includes('dispatched') ||
    norm.includes('مع المندوب') ||
    norm.includes('جاري الشحن')
  ) {
    return { status: 'with_delivery', isHistorical: false };
  }

  if (
    norm.includes('cancelled') ||
    norm.includes('canceled') ||
    norm.includes('ملغي') ||
    norm.includes('تم الإلغاء')
  ) {
    return { status: 'cancelled', isHistorical: true };
  }

  if (
    norm.includes('rejected') ||
    norm.includes('returned') ||
    norm.includes('return') ||
    norm.includes('مرفوض') ||
    norm.includes('مرتجع')
  ) {
    return { status: 'rejected', isHistorical: false };
  }

  // Default: newly registered / preparing order
  return { status: 'preparing', isHistorical: false };
}

/**
 * Reads and analyzes an uploaded Excel or CSV order file.
 * Returns column analysis, confidence mappings, and sample previews.
 */
export async function analyzeOrderFile(
  file: File,
  marketplace: MarketplaceId
): Promise<{
  fileName: string;
  columns: string[];
  mappings: ColumnMappingItem[];
  rawRows: Record<string, unknown>[];
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('الملف فارغ أو تالف.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });

  if (rawJson.length === 0) {
    throw new Error('لا توجد بيانات صالحة داخل الملف.');
  }

  const columns = Object.keys(rawJson[0]);
  const sampleRows = rawJson.slice(0, 5);

  const usedColumns = new Set<string>();
  const mappings: ColumnMappingItem[] = [];

  const requiredFields: DetectedFieldType[] = [
    'orderId',
    'sku',
    'quantity',
    'price',
    'status',
    'orderDate',
    'customerName',
  ];

  for (const field of requiredFields) {
    const isRequired = field !== 'customerName';
    const detection = detectColumnForField(field, columns, sampleRows, marketplace, usedColumns);

    if (detection.column && detection.confidence === 'high') {
      usedColumns.add(detection.column);
    }

    mappings.push({
      field,
      fieldLabelAr: FIELD_SYNONYMS[field].nameAr,
      fieldLabelEn: FIELD_SYNONYMS[field].nameEn,
      required: isRequired,
      detectedColumn: detection.column,
      confidence: detection.confidence,
      sampleValue: detection.sampleValue,
      userConfirmedColumn: detection.column,
    });
  }

  return {
    fileName: file.name,
    columns,
    mappings,
    rawRows: rawJson,
  };
}

/**
 * Parses raw rows using user-confirmed column mappings into grouped orders.
 * Handles multi-row order consolidation, duplicate detection, and inventory safety.
 */
export function processMappedOrderRows(
  rawRows: Record<string, unknown>[],
  mappings: ColumnMappingItem[],
  marketplace: MarketplaceId,
  fileName: string,
  columns: string[]
): SmartImportValidationResult {
  const mappingMap = new Map<DetectedFieldType, string>();
  for (const m of mappings) {
    const col = m.userConfirmedColumn || m.detectedColumn;
    if (col) {
      mappingMap.set(m.field, col);
    }
  }

  const orderIdCol = mappingMap.get('orderId');
  const skuCol = mappingMap.get('sku');
  const qtyCol = mappingMap.get('quantity');
  const priceCol = mappingMap.get('price');
  const statusCol = mappingMap.get('status');
  const dateCol = mappingMap.get('orderDate');
  const customerCol = mappingMap.get('customerName');

  // Existing orders in storage to prevent duplicates
  const existingOrders = storageService.getOrders();
  const existingKeySet = new Set(
    existingOrders.map((o) => `${o.marketplaceId.toLowerCase()}_${o.id.toLowerCase()}`)
  );

  const catalogProducts = storageService.getProducts();
  const productSkuMap = new Map(
    catalogProducts.filter((p) => p.sku).map((p) => [p.sku.toLowerCase().trim(), p])
  );

  // Group raw rows by Order ID
  const groupedOrdersMap = new Map<string, SmartOrderGroup>();

  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const rawOrderId = orderIdCol ? String(row[orderIdCol] || '').trim() : '';

    if (!rawOrderId) continue;

    const rawSku = skuCol ? String(row[skuCol] || '').trim() : 'UNKNOWN-SKU';
    const rawQty = qtyCol ? parseFloat(String(row[qtyCol] || '1').replace(/[^0-9.-]/g, '')) : 1;
    const quantity = isNaN(rawQty) || rawQty <= 0 ? 1 : Math.floor(rawQty);

    const rawPrice = priceCol ? parseFloat(String(row[priceCol] || '0').replace(/[^0-9.-]/g, '')) : 0;
    const unitPrice = isNaN(rawPrice) || rawPrice < 0 ? 0 : rawPrice;

    const rawStatus = statusCol ? String(row[statusCol] || '').trim() : 'preparing';
    const rawDate = dateCol ? String(row[dateCol] || '').trim() : new Date().toISOString();
    const customerName = customerCol ? String(row[customerCol] || '').trim() : undefined;

    // Resolve product info from catalog
    const matchedProduct = productSkuMap.get(rawSku.toLowerCase());
    const productName = matchedProduct?.name || `Product (${rawSku})`;
    const imageUrl =
      matchedProduct?.imageUrl ||
      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=160&auto=format&fit=crop&q=80';
    const productId = matchedProduct?.id || `auto-prod-${rawSku}`;

    const orderItem: SmartOrderItem = {
      sku: rawSku,
      productName,
      imageUrl,
      quantity,
      unitPrice,
      productId,
    };

    if (!groupedOrdersMap.has(rawOrderId)) {
      const normalized = normalizeOrderStatus(rawStatus);
      const isDuplicate = existingKeySet.has(`${marketplace.toLowerCase()}_${rawOrderId.toLowerCase()}`);

      // Parse order date safely
      let parsedDate = new Date().toISOString();
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          parsedDate = d.toISOString();
        }
      }

      groupedOrdersMap.set(rawOrderId, {
        orderId: rawOrderId,
        marketplaceId: marketplace,
        items: [orderItem],
        totalAmount: unitPrice * quantity,
        orderDate: parsedDate,
        customerName,
        rawStatus,
        normalizedStatus: normalized.status,
        isDuplicate,
        isHistorical: normalized.isHistorical,
        hasErrors: false,
        errors: [],
      });
    } else {
      // Consolidate multi-row items into the single order
      const existingGroup = groupedOrdersMap.get(rawOrderId)!;
      existingGroup.items.push(orderItem);
      existingGroup.totalAmount += unitPrice * quantity;
    }
  }

  const orders = Array.from(groupedOrdersMap.values());

  let newOrdersCount = 0;
  let historicalOrdersCount = 0;
  let duplicateOrdersCount = 0;
  let errorOrdersCount = 0;

  for (const ord of orders) {
    if (ord.isDuplicate) {
      duplicateOrdersCount++;
    } else if (ord.isHistorical) {
      historicalOrdersCount++;
    } else {
      newOrdersCount++;
    }
  }

  return {
    marketplace,
    fileName,
    totalRows: rawRows.length,
    columns,
    mappings,
    orders,
    totalOrdersDetected: orders.length,
    newOrdersCount,
    historicalOrdersCount,
    duplicateOrdersCount,
    errorOrdersCount,
  };
}
