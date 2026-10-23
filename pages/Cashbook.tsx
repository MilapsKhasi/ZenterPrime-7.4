
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Loader2, Calendar, Trash2, Edit, Eye, RefreshCw, Landmark, FileDown, AlertCircle, Wallet, Lock } from 'lucide-react';
import { formatDate, formatCurrency } from '../utils/helpers';
import { supabase } from '../lib/supabase';
import CashbookSheet from '../components/CashbookSheet';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { exportToCSV } from '../utils/exportHelper';
import { useCompany } from '../context/CompanyContext';
import { useLicense } from '../context/LicenseContext';
import { useSecurityDemo } from '../context/SecurityDemoContext';
import { ActionMenu } from '../components/ActionMenu';

const Cashbook = () => {
  const { activeCompany, loading: companyLoading } = useCompany();
  const { isReadOnly } = useLicense();
  const { verifyAction } = useSecurityDemo();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewState, setViewState] = useState<'list' | 'entry'>('list');
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadData = async () => {
    if (!activeCompany?.id) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cashbooks')
        .select('*')
        .eq('company_id', activeCompany.id)
        .not('is_deleted', 'is', true)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setEntries(data || []);
    } catch (e: any) {
      console.error("Cashbook API Fetch Failed:", e.message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyLoading) return;
    loadData();
    const handleSettingsChange = () => loadData();
    window.addEventListener('appSettingsChanged', handleSettingsChange);
    return () => window.removeEventListener('appSettingsChanged', handleSettingsChange);
  }, [activeCompany?.id, companyLoading]);

  const stats = useMemo(() => {
    return entries.reduce((acc, entry) => ({
      income: acc.income + (Number(entry.income_total) || 0),
      expense: acc.expense + (Number(entry.expense_total) || 0),
      balance: acc.balance + (Number(entry.balance) || 0)
    }), { income: 0, expense: 0, balance: 0 });
  }, [entries]);

  // Context-aware Previous Data Calculation
  const prevData = useMemo(() => {
    if (entries.length === 0) return { balance: 0, date: 'Initial' };
    
    if (!editingEntry) {
      // Logic for New Entry: Link to the absolute latest record
      return { balance: Number(entries[0].balance) || 0, date: formatDate(entries[0].date) };
    } else {
      // Logic for Editing: Link to the record created just before this one
      const currentIndex = entries.findIndex(e => e.id === editingEntry.id);
      const preceding = entries[currentIndex + 1]; // sorted desc, so index+1 is older
      if (preceding) {
        return { balance: Number(preceding.balance) || 0, date: formatDate(preceding.date) };
      }
      return { balance: 0, date: 'Initial' };
    }
  }, [entries, editingEntry, viewState]);

  const handleExportCSV = async () => {
    if (!activeCompany?.id || entries.length === 0) return;

    verifyAction('Export Data', async () => {
      setExporting(true);
      try {
        const headers = ['Sr', 'Stmt Date', 'Income', 'Expense', 'Balance'];
        const rows = entries.map((e, i) => [
          i + 1,
          formatDate(e.date),
          (Number(e.income_total) || 0).toFixed(2),
          (Number(e.expense_total) || 0).toFixed(2),
          (Number(e.balance) || 0).toFixed(2)
        ]);
        const config = {
          companyName: activeCompany.name || 'Cashbook Report',
          gstin: activeCompany.gstin || 'N/A',
          email: '', phone: '', address: activeCompany.address || 'N/A',
          reportTitle: 'Cashbook Register',
          dateRange: 'Full History'
        };
        exportToCSV(headers, rows, config);
      } catch (err) {
        alert("Export Failed.");
      } finally {
        setExporting(false);
      }
    });
  };

  const handleSaveSheet = async (data: any) => {
    if (isReadOnly) return alert("Evaluation license expired. Read-only mode.");
    if (!data.date) return alert("Please provide a date.");
    setLoading(true);
    const cid = activeCompany?.id;
    if (!cid) return;
    
    const payload = { 
      company_id: cid, 
      date: data.date, 
      income_total: data.incomeTotal, 
      expense_total: data.expenseTotal, 
      balance: data.balance, 
      raw_data: data, 
      is_deleted: false
    };

    try {
      if (data.id && typeof data.id === 'string' && !data.id.startsWith('local_')) {
        await supabase.from('cashbooks').update(payload).eq('id', data.id);
      } else {
        await supabase.from('cashbooks').insert([{ ...payload, created_at: new Date().toISOString() }]);
      }
      await loadData();
    } catch (e: any) {
      alert("Save Failed.");
    } finally { 
      setLoading(false);
      setViewState('list'); 
      setEditingEntry(null); 
    }
  };

  const deleteEntry = async (id: string) => {
      if (isReadOnly) return;
      if (!confirm("Permanently delete this?")) return;

      verifyAction('Delete Cashbook Entry', async () => {
        setLoading(true);
        try {
          await supabase.from('cashbooks').update({ is_deleted: true }).eq('id', id);
          await loadData();
        } finally {
          setLoading(false);
        }
      });
  };

  if (companyLoading) return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  if (!activeCompany?.id) return (
      <div className="h-full flex flex-col items-center justify-center p-10 bg-white border border-slate-200 rounded-md">
        <AlertCircle className="w-16 h-16 text-amber-500 mb-4" />
        <h2 className="text-xl font-medium text-slate-900 mb-2">Workspace Required</h2>
        <p className="text-slate-500 text-center max-w-md">Please select a workspace first.</p>
      </div>
  );

  if (viewState === 'entry') {
    return (
      <div className="h-full flex flex-col">
        <CashbookSheet 
          initialData={editingEntry} 
          existingEntries={entries}
          prevBalance={prevData.balance}
          prevDate={prevData.date}
          onSave={handleSaveSheet} 
          onCancel={() => { setViewState('list'); setEditingEntry(null); }} 
        />
      </div>
    );
  }

  const filteredEntries = entries.filter(e => String(e.date).includes(searchQuery));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        iconColor="text-blue-600 dark:text-blue-400"
        title="Cashbook Register"
        subtitle="Daily cash in hand statements, income, expenses, and net balances"
        badge={
          <button onClick={loadData} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded transition-colors ml-1 cursor-pointer" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
        actions={
          <>
            <button 
              onClick={() => verifyAction('Export Cashbook CSV', handleExportCSV)}
              disabled={exporting || entries.length === 0}
              className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all font-semibold flex items-center disabled:opacity-50 text-slate-700 dark:text-slate-300 shadow-xs cursor-pointer"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <FileDown className="w-3.5 h-3.5 mr-2" />} Export CSV
            </button>
            <button 
              disabled={isReadOnly}
              onClick={() => {
                if (!isReadOnly) {
                  verifyAction('Create Statement', () => {
                    setEditingEntry(null);
                    setViewState('entry');
                  });
                }
              }} 
              className={`px-5 py-2.5 rounded-md font-medium text-sm flex items-center shadow-sm ${
                isReadOnly
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-primary text-white hover:bg-primary-dark cursor-pointer'
              }`}
              title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'Create Statement'}
            >
              {isReadOnly ? <Lock className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />} Create Statement
            </button>
          </>
        }
      />

      {!loading && entries.length === 0 ? (
        <EmptyState 
          title="No Records" 
          message="No cashbook records found." 
          actionLabel={isReadOnly ? undefined : "Create Statement"} 
          onAction={() => {
            if (!isReadOnly) {
              verifyAction('Create Statement', () => {
                setEditingEntry(null);
                setViewState('entry');
              });
            }
          }} 
        />
      ) : (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[ 
                { label: 'Cumulative Inward', value: stats.income, color: 'text-emerald-600 dark:text-emerald-400' }, 
                { label: 'Cumulative Outward', value: stats.expense, color: 'text-rose-600 dark:text-rose-400' }, 
                { label: 'Net Cash In Hand', value: stats.balance, color: 'text-slate-900 dark:text-white' } 
                ].map((stat, i) => (
                <div key={i} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 flex flex-col hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-sm">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1 block">{stat.label}</span>
                    <span className={`text-[22px] font-bold font-mono ${stat.color}`}>
                        {formatCurrency(stat.value)}
                    </span>
                </div>
                ))}
            </div>

            <div className="space-y-4 pt-4">
                <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600 w-4 h-4" />
                <input 
                    type="text" 
                    value={searchQuery} 
                    onChange={(e) => setSearchQuery(e.target.value)} 
                    placeholder="Search by date..." 
                    className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs outline-none focus:border-slate-300 dark:focus:border-slate-600 shadow-sm text-slate-900 dark:text-slate-100" 
                />
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
                <table className="w-full text-left text-sm border-collapse min-w-[800px]">
                    <thead>
                    <tr className="bg-[#F8FAFC] dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        <th className="w-16 py-3.5 px-6 text-center">Sr</th>
                        <th className="py-3.5 px-6">Statement Date</th>
                        <th className="text-right py-3.5 px-6">Income</th>
                        <th className="text-right py-3.5 px-6">Expense</th>
                        <th className="text-right py-3.5 px-6">Balance</th>
                        <th className="text-center py-3.5 px-6 w-24">Manage</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                    {loading ? (
                        <tr><td colSpan={6} className="text-center py-20 text-slate-400 dark:text-slate-500 text-xs uppercase font-bold">Loading...</td></tr>
                    ) : filteredEntries.map((e, i) => (
                        <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-4 px-6 text-center font-mono text-slate-400 dark:text-slate-500 text-xs">{i + 1}</td>
                        <td className="py-4 px-6">
                            <div className="flex items-center text-slate-900 dark:text-white font-bold">
                            <Calendar className="w-4 h-4 mr-2 text-slate-400 dark:text-slate-500" />
                            {formatDate(e.date)}
                            </div>
                        </td>
                        <td className="text-right py-4 px-6 font-mono text-emerald-600 dark:text-emerald-400 font-bold text-base tabular-nums">
                            {formatCurrency(e.income_total, false)}
                        </td>
                        <td className="text-right py-4 px-6 font-mono text-rose-600 dark:text-rose-400 font-bold text-base tabular-nums">
                            {formatCurrency(e.expense_total, false)}
                        </td>
                        <td className="text-right py-4 px-6 font-bold text-slate-900 dark:text-white font-mono text-base tabular-nums">
                            {formatCurrency(e.balance, false)}
                        </td>
                        <td className="text-center py-4 px-6" onClick={(e) => e.stopPropagation()}>
                          <ActionMenu
                            items={[
                              {
                                label: 'View Statement',
                                icon: Eye,
                                onClick: () => { setEditingEntry(e); setViewState('entry'); }
                              },
                              {
                                label: 'Edit Statement',
                                icon: Edit,
                                disabled: isReadOnly,
                                onClick: () => { setEditingEntry(e); setViewState('entry'); }
                              },
                              {
                                label: 'Delete Statement',
                                icon: Trash2,
                                variant: 'danger',
                                disabled: isReadOnly,
                                onClick: () => deleteEntry(e.id)
                              }
                            ]}
                          />
                        </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
                </div>
            </div>
        </>
      )}
    </div>
  );
};

export default Cashbook;
