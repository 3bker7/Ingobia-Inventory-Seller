/**
 * Dynamic Excel Template Generator and Parser using SheetJS (xlsx)
 * Strictly supports dynamic marketplace configuration:
 * 1. Product Name (Required)
 * 2. SKU / Product Code (Optional)
 * 3. Image URL (Optional)
 * 4. Physical Stock (Required number >= 0)
 * 5. Dynamic Marketplace Price & Quantity pairs ([Marketplace Name] Price, [Marketplace Name] Quantity)
 *
 * Generated template is completely empty containing ONLY dynamic column headers.
 */

import * as XLSX from 'xlsx';
import { ExcelValidationResult, ExcelImportRow, Product, StockMovement } from '../types';
import { storageService } from './storage';
import { computeEditedAvailableStock } from '../domain/inventoryCustody';

export const CORE_COLUMNS = [
  'Product Name',
  'SKU / Product Code',
  'Image URL',
  'Physical Stock',
];

export const OFFICIAL_TEMPLATE_COLUMNS = [
  'Product Name',
  'SKU / Product Code',
  'Image URL',
  'Physical Stock',
  'Noon Price',
  'Noon Quantity',
  'Amazon Price',
  'Amazon Quantity',
];

/**
 * Dynamically computes official template columns based on the merchant's active marketplaces.
 */
export function getDynamicTemplateColumns(): string[] {
  const marketplaces = storageService.getMarketplaces();
  const cols = [...CORE_COLUMNS];

  for (const mkt of marketplaces) {
    cols.push(`${mkt.nameEn} Price`);
    cols.push(`${mkt.nameEn} Quantity`);
  }

  return cols;
}

/**
 * Downloads completely empty official Excel template with dynamic marketplace columns.
 * Absolutely NO sample rows or demo data.
 */
export function generateExcelTemplate(): void {
  const wb = XLSX.utils.book_new();
  const dynamicCols = getDynamicTemplateColumns();

  // Exactly one worksheet with column headers only
  const wsData = [dynamicCols];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 36 }, // Product Name
    { wch: 20 }, // SKU
    { wch: 30 }, // Image URL
    { wch: 15 }, // Physical Stock
    ...dynamicCols.slice(4).map(() => ({ wch: 16 })),
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Products_Catalog');

  const filename = 'Ingobia_Products_Template.xlsx';
  XLSX.writeFile(wb, filename);
}

/**
 * Validates uploaded Excel file against core columns and dynamic marketplaces
 */
