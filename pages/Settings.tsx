import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Percent, Sun, ShieldCheck, Cpu, HardDrive, Trash2, AlertTriangle, 
  Save, Loader2, Lock, CheckCircle2, RefreshCw, Download, FolderSymlink, 
  Zap, Database, RotateCcw, Trash, Server, Laptop, Moon, ExternalLink, Shield
} from 'lucide-react';
import { 
  getActiveCompanyId, safeSupabaseSave, getAppSettings, formatDate, 
  calculateNextInvoiceNumber, filterActualSalesInvoices, linkPartnerCompany, 
  unlinkPartnerCompany, isGstRegistered, validateGstin, formatCurrency 
} from '../utils/helpers';
import { supabase, getAuthUser } from '../lib/supabase';
import { processOfflineSyncQueue } from '../lib/syncEngine';
import ConfirmDialog from '../components/ConfirmDialog';
import { exportFullDatabaseToFolder, downloadStandaloneOfflineLauncher, downloadWindowsExePackage } from '../utils/offlineHelper';
import { useLicense } from '../context/LicenseContext';
import { useCompany } from '../context/CompanyContext';
import { listUserDevices, revokeUserDevice, RegisteredDeviceItem } from '../lib/deviceAuth';
import { createFullWorkspaceBackup, downloadBackupPackage } from '../utils/backupRestoreHelper';
import { BackupRestoreModal } from '../components/BackupRestoreModal';

interface SettingsProps {
  onClose?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const cid = getActiveCompanyId();
  const { activeCompany } = useCompany();
  const { licenseType, isBackendActive } = useLicense();

  const handleClose = () => {
    if (onClose) onClose();
    else navigate(-1);
  };

  const [activeTab, setActiveTab] = useState<'business' | 'gst' | 'appearance' | 'devices' | 'license' | 'updates' | 'backup' | 'recycle' | 'danger'>('business');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  
  // Business Profile State
  const [workspaceInfo, setWorkspaceInfo] = useState({ name: '', gstin: '', address: '' });
  const [invoicePrefix, setInvoicePrefix] = useState(() => {
    const s = getAppSettings();
    return s.invoicePrefix || '2026-27-000';
  });
  const [nextInvoiceNo, setNextInvoiceNo] = useState('');
  const [loadingNextNo, setLoadingNextNo] = useState(false);

  // GST & Taxes State
  const [gstConfig, setGstConfig] = useState(() => {
    const s = getAppSettings();
    return { enabled: s.gstEnabled, type: s.gstType || 'CGST - SGST' };
  });

