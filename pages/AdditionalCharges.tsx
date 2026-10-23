import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Loader2, X, ChevronDown, Lock, Percent } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveCompanyId, safeSupabaseSave, getSelectedLedgerIds, toggleSelectedLedgerId } from '../utils/helpers';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { ActionMenu } from '../components/ActionMenu';
import { useLicense } from '../context/LicenseContext';

const isGstLedger = (name: string) => {
  const upper = name.toUpperCase();
  return upper.includes('CGST') || upper.includes('SGST') || upper.includes('IGST') || upper.includes('GST');
};

const AdditionalCharges = () => {
  const { isReadOnly } = useLicense();
  const [taxes, setTaxes] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [isSaveAndNew, setIsSaveAndNew] = useState(false);

  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; tax: any | null }>({
    isOpen: false,
    tax: null
  });
  
  const getInitialFormData = () => ({
    name: '', 
    type: 'Charge', 
    calc_method: 'Percentage', 
    rate: 0, 
    fixed_amount: 0, 
    apply_on: 'Subtotal',
    applicable_to: 'Both',
    is_default: false
  });

  const [formData, setFormData] = useState(getInitialFormData());

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) {
      setLoading(false);
      return;
    }

    try {
      const currentSelected = getSelectedLedgerIds();
      setSelectedIds(currentSelected);
      
      const { data, error } = await supabase
        .from('duties_taxes')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false)
        .order('name');
      
      if (error) throw error;
      
      // Never show GST-related ledgers here
      const filtered = (data || []).filter((d: any) => !isGstLedger(d.name));
      setTaxes(filtered);
    } catch (err) {
      console.error("Error loading charges:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return alert("Evaluation license expired. Read-only mode.");
    const cid = getActiveCompanyId();
    if (!cid) return alert("No active workspace selected.");
    
    if (isGstLedger(formData.name)) {
      return alert("Additional Charges must never contain GST-related ledgers (CGST, SGST, IGST, or GST).");
    }

    setSaving(true);
    try {
      const payload = { 
        ...formData, 
        name: formData.name.trim(), 
        applicable_to: formData.applicable_to || 'Both',
        company_id: cid, 
        is_deleted: false 
      };
      
      try {
        await safeSupabaseSave('duties_taxes', payload, editingTax?.id);
      } catch (err: any) {
        if (err?.message?.includes('applicable_to') || err?.code === 'PGRST204' || err?.code === '42703') {
          const { applicable_to, ...cleanPayload } = payload;
          await safeSupabaseSave('duties_taxes', cleanPayload, editingTax?.id);
        } else {
          throw err;
        }
      }

      if (!isSaveAndNew) {
        setIsModalOpen(false);
      } else {
        setFormData(getInitialFormData());
      }
      await loadData();
      window.dispatchEvent(new Event('appSettingsChanged'));
    } catch (err: any) {
      alert("Error saving ledger: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <ConfirmDialog 
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, tax: null })}
        onConfirm={async () => {
            if (isReadOnly) return;
            const { error } = await supabase.from('duties_taxes').update({ is_deleted: true }).eq('id', deleteDialog.tax.id);
            if (!error) await loadData();
        }}
        title="Archive Charge/Deduction"
        message={`Are you sure you want to delete "${deleteDialog.tax?.name}"?`}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/30" onClick={() => setIsModalOpen(false)} />
            <div className="relative bg-white dark:bg-slate-900 w-full max-w-[650px] border border-slate-300 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                    <h2 className="text-lg font-medium text-slate-900 dark:text-white">{editingTax ? "Edit Charge / Deduction" : "Create New Charge / Deduction"}</h2>
                    <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white dark:bg-slate-900 custom-scrollbar">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Charge / Deduction Name</label>
                            <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm focus:border-slate-500 bg-white dark:bg-slate-800 dark:text-white" placeholder="Freight, Labour, Discount, etc..." />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Type</label>
                                <div className="relative">
                                    <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full h-10 px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm focus:border-slate-500 bg-white dark:bg-slate-800 dark:text-white appearance-none">
                                        <option value="Charge" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Charge (+)</option>
                                        <option value="Deduction" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Deduction (-)</option>
                                    </select>
                                    <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Calculation Method</label>
                                <div className="relative">
                                    <select value={formData.calc_method} onChange={e => setFormData({...formData, calc_method: e.target.value})} className="w-full h-10 px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm focus:border-slate-500 bg-white dark:bg-slate-800 dark:text-white appearance-none">
                                        <option value="Percentage" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Percentage</option>
                                        <option value="Fixed" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Fixed Amount</option>
                                    </select>
                                    <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Applicable To</label>
                            <div className="relative">
                                <select value={formData.applicable_to || 'Both'} onChange={e => setFormData({...formData, applicable_to: e.target.value})} className="w-full h-10 px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm focus:border-slate-500 bg-white dark:bg-slate-800 dark:text-white appearance-none">
                                    <option value="Both" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Both (Sales & Purchase)</option>
                                    <option value="Sales Invoices" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Sales Invoices</option>
                                    <option value="Purchase Bills" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Purchase Bills</option>
                                </select>
                                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Value</label>
                            <input type="number" step="0.01" value={formData.calc_method === 'Percentage' ? formData.rate : formData.fixed_amount} onChange={e => setFormData({...formData, [formData.calc_method === 'Percentage' ? 'rate' : 'fixed_amount']: parseFloat(e.target.value) || 0})} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 outline-none text-sm font-medium focus:border-slate-500 bg-white dark:bg-slate-800 dark:text-white" placeholder="0.00" />
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 bg-white dark:bg-slate-900 shrink-0">
                        <button 
                            type="button" 
                            onClick={() => setIsModalOpen(false)} 
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
            </div>
        </div>
      )}

      <PageHeader
        icon={Percent}
        iconColor="text-blue-600 dark:text-blue-400"
        title="Additional Charges"
        subtitle="Configure user-defined adjustments such as Labour, Freight, or Discounts"
        actions={
          taxes.length > 0 ? (
            <button 
              disabled={isReadOnly}
              onClick={() => { if (!isReadOnly) { setEditingTax(null); setFormData(getInitialFormData()); setIsModalOpen(true); } }} 
              className={`px-5 py-2.5 rounded-md font-medium text-sm transition-none capitalize w-full sm:w-auto flex items-center justify-center shadow-sm ${
                isReadOnly
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-primary text-white hover:bg-primary-dark cursor-pointer'
              }`}
              title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'New Charge'}
            >
              {isReadOnly ? <Lock className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />} New Charge
            </button>
          ) : undefined
        }
      />

      {!loading && taxes.length === 0 ? (
        <EmptyState 
          title="No Additional Charges" 
          message="Configure user-defined adjustments such as Labour, Freight, or Discounts to apply them on your invoices and bills." 
          actionLabel={isReadOnly ? undefined : "Create First Charge"} 
          onAction={() => { if (!isReadOnly) { setEditingTax(null); setFormData(getInitialFormData()); setIsModalOpen(true); } }} 
        />
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
                <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="w-20 py-3.5 px-6 text-center">Select</th>
                <th className="py-3.5 px-6">Name</th>
                <th className="py-3.5 px-6">Type</th>
                <th className="py-3.5 px-6">Applicable To</th>
                <th className="py-3.5 px-6">Calculation</th>
                <th className="py-3.5 px-6">Value</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {loading ? (
                <tr><td colSpan={7} className="text-center py-20 text-slate-400">Loading charges...</td></tr>
                ) : taxes.map((tax) => {
                const isSelected = selectedIds.includes(tax.id) || tax.is_default;
                return (
                    <tr key={tax.id} className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-6 text-center">
                        <button onClick={async () => {
                            if (isReadOnly) return;
                            const nextIds = toggleSelectedLedgerId(tax.id);
                            setSelectedIds(nextIds);
                            window.dispatchEvent(new Event('appSettingsChanged'));
                        }} className={`w-4 h-4 rounded border ${isSelected ? 'bg-primary border-slate-900 dark:border-white' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'} mx-auto transition-none ${isReadOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} />
                    </td>
                    <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">
                      <span>{tax.name}</span>
                    </td>
                    <td className="py-4 px-6 text-xs whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold ${
                        tax.type === 'Deduction' 
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400' 
                          : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                      }`}>
                        {tax.type === 'Deduction' ? 'Deduction (-)' : 'Charge (+)'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600 dark:text-slate-300">
                      <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                        {tax.applicable_to || 'Both'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-500 capitalize">{tax.calc_method}</td>
                    <td className="py-4 px-6 font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">{tax.calc_method === 'Percentage' ? `${tax.rate}%` : tax.fixed_amount.toFixed(2)}</td>
                    <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        align="right"
                        items={[
                          {
                            label: 'Edit Charge',
                            icon: Edit,
                            disabled: isReadOnly,
                            onClick: () => { setEditingTax(tax); setFormData({ ...tax, applicable_to: tax.applicable_to || 'Both' }); setIsModalOpen(true); }
                          },
                          {
                            label: 'Delete Charge',
                            icon: Trash2,
                            variant: 'danger',
                            disabled: isReadOnly,
                            onClick: () => setDeleteDialog({ isOpen: true, tax })
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
  );
};

export default AdditionalCharges;
