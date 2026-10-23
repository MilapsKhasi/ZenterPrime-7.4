import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Calendar, CreditCard, FileText, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import Modal from './Modal';
import { supabase } from '../lib/supabase';
import { getActiveCompanyId, formatDate, normalizeBill, safeSupabaseSave, syncTransactionToCashbook, formatCurrency, isTransactionForParty } from '../utils/helpers';
export { isTransactionForParty };
import { getDraft, saveDraft, clearDraft } from '../utils/draftManager';

interface PaymentVoucherModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: 'Receipt' | 'Payment';
  onSuccess?: () => void;
  initialPartyName?: string;
  initialBillId?: string;
  initialAmount?: number | string;
}

export const PaymentVoucherModal: React.FC<PaymentVoucherModalProps> = ({
  isOpen,
  onClose,
  initialType = 'Receipt',
  onSuccess,
  initialPartyName,
  initialBillId,
  initialAmount
}) => {
  const [voucherType, setVoucherType] = useState<'Receipt' | 'Payment'>(initialType);
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [account, setAccount] = useState<string>('Cash');
  const [partyName, setPartyName] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [isSaveAndNew, setIsSaveAndNew] = useState(false);

  const [customers, setCustomers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [partyBills, setPartyBills] = useState<any[]>([]);
  const [alreadyPaidBillIds, setAlreadyPaidBillIds] = useState<string[]>([]);
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);

  const cid = getActiveCompanyId();
  const draftKey = `payment_voucher_${cid}_${voucherType}`;
  const [isDraftRestored, setIsDraftRestored] = useState(false);

  // Sync initial type & check draft when opened
  useEffect(() => {
    if (isOpen) {
      setVoucherType(initialType);
      const todayStr = new Date().toISOString().split('T')[0];
      setDate(todayStr);

      if (initialPartyName) {
        setAccount('Cash');
        setPartyName(initialPartyName);
        if (initialAmount !== undefined && initialAmount !== null && Number(initialAmount) > 0) {
          setAmount(Number(initialAmount).toFixed(2));
        } else {
          setAmount('');
        }
        setDescription('');
        setSelectedBillIds(initialBillId ? [initialBillId] : []);
        setAlreadyPaidBillIds([]);
        setPartyBills([]);
        setIsDraftRestored(false);
      } else {
        const savedDraft = getDraft(`payment_voucher_${cid}_${initialType}`);
        if (savedDraft) {
          if (savedDraft.date) setDate(savedDraft.date);
          if (savedDraft.account) setAccount(savedDraft.account);
          if (savedDraft.partyName) setPartyName(savedDraft.partyName);
          if (savedDraft.amount) setAmount(savedDraft.amount);
          if (savedDraft.description) setDescription(savedDraft.description);
          if (savedDraft.selectedBillIds) setSelectedBillIds(savedDraft.selectedBillIds);
          setIsDraftRestored(true);
        } else {
          resetForm();
        }
      }
    }
  }, [isOpen, initialType, cid, initialPartyName, initialBillId, initialAmount]);

  // Auto-save draft
  useEffect(() => {
    if (!isOpen || !cid) return;
    if (partyName?.trim() || amount?.trim() || description?.trim() || selectedBillIds.length > 0) {
      saveDraft(draftKey, {
        date, account, partyName, amount, description, selectedBillIds
      });
    }
  }, [isOpen, cid, draftKey, date, account, partyName, amount, description, selectedBillIds]);

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setAccount('Cash');
    setPartyName('');
    setAmount('');
    setDescription('');
    setSelectedBillIds([]);
    setAlreadyPaidBillIds([]);
    setPartyBills([]);
    setIsDraftRestored(false);
  };

  // Load Parties
  useEffect(() => {
    if (!isOpen) return;
    const loadParties = async () => {
      const cid = getActiveCompanyId();
      if (!cid) return;

      const { data: vends } = await supabase.from('vendors').select('*').eq('company_id', cid).eq('is_deleted', false).order('name');
      const { data: custs } = await supabase.from('customers').select('*').eq('company_id', cid).eq('is_deleted', false).order('name');

      const partyMap = new Map();
      (custs || []).forEach((c: any) => {
        const key = c.name ? c.name.trim().toUpperCase() : c.id;
        partyMap.set(key, { ...c, party_type: c.party_type || 'customer', is_customer: true });
      });
      (vends || []).forEach((v: any) => {
        const key = v.name ? v.name.trim().toUpperCase() : v.id;
        partyMap.set(key, v);
      });

      const allParties = Array.from(partyMap.values());

      const receiptParties = allParties.filter((p: any) => {
        const pt = (p.party_type || '').toLowerCase();
        return pt === 'customer' || pt === 'both' || (p.is_customer === true && pt !== 'vendor');
      });

      const paymentParties = allParties.filter((p: any) => {
        const pt = (p.party_type || '').toLowerCase();
        return pt === 'vendor' || pt === 'both' || (p.is_customer === false && pt !== 'customer');
      });

      setCustomers(receiptParties);
      setVendors(paymentParties);
    };

    loadParties();
  }, [isOpen]);

  // Load Pending Bills for selected Party
  useEffect(() => {
    if (!isOpen || !partyName) {
      setPartyBills([]);
      setAlreadyPaidBillIds([]);
      setSelectedBillIds([]);
      return;
    }

    const fetchPartyBills = async () => {
      setLoadingBills(true);
      try {
        const cid = getActiveCompanyId();
        if (!cid) return;
        const table = voucherType === 'Receipt' ? 'sales_invoices' : 'purchase_bills';

        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq('company_id', cid)
          .eq('is_deleted', false);

        if (error) throw error;

        // Extract already paid bill IDs from all payment/receipt vouchers
        const paidIds = (data || [])
          .filter((item: any) => item.items && (item.items as any).is_payment_voucher === true)
          .flatMap((v: any) => v.items?.linked_bills || []);

        setAlreadyPaidBillIds(paidIds);

        // Filter bills for the selected party using case-insensitive matching
        const pNameLower = partyName.trim().toLowerCase();
        const bills = (data || []).filter((item: any) => {
          const isVoucher = item.items && (item.items as any).is_payment_voucher === true;
          const itemParty = (voucherType === 'Receipt' ? (item.customer_name || item.vendor_name) : (item.vendor_name || item.customer_name)) || '';
          const nameMatch = itemParty.trim().toLowerCase() === pNameLower;
          const isTargetBill = initialBillId && item.id === initialBillId;
          return !isVoucher && (nameMatch || isTargetBill);
        });

        setPartyBills(bills);
        if (initialBillId && bills.some((b: any) => b.id === initialBillId)) {
          setSelectedBillIds([initialBillId]);
          const targetB = bills.find((b: any) => b.id === initialBillId);
          if (targetB) {
            const billAmt = initialAmount ? Number(initialAmount) : Number(targetB.grand_total || 0);
            if (billAmt > 0) {
              setAmount(billAmt.toFixed(2));
            }
          }
        } else {
          setSelectedBillIds([]);
        }
      } catch (err) {
        console.error('Error fetching party bills:', err);
      } finally {
        setLoadingBills(false);
      }
    };

    fetchPartyBills();
  }, [isOpen, partyName, voucherType, initialBillId, initialAmount]);

  const handleBillToggle = (billId: string) => {
    setSelectedBillIds(prev => {
      const next = prev.includes(billId)
        ? prev.filter(id => id !== billId)
        : [...prev, billId];

      const total = partyBills
        .filter((b: any) => next.includes(b.id))
        .reduce((sum: number, b: any) => sum + (Number(b.grand_total) || 0), 0);

      setAmount(total > 0 ? total.toFixed(2) : '');
      return next;
    });
  };

  const totalOutstanding = useMemo(() => {
    return partyBills
      .filter((b: any) => {
        const hasDirectPayment = (Array.isArray(b.items?.payment_details) && b.items.payment_details.length > 0) ||
                                 (Array.isArray(b.payment_details) && b.payment_details.length > 0);
        const isLinked = alreadyPaidBillIds.includes(b.id);
        return !hasDirectPayment && !isLinked;
      })
      .reduce((sum: number, b: any) => sum + (Number(b.grand_total) || 0), 0);
  }, [partyBills, alreadyPaidBillIds]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const cid = getActiveCompanyId();
    if (!cid) {
      alert('Please select or create a workspace first.');
      return;
    }

    if (!partyName) {
      alert('Please select a party.');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert('Please enter a valid amount.');
      return;
    }

    setSaving(true);
    try {
      const isReceipt = voucherType === 'Receipt';
      const table = isReceipt ? 'sales_invoices' : 'purchase_bills';

      const { data: existingVVs } = await supabase
        .from(table)
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false);

      const prefix = isReceipt ? 'REC-' : 'PAY-';
      let maxSeq = 0;
      if (existingVVs) {
        existingVVs.forEach((v: any) => {
          const no = isReceipt ? (v as any).invoice_number : (v as any).bill_number;
          if (no && no.startsWith(prefix)) {
            const numPart = no.substring(prefix.length);
            if (/^\d+$/.test(numPart)) {
              const parsed = parseInt(numPart, 10);
              if (!isNaN(parsed) && parsed > maxSeq) {
                maxSeq = parsed;
              }
            }
          }
        });
      }

      const generatedNo = `${prefix}${(maxSeq + 1).toString().padStart(3, '0')}`;

      const selectedBills = partyBills.filter(b => selectedBillIds.includes(b.id));
      const refText = selectedBills.length > 0
        ? ` (Ref: ${selectedBills.map(b => b.invoice_number || b.bill_number).join(', ')})`
        : '';
      const finalDesc = (description.trim() || `${voucherType} Voucher`) + refText;

      const payload: any = {
        company_id: cid,
        date: date,
        total_without_gst: 0,
        total_gst: 0,
        grand_total: 0,
        status: 'Paid',
        is_deleted: false,
        description: finalDesc,
        items: {
          line_items: [],
          is_payment_voucher: true,
          payment_details: [{
            payment_amount: parsedAmount,
            payment_date: date,
            payment_method: account.trim()
          }],
          linked_bills: selectedBillIds
        }
      };

      if (isReceipt) {
        payload.customer_name = partyName;
        payload.invoice_number = generatedNo;
      } else {
        payload.vendor_name = partyName;
        payload.bill_number = generatedNo;
      }

      const res = await safeSupabaseSave(table, payload);

      if (res && res.data && res.data[0]) {
        await syncTransactionToCashbook(res.data[0]);
      }

      // Update linked bills status to 'Paid'
      if (selectedBillIds.length > 0) {
        await supabase
          .from(table)
          .update({ status: 'Paid' })
          .in('id', selectedBillIds);
      }

      clearDraft(draftKey);
      setIsDraftRestored(false);
      window.dispatchEvent(new Event('appSettingsChanged'));

      if (onSuccess) onSuccess();

      if (isSaveAndNew) {
        resetForm();
      } else {
        onClose();
      }
    } catch (err: any) {
      alert('Error saving voucher: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardDraft = () => {
    clearDraft(draftKey);
    resetForm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={voucherType === 'Receipt' ? 'New Receive Payment Voucher' : 'New Pay Supplier Voucher'}
      maxWidth="max-w-5xl"
    >
      <form onSubmit={handleSave} className="p-6 space-y-6">
        {isDraftRestored && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
            <span className="flex items-center gap-2 font-medium">
              <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Restored unsaved draft from your previous session.</span>
            </span>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-2.5 py-1 bg-amber-200/70 dark:bg-amber-900/60 hover:bg-amber-300 dark:hover:bg-amber-800 text-amber-950 dark:text-amber-100 font-semibold transition-colors cursor-pointer"
            >
              Discard Draft
            </button>
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2">Voucher Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setVoucherType('Receipt'); setPartyName(''); }}
              className={`h-10 border text-sm font-medium transition-colors flex items-center justify-center cursor-pointer ${voucherType === 'Receipt' ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'}`}
            >
              <ArrowDownCircle className="w-4 h-4 mr-2" /> Receipt (Receive Money)
            </button>
            <button
              type="button"
              onClick={() => { setVoucherType('Payment'); setPartyName(''); }}
              className={`h-10 border text-sm font-medium transition-colors flex items-center justify-center cursor-pointer ${voucherType === 'Payment' ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-500 text-rose-700 dark:text-rose-400' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'}`}
            >
              <ArrowUpCircle className="w-4 h-4 mr-2" /> Payment (Pay Money)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm focus:border-slate-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Account (Bank / Cash)</label>
            <div className="relative">
              <CreditCard className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                required
                placeholder="e.g. Kotak Bank, SBI, Cash"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm focus:border-slate-500"
                list="accounts-suggestions-modal"
              />
              <datalist id="accounts-suggestions-modal">
                <option value="Cash" />
                <option value="Kotak Bank" />
                <option value="State Bank of India" />
                <option value="HDFC Bank" />
                <option value="ICICI Bank" />
                <option value="Bank of Baroda" />
              </datalist>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">
              {voucherType === 'Receipt' ? 'Customer Name (Party)' : 'Vendor Name (Party)'}
            </label>
            <select
              required
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm focus:border-slate-500"
            >
              <option value="" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Select Party</option>
              {voucherType === 'Receipt' ? (
                customers.map(c => <option key={c.id} value={c.name} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">{c.name} {c.balance ? `(Bal: ${formatCurrency(c.balance)})` : ''}</option>)
              ) : (
                vendors.map(v => <option key={v.id} value={v.name} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">{v.name} {v.balance ? `(Bal: ${formatCurrency(v.balance)})` : ''}</option>)
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Amount</label>
            <input
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm font-medium focus:border-slate-500"
            />
          </div>
        </div>

        {partyName && (
          <div className="border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                {voucherType === 'Receipt' ? 'Pending Sales Invoices' : 'Pending Purchase Bills'}
              </span>
              <div className="flex items-center space-x-3 text-xs font-medium">
                <span className="text-slate-600 dark:text-slate-400">
                  Outstanding: <span className="text-red-600 dark:text-red-400 font-semibold">{formatCurrency(totalOutstanding)}</span>
                </span>
                {selectedBillIds.length > 0 && (
                  <span className="bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium border border-primary/20">
                    {selectedBillIds.length} Selected
                  </span>
                )}
              </div>
            </div>

            {loadingBills ? (
              <div className="py-4 flex items-center justify-center text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin mr-2 text-primary" /> Loading bills...
              </div>
            ) : partyBills.length === 0 ? (
              <div className="py-2 text-center text-xs text-slate-400 italic">
                No previous bills found for this party.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-100 dark:divide-slate-800">
                {partyBills.map((b) => {
                  const hasDirectPayment = (Array.isArray(b.items?.payment_details) && b.items.payment_details.length > 0) ||
                                           (Array.isArray(b.payment_details) && b.payment_details.length > 0);
                  const isPaid = hasDirectPayment || alreadyPaidBillIds.includes(b.id);
                  const isChecked = isPaid || selectedBillIds.includes(b.id);
                  const billNo = b.invoice_number || b.bill_number;
                  return (
                    <label
                      key={b.id}
                      className={`flex items-center justify-between py-2.5 px-3 text-xs transition-colors ${
                        isPaid
                          ? 'opacity-65 bg-slate-100/50 dark:bg-slate-800/20 cursor-not-allowed'
                          : isChecked
                            ? 'bg-primary/5 dark:bg-primary/10 cursor-pointer'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isPaid}
                          onChange={() => !isPaid && handleBillToggle(b.id)}
                          className="w-4 h-4 border-slate-300 text-primary dark:bg-slate-800 dark:border-slate-700 disabled:opacity-75"
                        />
                        <div className="flex flex-col">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-slate-900 dark:text-white">{billNo}</span>
                            {isPaid && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200">
                                Paid
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500">{formatDate(b.date)}</span>
                        </div>
                      </div>
                      <span className="font-semibold text-slate-950 dark:text-white">
                        {formatCurrency(Number(b.grand_total) || 0)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">Narration / Description</label>
          <div className="relative">
            <FileText className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <textarea
              placeholder="Enter transaction remarks..."
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm focus:border-slate-500 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
          >
            Discard
          </button>
          <button
            type="submit"
            onClick={() => setIsSaveAndNew(false)}
            disabled={saving}
            className="h-10 px-6 bg-primary hover:bg-primary-dark text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving && !isSaveAndNew && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
            Save
          </button>
          <button
            type="submit"
            onClick={() => setIsSaveAndNew(true)}
            disabled={saving}
            className="h-10 px-5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving && isSaveAndNew && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
            Save & New
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default PaymentVoucherModal;
