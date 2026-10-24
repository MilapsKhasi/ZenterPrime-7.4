import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { Upload, ArrowUp, ArrowDown, Check, TrendingUp } from 'lucide-react';
import { getAppSettings, formatCurrency } from '../utils/helpers';

interface SalesPurchaseChartProps {
  sales: any[];
  purchases: any[];
  loading?: boolean;
}

type TimeRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'All';
type ViewMode = 'revenue' | 'purchases' | 'comparative';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const SalesPurchaseChart: React.FC<SalesPurchaseChartProps> = ({
  sales = [],
  purchases = [],
  loading = false
}) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('6M');
  const [viewMode, setViewMode] = useState<ViewMode>('revenue');
  const [exported, setExported] = useState(false);

  // Theme reactivity (light/dark and dynamic primary color)
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });
  const [primaryColor, setPrimaryColor] = useState<string>('#4338CA');

  useEffect(() => {
    const updateTheme = () => {
      const dark = document.documentElement.classList.contains('dark');
      setIsDark(dark);
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
      if (computed) {
        setPrimaryColor(computed);
      }
    };

    updateTheme();
    window.addEventListener('appSettingsChanged', updateTheme);

    const observer = new MutationObserver(() => {
      updateTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-edition']
    });

    return () => {
      window.removeEventListener('appSettingsChanged', updateTheme);
      observer.disconnect();
    };
  }, []);

  const { currency } = getAppSettings();
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '₹';

  // Format compact numbers (e.g. $284.5K or ₹2.8L)
  const formatCompact = (val: number): string => {
    if (val === 0) return `${currencySymbol}0`;
    if (currency === 'INR') {
      if (val >= 10000000) return `${currencySymbol}${(val / 10000000).toFixed(1)}Cr`;
      if (val >= 100000) return `${currencySymbol}${(val / 100000).toFixed(1)}L`;
      if (val >= 1000) return `${currencySymbol}${(val / 1000).toFixed(1)}K`;
      return `${currencySymbol}${Math.round(val)}`;
    } else {
      if (val >= 1000000) return `${currencySymbol}${(val / 1000000).toFixed(1)}M`;
      if (val >= 1000) return `${currencySymbol}${(val / 1000).toFixed(1)}K`;
      return `${currencySymbol}${Math.round(val)}`;
    }
  };

  // Generate chart data based on time range and transactions
  const { chartData, totalRevenue, totalPurchases, growthRate, avgValue } = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    interface Bucket {
      key: string;
      label: string;
      fullLabel: string;
      dateStart: Date;
      dateEnd: Date;
      revenue: number;
      purchases: number;
    }

    const buckets: Bucket[] = [];

    if (timeRange === '1W') {
      // Last 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        buckets.push({
          key: dateKey,
          label: `${dayStr} ${d.getDate()}`,
          fullLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          dateStart: start,
          dateEnd: end,
          revenue: 0,
          purchases: 0
        });
      }
    } else if (timeRange === '1M') {
      // 4 Weekly intervals
      for (let i = 3; i >= 0; i--) {
        const endD = new Date(now);
        endD.setDate(endD.getDate() - i * 7);
        const startD = new Date(endD);
        startD.setDate(startD.getDate() - 6);
        buckets.push({
          key: `W${4 - i}`,
          label: `Wk ${4 - i}`,
          fullLabel: `${startD.getDate()} ${MONTH_NAMES[startD.getMonth()]} - ${endD.getDate()} ${MONTH_NAMES[endD.getMonth()]}`,
          dateStart: startD,
          dateEnd: endD,
          revenue: 0,
          purchases: 0
        });
      }
    } else if (timeRange === '3M') {
      // Last 3 months
      for (let i = 2; i >= 0; i--) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 0, 23, 59, 59);
        buckets.push({
          key: `${y}-${m}`,
          label: MONTH_NAMES[m],
          fullLabel: `${FULL_MONTHS[m]} ${y}`,
          dateStart: start,
          dateEnd: end,
          revenue: 0,
          purchases: 0
        });
      }
    } else if (timeRange === '6M') {
      // Last 6 months (exact layout from Dribbble reference)
      for (let i = 5; i >= 0; i--) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 0, 23, 59, 59);
        buckets.push({
          key: `${y}-${m}`,
          label: MONTH_NAMES[m],
          fullLabel: `${FULL_MONTHS[m]} ${y}`,
          dateStart: start,
          dateEnd: end,
          revenue: 0,
          purchases: 0
        });
      }
    } else {
      // '1Y' & 'All': Last 12 months
      for (let i = 11; i >= 0; i--) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 0, 23, 59, 59);
        buckets.push({
          key: `${y}-${m}`,
          label: MONTH_NAMES[m],
          fullLabel: `${FULL_MONTHS[m]} ${y}`,
          dateStart: start,
          dateEnd: end,
          revenue: 0,
          purchases: 0
        });
      }
    }

    const parseItemDate = (item: any): Date | null => {
      const raw = item?.date;
      if (!raw) return null;
      if (typeof raw === 'string' && raw.includes('-')) {
        const parts = raw.split('-');
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10) || 1);
      }
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    sales.forEach(s => {
      const itemDate = parseItemDate(s);
      if (!itemDate) return;
      const amt = Number(s.grand_total || 0);
      const b = buckets.find(b => itemDate >= b.dateStart && itemDate <= b.dateEnd);
      if (b) {
        b.revenue += amt;
      }
    });

    purchases.forEach(p => {
      const itemDate = parseItemDate(p);
      if (!itemDate) return;
      const amt = Number(p.grand_total || 0);
      const b = buckets.find(b => itemDate >= b.dateStart && itemDate <= b.dateEnd);
      if (b) {
        b.purchases += amt;
      }
    });

    const processed = buckets.map((b, idx, arr) => {
      const prevVal = idx > 0 ? arr[idx - 1].revenue : b.revenue;
      let pointGrowth = 0;
      if (prevVal > 0) {
        pointGrowth = Number((((b.revenue - prevVal) / prevVal) * 100).toFixed(1));
      } else if (b.revenue > 0) {
        pointGrowth = 100;
      }

      return {
        ...b,
        growth: pointGrowth,
        net: b.revenue - b.purchases
      };
    });

    const totRev = processed.reduce((acc, curr) => acc + curr.revenue, 0);
    const totPur = processed.reduce((acc, curr) => acc + curr.purchases, 0);

    const half = Math.floor(processed.length / 2);
    const firstHalfSum = processed.slice(0, half).reduce((acc, curr) => acc + curr.revenue, 0);
    const secondHalfSum = processed.slice(half).reduce((acc, curr) => acc + curr.revenue, 0);
    let overallGrowth = 0;
    if (firstHalfSum > 0) {
      overallGrowth = Number((((secondHalfSum - firstHalfSum) / firstHalfSum) * 100).toFixed(1));
    } else if (secondHalfSum > 0) {
      overallGrowth = 100;
    }

    const avg = processed.length > 0 ? Math.round(totRev / processed.length) : 0;

    return {
      chartData: processed,
      totalRevenue: totRev,
      totalPurchases: totPur,
      growthRate: overallGrowth,
      avgValue: avg
    };
  }, [sales, purchases, timeRange]);

  const handleExport = () => {
    if (chartData.length === 0) return;
    const csvRows = [
      ['Period', 'Revenue (Sales)', 'Purchases (Expenses)', 'Net Difference', 'Growth %'].join(','),
      ...chartData.map(d => [
        `"${d.fullLabel}"`,
        d.revenue.toFixed(2),
        d.purchases.toFixed(2),
        (d.revenue - d.purchases).toFixed(2),
        `${d.growth}%`
      ].join(','))
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-overview-${timeRange.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  };

  // Custom Floating Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;

    const displayAmount = viewMode === 'purchases' ? data.purchases : data.revenue;
    const isGrowthPos = data.growth >= 0;

    return (
      <div className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl shadow-xl p-3 border border-slate-200 dark:border-slate-700 min-w-[150px] select-none pointer-events-none transition-none">
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
          {data.fullLabel}
        </div>
        <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
          <span>{viewMode === 'purchases' ? 'Purchases' : 'Revenue'}</span>
          <span className="font-semibold text-slate-950 dark:text-white font-mono">
            {formatCurrency(displayAmount)}
          </span>
        </div>
        {viewMode === 'comparative' && (
          <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400 flex items-center space-x-1.5 mt-0.5">
            <span>Expenses</span>
            <span className="font-semibold font-mono">{formatCurrency(data.purchases)}</span>
          </div>
        )}
        <div className="flex items-center space-x-1 mt-1.5">
          <span
            className={`text-[11px] font-bold flex items-center ${
              isGrowthPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {isGrowthPos ? '+' : ''}{data.growth}%
            {isGrowthPos ? (
              <ArrowUp className="w-3 h-3 ml-0.5" />
            ) : (
              <ArrowDown className="w-3 h-3 ml-0.5" />
            )}
          </span>
        </div>
      </div>
    );
  };

  const isGrowthPos = growthRate >= 0;
  const activeTotal = viewMode === 'purchases' ? totalPurchases : totalRevenue;

  // Grid and Axis styling based on theme
  const gridStroke = isDark ? '#1e293b' : '#f1f5f9';
  const axisTickColor = isDark ? '#64748b' : '#94a3b8';

  return (
    <div className="rounded-[4px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs overflow-hidden p-5 sm:p-7 relative select-none" style={{ borderRadius: '4px' }}>
      {/* Top Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white capitalize">
              Revenue Overview
            </h2>

            {/* View Mode Switcher */}
            <div className="hidden sm:inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode('revenue')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  viewMode === 'revenue'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Revenue
              </button>
              <button
                type="button"
                onClick={() => setViewMode('purchases')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  viewMode === 'purchases'
                    ? 'bg-rose-500 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Purchases
              </button>
              <button
                type="button"
                onClick={() => setViewMode('comparative')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  viewMode === 'comparative'
                    ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Both
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {viewMode === 'purchases'
              ? 'Business procurement and vendor expenditures'
              : viewMode === 'comparative'
              ? 'Real-time sales revenue trajectory compared against purchases'
              : 'Business revenue growth and monthly performance'}
          </p>
        </div>

        {/* Timeframe & Export Buttons */}
        <div className="flex items-center space-x-2 sm:space-x-3 self-start md:self-auto">
          {/* Timeframe Filters (1W, 1M, 3M, 1Y, 6M, All) */}
          <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800/80 p-1 border border-slate-200 dark:border-slate-700/60">
            {(['1W', '1M', '3M', '1Y', '6M', 'All'] as TimeRange[]).map(range => {
              const isActive = timeRange === range;
              return (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  className={`px-2.5 sm:px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {range}
                </button>
              );
            })}
          </div>

          {/* Export Button */}
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer shadow-xs"
            title="Export chart data as CSV"
          >
            {exported ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Exported</span>
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>Export</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Chart Canvas Area */}
      <div className="w-full h-64 sm:h-72 min-w-0 my-2">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
            <span>Loading overview chart...</span>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
            <TrendingUp className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
            <span>No transaction activity recorded for this period</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 20, right: 10, left: 10, bottom: 0 }}
            >
              <defs>
                {/* Dynamic Primary Theme Gradient */}
                <linearGradient id="revenueThemeGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={primaryColor}
                    stopOpacity={isDark ? 0.55 : 0.32}
                  />
                  <stop
                    offset="50%"
                    stopColor={primaryColor}
                    stopOpacity={isDark ? 0.2 : 0.1}
                  />
                  <stop
                    offset="95%"
                    stopColor={primaryColor}
                    stopOpacity={0.0}
                  />
                </linearGradient>

                {/* Purchases Gradient */}
                <linearGradient id="purchasesThemeGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="#f43f5e"
                    stopOpacity={isDark ? 0.5 : 0.28}
                  />
                  <stop
                    offset="50%"
                    stopColor="#f43f5e"
                    stopOpacity={isDark ? 0.18 : 0.08}
                  />
                  <stop
                    offset="95%"
                    stopColor="#f43f5e"
                    stopOpacity={0.0}
                  />
                </linearGradient>
              </defs>

              {/* Minimal horizontal guidelines only */}
              <CartesianGrid
                vertical={false}
                horizontal={true}
                stroke={gridStroke}
                strokeDasharray="0"
              />

              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: axisTickColor, fontSize: 12, fontWeight: 500 }}
                dy={10}
              />

              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: axisTickColor, fontSize: 11, fontWeight: 500 }}
                tickFormatter={formatCompact}
                dx={-5}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: primaryColor,
                  strokeWidth: 1,
                  strokeDasharray: '3 3',
                  opacity: 0.35
                }}
              />

              {/* Revenue Area Curve */}
              {(viewMode === 'revenue' || viewMode === 'comparative') && (
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke={primaryColor}
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#revenueThemeGlow)"
                  isAnimationActive={false}
                  activeDot={{
                    r: 5,
                    fill: '#ffffff',
                    stroke: primaryColor,
                    strokeWidth: 3
                  }}
                />
              )}

              {/* Purchases Area Curve */}
              {(viewMode === 'purchases' || viewMode === 'comparative') && (
                <Area
                  type="monotone"
                  dataKey="purchases"
                  stroke="#f43f5e"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#purchasesThemeGlow)"
                  isAnimationActive={false}
                  activeDot={{
                    r: 5,
                    fill: '#ffffff',
                    stroke: '#f43f5e',
                    strokeWidth: 3
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Floating Centered Stats Capsule Pill */}
      <div className="flex justify-center mt-3 pt-2">
        <div className="inline-flex items-center gap-4 sm:gap-7 px-5 sm:px-8 py-2.5 rounded-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-xs shadow-xs">
          {/* Total */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Total</span>
            <span className="font-bold text-slate-900 dark:text-white tracking-tight text-sm">
              {formatCompact(activeTotal)}
            </span>
          </div>

          <div className="w-[1px] h-3.5 bg-slate-200 dark:bg-slate-700"></div>

          {/* Growth */}
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Growth</span>
            <span
              className={`font-semibold text-xs flex items-center ${
                isGrowthPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {isGrowthPos ? '+' : ''}{growthRate}%
              {isGrowthPos ? (
                <ArrowUp className="w-3.5 h-3.5 ml-0.5" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 ml-0.5" />
              )}
            </span>
          </div>

          <div className="w-[1px] h-3.5 bg-slate-200 dark:bg-slate-700"></div>

          {/* Average */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Avg</span>
            <span className="font-bold text-slate-900 dark:text-white tracking-tight text-sm">
              {formatCompact(avgValue)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalesPurchaseChart;
