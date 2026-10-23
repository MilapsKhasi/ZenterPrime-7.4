import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, FileText } from 'lucide-react';
import { getActiveCompanyId, safeSupabaseSave, toStorageValue, toDisplayValue, validateGstin } from '../utils/helpers';
import { getAuthUser } from '../lib/supabase';
import { recordActivity } from '../utils/activityTracker';
import { getDraft, saveDraft, clearDraft } from '../utils/draftManager';

interface PartyFormProps {
  initialData?: any | null;
  prefilledName?: string;
  defaultType?: 'customer' | 'vendor' | 'both'; // Initial preference if pre-filled
  onSubmit: (party: any, isSaveAndNew?: boolean) => void;
  onCancel: () => void;
}

const PartyForm: React.FC<PartyFormProps> = ({ initialData, prefilledName, defaultType = 'customer', onSubmit, onCancel }) => {
  const cid = getActiveCompanyId();
  const [loading, setLoading] = useState(false);
  const [isSaveAndNew, setIsSaveAndNew] = useState(false);
  const [isDraftRestored, setIsDraftRestored] = useState(false);

  const draftKey = `party_${cid}_${initialData?.id || 'new'}`;

  const [formData, setFormData] = useState<any>({
    name: prefilledName || '', 
    email: '', 
    phone: '', 
    gstin: '', 
    pan: '', 
    state: '',
    account_number: '', 
    account_name: '', 
    ifsc_code: '', 
    address: '', 
    balance: 0,
    party_type: defaultType, // 'customer', 'vendor', or 'both'
    is_customer: defaultType === 'customer' || defaultType === 'both'
  });

  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedDraft = getDraft(draftKey);
    if (savedDraft) {
      setFormData(savedDraft);
      setIsDraftRestored(true);
    } else if (initialData) {
      let pType = (initialData.party_type || '').toLowerCase();
      if (!pType || (pType !== 'customer' && pType !== 'vendor' && pType !== 'both')) {
        pType = initialData.is_customer ? 'customer' : 'vendor';
      }
      setFormData({ 
        ...initialData,
        party_type: pType,
        is_customer: pType === 'customer' || pType === 'both'
      });
    } else if (prefilledName) {
      setFormData((prev: any) => ({ ...prev, name: prefilledName }));
    }
    setTimeout(() => {
      firstInputRef.current?.focus();
      firstInputRef.current?.select();
    }, 100);
  }, [initialData, prefilledName, draftKey]);

  // Auto-save draft
  useEffect(() => {
    if (!cid) return;
    if (formData.name?.trim() || formData.phone?.trim() || formData.email?.trim() || formData.gstin?.trim()) {
      saveDraft(draftKey, formData);
    }
  }, [formData, draftKey, cid]);

  const handleChange = (field: string, value: any) => { 
    if (field === 'name') {
      setFormData((prev: any) => ({ ...prev, name: typeof value === 'string' ? value.toUpperCase() : value })); 
    } else {
      setFormData((prev: any) => ({ ...prev, [field]: value })); 
    }
  };

  const handleTypeChange = (type: 'customer' | 'vendor' | 'both') => {
    setFormData((prev: any) => ({ 
      ...prev, 
      party_type: type,
      is_customer: type === 'customer' || type === 'both'
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!formData.name.trim()) return alert("Party Name is required.");
    if (formData.gstin && formData.gstin.trim().length > 0) {
      if (!validateGstin(formData.gstin)) {
        alert("Invalid GSTIN number! The GSTIN entered is not a valid, current, and registered GSTIN checked against gst.gov.in portal records. Please enter a valid 15-digit GSTIN or leave it blank.");
        return;
      }
    }
    setLoading(true);
    try {
      const user = await getAuthUser();
      if (user) recordActivity(user.id, user.email || '');

      const cid = getActiveCompanyId();
      const payload = { 
        ...formData, 
        party_type: formData.party_type || 'customer',
        is_customer: formData.party_type === 'customer' || formData.party_type === 'both',
        balance: toStorageValue(formData.balance),
        company_id: cid, 
        is_deleted: false,
        name: formData.name.trim().toUpperCase()
      };
      
      // Save to 'vendors' table, which acts as our unified 'parties' table
      const result = await safeSupabaseSave('vendors', payload, initialData?.id);
      clearDraft(draftKey);
      setIsDraftRestored(false);
      onSubmit(result.data[0], isSaveAndNew);
      if (isSaveAndNew) {
        setFormData({
          name: '', 
          email: '', 
          phone: '', 
          gstin: '', 
          pan: '', 
          state: '',
          account_number: '', 
          account_name: '', 
          ifsc_code: '', 
          address: '', 
          balance: 0,
          party_type: defaultType,
          is_customer: defaultType === 'customer' || defaultType === 'both'
        });
        setTimeout(() => firstInputRef.current?.focus(), 100);
      }
    } catch (err: any) { 
      alert("Error saving party: " + err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleDiscardDraft = () => {
    clearDraft(draftKey);
    setIsDraftRestored(false);
    if (initialData) {
      let pType = (initialData.party_type || '').toLowerCase();
      if (!pType || (pType !== 'customer' && pType !== 'vendor' && pType !== 'both')) {
        pType = initialData.is_customer ? 'customer' : 'vendor';
      }
      setFormData({ ...initialData, party_type: pType, is_customer: pType === 'customer' || pType === 'both' });
    } else {
      setFormData({
        name: prefilledName || '', email: '', phone: '', gstin: '', pan: '', state: '',
        account_number: '', account_name: '', ifsc_code: '', address: '', balance: 0,
        party_type: defaultType, is_customer: defaultType === 'customer' || defaultType === 'both'
      });
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 w-full flex flex-col">
      {isDraftRestored && (
        <div className="mx-6 mt-4 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
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

      {/* Form Body */}
      <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-white dark:bg-slate-900">
        {/* Party Name & Type */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Party Name</label>
            <input 
              ref={firstInputRef} 
              type="text" 
              required
              value={toDisplayValue(formData.name)} 
              onChange={e => handleChange('name', e.target.value)} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs uppercase font-medium focus:border-primary" 
              placeholder="Party / Business Name" 
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Party Type</label>
            <select 
              value={formData.party_type || 'customer'}
              onChange={e => handleTypeChange(e.target.value as 'customer' | 'vendor' | 'both')}
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs font-medium focus:border-primary"
            >
              <option value="customer" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Customer</option>
              <option value="vendor" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Vendor</option>
              <option value="both" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Both (Customer & Vendor)</option>
            </select>
          </div>
        </div>

        {/* Balance & Legal Registrations */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="space-y-1.5 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Opening Balance</label>
            <input 
              type="number" 
              value={toDisplayValue(formData.balance)} 
              onChange={e => handleChange('balance', parseFloat(e.target.value) || 0)} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs focus:border-primary" 
              placeholder="0.00" 
            />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">GSTIN Number</label>
            <input 
              type="text" 
              value={toDisplayValue(formData.gstin)} 
              onChange={e => handleChange('gstin', e.target.value.toUpperCase())} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs uppercase focus:border-primary" 
              placeholder="15-digit GSTIN" 
            />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">PAN Number</label>
            <input 
              type="text" 
              value={toDisplayValue(formData.pan)} 
              onChange={e => handleChange('pan', e.target.value.toUpperCase())} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs uppercase focus:border-primary" 
              placeholder="10-digit PAN" 
            />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">State Name</label>
            <input 
              type="text" 
              value={toDisplayValue(formData.state)} 
              onChange={e => handleChange('state', e.target.value)} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs focus:border-primary" 
              placeholder="e.g. Maharashtra" 
            />
          </div>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Email Address</label>
            <input 
              type="email" 
              value={toDisplayValue(formData.email)} 
              onChange={e => handleChange('email', e.target.value)} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs focus:border-primary" 
              placeholder="name@company.com" 
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Contact Number</label>
            <input 
              type="text" 
              value={toDisplayValue(formData.phone)} 
              onChange={e => handleChange('phone', e.target.value)} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs focus:border-primary" 
              placeholder="e.g. 9876543210" 
            />
          </div>
        </div>

        {/* Business Address */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Business Address</label>
          <textarea 
            rows={3} 
            value={toDisplayValue(formData.address)} 
            onChange={e => handleChange('address', e.target.value)} 
            className="w-full p-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs resize-none h-24 focus:border-primary" 
            placeholder="Physical / Billing Address" 
          />
        </div>

        {/* Bank Account Details */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Bank Account Number</label>
            <input 
              type="text" 
              value={toDisplayValue(formData.account_number)} 
              onChange={e => handleChange('account_number', e.target.value)} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs focus:border-primary" 
              placeholder="Account Number" 
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Account Holder Name</label>
            <input 
              type="text" 
              value={toDisplayValue(formData.account_name)} 
              onChange={e => handleChange('account_name', e.target.value)} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs focus:border-primary" 
              placeholder="Account Name" 
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">IFSC Code</label>
            <input 
              type="text" 
              value={toDisplayValue(formData.ifsc_code)} 
              onChange={e => handleChange('ifsc_code', e.target.value.toUpperCase())} 
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none text-xs uppercase focus:border-primary" 
              placeholder="IFSC Code" 
            />
          </div>
        </div>

        {/* Action Buttons Horizontal Bar: Discard, Save, Save & New */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-6 border-t border-slate-200 dark:border-slate-800">
          <button 
            type="button" 
            onClick={onCancel} 
            disabled={loading} 
            className="h-10 px-4 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Discard
          </button>
          <button 
            type="submit" 
            onClick={() => setIsSaveAndNew(false)}
            disabled={loading} 
            className="h-10 px-5 bg-primary text-white hover:bg-primary-dark text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading && !isSaveAndNew ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            <span>{initialData ? 'Update Party' : 'Save Party'}</span>
          </button>
          <button 
            type="button" 
            onClick={() => { setIsSaveAndNew(true); handleSubmit(new Event('submit') as any); }} 
            disabled={loading}
            className="h-10 px-5 bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-900 dark:hover:bg-slate-600 text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading && isSaveAndNew ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            <span>Save & New</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default PartyForm;
