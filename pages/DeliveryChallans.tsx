import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Plus, Printer, Edit, Trash2, Truck, Loader2, Lock } from 'lucide-react';
import { formatDate, formatCurrency, getActiveCompanyId, normalizeBill } from '../utils/helpers';
import Modal from '../components/Modal';
import DeliveryChallanForm from '../components/DeliveryChallanForm';
import ConfirmDialog from '../components/ConfirmDialog';
import DateFilter, { DateFilterHandle } from '../components/DateFilter';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import SectionIcon from '../components/SectionIcon';
import { supabase } from '../lib/supabase';
import { InvoicePrintModal } from '../components/InvoicePrintModal';
import { ActionMenu } from '../components/ActionMenu';
import { useLicense } from '../context/LicenseContext';
import { useSecurityDemo } from '../context/SecurityDemoContext';

export const DeliveryChallans = () => {
  const location = useLocation();
  const { isReadOnly } = useLicense();
  const { verifyAction } = useSecurityDemo();
  const [challans, setChallans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingChallan, setEditingChallan] = useState<any | null>(null);
  const [printModalChallan, setPrintModalChallan] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<{ startDate: string | null; endDate: string | null }>({
    startDate: null,
    endDate: null
  });

  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; challan: any | null }>({
    isOpen: false,
    challan: null
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dateFilterRef = useRef<DateFilterHandle>(null);

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) return;

    try {
      // 1. Fetch from delivery_challans table
      let dcQuery = supabase
        .from('delivery_challans')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false);

      if (dateRange.startDate && dateRange.endDate) {
        dcQuery = dcQuery.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
      }

      const { data: dcRes } = await dcQuery.order('date', { ascending: false });

      // 2. Fetch legacy from sales_invoices table
      let salesQuery = supabase
        .from('sales_invoices')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false);

      if (dateRange.startDate && dateRange.endDate) {
        salesQuery = salesQuery.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
      }

      const { data: salesRes } = await salesQuery.order('date', { ascending: false });

      const dcMapped = (dcRes || []).map((item: any) => ({
        ...item,
        invoice_number: item.challan_number || item.invoice_number,
        bill_number: item.challan_number || item.invoice_number,
        grand_total: item.total_goods_value ?? item.grand_total ?? item.total_without_gst ?? 0,
        total_without_gst: item.total_goods_value ?? item.total_without_gst ?? 0
      })).map(normalizeBill);

      const legacyDcMapped = (salesRes || [])
        .map(normalizeBill)
        .filter((b: any) => b && (b.items_raw?.is_delivery_challan === true || b.invoice_number?.startsWith('DC-')));

      const mergedMap = new Map();
      dcMapped.forEach((item: any) => mergedMap.set(item.id, item));
      legacyDcMapped.forEach((item: any) => {
        if (!mergedMap.has(item.id)) {
          mergedMap.set(item.id, item);
        }
      });

      const finalChallans = Array.from(mergedMap.values()).sort((a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      setChallans(finalChallans);
    } catch (err: any) {
      console.error('Error loading delivery challans:', err.message || err);
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

  // Open modal if state contains flag or selected item
  useEffect(() => {
    if (location.state?.createNew) {
      if (!isReadOnly) {
        setEditingChallan(null);
        setIsModalOpen(true);
      }
    }
  }, [location.state, isReadOnly]);

  const filtered = challans.filter(c => {
    const search = searchQuery.toLowerCase();
    const customer = c.customer_name?.toLowerCase() || '';
    const num = c.invoice_number?.toLowerCase() || c.bill_number?.toLowerCase() || c.challan_number?.toLowerCase() || '';
    const veh = c.items_raw?.vehicle_no?.toLowerCase() || '';
    return customer.includes(search) || num.includes(search) || veh.includes(search);
  });

  const confirmDelete = async () => {
    if (isReadOnly || !deleteDialog.challan) return;
    const item = deleteDialog.challan;

    await supabase
      .from('delivery_challans')
      .update({ is_deleted: true })
      .eq('id', item.id);

    await supabase
      .from('sales_invoices')
      .update({ is_deleted: true })
      .eq('id', item.id);

    loadData();
    window.dispatchEvent(new Event('appSettingsChanged'));
    setDeleteDialog({ isOpen: false, challan: null });
  };

  const totalDispatchedValue = filtered.reduce(
    (acc, c) => acc + Number(c.grand_total || c.total_without_gst || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Creation / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingChallan(null);
        }}
        title={editingChallan ? 'Update Delivery Challan' : 'New Delivery Challan'}
        maxWidth="max-w-5xl"
      >
        <DeliveryChallanForm
          initialData={editingChallan}
          onSubmit={(challan, shouldPrint) => {
            setIsModalOpen(false);
            setEditingChallan(null);
            loadData();
            if (shouldPrint && challan) {
              setPrintModalChallan(challan);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingChallan(null);
          }}
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, challan: null })}
        onConfirm={confirmDelete}
        title="Delete Delivery Challan"
        message={`Are you sure you want to delete delivery challan ${deleteDialog.challan?.invoice_number}?`}
      />

      {/* Header Bar */}
      <PageHeader
        icon={Truck}
        iconColor="text-emerald-600 dark:text-emerald-400"
        title="Delivery Challan Ledger"
        subtitle="Manage goods transport, dispatch notes, and delivery challans"
        actions={
          <button
            disabled={isReadOnly}
            onClick={() => {
              if (!isReadOnly) {
                verifyAction('Create Delivery Challan', () => {
                  setEditingChallan(null);
                  setIsModalOpen(true);
                });
              }
            }}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-md font-medium text-sm flex items-center justify-center shadow-sm ${
              isReadOnly
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary-dark cursor-pointer'
            }`}
            title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'New Delivery Challan'}
          >
            {isReadOnly ? <Lock className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />} New Delivery Challan
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
              placeholder="Search challan, customer, or vehicle..." 
              className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <DateFilter ref={dateFilterRef} onFilterChange={setDateRange} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Total Challans</p>
              <p className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">{filtered.length}</p>
            </div>
            <SectionIcon icon={Truck} className="text-blue-600 dark:text-blue-400" size={20} />
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Dispatched Goods Value</p>
              <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(totalDispatchedValue)}</p>
            </div>
            <SectionIcon icon={Truck} className="text-blue-600 dark:text-blue-400" size={20} />
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No Delivery Challans"
            message="Issue delivery challans to track goods dispatched to customers before invoicing."
            actionLabel={isReadOnly ? undefined : "Create Delivery Challan"}
            onAction={() => {
              if (!isReadOnly) {
                setEditingChallan(null);
                setIsModalOpen(true);
              }
            }}
          />
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
            <table className="w-full text-left border-collapse min-w-[850px]">
              <thead>
                <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-6 w-12 text-center">Sr</th>
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Challan #</th>
                  <th className="py-3.5 px-6">Customer Name</th>
                  <th className="py-3.5 px-6">Vehicle / Transport</th>
                  <th className="py-3.5 px-6 text-right">Subtotal</th>
                  <th className="py-3.5 px-6 text-right">Total Value</th>
                  <th className="py-3.5 px-6 text-center">Status</th>
                  <th className="py-3.5 px-6 text-center w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm text-slate-700 dark:text-slate-300">
                {filtered.map((c, i) => {
                  const veh = c.items_raw?.vehicle_no || '—';
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                    >
                      <td className="py-4 px-6 text-center text-slate-400 font-mono text-xs">{i + 1}</td>
                      <td className="py-4 px-6 font-mono text-sm">{formatDate(c.date)}</td>
                      <td className="py-4 px-6 font-mono text-sm text-slate-700 dark:text-slate-300">
                        {c.invoice_number || c.bill_number}
                      </td>
                      <td className="py-4 px-6 font-bold text-slate-900 dark:text-white capitalize text-sm">
                        {c.customer_name || c.vendor_name}
                      </td>
                      <td className="py-4 px-6 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {veh}
                      </td>
                      <td className="py-4 px-6 text-right font-mono text-slate-600 dark:text-slate-400 text-sm">
                        {formatCurrency(c.total_without_gst)}
                      </td>
                      <td className="py-4 px-6 text-right font-mono font-bold text-slate-900 dark:text-white text-base tabular-nums">
                        {formatCurrency(c.grand_total)}
                      </td>
                      <td className="py-4 px-6 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold border border-emerald-200/60 dark:border-emerald-900/40">
                          {c.status || 'Dispatched'}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center" onClick={(e) => e.stopPropagation()}>
                        <ActionMenu
                          items={[
                            {
                              label: 'Print Challan',
                              icon: Printer,
                              onClick: () => {
                                verifyAction('Print Delivery Challan', () => setPrintModalChallan(c));
                              }
                            },
                            {
                              label: 'Edit Challan',
                              icon: Edit,
                              disabled: isReadOnly,
                              onClick: () => {
                                setEditingChallan(c);
                                setIsModalOpen(true);
                              }
                            },
                            {
                              label: 'Delete Challan',
                              icon: Trash2,
                              variant: 'danger',
                              disabled: isReadOnly,
                              onClick: () => {
                                verifyAction('Delete Challan', () => setDeleteDialog({ isOpen: true, challan: c }));
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

      {/* Print Modal */}
      <InvoicePrintModal
        isOpen={!!printModalChallan}
        onClose={() => setPrintModalChallan(null)}
        invoice={printModalChallan}
      />
    </div>
  );
};

export default DeliveryChallans;
