
import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Loader2, Edit, Trash2, Plus, Printer, FileText, Lock, ArrowDownCircle } from 'lucide-react';
import { formatDate, formatCurrency, getActiveCompanyId, normalizeBill, unsyncTransactionFromCashbook, syncInvoiceItemsToItemsTable } from '../utils/helpers';
import Modal from '../components/Modal';
import SalesInvoiceForm from '../components/SalesInvoiceForm';
import ConfirmDialog from '../components/ConfirmDialog';
import DateFilter, { DateFilterHandle } from '../components/DateFilter';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import SectionIcon from '../components/SectionIcon';
import { supabase } from '../lib/supabase';
import { InvoicePrintModal } from '../components/InvoicePrintModal';
import { PaymentVoucherModal } from '../components/PaymentVoucherModal';
import { ActionMenu, ActionMenuItem } from '../components/ActionMenu';
import { useLicense } from '../context/LicenseContext';
import { useSecurityDemo } from '../context/SecurityDemoContext';

const Sales = () => {
  const location = useLocation();
  const { isReadOnly } = useLicense();
  const { verifyAction } = useSecurityDemo();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [printModalInvoice, setPrintModalInvoice] = useState<any | null>(null);
  const [settlePayment, setSettlePayment] = useState<{
    isOpen: boolean;
    partyName: string;
    billId: string;
    amount: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ startDate: string | null, endDate: string | null }>({ startDate: null, endDate: null });

  useEffect(() => {
    if (location.state?.highlightedId || location.state?.searchKey || location.state?.selectedItem) {
      const targetId = location.state.highlightedId || location.state.selectedItem?.id;
      const targetNo = location.state.selectedItem?.invoice_number || location.state.selectedItem?.bill_number;
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

  // Automatically open the target invoice modal when loaded
  useEffect(() => {
    if (!loading && invoices.length > 0 && (location.state?.highlightedId || location.state?.selectedItem?.id)) {
      const targetId = location.state.highlightedId || location.state.selectedItem?.id;
      const found = invoices.find(inv => inv.id === targetId);
      if (found) {
        setEditingInvoice(found);
        setIsModalOpen(true);
      } else if (location.state.selectedItem) {
        setEditingInvoice(normalizeBill(location.state.selectedItem));
        setIsModalOpen(true);
      }
    }
  }, [loading, invoices, location.state]);
  
  const [headerFocusIdx, setHeaderFocusIdx] = useState<number | null>(0); 
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [lastShiftNTime, setLastShiftNTime] = useState<number>(0);

  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; invoice: any | null }>({
    isOpen: false,
    invoice: null
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dateFilterRef = useRef<DateFilterHandle>(null);
  const newSaleBtnRef = useRef<HTMLButtonElement>(null);

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) return;
    
    try {
      let query = supabase.from('sales_invoices')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false);

      if (dateRange.startDate && dateRange.endDate) {
        query = query.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
      }
      const { data, error } = await query.order('date', { ascending: false });
      
      if (error) throw error;
      
      const normalizedData = (data || []).map(normalizeBill).filter((b: any) => b && !b.items_raw?.is_payment_voucher);
      setInvoices(normalizedData);

      // Sync items from sales_invoices into the stock_items table once per invoice
      syncInvoiceItemsToItemsTable(data || [], cid).catch(err => {
        console.warn('Failed to sync invoice items to stock_items:', err);
      });
    } catch (err: any) {
      console.error("Error loading sales:", err.message || err);
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

  const filtered = invoices.filter(i => {
    const search = searchQuery.toLowerCase();
    return i.invoice_number?.toLowerCase().includes(search) || i.customer_name?.toLowerCase().includes(search);
  });

  useEffect(() => {
    if (headerFocusIdx === 0) dateFilterRef.current?.focusYear();
    if (headerFocusIdx === 1) dateFilterRef.current?.focusMonth();
    if (headerFocusIdx === 2) newSaleBtnRef.current?.focus();
  }, [headerFocusIdx]);

  const confirmDelete = async () => {
    if (!deleteDialog.invoice) return;
    const inv = deleteDialog.invoice;
    setDeleteDialog({ isOpen: false, invoice: null });

    verifyAction('Delete Sales Invoice', async () => {
      const { error } = await supabase.from('sales_invoices').update({ is_deleted: true }).eq('id', inv.id);
      if (!error) {
          await unsyncTransactionFromCashbook(inv);
          loadData();
          window.dispatchEvent(new Event('appSettingsChanged'));
      }
    });
  };

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteDialog.isOpen) {
          e.preventDefault();
          setDeleteDialog({ isOpen: false, invoice: null });
        } else if (selectedRowIdx !== null) {
          setSelectedRowIdx(null);
        }
        return;
      }

      const activeEl = document.activeElement;
      const isFocusedInInput = (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || activeEl?.tagName === 'SELECT') && activeEl !== searchInputRef.current;
      if (isFocusedInInput || isModalOpen) return;

      if (selectedRowIdx !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedRowIdx(prev => (prev === null ? 0 : Math.min(prev + 1, filtered.length - 1)));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedRowIdx(prev => (prev === null ? 0 : Math.max(prev - 1, 0)));
        }
      }

      if (e.shiftKey) {
        if (e.key === 'N' || e.key === 'n') {
          setLastShiftNTime(Date.now());
        }
        if ((e.key === 'S' || e.key === 's') && (Date.now() - lastShiftNTime < 1000)) {
          e.preventDefault();
          setEditingInvoice(null);
          setIsModalOpen(true);
          setLastShiftNTime(0);
          return;
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setHeaderFocusIdx(prev => (prev === null ? 0 : (prev + 1) % 3));
          setSelectedRowIdx(null);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setHeaderFocusIdx(prev => (prev === null ? 2 : (prev - 1 + 3) % 3));
          setSelectedRowIdx(null);
        } 
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (activeEl !== searchInputRef.current) {
            searchInputRef.current?.focus();
            setSelectedRowIdx(null);
            setHeaderFocusIdx(null);
          } else {
            if (filtered.length > 0) {
              setSelectedRowIdx(0);
              searchInputRef.current?.blur();
            }
          }
        } 
        else if (e.key === 'E' || e.key === 'e') {
          if (selectedRowIdx !== null && filtered[selectedRowIdx]) {
            e.preventDefault();
            setEditingInvoice(filtered[selectedRowIdx]);
            setIsModalOpen(true);
          }
        } 
        else if (e.key === 'D' || e.key === 'd') {
          if (selectedRowIdx !== null && filtered[selectedRowIdx]) {
            e.preventDefault();
            const inv = filtered[selectedRowIdx];
            if (!deleteDialog.isOpen) {
              setDeleteDialog({ isOpen: true, invoice: inv });
            } else {
              confirmDelete();
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [filtered, selectedRowIdx, deleteDialog, headerFocusIdx, isModalOpen, lastShiftNTime]);

  return (
    <div className="space-y-6">
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingInvoice(null); }} title={editingInvoice ? "Update Sale Invoice" : "Generate Sale Invoice"} maxWidth="max-w-5xl">
        <SalesInvoiceForm initialData={editingInvoice} onSubmit={(inv, shouldPrint, isSaveAndNew) => { if (!isSaveAndNew) { setIsModalOpen(false); setEditingInvoice(null); } loadData(); if (shouldPrint && inv) setPrintModalInvoice(inv); }} onCancel={() => { setIsModalOpen(false); setEditingInvoice(null); }} />
      </Modal>

      <ConfirmDialog 
        isOpen={deleteDialog.isOpen} 
        onClose={() => setDeleteDialog({ isOpen: false, invoice: null })} 
        onConfirm={confirmDelete} 
        title="Delete Invoice" 
        message={`Permanently archive sale invoice ${deleteDialog.invoice?.invoice_number}? (Press Shift + D again to confirm, or Esc to cancel)`} 
      />

      <PageHeader
        icon={FileText}
        iconColor="text-emerald-600 dark:text-emerald-400"
        title="Sales Ledger"
        subtitle="Generate sales invoices, track revenue, and manage customer accounts"
        actions={
          <button
            ref={newSaleBtnRef}
            disabled={isReadOnly}
            onClick={() => {
              if (!isReadOnly) {
                verifyAction('Create Sales Invoice', () => {
                  setEditingInvoice(null);
                  setIsModalOpen(true);
                });
              }
            }}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-md font-medium text-sm flex items-center justify-center shadow-sm ${
              isReadOnly
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary-dark cursor-pointer'
            }`}
            title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'New Sale'}
          >
            {isReadOnly ? <Lock className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />} New Sale
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
              placeholder="Search invoice or customer..." 
              className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <DateFilter ref={dateFilterRef} onFilterChange={setDateRange} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Total Revenue</p>
              <p className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                {formatCurrency(filtered.reduce((acc, i) => acc + Number(i.grand_total || 0), 0))}
              </p>
            </div>
            <SectionIcon icon={FileText} className="text-emerald-600 dark:text-emerald-400" size={20} />
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState 
            title="No Sales Invoices" 
            message="Start generating revenue records by creating your first sales invoice. Track payments and customer history efficiently!" 
            actionLabel="Generate New Sale" 
            onAction={() => { setEditingInvoice(null); setIsModalOpen(true); }} 
          />
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6 w-12 text-center bg-amber-100/70 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 font-bold border-r border-amber-200/50 dark:border-amber-900/30">Sr</th>
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Invoice #</th>
                  <th className="py-3.5 px-6">Customer</th>
                  <th className="py-3.5 px-6 text-right">Taxable</th>
                  <th className="py-3.5 px-6 text-right">GST</th>
                  <th className="py-3.5 px-6 text-right">Net Total</th>
                  <th className="py-3.5 px-6 text-center w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm text-slate-700 dark:text-slate-300">
                {filtered.map((inv, i) => {
                  const isHighlighted = inv.id === highlightedId;
                  return (
                    <tr 
                      key={inv.id} 
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
                      onClick={() => { setSelectedRowIdx(i); setHighlightedId(inv.id); }}
                    >
                      <td className={`py-4 px-6 text-center font-mono text-xs ${isHighlighted || selectedRowIdx === i ? 'text-amber-900 dark:text-amber-300 font-bold bg-amber-200/60 dark:bg-amber-900/40' : 'text-slate-400'}`}>{i + 1}</td>
                      <td className="py-4 px-6 font-mono text-sm">{formatDate(inv.date)}</td>
                      <td className="py-4 px-6 font-mono text-sm text-slate-700 dark:text-slate-300">{inv.bill_number}</td>
                      <td className="py-4 px-6 font-bold text-slate-900 dark:text-white capitalize text-sm">{inv.vendor_name}</td>
                      <td className="py-4 px-6 text-right font-mono text-slate-600 dark:text-slate-400 text-sm">{formatCurrency(inv.total_without_gst)}</td>
                      <td className="py-4 px-6 text-right font-mono text-slate-600 dark:text-slate-400 text-sm">{formatCurrency(inv.total_gst)}</td>
                      <td className="py-4 px-6 text-right font-mono font-bold text-slate-900 dark:text-white text-base tabular-nums">{formatCurrency(inv.grand_total)}</td>
                      <td className="py-4 px-6 text-center" onClick={(e) => e.stopPropagation()}>
                        <ActionMenu
                          items={[
                            {
                              label: 'Settle Payment',
                              icon: ArrowDownCircle,
                              variant: 'success',
                              onClick: () => {
                                setSettlePayment({
                                  isOpen: true,
                                  partyName: inv.vendor_name || inv.customer_name || '',
                                  billId: inv.id,
                                  amount: Number(inv.grand_total || 0)
                                });
                              }
                            },
                            {
                              label: 'Edit Invoice',
                              icon: Edit,
                              disabled: isReadOnly,
                              onClick: () => {
                                setEditingInvoice(inv);
                                setIsModalOpen(true);
                              }
                            },
                            {
                              label: 'Print Invoice',
                              icon: Printer,
                              onClick: () => {
                                verifyAction('Print Invoice', () => setPrintModalInvoice(inv));
                              }
                            },
                            {
                              label: 'Delete Invoice',
                              icon: Trash2,
                              variant: 'danger',
                              disabled: isReadOnly,
                              onClick: () => {
                                verifyAction('Delete Invoice', () => setDeleteDialog({ isOpen: true, invoice: inv }));
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

      <InvoicePrintModal 
        isOpen={!!printModalInvoice} 
        onClose={() => setPrintModalInvoice(null)} 
        invoice={printModalInvoice} 
      />

      {settlePayment?.isOpen && (
        <PaymentVoucherModal
          isOpen={settlePayment.isOpen}
          onClose={() => setSettlePayment(null)}
          initialType="Receipt"
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

export default Sales;
