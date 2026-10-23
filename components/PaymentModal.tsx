
import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Trash2, Calculator } from 'lucide-react';
import { formatDate, parseDateFromInput, formatCurrency } from '../utils/helpers';
import Modal from './Modal';

interface PaymentEntry {
  id: string;
  date: string;
  displayDate: string;
  method: string;
  amount: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (details: any) => void;
  billNumber: string;
  totalAmount: number;
  initialPayments?: any[];
}

const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, onSubmit, billNumber, totalAmount, initialPayments }) => {
  const today = new Date().toISOString().split('T')[0];
  
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);

  useEffect(() => {
    if (isOpen) {
      if (initialPayments && initialPayments.length > 0) {
        setPayments(initialPayments.map(p => ({
          id: Math.random().toString(36).substr(2, 9),
          date: p.payment_date || today,
          displayDate: formatDate(p.payment_date || today),
          method: p.payment_method || 'Cash',
          amount: (p.payment_amount || 0).toString()
        })));
      } else {
        setPayments([{
          id: Math.random().toString(36).substr(2, 9),
          date: today,
          displayDate: formatDate(today),
          method: 'Cash',
          amount: totalAmount.toString()
        }]);
      }
    }
  }, [isOpen, initialPayments, totalAmount, today]);

  if (!isOpen) return null;

  const addPayment = () => {
    const remaining = totalAmount - payments.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
    setPayments([...payments, {
      id: Math.random().toString(36).substr(2, 9),
      date: today,
      displayDate: formatDate(today),
      method: 'Cash',
      amount: Math.max(0, remaining).toString()
    }]);
  };

  const removePayment = (id: string) => {
    if (payments.length > 1) {
      setPayments(payments.filter(p => p.id !== id));
    }
  };

  const updatePayment = (id: string, field: keyof PaymentEntry, val: string) => {
    setPayments(payments.map(p => p.id === id ? { ...p, [field]: val } : p));
  };

  const handleBlurDate = (id: string) => {
    const p = payments.find(p => p.id === id);
    if (!p) return;
    const iso = parseDateFromInput(p.displayDate);
    if (iso) {
      updatePayment(id, 'date', iso);
      updatePayment(id, 'displayDate', formatDate(iso));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const formattedPayments = payments.map(p => ({
        payment_date: p.date,
        payment_method: p.method,
        payment_amount: parseFloat(p.amount) || 0
      }));
      await onSubmit(formattedPayments);
    } finally {
      setSaving(false);
    }
  };

  const totalPaid = payments.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
  const balance = totalAmount - totalPaid;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Payment Details - Bill ${billNumber}`} maxWidth="max-w-2xl">
      <div className="flex flex-col">
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
            <div className="text-center">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Bill Amount</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{formatCurrency(totalAmount)}</p>
            </div>
            <div className="text-center border-x border-slate-200 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Paid</p>
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalPaid)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Balance</p>
              <p className={`text-sm font-bold ${balance > 0 ? 'text-amber-600' : balance < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {formatCurrency(balance)}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {payments.map((p, idx) => (
              <div key={p.id} className="p-4 border border-slate-200 dark:border-slate-800 space-y-4 bg-white dark:bg-slate-900">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Payment Entry #{idx + 1}</span>
                  {payments.length > 1 && (
                    <button type="button" onClick={() => removePayment(p.id)} className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</label>
                    <input 
                      required 
                      value={p.displayDate} 
                      onChange={e => updatePayment(p.id, 'displayDate', e.target.value)} 
                      onBlur={() => handleBlurDate(p.id)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm focus:border-slate-500" 
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Payment Method</label>
                    <select 
                      value={p.method} 
                      onChange={e => updatePayment(p.id, 'method', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm appearance-none cursor-pointer focus:border-slate-500"
                    >
                      <option value="Cash" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Cash</option>
                      <option value="Bank Transfer" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Bank Transfer</option>
                      <option value="Cheque" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Cheque</option>
                      <option value="UPI" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">UPI</option>
                      <option value="Credit Card" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Credit Card</option>
                      <option value="Other" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Other</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</label>
                    <input 
                      required 
                      type="number"
                      step="0.01"
                      value={p.amount} 
                      onChange={e => updatePayment(p.id, 'amount', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm font-medium focus:border-slate-500" 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button 
            type="button" 
            onClick={addPayment}
            className="w-full py-2.5 border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:border-primary hover:text-primary transition-colors flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Payment Entry</span>
          </button>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0">
          <button 
            type="button" 
            onClick={onClose} 
            disabled={saving} 
            className="h-10 px-4 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            Discard
          </button>
          <button 
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="h-10 px-6 bg-primary hover:bg-primary-dark text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save Payments
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PaymentModal;
