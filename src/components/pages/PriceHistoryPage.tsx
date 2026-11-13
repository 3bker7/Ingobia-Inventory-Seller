import React, { useState } from 'react';
import {
  History,
  TrendingDown,
  TrendingUp,
  Search,
  Filter,
  ShieldCheck,
} from 'lucide-react';
import { storageService } from '../../services/storage';
import { translations, Locale } from '../../locales/translations';

interface PriceHistoryPageProps {
  locale: Locale;
}

export const PriceHistoryPage: React.FC<PriceHistoryPageProps> = ({ locale }) => {
  const t = translations[locale];
  const settings = storageService.getSettings();
  const priceHistory = storageService.getPriceHistory();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('all');
  const [selectedChangeType, setSelectedChangeType] = useState<string>('all');

  const filteredHistory = priceHistory.filter((rec) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      rec.productSku.toLowerCase().includes(q) ||
      rec.productName.toLowerCase().includes(q) ||
      (rec.reason && rec.reason.toLowerCase().includes(q));

    if (!matchesSearch) return false;
    if (selectedMarketplace !== 'all' && rec.marketplaceId !== selectedMarketplace) return false;
    if (selectedChangeType !== 'all' && rec.changeType !== selectedChangeType) return false;

    return true;
  });

  return (
    <div className="space-y-4">
      {/* Notice Banner */}
      <div className="p-3.5 bg-white border border-[#E8ECF2] rounded-xl flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-[#172033]">
              {t.priceHistory.title}
            </h4>
            <p className="text-[11px] text-[#64748B] mt-0.5">
              {t.priceHistory.ruleNotice}
            </p>
          </div>
        </div>

        <span className="text-xs font-mono-code font-bold text-[#172033] tabular-nums">
          {priceHistory.length} {locale === 'ar' ? 'سجل مؤرشف' : 'records'}
        </span>
      </div>

      {/* Search and Filters Toolbar */}
      <div className="bg-white p-3.5 rounded-xl border border-[#E8ECF2] shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-[#64748B] absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.priceHistory.searchPlaceholder}
              className="w-full ps-9 pe-3 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
          </div>

          <select
            value={selectedMarketplace}
            onChange={(e) => setSelectedMarketplace(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{locale === 'ar' ? 'جميع المنصات' : 'All Marketplaces'}</option>
            {settings.marketplaces.map((mkt) => (
              <option key={mkt.id} value={mkt.id}>
                {locale === 'ar' ? mkt.nameAr : mkt.nameEn}
              </option>
            ))}
          </select>

          <select
            value={selectedChangeType}
            onChange={(e) => setSelectedChangeType(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#F7F8FA] border border-[#E8ECF2] rounded-lg text-[#172033] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          >
            <option value="all">{locale === 'ar' ? 'جميع أنواع التغيير' : 'All Changes'}</option>
            <option value="increase">{locale === 'ar' ? 'ارتفاع (+)' : 'Increases (+)'}</option>
            <option value="decrease">{locale === 'ar' ? 'انخفاض (-)' : 'Decreases (-)'}</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
          <Filter className="w-3.5 h-3.5" />
          <span>
            {locale === 'ar' ? 'تم العثور على:' : 'Showing:'}{' '}
            <strong className="text-[#172033]">{filteredHistory.length}</strong>
          </span>
        </div>
      </div>

      {/* Historical Price Table */}
      <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs border-collapse">
            <thead>
              <tr className="bg-[#F7F8FA] border-b border-[#E8ECF2] text-[#64748B] font-semibold select-none">
                <th className="py-3 px-3 text-start">{t.priceHistory.date}</th>
                <th className="py-3 px-3 text-start">{t.priceHistory.sku}</th>
                <th className="py-3 px-3 text-start">{t.priceHistory.productName}</th>
                <th className="py-3 px-3 text-start">{t.priceHistory.marketplace}</th>
                <th className="py-3 px-3 text-end">{t.priceHistory.prevPrice}</th>
                <th className="py-3 px-3 text-end">{t.priceHistory.newPrice}</th>
                <th className="py-3 px-3 text-center">{t.priceHistory.diff}</th>
                <th className="py-3 px-3 text-start">{t.priceHistory.reason}</th>
                <th className="py-3 px-3 text-start">{t.priceHistory.changedBy}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#E8ECF2]">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[#64748B]">
                    <History className="w-8 h-8 mx-auto text-[#64748B]/60 mb-2" />
                    <p className="text-sm font-medium">{t.priceHistory.noHistory}</p>
                  </td>
                </tr>
              ) : (
                filteredHistory.map((rec) => {
                  const mkt = settings.marketplaces.find((m) => m.id === rec.marketplaceId);
                  const isDecrease = rec.changeType === 'decrease';
                  const isIncrease = rec.changeType === 'increase';
                  const diffAmount = rec.newPrice - rec.previousPrice;

                  return (
                    <tr key={rec.id} className="hover:bg-[#F7F8FA]/70 transition-colors">
                      {/* Date */}
                      <td className="py-2.5 px-3 text-[#64748B] text-[11px] tabular-nums whitespace-nowrap">
                        {new Date(rec.timestamp).toLocaleDateString(
                          locale === 'ar' ? 'ar-SA' : 'en-US',
                          { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }
                        )}
                      </td>

                      {/* SKU */}
                      <td className="py-2.5 px-3 font-mono-code font-bold text-[#172033]">
                        {rec.productSku}
                      </td>

                      {/* Name */}
                      <td className="py-2.5 px-3 font-semibold text-[#172033] max-w-xs truncate">
                        {rec.productName}
                      </td>

                      {/* Marketplace */}
                      <td className="py-2.5 px-3">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold border"
                          style={{
                            backgroundColor: mkt?.badgeBg || '#FEF9C3',
                            color: mkt?.badgeText || '#854D0E',
                            borderColor: '#E8ECF2',
                          }}
                        >
                          {locale === 'ar' ? mkt?.nameAr || rec.marketplaceId : mkt?.nameEn || rec.marketplaceId}
                        </span>
                      </td>

                      {/* Previous Price */}
                      <td className="py-2.5 px-3 text-end font-medium text-[#64748B] tabular-nums">
                        {rec.previousPrice.toFixed(2)} {settings.currency}
                      </td>

                      {/* New Price */}
                      <td className="py-2.5 px-3 text-end font-bold text-[#172033] tabular-nums">
                        {rec.newPrice.toFixed(2)} {settings.currency}
                      </td>

                      {/* Difference */}
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 font-bold tabular-nums text-xs px-2 py-0.5 rounded ${
                            isDecrease
                              ? 'bg-emerald-50 text-[#16A36A]'
                              : isIncrease
                              ? 'bg-rose-50 text-[#DC5555]'
                              : 'bg-slate-100 text-[#64748B]'
                          }`}
                        >
                          {isDecrease ? (
                            <TrendingDown className="w-3.5 h-3.5" />
                          ) : isIncrease ? (
                            <TrendingUp className="w-3.5 h-3.5" />
                          ) : null}
                          {isIncrease ? `+${diffAmount.toFixed(2)}` : diffAmount.toFixed(2)}{' '}
                          ({rec.percentageDiff > 0 ? `+${rec.percentageDiff}` : rec.percentageDiff}%)
                        </span>
                      </td>

                      {/* Reason */}
                      <td className="py-2.5 px-3 text-[#172033] max-w-xs truncate" title={rec.reason || '—'}>
                        {rec.reason || '—'}
                      </td>

                      {/* Changed By */}
                      <td className="py-2.5 px-3 text-[#64748B] text-[11px] whitespace-nowrap">
                        {rec.changedBy}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