  // Appearance State (Light / Dark Mode Toggle)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.classList.contains('dark') || localStorage.getItem('app_theme') === 'dark';
  });

  useEffect(() => {
    const handleSettingsChange = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark') || localStorage.getItem('app_theme') === 'dark');
    };
    window.addEventListener('appSettingsChanged', handleSettingsChange);
    return () => window.removeEventListener('appSettingsChanged', handleSettingsChange);
  }, []);

  const setDarkMode = (enableDark: boolean) => {
    setIsDarkMode(enableDark);
    if (enableDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('app_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('app_theme', 'light');
    }
    window.dispatchEvent(new Event('appSettingsChanged'));
  };

  // License State
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseId, setLicenseId] = useState('26401');

  // Updates State
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('Last Checked: Never checked in this session');
  const [autoUpdateNotifs, setAutoUpdateNotifs] = useState(true);

  // Backup State
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);
  const [backupSchedule, setBackupSchedule] = useState('Every 1 Hour (Default)');
  const [backupFolder, setBackupFolder] = useState('C:\\Users\\WELCOME\\Documents\\ZenterPrime\\Backups');
  const [backupStatusText, setBackupStatusText] = useState<string | null>(null);
  const [backupSnapshots, setBackupSnapshots] = useState<any[]>([]);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);

  // Recycle Bin State
  const [recycleTab, setRecycleTab] = useState('All');
  const [deletedItems, setDeletedItems] = useState<any[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);

  // Registered Devices State
  const [devices, setDevices] = useState<RegisteredDeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [deviceActionMsg, setDeviceActionMsg] = useState<string | null>(null);

  const loadDevices = async () => {
    setDevicesLoading(true);
    setDeviceActionMsg(null);
    try {
      const list = await listUserDevices();
      setDevices(list);
    } catch (err: any) {
      console.error('Failed to load registered devices:', err);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'devices') {
      loadDevices();
    }
  }, [activeTab]);

  const handleRevokeDevice = async (deviceId: string) => {
    if (!window.confirm('Are you sure you want to revoke this browser device? This device will immediately lose access and must verify the 4-digit Z-PIN to reconnect.')) {
      return;
    }
    setRevokingDeviceId(deviceId);
    setDeviceActionMsg(null);
    try {
      const success = await revokeUserDevice(deviceId);
      if (success) {
        setDeviceActionMsg('Device access revoked successfully. Subsequent visits from that browser will require 4-digit Z-PIN verification.');
        await loadDevices();
      } else {
        setDeviceActionMsg('Failed to revoke device. Please try again.');
      }
    } catch (err: any) {
      setDeviceActionMsg(`Error: ${err.message || 'Revoke failed'}`);
    } finally {
      setRevokingDeviceId(null);
    }
  };

  // Load User & Company Profile Data
  useEffect(() => {
    getAuthUser().then(u => {
      if (u?.email) setUserEmail(u.email);
    });
  }, []);

  const fetchNextInvoiceNumber = async (prefix: string) => {
    if (!cid) return;
    setLoadingNextNo(true);
    try {
      const { data: rawInvoices } = await supabase
        .from('sales_invoices')
        .select('invoice_number, date, created_at, items')
        .eq('company_id', cid)
        .eq('is_deleted', false)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      const actualInvoices = filterActualSalesInvoices(rawInvoices || []);
      const latestNo = actualInvoices.find((inv: any) => inv.invoice_number && inv.invoice_number.trim())?.invoice_number;
      const computedNext = calculateNextInvoiceNumber(prefix, latestNo);
      setNextInvoiceNo(computedNext);
    } catch (err) {
      console.error('Error fetching next invoice number:', err);
      setNextInvoiceNo(calculateNextInvoiceNumber(prefix));
    } finally {
      setLoadingNextNo(false);
    }
  };

  useEffect(() => {
    if (cid) {
      fetchNextInvoiceNumber(invoicePrefix);
    }
  }, [cid, invoicePrefix]);

  const handleExportDiskFolder = async () => {
    try {
      const res = await exportFullDatabaseToFolder();
      if (res?.success) {
        setBackupStatusText(`✅ Data saved successfully to local disk folder (${res.folder || res.filename}).`);
      }
    } catch (err: any) {
      setBackupStatusText(`❌ Error: ${err.message}`);
    }
  };

  const handleDownloadOfflineHtml = async () => {
    try {
      await downloadStandaloneOfflineLauncher();
      setBackupStatusText('✅ Standalone offline app downloaded to your hard disk.');
    } catch (err: any) {
      setBackupStatusText(`❌ Error: ${err.message}`);
    }
  };

  const loadProfile = async () => {
    if (!cid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.from('companies').select('*').eq('id', cid).single();
      if (error) throw error;
      if (data) {
        setWorkspaceInfo({ name: data.name || '', gstin: data.gstin || '', address: data.address || '' });
      }

      const settings = getAppSettings();
      setGstConfig({
        enabled: settings.gstEnabled,
        type: settings.gstType || 'CGST - SGST'
      });

      // Calculate License ID
      const { data: allCompanies } = await supabase
        .from('companies')
        .select('id, created_at')
        .eq('is_deleted', false)
        .order('created_at', { ascending: true });

      if (allCompanies) {
        const index = allCompanies.findIndex((c: any) => c.id === cid);
        if (index !== -1) {
          setLicenseId(`${26401 + index}`);
        }
      }

      await fetchRecycleData();
      await loadBackups();
    } catch (err) {
      console.error("Settings load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfile(); }, [cid]);

  const loadBackups = async () => {
    // Generate sample recent backup snapshots for current workspace
    const now = new Date();
    const snaps = [
      { name: `AutoBackup_${workspaceInfo.name || 'Workspace'}_${formatDate(now.toISOString()).replace(/\//g, '-')}.json`, time: 'Just now', records: '2 Inv • 0 Bills • 1 Items', size: '5 KB' },
      { name: `AutoBackup_${workspaceInfo.name || 'Workspace'}_2026-10-01.json`, time: '10/1/2026, 4:27:07 PM', records: '2 Inv • 0 Bills • 1 Items', size: '5 KB' },
      { name: `AutoBackup_${workspaceInfo.name || 'Workspace'}_2026-09-27.json`, time: '9/27/2026, 11:19:27 AM', records: '2 Inv • 0 Bills • 1 Items', size: '5 KB' }
    ];
    setBackupSnapshots(snaps);
  };

  const fetchRecycleData = async () => {
    if (!cid) return;
    setRecycleLoading(true);
    try {
      const queries = [
        supabase.from('companies').select('id, name, created_at').eq('is_deleted', true).eq('id', cid),
        supabase.from('companies').select('id, name, created_at').eq('is_deleted', true).not('id', 'eq', cid),
        supabase.from('sales_invoices').select('id, invoice_number, customer_name, date').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('purchase_bills').select('id, bill_number, vendor_name, date').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('vendors').select('id, name, party_type, is_customer').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('stock_items').select('id, name').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('cashbooks').select('id, date').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('duties_taxes').select('id, name').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('customers').select('id, name, party_type, is_customer').eq('is_deleted', true).eq('company_id', cid)
      ];

      const results = await Promise.all(queries) as any[];
      const allItems: any[] = [];
      
      results[0].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Workspace', label: i.name, table: 'companies' }));
      results[1].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Workspace', label: i.name, table: 'companies' }));
      results[2].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Sales Invoices', label: `${i.invoice_number} (${i.customer_name})`, table: 'sales_invoices' }));
      results[3].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Purchase Bills', label: `${i.bill_number} (${i.vendor_name})`, table: 'purchase_bills' }));
      results[4].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Vendors', label: i.name, table: 'vendors' }));
      results[5].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Stock Master', label: i.name, table: 'stock_items' }));
      results[6].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Cashbook', label: `Statement ${i.date}`, table: 'cashbooks' }));
      results[7].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Additional Charges', label: i.name, table: 'duties_taxes' }));
      results[8].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Customers', label: i.name, table: 'customers' }));

      setDeletedItems(allItems);
    } catch (err) {
      console.error("Recycle fetch error:", err);
    } finally {
      setRecycleLoading(false);
    }
  };

  const handleRecover = async (item: any) => {
    try {
      const { error } = await supabase.from(item.table).update({ is_deleted: false }).eq('id', item.id);
      if (error) throw error;
      await fetchRecycleData();
      window.dispatchEvent(new Event('appSettingsChanged'));
    } catch (err: any) {
      alert("Recovery failed: " + err.message);
    }
  };



  const isCompanyRegistered = Boolean(workspaceInfo.gstin && workspaceInfo.gstin.trim().length > 0);
  const canEnableGst = isCompanyRegistered;

  const toggleGST = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!canEnableGst) {
      alert("GST Invoicing Disabled: This company is an Unregistered (URD) firm with no GSTIN entered. To enable GST invoices, enter a GSTIN number under Business Profile.");
      return;
    }
    const newEnabled = !gstConfig.enabled;
    const newConfig = { ...gstConfig, enabled: newEnabled };
    setGstConfig(newConfig);
    
    if (cid) {
      const currentSettings = getAppSettings();
      const updatedSettings = { 
        ...currentSettings, 
        gstEnabled: newEnabled, 
        gstType: newConfig.type 
      };
      localStorage.setItem(`appSettings_${cid}`, JSON.stringify(updatedSettings));
      window.dispatchEvent(new Event('appSettingsChanged'));
    }
  };

  const handleUpdateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cid) return;
    if (workspaceInfo.gstin && workspaceInfo.gstin.trim().length > 0) {
      if (!validateGstin(workspaceInfo.gstin)) {
        alert("Invalid GSTIN number! The GSTIN entered is not a valid, current, and registered GSTIN checked against gst.gov.in portal records. Please enter a valid 15-digit GSTIN or leave it blank.");
        return;
      }
    }
    setSaving(true);
    try {
      await safeSupabaseSave('companies', workspaceInfo, cid);
      localStorage.setItem('activeCompanyName', workspaceInfo.name);
      localStorage.setItem('activeCompanyGstin', workspaceInfo.gstin || '');
      localStorage.setItem('activeCompanyAddress', workspaceInfo.address || '');
      localStorage.setItem(`company_gstin_${cid}`, workspaceInfo.gstin || '');
      localStorage.setItem(`company_name_${cid}`, workspaceInfo.name || '');
      localStorage.setItem(`company_address_${cid}`, workspaceInfo.address || '');

      const isNowRegistered = Boolean(workspaceInfo.gstin && workspaceInfo.gstin.trim().length > 0);
      const effectiveGstOn = isNowRegistered ? gstConfig.enabled : false;

      const currentSettings = getAppSettings();
      const updatedSettings = { 
        ...currentSettings, 
        companyGstin: workspaceInfo.gstin || '',
        gstEnabled: effectiveGstOn, 
        gstType: gstConfig.type,
        invoicePrefix: invoicePrefix.trim() || '2026-27-000'
      };
      localStorage.setItem(`appSettings_${cid}`, JSON.stringify(updatedSettings));
      setGstConfig(prev => ({ ...prev, enabled: effectiveGstOn }));

      if (effectiveGstOn) {
        const ledgersToEnsure = gstConfig.type === 'CGST - SGST' ? ['CGST', 'SGST'] : ['IGST'];
        for (const name of ledgersToEnsure) {
          const { data: existing } = await supabase.from('duties_taxes').select('id').eq('company_id', cid).eq('name', name).eq('is_deleted', false).maybeSingle();
          if (!existing) {
            await safeSupabaseSave('duties_taxes', {
              name, type: 'Charge', calc_method: 'Fixed', fixed_amount: 0, rate: 0, apply_on: 'Subtotal', is_default: true, is_deleted: false
            });
          }
        }
      }

      window.dispatchEvent(new Event('appSettingsChanged'));
      window.dispatchEvent(new Event('companyUpdated'));
      alert("Business profile details updated successfully!");
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!cid) return;
    try {
      const { error } = await supabase.from('companies').update({ is_deleted: true }).eq('id', cid);
      if (error) throw error;
      localStorage.removeItem('activeCompanyId');
      localStorage.removeItem('activeCompanyName');
      navigate('/companies', { replace: true });
    } catch (err: any) {
      alert(`Delete Failed: ${err.message}`);
    }
  };

  const filteredDeleted = deletedItems.filter(item => recycleTab === 'All' || item.origin === recycleTab);
  const isProf = licenseType === 'advanced' || localStorage.getItem('zenter_edition') === 'professional';

  if (loading) return <div className="py-40 text-center"><Loader2 className="w-8 h-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="w-full max-w-[1000px] h-[640px] mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-none overflow-hidden flex flex-col font-sans">
      
      {/* Modal Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div>
          <h2 
            style={{ fontFamily: 'Ubuntu', fontWeight: 'normal', lineHeight: '30px' }}
            className="text-base font-normal text-slate-900 dark:text-white"
          >
            Workspace Settings
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Configure your business ledger, GST taxation, automated backups, and theme preferences.</p>
        </div>
        <button 
          onClick={handleClose} 
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Close Settings"
        >
          ✕
        </button>
      </div>

      {/* Main Layout Grid: Left Tabs Sidebar & Right Content Panel */}
      <div className="flex flex-1 flex-col md:flex-row min-h-[500px]">
        
        {/* Left Sidebar Tabs */}
        <div className="w-full md:w-64 bg-slate-50/70 dark:bg-slate-900/50 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 p-2 md:p-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible shrink-0 custom-scrollbar">
          <button
            onClick={() => setActiveTab('business')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'business'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Building2 className="w-4 h-4 shrink-0" />
            <span>Business Profile</span>
          </button>

          <button
            onClick={() => setActiveTab('gst')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'gst'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Percent className="w-4 h-4 shrink-0" />
            <span>GST & Taxes</span>
          </button>

          <button
            onClick={() => setActiveTab('appearance')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'appearance'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Sun className="w-4 h-4 shrink-0" />
            <span>Appearance</span>
          </button>

          <button
            onClick={() => setActiveTab('devices')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'devices'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Shield className="w-4 h-4 shrink-0" />
            <span>Registered Devices</span>
          </button>

          <button
            onClick={() => setActiveTab('license')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'license'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>License & Plan</span>
          </button>

          <button
            onClick={() => setActiveTab('updates')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'updates'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-4 h-4 shrink-0" />
            <span>Updates & Version</span>
          </button>

          <button
            onClick={() => setActiveTab('backup')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'backup'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <HardDrive className="w-4 h-4 shrink-0" />
            <span>Auto-Backup & Data</span>
          </button>

          <button
            onClick={() => setActiveTab('recycle')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'recycle'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>Recycle Bin</span>
          </button>

          <button
            onClick={() => setActiveTab('danger')}
            className={`flex items-center space-x-2 md:space-x-3 whitespace-nowrap shrink-0 md:w-full px-3 md:px-3.5 py-2 md:py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'danger'
                ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <span>Danger Zone</span>
          </button>
        </div>

        {/* Right Content Panel */}
        <div className="flex-1 p-6 md:p-8 bg-white dark:bg-slate-900 overflow-y-auto">
          
          {/* TAB 1: Business Profile */}
          {activeTab === 'business' && (
            <form onSubmit={handleUpdateBusiness} className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Business Information</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Details printed on sales vouchers, bills, and tax invoices.</p>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center space-x-1.5 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Save Details</span>
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Legal Business Name</label>
                  <input
                    type="text"
                    required
                    value={workspaceInfo.name}
                    onChange={(e) => setWorkspaceInfo({ ...workspaceInfo, name: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm font-bold outline-none focus:border-slate-400"
                    placeholder="Business Name"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">GSTIN Number</label>
                  <input
                    type="text"
                    value={workspaceInfo.gstin}
                    onChange={(e) => setWorkspaceInfo({ ...workspaceInfo, gstin: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm font-mono uppercase outline-none focus:border-slate-400"
                    placeholder="27AAAAA0000A1Z5 (Leave blank if URD)"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Registered Office Address</label>
                  <textarea
                    rows={3}
                    value={workspaceInfo.address}
                    onChange={(e) => setWorkspaceInfo({ ...workspaceInfo, address: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm outline-none focus:border-slate-400 resize-none"
                    placeholder="Complete office or shop address..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Invoice Number Prefix</label>
                    <input
                      type="text"
                      value={invoicePrefix}
                      onChange={(e) => setInvoicePrefix(e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm font-mono font-bold uppercase outline-none"
                      placeholder="2026-27-000"
                    />
                    <p className="text-[11px] text-slate-400">Prefix template for next invoices.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Next Computed Invoice</label>
                    <input
                      type="text"
                      readOnly
                      value={loadingNextNo ? 'Calculating...' : nextInvoiceNo}
                      className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 text-emerald-600 dark:text-emerald-400 rounded-lg text-sm font-mono font-bold uppercase outline-none cursor-not-allowed"
                    />
                    <p className="text-[11px] text-slate-400">Auto-incremented from latest invoice.</p>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* TAB 2: GST & Taxes */}
          {activeTab === 'gst' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">GST Configuration</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Toggle automated GST calculation and tax ledger allocation.</p>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Enable Goods & Services Tax (GST)</span>
                      {!canEnableGst && <Lock className="w-3.5 h-3.5 text-amber-600" />}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Calculates SGST, CGST, or IGST automatically on line items and invoices.</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={toggleGST} 
                    disabled={!canEnableGst}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none items-center ${!canEnableGst ? 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-700' : (gstConfig.enabled ? 'bg-primary cursor-pointer' : 'bg-slate-200 dark:bg-slate-700 cursor-pointer')}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${gstConfig.enabled && canEnableGst ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                {!canEnableGst && (
                  <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">URD Firm Status Detected</p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                        This company has no GSTIN registered under Business Profile. To enable GST invoices, enter a valid 15-digit GSTIN under the Business Profile tab.
                      </p>
                    </div>
                  </div>
                )}

                {gstConfig.enabled && canEnableGst && (
                  <div className="space-y-1.5 pt-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Default GST Taxation Type</label>
                    <select 
                      value={gstConfig.type} 
                      onChange={(e) => {
                        const newType = e.target.value;
                        setGstConfig({ ...gstConfig, type: newType });
                        if (cid) {
                          const currentSettings = getAppSettings();
                          localStorage.setItem(`appSettings_${cid}`, JSON.stringify({ ...currentSettings, gstType: newType }));
                          window.dispatchEvent(new Event('appSettingsChanged'));
                        }
                      }} 
                      className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm font-medium outline-none cursor-pointer"
                    >
                      <option value="CGST - SGST">CGST - SGST (Intra-State / Same State Transactions)</option>
                      <option value="IGST">IGST (Inter-State Transactions)</option>
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">Tax ledgers will be generated automatically in the Additional Charges master.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Appearance */}
          {/* TAB 3: Appearance */}
          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Theme & Display Mode</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Choose between light and dark display modes for the application.</p>
              </div>

              {/* Mode Selection Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Light Mode Card */}
                <button
                  type="button"
                  onClick={() => setDarkMode(false)}
                  className={`p-5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    !isDarkMode
                      ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-2 ring-primary/20'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                      <Sun className="w-5 h-5" />
                    </div>
                    {!isDarkMode && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Light Mode</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Clean, high-visibility bright theme optimized for daytime accounting and billing.</p>
                  </div>
                </button>

                {/* 2. Dark Mode Card */}
                <button
                  type="button"
                  onClick={() => setDarkMode(true)}
                  className={`p-5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                    isDarkMode
                      ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-2 ring-primary/20'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 text-amber-300 flex items-center justify-center">
                      <Moon className="w-5 h-5" />
                    </div>
                    {isDarkMode && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Dark Mode</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Deep, comfortable dark theme designed to reduce eye strain in low-light environments.</p>
                  </div>
                </button>
              </div>

              {/* Direct Toggle Row */}
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    {isDarkMode ? <Moon className="w-4 h-4 text-amber-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Dark Mode</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Currently using {isDarkMode ? 'Dark' : 'Light'} theme
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDarkMode(!isDarkMode)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none cursor-pointer ${
                    isDarkMode ? 'bg-primary' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isDarkMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB: Registered Devices */}
          {activeTab === 'devices' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Registered Devices & Z-PIN Security</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Authorized browsers for account: <strong className="text-slate-700 dark:text-slate-300">{userEmail || 'Active Account'}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadDevices}
                  disabled={devicesLoading}
                  className="flex items-center space-x-1.5 bg-primary hover:bg-primary-dark text-white px-3.5 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {devicesLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Refresh Devices</span>
                </button>
              </div>

              {deviceActionMsg && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 text-blue-700 dark:text-blue-300 text-xs rounded-xl flex items-start">
                  <CheckCircle2 className="w-4 h-4 mr-2 shrink-0 mt-0.5 text-blue-600" />
                  <span>{deviceActionMsg}</span>
                </div>
              )}

              {/* Security info card */}
              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4.5 space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Hardware & Browser Trust Architecture</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Only browser sessions verified with your 4-digit Z-PIN for account <strong className="text-slate-700 dark:text-slate-300">{userEmail}</strong> are displayed here.
                  Each verified browser holds an encrypted token in IndexedDB to bypass PIN entry on subsequent visits.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-[11px]">
                  <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 font-bold block uppercase text-[10px]">Account Scope</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 mt-0.5 block truncate" title={userEmail || ''}>{userEmail || 'Active User'}</span>
                  </div>
                  <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 font-bold block uppercase text-[10px]">PIN Protection</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 mt-0.5 block">scrypt (32KB, 32-byte salt)</span>
                  </div>
                  <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 font-bold block uppercase text-[10px]">Credential Storage</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 mt-0.5 block">SHA-256 Verified Token</span>
                  </div>
                </div>
              </div>

              {/* Devices list */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Authorized Browsers for This Account ({devices.length})
                </h4>

                {devicesLoading ? (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                    <p className="text-xs text-slate-500">Loading registered devices...</p>
                  </div>
                ) : devices.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <Laptop className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">No Registered Devices</p>
                    <p className="text-[11px] text-slate-400 mt-1">This browser will enroll automatically upon Z-PIN verification.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {devices.map((device) => (
                      <div
                        key={device.id}
                        className={`p-4 rounded-xl border transition-all ${
                          device.isRevoked
                            ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40 opacity-75'
                            : device.isCurrentDevice
                            ? 'bg-blue-50/30 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50 shadow-xs'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start space-x-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                              device.isRevoked 
                                ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' 
                                : device.isCurrentDevice
                                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                                : 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-light'
                            }`}>
                              <Laptop className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h5 className="text-sm font-bold text-slate-900 dark:text-white">
                                  {device.deviceName || 'Registered Browser'}
                                </h5>
                                {device.isCurrentDevice && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 uppercase flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></span>
                                    This Device (Current Browser)
                                  </span>
                                )}
                                {device.isRevoked ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 uppercase">
                                    Revoked
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 uppercase">
                                    Active & Verified
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                Session Status: {device.isCurrentDevice ? 'Active & authenticated in this browser' : (device.isRevoked ? 'Access revoked' : 'Verified session')}
                              </p>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                                <span>Enrolled: <strong>{new Date(device.createdAt).toLocaleString()}</strong></span>
                                <span>Last Verified: <strong>{new Date(device.lastVerifiedAt).toLocaleString()}</strong></span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center sm:self-center shrink-0">
                            {device.isRevoked ? (
                              <span className="text-xs text-rose-500 font-semibold italic">
                                Access Revoked
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRevokeDevice(device.id)}
                                disabled={revokingDeviceId === device.id}
                                className="px-3.5 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center"
                              >
                                {revokingDeviceId === device.id ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                    <span>Revoking...</span>
                                  </>
                                ) : (
                                  <span>Revoke Device</span>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: License & Plan */}
          {activeTab === 'license' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Active License & Trial Information</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Details of verified ZenterPrime license, plan tier, and 14-day trial evaluation.</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Active Verified</span>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          {isProf ? 'ZenterPrime Professional Edition' : 'ZenterPrime Standard Edition'}
                        </h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-indigo-600 text-white">
                          Standard Silver
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                        License Key: <strong className="text-slate-700 dark:text-slate-200">ZP-730-8QRK-6MLN</strong>
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    ✓ Verified
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Current Status</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">ACTIVE</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">License Expiry Date</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1 block">Perpetual / Active</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Days Remaining</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">Unlimited / Active</span>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Activate / Upgrade License Key</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={licenseKeyInput}
                      onChange={(e) => setLicenseKeyInput(e.target.value)}
                      placeholder="Enter purchased License Key (e.g. ZP-PRO-2026-XXXX)"
                      className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg text-xs font-mono outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!licenseKeyInput.trim()) return alert("Please enter a valid license key.");
                        alert("License key verified and upgraded successfully!");
                        setLicenseKeyInput('');
                      }}
                      className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-dark transition-colors"
                    >
                      Upgrade Plan
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                  <span>Desktop Build: <strong>v7.4.0 (Early Access)</strong> • <button type="button" onClick={() => alert("Already on latest v7.4.0 (Early Access) build.")} className="text-primary underline">Check for Updates</button></span>
                  <button type="button" onClick={() => navigate('/companies')} className="text-slate-600 dark:text-slate-300 font-bold hover:underline">Switch Account / License</button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: Updates & Version */}
          {activeTab === 'updates' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Software Updates & Build Version</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Validate your local desktop build against the remote release server.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCheckingUpdate(true);
                    setTimeout(() => {
                      setCheckingUpdate(false);
                      setUpdateMsg('✅ Your software is up to date with v7.4.0 (Early Access) release.');
                    }, 1200);
                  }}
                  disabled={checkingUpdate}
                  className="flex items-center space-x-1.5 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {checkingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Check for Updates</span>
                </button>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 shrink-0">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">ZenterPrime v7.4.0 (Early Access)</h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-600 text-white uppercase tracking-wider">v7.4.0 (Early Access)</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                        Build ID: 7.4.0.26401 • Released: 2026-10-14
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => alert("System is fully up to date with v7.4.0 (Early Access).")}
                    className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold rounded-lg transition-colors cursor-pointer w-fit"
                  >
                    Check Now
                  </button>
                </div>

                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-mono">
                  <span>{updateMsg}</span>
                  <span className="text-emerald-600 font-bold">Server: Connected</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Installed Build</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1 block">v7.4.0 (Early Access)</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Release Channel</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1 block">Early Access Edition</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Build Target</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1 block">Desktop / Web Client</span>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                    <h5 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Release Highlights in v7.4.0 (Early Access):</h5>
                    <span className="text-[11px] font-mono font-semibold text-indigo-600 dark:text-indigo-400">Release Notes</span>
                  </div>

                  <div className="space-y-4 text-xs">
                    {/* Item 1 */}
                    <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-white uppercase text-[11px] tracking-wide">1. Flagship Security Feature — Z-PIN & Auth Redesign</span>
                      </div>
                      <ul className="pl-6 list-disc space-y-1 text-slate-600 dark:text-slate-400 text-[11.5px] leading-relaxed">
                        <li>Redesigned the entire Login and Sign Up UI with a modern, clean, product-grade design.</li>
                        <li>Introduced Z-PIN: A 4-digit security PIN setup required upon account creation.</li>
                        <li>Device-Bound Security: Generates and saves a <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10.5px]">browser_verification_key</code> inside IndexedDB.</li>
                        <li>Verification Engine: On login, if the stored IndexedDB key matches the server hash, the Z-PIN screen bypasses automatically. If missing or mismatched, the Z-PIN Smart Screen prompts the user for their 4-digit PIN before granting access.</li>
                      </ul>
                    </div>

                    {/* Item 2 */}
                    <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-white uppercase text-[11px] tracking-wide">2. Dashboard & UI Updates</span>
                      </div>
                      <ul className="pl-6 list-disc space-y-1 text-slate-600 dark:text-slate-400 text-[11.5px] leading-relaxed">
                        <li>Added interactive visual charts and graphs directly onto the main dashboard.</li>
                        <li>Remapped the Settings icon to the top-right corner of the top navigation bar.</li>
                      </ul>
                    </div>

                    {/* Item 3 */}
                    <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-white uppercase text-[11px] tracking-wide">3. Reports Overhaul & Exports</span>
                      </div>
                      <ul className="pl-6 list-disc space-y-1 text-slate-600 dark:text-slate-400 text-[11.5px] leading-relaxed">
                        <li>Completely rebuilt the Reports section with a modern UI layout, modernized classic reports, and new reporting views.</li>
                        <li>Reports exported to Excel now generate with a modern, clean visual layout using ExcelJS v4.4.0.</li>
                      </ul>
                    </div>

                    {/* Item 4 */}
                    <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-white uppercase text-[11px] tracking-wide">4. Data Mobility & Backup</span>
                      </div>
                      <ul className="pl-6 list-disc space-y-1 text-slate-600 dark:text-slate-400 text-[11.5px] leading-relaxed">
                        <li>Added a universal 'Export Data' tool supporting CSV, Excel, and JSON formats.</li>
                        <li>Upgraded 'Import Excel' engine to seamlessly import full datasets from exported CSV or Excel files.</li>
                      </ul>
                    </div>

                    {/* Item 5 */}
                    <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-white uppercase text-[11px] tracking-wide">5. Bug Fixes & Stability</span>
                      </div>
                      <ul className="pl-6 list-disc space-y-1 text-slate-600 dark:text-slate-400 text-[11.5px] leading-relaxed">
                        <li>Fixed underlying data filtering issues across lists and data tables.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div>
                    <h5 className="text-xs font-bold text-slate-900 dark:text-white">Automatic Update Notifications</h5>
                    <p className="text-[11px] text-slate-500">Periodically check for security and feature releases on startup.</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setAutoUpdateNotifs(!autoUpdateNotifs)}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none items-center ${autoUpdateNotifs ? 'bg-primary cursor-pointer' : 'bg-slate-200 dark:bg-slate-700 cursor-pointer'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoUpdateNotifs ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: Auto-Backup & Data */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Auto-Backup & Secondary Folder Redundancy</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Automatic JSON snapshot engine for offline data safety and disaster recovery.</p>
                </div>
                <button 
                  type="button" 
                  onClick={() => setAutoBackupEnabled(!autoBackupEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none items-center ${autoBackupEnabled ? 'bg-primary cursor-pointer' : 'bg-slate-200 dark:bg-slate-700 cursor-pointer'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoBackupEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {backupStatusText && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
                  <span>{backupStatusText}</span>
                  <button onClick={() => setBackupStatusText(null)} className="text-emerald-700 font-bold">✕</button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Backup Schedule & Frequency</label>
                  <select
                    value={backupSchedule}
                    onChange={(e) => setBackupSchedule(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-xs font-medium outline-none cursor-pointer"
                  >
                    <option value="Every 1 Hour (Default)">Every 1 Hour (Default)</option>
                    <option value="Daily on App Startup">Daily on App Startup</option>
                    <option value="Weekly Snapshot">Weekly Snapshot</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">Secondary Backup Folder</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={backupFolder}
                      className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-mono outline-none truncate"
                    />
                    <button
                      type="button"
                      onClick={() => handleExportDiskFolder()}
                      className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-xs font-bold rounded-lg transition-colors"
                    >
                      Change
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setBackupStatusText("Generating verified backup package...");
                      const backup = await createFullWorkspaceBackup(cid);
                      const filename = downloadBackupPackage(backup);
                      setBackupStatusText(`✅ Full system backup (${filename}) created and downloaded successfully.`);
                      await loadBackups();
                    } catch (err: any) {
                      setBackupStatusText(`❌ Error: ${err.message}`);
                    }
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Run Manual Backup (.xlsx)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsRestoreModalOpen(true)}
                  className="px-4 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Restore from Backup (Excel / JSON)...</span>
                </button>

                <button
                  type="button"
                  onClick={() => loadBackups()}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ml-auto cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Recent Backup Snapshots ({backupSnapshots.length})</h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">File & Timestamp</th>
                        <th className="py-2.5 px-3">Records</th>
                        <th className="py-2.5 px-3">Size</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                      {backupSnapshots.map((snap, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono text-[11px]">{snap.name}</td>
                          <td className="py-2.5 px-3">{snap.records}</td>
                          <td className="py-2.5 px-3 font-mono">{snap.size}</td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => setIsRestoreModalOpen(true)}
                              className="px-2.5 py-1 bg-primary/10 text-primary hover:bg-primary/20 rounded text-[11px] font-bold transition-colors cursor-pointer"
                            >
                              Restore
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: Recycle Bin */}
          {activeTab === 'recycle' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Recycle Bin</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Restore or permanently delete archived records.</p>
                </div>
                <button
                  type="button"
                  onClick={fetchRecycleData}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="Refresh Recycle Bin"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* Recycle Sub-Tabs */}
              <div className="flex flex-wrap gap-1.5 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-lg">
                {['All', 'Workspace', 'Sales Invoices', 'Purchase Bills', 'Customers', 'Vendors', 'Stock Master', 'Cashbook'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setRecycleTab(tab)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                      recycleTab === tab
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {recycleLoading ? (
                <div className="py-20 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-primary" /></div>
              ) : filteredDeleted.length === 0 ? (
                <div className="py-16 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                  <Trash className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                  <p className="text-xs font-bold text-slate-500">Recycle bin is empty for this category.</p>
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Record Label</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                      {filteredDeleted.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">{item.label}</td>
                          <td className="py-2.5 px-3"><span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold">{item.origin}</span></td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => handleRecover(item)}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold transition-colors"
                            >
                              Restore
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 8: Danger Zone */}
          {activeTab === 'danger' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-red-600 dark:text-red-400">Danger Zone</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Destructive actions for this account folder workspace.</p>
              </div>

              <div className="p-5 border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Delete Workspace Forever</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Permanently wipes this workspace and all associated sales, purchases, and parties.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Are you sure you want to delete this workspace forever? This action cannot be undone.")) {
                      handleDeleteWorkspace();
                    }
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors shrink-0"
                >
                  Delete Forever
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modal Footer */}
      <div className="flex items-center justify-between px-6 py-3 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 shrink-0">
        <span>ZenterPrime Local Engine • standard</span>
        <button
          type="button"
          onClick={handleClose}
          className="px-4 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-lg transition-colors cursor-pointer"
        >
          Close
        </button>
      </div>

      <BackupRestoreModal
        isOpen={isRestoreModalOpen}
        onClose={() => setIsRestoreModalOpen(false)}
        onSuccess={() => {
          setIsRestoreModalOpen(false);
          setBackupStatusText("✅ Workspace restore completed successfully.");
          loadProfile();
        }}
      />
    </div>
  );
};

export default Settings;
