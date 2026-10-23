import React, { useState, useEffect } from 'react';
import { Search, Edit, Trash2, Filter, ChevronDown, Loader2, ReceiptText, Plus, CheckCircle2, Clock, ArrowUpCircle } from 'lucide-react';
import { formatCurrency, formatDate, getActiveCompanyId, normalizeBill } from '../utils/helpers';
import Modal from '../components/Modal';
import BillForm from '../components/BillForm';
import ConfirmDialog from '../components/ConfirmDialog';
import PageHeader from '../components/PageHeader';
import SectionIcon from '../components/SectionIcon';
import { supabase } from '../lib/supabase';
import { useSecurityDemo } from '../context/SecurityDemoContext';
import { PaymentVoucherModal } from '../components/PaymentVoucherModal';
import { ActionMenu } from '../components/ActionMenu';

const Purchases = () => {
  const { verifyAction } = useSecurityDemo();
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [settlePayment, setSettlePayment] = useState<{
    isOpen: boolean;
    partyName: string;
    billId: string;
    amount: number;
  } | null>(null);
  
  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; bill: any | null }>({
    isOpen: false,
    bill: null
  });

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) return;

    try {
      const { data, error } = await supabase
        .from('purchase_bills')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false)
        .order('date', { ascending: false });

      if (error) throw error;

      const normalized = (data || []).map((b: any) => normalizeBill(b)).filter(Boolean);
      const paymentVouchers = normalized.filter((b: any) => b?.items_raw?.is_payment_voucher === true);
      const actualBills = normalized.filter((b: any) => b && !b.items_raw?.is_payment_voucher);

      const computedBills = actualBills.map((bill: any) => {
        const linkedVouchers = paymentVouchers.filter((v: any) => v.items_raw?.linked_bills?.includes(bill.id));
        const totalPaidOnBill = linkedVouchers.reduce((sum: number, v: any) => {
          const pDetails = v.items_raw?.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          const amt = pArray.reduce((sumVal: number, p: any) => sumVal + (Number(p.payment_amount) || 0), 0);
          return sum + amt;
        }, 0);
        const outstanding = Math.max(0, Number(bill.grand_total || 0) - totalPaidOnBill);
        const status = (outstanding === 0 && Number(bill.grand_total || 0) > 0) ? 'Paid' : 'Pending';
        return { ...bill, outstanding, status, type: 'Purchase' };
      });

      setBills(computedBills);
    } catch (err: any) {
      console.error("Error loading purchases:", err.message || err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    window.addEventListener('appSettingsChanged', loadData);
    return () => window.removeEventListener('appSettingsChanged', loadData);
  }, []);

  const confirmDelete = async () => {
    if (!deleteDialog.bill) return;
    const billId = deleteDialog.bill.id;
    setDeleteDialog({ isOpen: false, bill: null });

    verifyAction('Delete Purchase Bill', async () => {
      const { error } = await supabase.from('purchase_bills').update({ is_deleted: true }).eq('id', billId);
      if (error) alert('Error deleting: ' + error.message);
      else loadData();
    });
  };

  const filtered = bills.filter(b => {
    const matchesStatus = statusFilter === 'All' ? true : b.status === statusFilter;
    const matchesSearch = b.bill_number?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          b.vendor_name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Edit Purchase Bill" maxWidth="max-w-5xl">
        <BillForm initialData={editingBill} onSubmit={(bill, isSaveAndNew) => { if (!isSaveAndNew) { setIsModalOpen(false); setEditingBill(null); } loadData(); }} onCancel={() => setIsModalOpen(false)} />
      </Modal>

      <ConfirmDialog 
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, bill: null })}
        onConfirm={confirmDelete}
        title="Archive Entry"
        message={`Delete purchase entry ${deleteDialog.bill?.bill_number}?`}
      />

      <PageHeader
        icon={ReceiptText}
        iconColor="text-violet-600 dark:text-violet-400"
        title="Purchase Register"
        subtitle="Manage and track all vendor purchase invoices and bills"
        actions={
          <button
            onClick={() => verifyAction('Create Purchase Bill', () => { setEditingBill(null); setIsModalOpen(true); })}
            className="w-full sm:w-auto bg-primary text-white px-5 py-2.5 rounded-md font-medium text-sm hover:bg-primary-dark flex items-center justify-center shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-2" /> New Purchase
          </button>
        }
      />

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-4 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:max-w-xs shrink-0">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bill or vendor..." 
              className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          <div className="relative">
            <button 
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex items-center space-x-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
            >
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Status: {statusFilter}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {isMenuOpen && (
              <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1 min-w-[130px]">
                {['All', 'Paid', 'Pending'].map(opt => (
                  <button 
                    key={opt} 
                    onClick={() => { setStatusFilter(opt); setIsMenuOpen(false); }} 
                    className={`w-full text-left px-4 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700/50 ${statusFilter === opt ? 'bg-primary/10 text-primary font-bold' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Gross Purchase</p>
              <p className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                {formatCurrency(filtered.reduce((acc, b) => acc + Number(b.grand_total || 0), 0))}
              </p>
            </div>
            <SectionIcon icon={ReceiptText} className="text-indigo-600 dark:text-indigo-400" size={20} />
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Bill No</th>
                  <th className="py-3.5 px-6">Vendor Name</th>
                  <th className="py-3.5 px-6 text-right">Taxable</th>
                  <th className="py-3.5 px-6 text-right">Grand Total</th>
                  <th className="py-3.5 px-6 text-center">Status</th>
                  <th className="py-3.5 px-6 text-center w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm text-slate-700 dark:text-slate-300">
                {filtered.map(b => (
                  <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-6 font-mono text-sm text-slate-700 dark:text-slate-300">{formatDate(b.date)}</td>
                    <td className="py-4 px-6 font-mono text-sm text-slate-700 dark:text-slate-300">{b.bill_number}</td>
                    <td className="py-4 px-6 font-bold text-slate-900 dark:text-white capitalize text-sm">{b.vendor_name}</td>
                    <td className="py-4 px-6 text-right font-mono text-slate-600 dark:text-slate-400 text-sm">{formatCurrency(b.total_without_gst)}</td>
                    <td className="py-4 px-6 text-right font-mono font-bold text-slate-900 dark:text-white text-base tabular-nums">{formatCurrency(b.grand_total)}</td>
                    <td className="py-4 px-6 text-center whitespace-nowrap">
                      {b.status === 'Paid' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold border border-emerald-200/60 dark:border-emerald-900/40">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-xs font-semibold border border-amber-200/60 dark:border-amber-900/40">
                          <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          Pending
                        </span>
                      )}
                    </td>
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
                                amount: Number(b.outstanding ?? b.grand_total ?? 0)
                              });
                            }
                          },
                          {
                            label: 'Edit Bill',
                            icon: Edit,
                            onClick: () => {
                              setEditingBill(b);
                              setIsModalOpen(true);
                            }
                          },
                          {
                            label: 'Delete Bill',
                            icon: Trash2,
                            variant: 'danger',
                            onClick: () => {
                              setDeleteDialog({ isOpen: true, bill: b });
                            }
                          }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="py-16 text-center text-slate-400 italic">No purchase entries found matching filters.</td></tr>
                )}
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

export default Purchases;