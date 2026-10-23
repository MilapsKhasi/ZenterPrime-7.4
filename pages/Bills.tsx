
import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Loader2, Edit, Trash2, Plus, ReceiptText, Lock, ArrowUpCircle } from 'lucide-react';
import { formatDate, formatCurrency, getActiveCompanyId, normalizeBill, unsyncTransactionFromCashbook } from '../utils/helpers';
import Modal from '../components/Modal';
import BillForm from '../components/BillForm';
import ConfirmDialog from '../components/ConfirmDialog';
import DateFilter, { DateFilterHandle } from '../components/DateFilter';
import ExportModal from '../components/ExportModal';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import SectionIcon from '../components/SectionIcon';
import { supabase } from '../lib/supabase';
import { useLicense } from '../context/LicenseContext';
import { useSecurityDemo } from '../context/SecurityDemoContext';
import { PaymentVoucherModal } from '../components/PaymentVoucherModal';
import { ActionMenu } from '../components/ActionMenu';

const Bills = () => {
  const location = useLocation();
  const { isReadOnly } = useLicense();
  const { verifyAction } = useSecurityDemo();
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [settlePayment, setSettlePayment] = useState<{
    isOpen: boolean;
    partyName: string;
    billId: string;
    amount: number;
  } | null>(null);
  const [dateRange, setDateRange] = useState<{ startDate: string | null, endDate: string | null }>({ startDate: null, endDate: null });

  useEffect(() => {
    if (location.state?.highlightedId || location.state?.searchKey || location.state?.selectedItem) {
      const targetId = location.state.highlightedId || location.state.selectedItem?.id;
      const targetNo = location.state.selectedItem?.bill_number;
      if (targetNo) {
        setSearchQuery(targetNo);
      } else if (location.state.searchKey) {
        setSearchQuery(location.state.searchKey);
      }
      if (targetId) {
        setHighlightedId(targetId);
      }
    }
  }, [location.state]);

  // Automatically open the target bill modal when loaded
  useEffect(() => {
    if (!loading && bills.length > 0 && (location.state?.highlightedId || location.state?.selectedItem?.id)) {
      const targetId = location.state.highlightedId || location.state.selectedItem?.id;
      const found = bills.find(b => b.id === targetId);
      if (found) {
        setEditingBill(found);
        setIsModalOpen(true);
      } else if (location.state.selectedItem) {
        setEditingBill(normalizeBill(location.state.selectedItem));
        setIsModalOpen(true);
      }
    }
  }, [loading, bills, location.state]);
  
  const [headerFocusIdx, setHeaderFocusIdx] = useState<number | null>(0); 
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [lastShiftNTime, setLastShiftNTime] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dateFilterRef = useRef<DateFilterHandle>(null);
  const newEntryBtnRef = useRef<HTMLButtonElement>(null);

  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; bill: any | null }>({
    isOpen: false,
    bill: null
  });

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) {
      setLoading(false);
      return;
    }
    
    try {
      let query = supabase.from('purchase_bills')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false);
      
      if (dateRange.startDate && dateRange.endDate) {
        query = query.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
      }
      
      const { data, error } = await query.order('date', { ascending: false });
      
      if (error) throw error;
      
      const normalizedData = (data || [])
        .map((b: any) => {
          const norm = normalizeBill(b);
          return norm ? { ...norm, type: 'Purchase' } : null;
        })
        .filter((b: any) => b && !b.items_raw?.is_payment_voucher);
        
      setBills(normalizedData);
    } catch (err: any) {
      console.error("Error loading bills:", err.message || err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const handleRefresh = () => loadData();
    window.addEventListener('appSettingsChanged', handleRefresh);
    return () => window.removeEventListener('appSettingsChanged', handleRefresh);
  }, [dateRange]);

  useEffect(() => {
    if (headerFocusIdx === 0) dateFilterRef.current?.focusYear();
    if (headerFocusIdx === 1) dateFilterRef.current?.focusMonth();
    if (headerFocusIdx === 2) newEntryBtnRef.current?.focus();
  }, [headerFocusIdx]);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteDialog.isOpen) {
          e.preventDefault();
          setDeleteDialog({ isOpen: false, bill: null });
        } else if (isExportModalOpen) {
          e.preventDefault();
          setIsExportModalOpen(false);
        } else if (selectedRowIdx !== null) {
          setSelectedRowIdx(null);
        }
        return;
      }

      const activeEl = document.activeElement;
      const isFocusedInInput = (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || activeEl?.tagName === 'SELECT') && activeEl !== searchInputRef.current;
      if (isFocusedInInput || isModalOpen || isExportModalOpen) return;

      if (selectedRowIdx !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedRowIdx(prev => Math.min((prev || 0) + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedRowIdx(prev => Math.max((prev || 0) - 1, 0));
        }
      }

      if (e.shiftKey) {
        if (e.key === 'N' || e.key === 'n') setLastShiftNTime(Date.now());
        if ((e.key === 'P' || e.key === 'p') && (Date.now() - lastShiftNTime < 1000)) {
            e.preventDefault(); setEditingBill(null); setIsModalOpen(true); setLastShiftNTime(0); return;
        }

        if (e.key === 'X' || e.key === 'x') {
            e.preventDefault(); setIsExportModalOpen(true); return;
        }

        if (e.key === 'ArrowRight') {
            e.preventDefault(); setHeaderFocusIdx(prev => (prev === null ? 0 : (prev + 1) % 3)); setSelectedRowIdx(null);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault(); setHeaderFocusIdx(prev => (prev === null ? 2 : (prev - 1 + 3) % 3)); setSelectedRowIdx(null);
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (activeEl !== searchInputRef.current) {
                searchInputRef.current?.focus();
                setSelectedRowIdx(null); setHeaderFocusIdx(null);
            } else {
                if (filtered.length > 0) {
                    setSelectedRowIdx(0); searchInputRef.current?.blur();
                }
            }
        }

        if (selectedRowIdx !== null && filtered[selectedRowIdx]) {
            if (e.key === 'E' || e.key === 'e') {
                e.preventDefault(); setEditingBill(filtered[selectedRowIdx]); setIsModalOpen(true);
            } else if (e.key === 'D' || e.key === 'd') {
                e.preventDefault();
                if (!deleteDialog.isOpen) setDeleteDialog({ isOpen: true, bill: filtered[selectedRowIdx] });
                else confirmDelete();
            }
        }
      }
    };

    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [bills, selectedRowIdx, headerFocusIdx, isModalOpen, isExportModalOpen, deleteDialog, lastShiftNTime]);

  const confirmDelete = async () => {
    if (!deleteDialog.bill) return;
    const bill = deleteDialog.bill;
    setDeleteDialog({ isOpen: false, bill: null });

    verifyAction('Delete Purchase Bill', async () => {
      const { error } = await supabase.from('purchase_bills').update({ is_deleted: true }).eq('id', bill.id);
      if (!error) {
        await unsyncTransactionFromCashbook(bill);
        loadData();
        window.dispatchEvent(new Event('appSettingsChanged'));
      }
    });
  };

  const filtered = bills.filter(b => {
    const search = searchQuery.toLowerCase();
    return b.bill_number?.toLowerCase().includes(search) || b.vendor_name?.toLowerCase().includes(search);
  });

  const totalPurchase = filtered.reduce((acc, b) => acc + Number(b.grand_total || 0), 0);

  return (
    <div className="space-y-6">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingBill ? "Edit Purchase Bill" : "Register Purchase Bill"} maxWidth="max-w-5xl">
        <BillForm initialData={editingBill} onSubmit={() => { setIsModalOpen(false); loadData(); }} onCancel={() => setIsModalOpen(false)} />
      </Modal>

      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} onExport={() => {}} reportName="Purchase Bills Ledger" />

      <ConfirmDialog isOpen={deleteDialog.isOpen} onClose={() => setDeleteDialog({ isOpen: false, bill: null })} onConfirm={confirmDelete} title="Archive Bill" message={`Are you sure you want to delete bill ${deleteDialog.bill?.bill_number}? (Press Shift + D again to confirm)`} />

      <PageHeader
        icon={ReceiptText}
        iconColor="text-violet-600 dark:text-violet-400"
        title="Purchase Bills Ledger"
        subtitle="Register purchase invoices, track vendor liabilities, and manage stock receipts"
        actions={
          <button
            ref={newEntryBtnRef}
            disabled={isReadOnly}
            onClick={() => {
              if (!isReadOnly) {
                verifyAction('Create Purchase Bill', () => {
                  setEditingBill(null);
                  setIsModalOpen(true);
                });
              }
            }}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-md font-medium text-sm flex items-center justify-center shadow-sm ${
              isReadOnly
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary-dark cursor-pointer'
            }`}
            title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'New Entry'}
          >
            {isReadOnly ? <Lock className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />} New Entry
          </button>
        }
      />

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-4 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:max-w-xs shrink-0">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input 
              ref={searchInputRef}
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bill or vendor..." 
              className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <DateFilter ref={dateFilterRef} onFilterChange={setDateRange} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Total Purchase</p>
              <p className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                {formatCurrency(totalPurchase)}
              </p>
            </div>
            <SectionIcon icon={ReceiptText} className="text-indigo-600 dark:text-indigo-400" size={20} />
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState 
            title="No Purchase Bills Found" 
            message="Keep track of your supply chain by registering your first purchase invoice today!" 
            actionLabel="New Purchase Entry" 
            onAction={() => { setEditingBill(null); setIsModalOpen(true); }} 
          />
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6 w-12 text-center bg-amber-100/70 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 font-bold border-r border-amber-200/50 dark:border-amber-900/30">Sr</th>
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Bill No</th>
                  <th className="py-3.5 px-6">Vendor</th>
                  <th className="py-3.5 px-6 text-right">Without GST</th>
                  <th className="py-3.5 px-6 text-right">GST</th>
                  <th className="py-3.5 px-6 text-right">With GST</th>
                  <th className="py-3.5 px-6 text-center w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm text-slate-700 dark:text-slate-300">
                {filtered.map((b, i) => {
                  const isHighlighted = b.id === highlightedId;
                  return (
                    <tr 
                      key={b.id} 
                      ref={(el) => {
                        if (el && isHighlighted) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }}
                      className={`border-b border-slate-100 dark:border-slate-800/80 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors cursor-pointer ${
                        isHighlighted || selectedRowIdx === i
                          ? 'bg-amber-100/90 dark:bg-amber-950/50 text-slate-900 dark:text-amber-100 font-semibold'
                          : ''
                      }`}
                      onClick={() => { setSelectedRowIdx(i); setHighlightedId(b.id); }}
                    >
                      <td className={`py-4 px-6 text-center font-mono text-xs ${isHighlighted || selectedRowIdx === i ? 'text-amber-900 dark:text-amber-300 font-bold bg-amber-200/60 dark:bg-amber-900/40' : 'text-slate-400'}`}>{i + 1}</td>
                      <td className="py-4 px-6 font-mono text-sm">{formatDate(b.date)}</td>
                      <td className="py-4 px-6 font-mono text-sm text-slate-700 dark:text-slate-300">{b.bill_number}</td>
                      <td className="py-4 px-6 font-bold text-slate-900 dark:text-white capitalize text-sm">{b.vendor_name}</td>
                      <td className="py-4 px-6 text-right font-mono text-slate-600 dark:text-slate-400 text-sm">{formatCurrency(b.total_without_gst)}</td>
                      <td className="py-4 px-6 text-right font-mono text-slate-600 dark:text-slate-400 text-sm">{formatCurrency(b.total_gst)}</td>
                      <td className="py-4 px-6 text-right font-mono font-bold text-slate-900 dark:text-white text-base tabular-nums">{formatCurrency(b.grand_total)}</td>
                      <td className="py-4 px-6 text-center" onClick={(e) => e.stopPropagation()}>
                        <ActionMenu
                          items={[
                            {
                              label: 'Settle Payment',
                              icon: ArrowUpCircle,
                              variant: 'success',
                              onClick: () => {
                                setSettlePayment({
                                  isOpen: true,
                                  partyName: b.vendor_name || b.customer_name || '',
                                  billId: b.id,
                                  amount: Number(b.grand_total || 0)
                                });
                              }
                            },
                            {
                              label: 'Edit Bill',
                              icon: Edit,
                              disabled: isReadOnly,
                              onClick: () => {
                                setEditingBill(b);
                                setIsModalOpen(true);
                              }
                            },
                            {
                              label: 'Delete Bill',
                              icon: Trash2,
                              variant: 'danger',
                              disabled: isReadOnly,
                              onClick: () => {
                                verifyAction('Delete Bill', () => setDeleteDialog({ isOpen: true, bill: b }));
                              }
                            }
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {settlePayment?.isOpen && (
        <PaymentVoucherModal
          isOpen={settlePayment.isOpen}
          onClose={() => setSettlePayment(null)}
          initialType="Payment"
          initialPartyName={settlePayment.partyName}
          initialBillId={settlePayment.billId}
          initialAmount={settlePayment.amount}
          onSuccess={() => {
            setSettlePayment(null);
            loadData();
          }}
        />
      )}
    </div>
  );
};

export default Bills;