export async function parseAndValidateExcel(file: File): Promise<ExcelValidationResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return {
      isValid: false,
      rows: [],
      totalRows: 0,
      validCount: 0,
      newProductsCount: 0,
      existingProductsCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
    };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawJson = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
  });

  if (rawJson.length < 2) {
    return {
      isValid: false,
      rows: [],
      totalRows: 0,
      validCount: 0,
      newProductsCount: 0,
      existingProductsCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
    };
  }

  const headerRow = (rawJson[0] || []).map((col) =>
    String(col || '').trim().toLowerCase()
  );

  const findColIndex = (...candidates: string[]) => {
    return headerRow.findIndex((h) =>
      candidates.some((c) => h === c.toLowerCase() || h.includes(c.toLowerCase()))
    );
  };

  const nameIdx = findColIndex('product name', 'اسم المنتج', 'name', 'title');
  const skuIdx = findColIndex('sku', 'product code', 'رمز المنتج', 'كود');
  const imgIdx = findColIndex('image url', 'صورة', 'image');
  const stockIdx = findColIndex('physical stock', 'المخزون الفعلي', 'stock', 'physical');

  const hasRequiredHeaders = nameIdx !== -1 && stockIdx !== -1;

  if (!hasRequiredHeaders) {
    return {
      isValid: false,
      rows: [
        {
          rowNumber: 1,
          raw: { headers: rawJson[0] },
          status: 'invalid',
          errors: [
            'الأعمدة المطلوبة غير متوفرة. يجب أن يحتوي الملف على عمودي: Product Name و Physical Stock على الأقل.',
          ],
        },
      ],
      totalRows: 0,
      validCount: 0,
      newProductsCount: 0,
      existingProductsCount: 0,
      duplicateCount: 0,
      invalidCount: 1,
    };
  }

  // Map dynamic marketplaces
  const marketplaces = storageService.getMarketplaces();
  const mktColumnMap: Record<string, { priceIdx: number; qtyIdx: number }> = {};

  for (const mkt of marketplaces) {
    const priceIdx = findColIndex(
      `${mkt.nameEn} price`,
      `${mkt.nameAr} سعر`,
      `سعر ${mkt.nameAr}`,
      `${mkt.id} price`
    );
    const qtyIdx = findColIndex(
      `${mkt.nameEn} quantity`,
      `${mkt.nameEn} qty`,
      `${mkt.nameAr} كمية`,
      `كمية ${mkt.nameAr}`,
      `${mkt.id} qty`
    );
    mktColumnMap[mkt.id] = { priceIdx, qtyIdx };
  }

  const currentProducts = storageService.getProducts();
  const existingSkuMap = new Map(
    currentProducts.filter((p) => p.sku).map((p) => [p.sku.toLowerCase().trim(), p])
  );
  const existingNameMap = new Map(
    currentProducts.map((p) => [p.name.toLowerCase().trim(), p])
  );

  const seenKeysInFile = new Set<string>();
  const duplicateKeysInFile = new Set<string>();

  // Pass 1: detect duplicates within file
  for (let i = 1; i < rawJson.length; i++) {
    const row = rawJson[i];
    if (!row || row.length === 0 || row.every((c) => c === '' || c === undefined)) continue;

    const rawName = String(row[nameIdx] || '').trim().toLowerCase();
    const rawSku = skuIdx !== -1 ? String(row[skuIdx] || '').trim().toLowerCase() : '';
    const key = rawSku || rawName;
    if (!key) continue;

    if (seenKeysInFile.has(key)) {
      duplicateKeysInFile.add(key);
    } else {
      seenKeysInFile.add(key);
    }
  }

  const parsedRows: ExcelValidationResult['rows'] = [];
  let validCount = 0;
  let newProductsCount = 0;
  let existingProductsCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  const parseNum = (val: unknown, defaultVal = 0): number => {
    if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
    const parsed = parseFloat(String(val || '0').replace(/[^0-9.-]/g, ''));
    return isNaN(parsed) ? defaultVal : parsed;
  };

  for (let i = 1; i < rawJson.length; i++) {
    const row = rawJson[i];
    if (!row || row.every((c) => c === '' || c === undefined)) continue;

    const rowNumber = i + 1;
    const errors: string[] = [];

    const name = String(row[nameIdx] || '').trim();
    const sku = skuIdx !== -1 ? String(row[skuIdx] || '').trim() : '';
    const imageUrl =
      imgIdx !== -1 && row[imgIdx]
        ? String(row[imgIdx]).trim()
        : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=160&auto=format&fit=crop&q=80';

    const rawStock = stockIdx !== -1 ? row[stockIdx] : 0;
    const numericStock = parseNum(rawStock, NaN);
    const physicalStock = Number.isFinite(numericStock) ? Math.max(0, Math.floor(numericStock)) : 0;

    if (!name) errors.push('اسم المنتج مطلوب.');
    if (!Number.isFinite(numericStock) || numericStock < 0) {
      errors.push('المخزون الفعلي يجب أن يكون رقماً صحيحاً أكبر من أو يساوي 0.');
    }

    const key = (sku || name).toLowerCase();
    const isDuplicateInFile = duplicateKeysInFile.has(key);

    let status: 'new' | 'existing' | 'duplicate_in_file' | 'invalid' = 'new';

    if (errors.length > 0) {
      status = 'invalid';
      invalidCount++;
    } else if (isDuplicateInFile) {
      status = 'duplicate_in_file';
      duplicateCount++;
      errors.push('هذا المنتج مكرر أكثر من مرة داخل نفس الملف.');
    } else if (
      (sku && existingSkuMap.has(sku.toLowerCase())) ||
      existingNameMap.has(name.toLowerCase())
    ) {
      status = 'existing';
      existingProductsCount++;
      validCount++;
    } else {
      status = 'new';
      newProductsCount++;
      validCount++;
    }

    // Dynamic marketplace values extraction
    const dynamicMktData: Record<string, { price: number; quantity: number }> = {};
    for (const mkt of marketplaces) {
      const { priceIdx, qtyIdx } = mktColumnMap[mkt.id] || { priceIdx: -1, qtyIdx: -1 };
      const mPrice = priceIdx !== -1 ? Math.max(0, parseNum(row[priceIdx], 0)) : 0;
      const mQty = qtyIdx !== -1 ? Math.max(0, Math.floor(parseNum(row[qtyIdx], 0))) : 0;
      dynamicMktData[mkt.id] = { price: mPrice, quantity: mQty };
    }

    const rowData: ExcelImportRow = {
      productName: name,
      sku: sku || `SKU-${Date.now().toString().slice(-4)}-${i}`,
      imageUrl,
      physicalStock,
      noonPrice: dynamicMktData['noon']?.price || 0,
      noonQuantity: dynamicMktData['noon']?.quantity || 0,
      amazonPrice: dynamicMktData['amazon']?.price || 0,
      amazonQuantity: dynamicMktData['amazon']?.quantity || 0,
      marketplaceData: dynamicMktData,
    };

    parsedRows.push({
      rowNumber,
      raw: {
        name,
        sku,
        imageUrl,
        physicalStock: rawStock,
        ...dynamicMktData,
      },
      data: errors.length === 0 ? rowData : undefined,
      status,
      errors,
    });
  }

  return {
    isValid: invalidCount === 0 && duplicateCount === 0,
    rows: parsedRows,
    totalRows: parsedRows.length,
    validCount,
    newProductsCount,
    existingProductsCount,
    duplicateCount,
    invalidCount,
  };
}

