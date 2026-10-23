
import React, { useState, useEffect } from 'react';
import { Save, Loader2, Check, Lock } from 'lucide-react';
// Fixed: Removed non-existent getDatePlaceholder from imports
import { getActiveCompanyId, formatCurrency, parseDateFromInput, formatDate, getEffectiveCompanyInfo } from '../utils/helpers';
import { supabase } from '../lib/supabase';
import { getDraft, saveDraft, clearDraft } from '../utils/draftManager';

interface SimplifiedPurchaseFormProps {
  initialData?: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}

const SimplifiedPurchaseForm: React.FC<SimplifiedPurchaseFormProps> = ({ initialData, onSubmit, onCancel }) => {
  const cid = getActiveCompanyId();
  const effectiveCompany = getEffectiveCompanyInfo();
  const canUseGst = effectiveCompany.canUseGst;
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<any>({
    date: '', displayDate: '', bill_number: '', vendor_name: '',
    total_without_gst: 0, total_gst: 0, round_off: 0, grand_total: 0, status: 'Pending'
  });

  const draftKey = `simplified_purchase_${cid}_${initialData?.id || 'new'}`;

  useEffect(() => {
    const savedDraft = getDraft(draftKey);
    if (savedDraft) {
      setFormData(savedDraft);
    } else if (initialData) {
      setFormData({ 
        vendor_name: initialData.vendor_name || '',
        bill_number: initialData.bill_number || '',
        date: initialData.date || '',
        displayDate: formatDate(initialData.date),
        total_without_gst: initialData.total_without_gst || 0,
        total_gst: initialData.total_gst || 0,
        round_off: initialData.round_off || 0,
        grand_total: initialData.grand_total || 0,
        status: initialData.status || 'Pending'
      });
    }
  }, [initialData, draftKey]);

  // Auto-save draft
  useEffect(() => {
    if (!cid) return;
    if (formData.vendor_name?.trim() || formData.bill_number?.trim() || formData.grand_total > 0) {
      saveDraft(draftKey, formData);
    }
  }, [formData, draftKey, cid]);

  const updateAmounts = (taxable: number, gst: number) => {
      const effectiveGst = canUseGst ? gst : 0;
      const rawTotal = taxable + effectiveGst;
      const rounded = Math.round(rawTotal);
      const ro = parseFloat((rounded - rawTotal).toFixed(2));
      setFormData((prev: any) => ({ ...prev, total_without_gst: taxable, total_gst: effectiveGst, round_off: ro, grand_total: rounded }));
  };

  const handleDateBlur = () => {
    const iso = parseDateFromInput(formData.displayDate);
    if (iso) setFormData({ ...formData, date: iso, displayDate: formatDate(iso) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.date || !formData.bill_number || !formData.vendor_name) return alert("Fill all mandatory fields.");
    if (!canUseGst && formData.total_gst > 0) return alert("Unregistered (URD) firms cannot enter purchase bills enabled with GST.");
    
    if (!cid) return alert("No active workspace selected.");

    setLoading(true);
    try {
      // Logic refined: Data is stored against company_id. 
      // RLS policies on the 'bills' table should grant access based on companies_users membership.
      const trimmedVendor = (formData.vendor_name || '').trim().toUpperCase();
      const { data: existingVendors } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('company_id', cid)
        .eq('is_deleted', false);
      
      const matchedParty = (existingVendors || []).find((v: any) => v.name?.trim().toUpperCase() === trimmedVendor);
      const partyId = matchedParty?.id || initialData?.party_id || initialData?.vendor_id || null;

      const payload = {
        company_id: cid,
        party_id: partyId,
        vendor_id: partyId,
        vendor_name: trimmedVendor,
        bill_number: formData.bill_number,
        date: formData.date,
        items: [],
        total_without_gst: formData.total_without_gst,
        total_gst: formData.total_gst,
        grand_total: formData.grand_total,
        status: formData.status,
        is_deleted: false
      };

      let error;
      if (initialData?.id) {
        const { error: err } = await supabase.from('purchase_bills').update(payload).eq('id', initialData.id);
        error = err;
      } else {
        const { error: err } = await supabase.from('purchase_bills').insert([payload]);
        error = err;
      }

      if (error) {
        console.error("Supabase Error:", error);
        throw new Error(error.message);
      }
      
      clearDraft(draftKey);
      window.dispatchEvent(new Event('appSettingsChanged'));
      onSubmit({ ...payload, id: initialData?.id });
    } catch (err: any) {
      alert("Error saving: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-white dark:bg-slate-900">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</label>
          <input required value={formData.displayDate || ''} onChange={(e) => setFormData({...formData, displayDate: e.target.value})} onBlur={handleDateBlur} placeholder="DD/MM/YYYY" className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm focus:border-slate-500" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Bill Number</label>
          <input required value={formData.bill_number || ''} onChange={(e) => setFormData({...formData, bill_number: e.target.value})} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm font-medium focus:border-slate-500" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Vendor Name</label>
        <input required value={formData.vendor_name || ''} onChange={(e) => setFormData({...formData, vendor_name: e.target.value})} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm focus:border-slate-500 uppercase" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Taxable Amount (Without GST)</label>
          <input type="number" step="0.01" value={formData.total_without_gst || 0} onChange={(e) => updateAmounts(Number(e.target.value), formData.total_gst)} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm font-medium focus:border-slate-500" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">GST Amount</label>
          <input type="number" step="0.01" value={formData.total_gst || 0} onChange={(e) => updateAmounts(formData.total_without_gst, Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none text-sm font-medium focus:border-slate-500" />
        </div>
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/50 p-4 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
              <span>Without GST</span>
              <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(formData.total_without_gst)}</span>
          </div>
          <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
              <span>GST Total</span>
              <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(formData.total_gst)}</span>
          </div>
          <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 italic">
              <span>Round Off</span>
              <span className="font-medium text-slate-900 dark:text-white">{formData.round_off >= 0 ? '+' : ''}{(formData.round_off || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center pt-3 border-t border-slate-200 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">Grand Total</span>
              <span className="text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(formData.grand_total)}</span>
          </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-200 dark:border-slate-800">
        <button 
          type="button" 
          onClick={onCancel} 
          disabled={loading}
          className="h-10 px-4 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer disabled:opacity-50"
        >
          Discard
        </button>
        <button 
          type="submit" 
          disabled={loading} 
          className="h-10 px-6 bg-primary hover:bg-primary-dark text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Purchase
        </button>
      </div>
    </form>
  );
};

export default SimplifiedPurchaseForm;
