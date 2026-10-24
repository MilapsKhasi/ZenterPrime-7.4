import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, FileText, ShoppingCart, ArrowDownCircle, ArrowUpCircle, Lock } from 'lucide-react';
import { useLicense } from '../context/LicenseContext';

interface NewVoucherDropdownProps {
  onSelectSalesInvoice: () => void;
  onSelectPurchaseBill: () => void;
  onSelectReceivePayment: () => void;
  onSelectMakePayment: () => void;
  className?: string;
}

export const NewVoucherDropdown: React.FC<NewVoucherDropdownProps> = ({
  onSelectSalesInvoice,
  onSelectPurchaseBill,
  onSelectReceivePayment,
  onSelectMakePayment,
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isReadOnly } = useLicense();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={`relative inline-block text-left ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={isReadOnly}
        onClick={() => { if (!isReadOnly) setIsOpen(!isOpen); }}
        title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'New Voucher'}
        className={`px-4 py-2 font-medium text-xs rounded capitalize flex items-center justify-between gap-1.5 shadow-sm transition-none ${
          isReadOnly
            ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-300 dark:border-slate-700'
            : 'bg-[#4338ca] text-white hover:bg-[#3730a3] cursor-pointer'
        }`}
      >
        {isReadOnly && <Lock className="w-3.5 h-3.5" />}
        <span>New Voucher</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !isReadOnly && (
        <div className="absolute right-0 mt-1.5 w-48 sm:w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 z-50 text-xs">
          <button
            type="button"
            onClick={() => { setIsOpen(false); onSelectSalesInvoice(); }}
            className="w-full text-left px-3.5 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 flex items-center gap-2.5 font-medium transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Sales Invoice</span>
          </button>
          <button
            type="button"
            onClick={() => { setIsOpen(false); onSelectPurchaseBill(); }}
            className="w-full text-left px-3.5 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 flex items-center gap-2.5 font-medium transition-colors cursor-pointer"
          >
            <ShoppingCart className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>Purchase Bill</span>
          </button>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button
            type="button"
            onClick={() => { setIsOpen(false); onSelectReceivePayment(); }}
            className="w-full text-left px-3.5 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 flex items-center gap-2.5 font-medium transition-colors cursor-pointer"
          >
            <ArrowDownCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Receive Payment</span>
          </button>
          <button
            type="button"
            onClick={() => { setIsOpen(false); onSelectMakePayment(); }}
            className="w-full text-left px-3.5 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 flex items-center gap-2.5 font-medium transition-colors cursor-pointer"
          >
            <ArrowUpCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>Pay Supplier</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default NewVoucherDropdown;