/**
 * Executes the confirmed import dynamically for all active marketplaces.
 */
export function executeExcelImport(
  validRows: ExcelImportRow[],
  operator: string = 'مدير العمليات'
): {
  success: boolean;
  error?: string;
  importedNew: number;
  updatedExisting: number;
  totalProcessed: number;
  skippedInvalid?: number;
} {
  let importedNew = 0;
  let updatedExisting = 0;
  let skippedInvalid = 0;
  const marketplaces = storageService.getMarketplaces();
  const workingProducts = storageService.getProducts().map((p) => ({
    ...p,
    marketplaceListings: { ...p.marketplaceListings },
  }));
  const movementsToRecord: StockMovement[] = [];

  for (let rowIdx = 0; rowIdx < validRows.length; rowIdx++) {
    const row = validRows[rowIdx];
    const trimmedSku = row.sku ? row.sku.trim().toLowerCase() : '';
    const trimmedName = row.productName.trim().toLowerCase();
    const existing = workingProducts.find(
      (p) =>
        (trimmedSku && p.sku && p.sku.toLowerCase() === trimmedSku) ||
        p.name.toLowerCase() === trimmedName ||
        (p.nameAr && p.nameAr.toLowerCase() === trimmedName)
    );

    if (existing) {
      const prevPhysical = existing.physicalStock;
      const prevAvailable = existing.availableStock;
      const stockCheck = computeEditedAvailableStock(existing, row.physicalStock);
      if (!stockCheck.valid) {
        skippedInvalid++;
        continue;
      }

      const stockDiff = row.physicalStock - prevPhysical;
      existing.physicalStock = row.physicalStock;
      existing.availableStock = stockCheck.newAvailable;

      // Update dynamic marketplace listings
      if (row.marketplaceData) {
        for (const [mktId, data] of Object.entries(row.marketplaceData)) {
          if (data.price > 0 || data.quantity > 0) {
            existing.marketplaceListings[mktId] = {
              marketplaceId: mktId,
              price: data.price > 0 ? data.price : (existing.marketplaceListings[mktId]?.price || 100),
              quantity: data.quantity,
              listingStatus: data.quantity > 0 ? 'active' : 'out_of_stock',
              lastUpdated: new Date().toISOString(),
            };
          }
        }
      }

      if (row.imageUrl) existing.imageUrl = row.imageUrl;
      existing.updatedAt = new Date().toISOString();

      if (stockDiff !== 0) {
        movementsToRecord.push({
          id: `mov-${Date.now()}-${rowIdx}-${Math.random().toString(36).substring(2, 6)}`,
          productId: existing.id,
          productSku: existing.sku || existing.name,
          productName: existing.name,
          type: 'excel_import',
          quantityChange: stockDiff,
          previousPhysical: prevPhysical,
          newPhysical: existing.physicalStock,
          previousAvailable: prevAvailable,
          newAvailable: existing.availableStock,
          reason: 'تحديث عبر استيراد إكسيل المجمع الموحد',
          operator,
          timestamp: new Date().toISOString(),
        });
      }

      updatedExisting++;
    } else {
      const newProduct: Product = {
        id: `prod-${Date.now()}-${rowIdx}-${Math.random().toString(36).substring(2, 6)}`,
        sku: row.sku || `SKU-${Date.now().toString().slice(-4)}-${rowIdx}`,
        name: row.productName,
        imageUrl: row.imageUrl,
        currentPrice: row.noonPrice || row.amazonPrice || 100,
        physicalStock: row.physicalStock,
        availableStock: row.physicalStock,
        reservedStock: 0,
        awaitingInspectionStock: 0,
        damagedStock: 0,
        outboundInTransitStock: 0,
        returnInTransitStock: 0,
        marketplaceListings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (row.marketplaceData) {
        for (const [mktId, data] of Object.entries(row.marketplaceData)) {
          newProduct.marketplaceListings[mktId] = {
            marketplaceId: mktId,
            price: data.price > 0 ? data.price : 100,
            quantity: data.quantity,
            listingStatus: data.quantity > 0 ? 'active' : 'out_of_stock',
            lastUpdated: new Date().toISOString(),
          };
        }
      } else {
        for (const mkt of marketplaces) {
          const p = mkt.id === 'noon' ? row.noonPrice : mkt.id === 'amazon' ? row.amazonPrice : 100;
          const q = mkt.id === 'noon' ? row.noonQuantity : mkt.id === 'amazon' ? row.amazonQuantity : 0;
          newProduct.marketplaceListings[mkt.id] = {
            marketplaceId: mkt.id,
            price: p > 0 ? p : 100,
            quantity: q,
            listingStatus: q > 0 ? 'active' : 'out_of_stock',
            lastUpdated: new Date().toISOString(),
          };
        }
      }

      workingProducts.unshift(newProduct);

      movementsToRecord.push({
        id: `mov-${Date.now()}-${rowIdx}-${Math.random().toString(36).substring(2, 6)}`,
        productId: newProduct.id,
        productSku: newProduct.sku || newProduct.name,
        productName: newProduct.name,
        type: 'excel_import',
        quantityChange: newProduct.physicalStock,
        previousPhysical: 0,
        newPhysical: newProduct.physicalStock,
        previousAvailable: 0,
        newAvailable: newProduct.availableStock,
        reason: 'إنشاء منتج جديد عبر استيراد إكسيل المجمع',
        operator,
        timestamp: new Date().toISOString(),
      });

      importedNew++;
    }
  }

  const writeRes = storageService.saveProductsBatch(workingProducts, movementsToRecord);
  if (!writeRes.success) {
    return {
      success: false,
      error: writeRes.error,
      importedNew: 0,
      updatedExisting: 0,
      totalProcessed: 0,
      skippedInvalid,
    };
  }

  return {
    success: true,
    importedNew,
    updatedExisting,
    totalProcessed: validRows.length,
    skippedInvalid,
  };
}
