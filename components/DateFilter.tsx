import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface DateFilterProps {
  onFilterChange: (range: { startDate: string | null, endDate: string | null }) => void;
}

export interface DateFilterHandle {
  focusYear: () => void;
  focusMonth: () => void;
}

const DateFilter = forwardRef<DateFilterHandle, DateFilterProps>(({ onFilterChange }, ref) => {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(`This Year`);
  const [selectedMonth, setSelectedMonth] = useState('This Month');

  const yearRef = useRef<HTMLSelectElement>(null);
  const monthRef = useRef<HTMLSelectElement>(null);

  useImperativeHandle(ref, () => ({
    focusYear: () => yearRef.current?.focus(),
    focusMonth: () => monthRef.current?.focus(),
  }));

  const years = ['This Year', `${currentYear - 1}-${currentYear}`, `${currentYear}-${currentYear + 1}`];
  const months = ['This Month', 'All Months', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  useEffect(() => {
    const now = new Date();
    const currentYearNum = now.getFullYear();
    const currentMonthIdx = now.getMonth(); // 0-indexed (0 = Jan, 11 = Dec)

    // 1. Calculate the financial year bounds based on selectedYear
    let startYear = currentYearNum;
    if (selectedYear === 'This Year') {
      // In India, Financial Year starts April 1st.
      // If current month is Jan/Feb/Mar, the current FY started previous year.
      startYear = (currentMonthIdx < 3) ? currentYearNum - 1 : currentYearNum;
    } else {
      // Format is e.g. "2025-2026"
      const parts = selectedYear.split('-');
      if (parts.length === 2) {
        startYear = parseInt(parts[0], 10);
      }
    }
    const endYear = startYear + 1;

    // 2. Determine target month index or if "All Months" is selected
    let targetMonthIdx = currentMonthIdx;
    let isAllMonths = false;

    if (selectedMonth === 'This Month') {
      targetMonthIdx = currentMonthIdx;
    } else if (selectedMonth === 'All Months') {
      isAllMonths = true;
    } else {
      const monthMap: { [key: string]: number } = {
        'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
        'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11
      };
      targetMonthIdx = monthMap[selectedMonth] !== undefined ? monthMap[selectedMonth] : currentMonthIdx;
    }

    let startDate: string | null = null;
    let endDate: string | null = null;

    if (isAllMonths) {
      // Entire financial year: April 1st of startYear to March 31st of endYear
      startDate = `${startYear}-04-01`;
      endDate = `${endYear}-03-31`;
    } else {
      // Standard calendar month mapping within the selected financial year context.
      // April (3) to December (11) are in the startYear of that financial year.
      // January (0) to March (2) are in the endYear of that financial year.
      const calYear = (targetMonthIdx >= 3) ? startYear : endYear;
      
      const monthStr = String(targetMonthIdx + 1).padStart(2, '0');
      startDate = `${calYear}-${monthStr}-01`;

      const lastDay = new Date(calYear, targetMonthIdx + 1, 0).getDate();
      const lastDayStr = String(lastDay).padStart(2, '0');
      endDate = `${calYear}-${monthStr}-${lastDayStr}`;
    }

    onFilterChange({ startDate, endDate });
  }, [selectedYear, selectedMonth]);

  return (
    <div className="flex space-x-2">
      <div className="relative">
        <select
          ref={yearRef}
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          style={{ height: '40px' }}
          className="appearance-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md pl-4 pr-10 text-xs font-normal text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer outline-none min-w-[110px] focus:border-primary focus:ring-1 focus:ring-primary transition-colors h-10"
        >
          {years.map((opt: string) => <option key={opt} value={opt} className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">{opt}</option>)}
        </select>
        <ChevronDown className="w-3 h-3 absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>

      <div className="relative">
        <select
          ref={monthRef}
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          style={{ height: '40px' }}
          className="appearance-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md pl-4 pr-10 text-xs font-normal text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer outline-none min-w-[110px] focus:border-primary focus:ring-1 focus:ring-primary transition-colors h-10"
        >
          {months.map((opt: string) => <option key={opt} value={opt} className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">{opt}</option>)}
        </select>
        <ChevronDown className="w-3 h-3 absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
});

export default DateFilter;
