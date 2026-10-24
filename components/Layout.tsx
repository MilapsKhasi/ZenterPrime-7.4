
import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Users, UserSquare2, BadgeIndianRupee, Package, BarChart3, Settings as SettingsIcon, ShoppingCart, ReceiptText, Percent, BookOpen, ChevronDown, Building2, Menu, LogOut, Edit, Trash2, Save, Plus, ShieldCheck, AlertTriangle, MonitorPlay, Wallet, Contact, FileText, ArrowDownCircle, ArrowUpCircle, FolderPlus, Building, Crown, Lock, Search, FileSpreadsheet, Truck, Sun, Moon, Download } from 'lucide-react';
import { supabase, getAuthUser } from '../lib/supabase';
import { useCompany } from '../context/CompanyContext';
import { useLicense } from '../context/LicenseContext';
import Logo from './Logo';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import UpdateNotification from './UpdateNotification';
import CreateNewModal from './CreateNewModal';
import GlobalSearchModal from './GlobalSearchModal';
import ImportExcelModal from './ImportExcelModal';
import ExportDataModal from './ExportDataModal';
import LicenseSummaryBadge from './LicenseSummaryBadge';
import ActivationScreen from './ActivationScreen';
import { BackupReminderBanner } from './BackupReminderBanner';
import Settings from '../pages/Settings';
import { processOfflineSyncQueue } from '../lib/syncEngine';
import { useSecurityDemo } from '../context/SecurityDemoContext';
import { performAppSignOut } from '../lib/deviceAuth';

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [isCreateNewModalOpen, setIsCreateNewModalOpen] = useState(false);
  const [quickCreateType, setQuickCreateType] = useState<string | null>(null);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isImportExcelOpen, setIsImportExcelOpen] = useState(false);
  const [isExportDataOpen, setIsExportDataOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const { activeCompany, setCompany } = useCompany();
  const { isWorkspaceLimitReached, devMode, isReadOnly } = useLicense();
  const { verifyAction } = useSecurityDemo();
  const navigate = useNavigate();
  const location = useLocation();

  const handleQuickCreate = (type: string) => {
    verifyAction('Create Document', () => {
      setQuickCreateType(type);
      setIsCreateNewModalOpen(true);
    });
  };

  const [user, setUser] = useState<any>(null);

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

  const toggleTheme = () => {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    if (nextMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('app_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('app_theme', 'light');
    }
    window.dispatchEvent(new Event('appSettingsChanged'));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      const u = await getAuthUser();
      setUser(u);
      if (u) {
        processOfflineSyncQueue().catch((err) => console.warn('[Layout] Sync queue error:', err));
      }
    };
    fetchUser();
  }, []);

  // Handle window resize to auto-close/open sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Universal Keyboard Shortcuts (Ctrl+K, Ctrl+N, Ctrl+S, Esc)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl + K -> Global Search
      if (isCtrl && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        setIsGlobalSearchOpen(prev => !prev);
        return;
      }

      // Ctrl + N -> Create New
      if (isCtrl && (e.key === 'n' || e.key === 'N' || e.code === 'KeyN')) {
        e.preventDefault();
        e.stopPropagation();
        setQuickCreateType(null);
        setIsCreateNewModalOpen(true);
        return;
      }

      // Ctrl + S -> Save active form or modal
      if (isCtrl && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        // Look for open modal form
        const modalForm = document.querySelector('.fixed form, [role="dialog"] form') as HTMLFormElement | null;
        if (modalForm) {
          if (typeof modalForm.requestSubmit === 'function') {
            modalForm.requestSubmit();
          } else {
            const btn = modalForm.querySelector('button[type="submit"]') as HTMLButtonElement | null;
            if (btn) btn.click();
            else modalForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
          return;
        }

        // Look for main page form
        const pageForm = document.querySelector('main form, form') as HTMLFormElement | null;
        if (pageForm) {
          if (typeof pageForm.requestSubmit === 'function') {
            pageForm.requestSubmit();
          } else {
            const btn = pageForm.querySelector('button[type="submit"]') as HTMLButtonElement | null;
            if (btn) btn.click();
            else pageForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
          return;
        }
      }

      // Esc -> Close search / mobile menu / workspace menu
      if (e.key === 'Escape') {
        if (isGlobalSearchOpen) setIsGlobalSearchOpen(false);
        if (isMobileMenuOpen) setIsMobileMenuOpen(false);
        if (showWorkspaceMenu) setShowWorkspaceMenu(false);
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts, true);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts, true);
  }, [isGlobalSearchOpen, isCreateNewModalOpen, isMobileMenuOpen, showWorkspaceMenu]);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Edit/Create Workspace States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingWs, setEditingWs] = useState<any>(null);
  const [wsFormData, setWsFormData] = useState({ name: '', gstin: '', address: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; ws: any | null }>({ isOpen: false, ws: null });

  const loadWorkspaces = async () => {
    try {
      const u = user || await getAuthUser();
      const isRealUser = u && u.id !== 'local-user-1';

      let query = supabase.from('companies').select('*').eq('is_deleted', false);
      if (isRealUser) {
        query = query.or(`created_by.eq.${u.id},user_id.eq.${u.id}`);
      }

      const { data, error } = await query.order('name');
      if (error) throw error;

      const filtered = (data || []).filter((c: any) => {
        if (isRealUser && c.id === 'local-company-1') return false;
        return true;
      });

      setWorkspaces(filtered);
    } catch (err: any) {
      if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError') || err?.name === 'TypeError' || err?.status === 401 || err?.message?.includes('Auth') || err?.message?.includes('JWT')) {
        console.warn("Offline or unauthorized while loading workspaces:", err?.message || err);
      } else {
        console.error("Error loading workspaces:", err);
      }
    }
  };

  useEffect(() => {
    if (user) {
      loadWorkspaces();
    }
  }, [user]);

  const handleSwitchWorkspace = async (ws: any) => {
    await setCompany(ws);
    setShowWorkspaceMenu(false);
    navigate('/', { replace: true });
  };

  const handleSignOut = async () => {
    await performAppSignOut();
  };

  const handleOpenCreateWs = () => {
    setEditingWs(null);
    setWsFormData({ name: '', gstin: '', address: '' });
    setIsEditModalOpen(true);
    setShowWorkspaceMenu(false);
  };

  const openEditWs = (e: React.MouseEvent, ws: any) => {
    e.stopPropagation();
    setEditingWs(ws);
    setWsFormData({ name: ws.name, gstin: ws.gstin || '', address: ws.address || '' });
    setIsEditModalOpen(true);
    setShowWorkspaceMenu(false);
  };

  const openDeleteWs = (e: React.MouseEvent, ws: any) => {
    e.stopPropagation();
    setDeleteConfirm({ isOpen: true, ws });
    setShowWorkspaceMenu(false);
  };

  const handleSaveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsFormData.name.trim()) return;
    
    try {
      const user = await getAuthUser();
      if (!user) throw new Error("Auth session not found");

      const payload = {
        name: wsFormData.name.trim().toUpperCase(),
        gstin: wsFormData.gstin.trim().toUpperCase(),
        address: wsFormData.address.trim(),
        user_id: user.id,
        created_by: user.id
      };

      if (editingWs) {
        const { error } = await supabase
          .from('companies')
          .update(payload)
          .eq('id', editingWs.id);
        if (error) throw error;
        
        if (activeCompany?.id === editingWs.id) {
            await setCompany({ ...editingWs, ...payload, name: payload.name });
        }
      } else {
        const { error } = await supabase
          .from('companies')
          .insert([payload]);
        if (error) throw error;
      }

      setIsEditModalOpen(false);
      loadWorkspaces();
    } catch (err: any) {
      alert(`Operation Failed: ${err.message}`);
    }
  };

  const handleConfirmDeleteWs = async () => {
    if (!deleteConfirm.ws) return;
    try {
      const { error } = await supabase
        .from('companies')
        .update({ is_deleted: true })
        .eq('id', deleteConfirm.ws.id);
      
      if (error) throw error;
      
      if (activeCompany?.id === deleteConfirm.ws.id) {
        localStorage.removeItem('activeCompanyId');
        localStorage.removeItem('activeCompanyName');
        navigate('/companies', { replace: true });
      } else {
        loadWorkspaces();
      }
    } catch (err: any) {
      alert(`Delete Failed: ${err.message}`);
    } finally {
      setDeleteConfirm({ isOpen: false, ws: null });
    }
  };

  const [premiumNotice, setPremiumNotice] = useState<{ isOpen: boolean; title: string; edition: string }>({
    isOpen: false,
    title: '',
    edition: ''
  });

  const menuGroups = [
    {
      groupName: '',
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
      ]
    },
    {
      groupName: 'Sales',
      items: [
        { icon: FileText, label: 'Sales Invoices', path: '/sales', createType: 'sales_invoice' },
        { icon: ArrowDownCircle, label: 'Receive Payment', path: '/receive-payment', createType: 'receive_payment' },
        { icon: Truck, label: 'Delivery Challan', path: '/delivery-challan', createType: 'delivery_challan' },
      ]
    },
    {
      groupName: 'Purchases',
      items: [
        { icon: ReceiptText, label: 'Purchase Bills', path: '/bills', createType: 'purchase_bill' },
        { icon: ArrowUpCircle, label: 'Pay Supplier', path: '/make-payment', createType: 'make_payment' },
      ]
    },
    {
      groupName: 'Stock',
      items: [
        { icon: Package, label: 'Stock Items', path: '/stock', createType: 'stock_item' },
      ]
    },
    {
      groupName: 'Parties',
      items: [
        { icon: Contact, label: 'Parties', path: '/parties', createType: 'party' },
      ]
    },
    {
      groupName: 'Others',
      items: [
        { icon: Wallet, label: 'Cashbook', path: '/cashbook' },
        { icon: Percent, label: 'Additional Charges', path: '/additional-charges' },
        { icon: BarChart3, label: 'Reports', path: '/reports' },
      ]
    }
  ];

  return (
    <div className="flex h-screen bg-[#F7F8FC] dark:bg-slate-950 overflow-hidden font-sans transition-colors duration-300 relative">
      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-[70] lg:relative lg:z-50
        ${isSidebarOpen ? 'w-64 translate-x-0' : 'w-16 -translate-x-full lg:translate-x-0'}
        ${isMobileMenuOpen ? 'translate-x-0 w-64' : ''}
        bg-white dark:bg-slate-900 border-none flex flex-col transition-all duration-300
      `}>
        <div className="h-[50px] bg-[#4338ca] flex items-center px-4 shrink-0 border-none">
          <div className="flex items-center space-x-3">
            <Logo size={32} className="-ml-1.5" />
            {(isSidebarOpen || isMobileMenuOpen) && (
              <div className="flex flex-col">
                <div className="flex items-center space-x-2">
                  <span className="text-[14px] font-normal text-white tracking-tight leading-none">ZenterPrime</span>
                  {!devMode && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-white/15 text-white border border-white/20">v7.4.0</span>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* Close button for mobile menu */}
          <button 
            onClick={() => setIsMobileMenuOpen(false)}
            className="lg:hidden ml-auto p-2 text-white hover:bg-white/10 rounded"
          >
            <Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>
        
        {/* Gateway of ZenterPrime Header */}
        <div className={`bg-slate-50 dark:bg-slate-800/40 flex items-center transition-all duration-300 shrink-0 border-b border-slate-100 dark:border-slate-800 ${(isSidebarOpen || isMobileMenuOpen) ? 'px-4 py-2.5 h-10' : 'h-1.5 justify-center'}`}>
          {(isSidebarOpen || isMobileMenuOpen) && (
            <span className="text-slate-500 dark:text-slate-400 font-bold text-[10px] capitalize tracking-wide whitespace-nowrap">
              Quick Start
            </span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-2 custom-scrollbar">
          {menuGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-0.5">
              {(isSidebarOpen || isMobileMenuOpen) && group.groupName && (
                <div className="pt-2 pb-1 px-3 flex items-center space-x-2">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    {group.groupName}
                  </span>
                  <span className="h-[1px] flex-1 bg-slate-100 dark:bg-slate-800" />
                </div>
              )}
              {(!isSidebarOpen && !isMobileMenuOpen) && group.groupName && gIdx > 0 && (
                <div className="my-1 border-t border-slate-100 dark:border-slate-800/60" />
              )}
              {group.items.map((item: any, iIdx) => {
                const IconComponent = item.icon;
                if (item.isPremium) {
                  return (
                    <button
                      key={iIdx}
                      type="button"
                      onClick={() => {
                        setPremiumNotice({
                          isOpen: true,
                          title: item.label,
                          edition: item.edition || 'Standard & Advanced Edition'
                        });
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 group cursor-pointer"
                    >
                      <div className="flex items-center min-w-0">
                        <IconComponent className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400" />
                        {(isSidebarOpen || isMobileMenuOpen) && (
                          <span className="ml-3 text-[13px] whitespace-nowrap truncate font-medium">{item.label}</span>
                        )}
                      </div>
                      {(isSidebarOpen || isMobileMenuOpen) && (
                        <span className="text-[11px] ml-1 shrink-0" title={`${item.label} (${item.edition})`}>👑</span>
                      )}
                    </button>
                  );
                }

                const isActive = location.pathname === item.path;
                return (
                  <div
                    key={item.path || iIdx}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded transition-colors group ${isActive
                      ? 'bg-[#4338ca] text-white font-bold shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <Link
                      to={item.path || '/'}
                      onClick={() => {
                        if (window.innerWidth < 1024) {
                          setIsMobileMenuOpen(false);
                        }
                      }}
                      className="flex items-center min-w-0 flex-1 py-0.5 mr-1"
                    >
                      <IconComponent className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
                      {(isSidebarOpen || isMobileMenuOpen) && (
                        <span className="ml-2.5 text-[13px] whitespace-nowrap capitalize truncate">{item.label}</span>
                      )}
                    </Link>
                    {(isSidebarOpen || isMobileMenuOpen) && item.createType && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isReadOnly) return;
                          handleQuickCreate(item.createType);
                        }}
                        title={`Create New ${item.label}`}
                        disabled={isReadOnly}
                        className={`p-1 rounded transition-all shrink-0 flex items-center justify-center cursor-pointer ${
                          isActive
                            ? 'bg-white/20 hover:bg-white/35 text-white'
                            : 'text-slate-400 dark:text-slate-500 hover:text-primary dark:hover:text-primary-light hover:bg-slate-200/80 dark:hover:bg-slate-700/80'
                        } ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <BackupReminderBanner />
        <header className="h-[50px] bg-[#4338ca] flex items-center justify-between px-2.5 sm:px-4 shrink-0 z-40 gap-3 border-none">
          <div className="flex items-center space-x-2 w-[55%] sm:w-[58%] md:w-[60%] max-w-[620px] min-w-0">
            {/* Mobile toggle menu */}
            <button 
              onClick={() => setIsMobileMenuOpen(true)} 
              className="lg:hidden flex items-center justify-center p-1.5 hover:bg-white/10 rounded cursor-pointer transition-colors shrink-0"
              title="Open Navigation Menu"
            >
              <Menu className="w-5 h-5 text-white" />
            </button>

            {/* Long search button covering 60% of topbar from left margin */}
            <button
              onClick={() => setIsGlobalSearchOpen(true)}
              className="w-full flex items-center justify-between px-3 h-[32px] bg-[#3b31b3]/70 hover:bg-[#372ea3] text-white rounded-md text-xs transition-all border border-indigo-400/30 cursor-pointer shadow-2xs group"
              title="Global Search (Ctrl + K)"
            >
              <div className="flex items-center space-x-2 text-white/90 min-w-0">
                <Search className="w-3.5 h-3.5 text-white/90 shrink-0" />
                <span className="font-normal text-white/90 text-[11.5px] truncate">
                  Search vouchers, ledgers, items, parties...
                </span>
              </div>
            </button>
          </div>

          <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
            <div className="hidden 2xl:block">
              <LicenseSummaryBadge />
            </div>
            {localStorage.getItem('use_offline_mode') === 'true' && (
              <span className="hidden sm:flex items-center space-x-1 px-2 py-0.5 bg-amber-500/20 border border-amber-400/40 text-amber-200 font-bold rounded text-[9.5px] uppercase tracking-wider select-none">
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full mr-1"></span>
                Offline
              </span>
            )}

            {/* Company dropdown beside Import button on its left side */}
            <div className="relative">
              <button
                onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                className="flex items-center px-2.5 sm:px-3 py-1.5 h-[32px] bg-[#4338ca] border border-indigo-400/30 rounded text-sm hover:bg-[#3b31b3] transition-colors cursor-pointer"
              >
                <Building2 className="w-3.5 h-3.5 text-white mr-1.5 shrink-0" />
                <span className="font-medium text-white capitalize text-[11px] max-w-[85px] xs:max-w-[110px] sm:max-w-[150px] truncate">
                  {activeCompany?.name || 'Select Workspace'}
                </span>
                <ChevronDown className="ml-1 sm:ml-2 w-3 h-3 text-white shrink-0" />
              </button>
              {showWorkspaceMenu && (
                <div className="absolute top-full right-0 sm:right-auto sm:left-0 mt-1 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded shadow-lg overflow-hidden z-50">
                  <div className="max-h-60 overflow-y-auto custom-scrollbar py-1">
                    {workspaces.map((ws) => (
                      <div 
                        key={ws.id}
                        className={`w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer group ${activeCompany?.id === ws.id ? 'bg-primary/10 dark:bg-primary/5' : ''}`}
                        onClick={() => handleSwitchWorkspace(ws)}
                      >
                        <div className="flex items-center min-w-0 flex-1">
                            <Building2 className={`w-3.5 h-3.5 mr-2 shrink-0 ${activeCompany?.id === ws.id ? 'text-slate-900 dark:text-primary' : 'text-slate-400'}`} />
                            <span className={`truncate capitalize text-xs ${activeCompany?.id === ws.id ? 'font-medium text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>{ws.name}</span>
                        </div>
                        <div className="flex items-center space-x-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => openEditWs(e, ws)} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700 rounded"><Edit className="w-3 h-3" /></button>
                            <button onClick={(e) => openDeleteWs(e, ws)} className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-white dark:hover:bg-slate-700 rounded"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-slate-100 dark:border-slate-800 py-1 bg-slate-50/50 dark:bg-slate-900/50">
                    <button
                      onClick={isWorkspaceLimitReached ? undefined : handleOpenCreateWs}
                      disabled={isWorkspaceLimitReached}
                      className={`w-full flex items-center px-4 py-2 text-left text-xs font-medium border-b border-slate-100 dark:border-slate-800 transition-colors ${
                        isWorkspaceLimitReached
                          ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed bg-slate-50/50 dark:bg-slate-900/50'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                      title={isWorkspaceLimitReached ? 'Evaluation Edition accounts are limited to 1 workspace' : 'Create New Workspace'}
                    >
                      <Plus className="w-3.5 h-3.5 mr-2" />
                      <span className="capitalize">Create New Workspace {isWorkspaceLimitReached ? '(Limit 1)' : ''}</span>
                    </button>
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center px-4 py-2.5 text-left text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5 mr-2" />
                      <span className="capitalize">Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Import Button */}
            <button
              disabled={isReadOnly}
              onClick={() => {
                if (!isReadOnly) {
                  verifyAction('Import Excel Data', () => setIsImportExcelOpen(true));
                }
              }}
              className={`px-2.5 sm:px-3 py-1.5 font-medium text-xs rounded-md capitalize flex items-center gap-1.5 shadow-sm transition-all ${
                isReadOnly
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 border-0 cursor-not-allowed'
                  : 'bg-[#009a71] hover:bg-[#008763] border-0 text-white cursor-pointer'
              }`}
              title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'Import Excel / CSV Data'}
            >
              {isReadOnly ? <Lock className="w-3.5 h-3.5" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-white" />}
              <span className="hidden sm:inline text-[11.5px]">Import</span>
            </button>
            <button
              onClick={() => setIsExportDataOpen(true)}
              className="px-2.5 sm:px-3 py-1.5 font-medium text-xs rounded-md capitalize flex items-center gap-1.5 shadow-xs transition-all bg-[#4338ca] text-white border border-indigo-400/30 hover:bg-[#3b31b3] cursor-pointer"
              title="Export Workspace Data (Excel, CSV, JSON)"
            >
              <Download className="w-3.5 h-3.5 text-white" />
              <span className="hidden md:inline text-[11.5px]">Export</span>
            </button>
            <button
              disabled={isReadOnly}
              onClick={() => {
                if (!isReadOnly) {
                  verifyAction('Create Document', () => {
                    setQuickCreateType(null);
                    setIsCreateNewModalOpen(true);
                  });
                }
              }}
              className={`px-2.5 sm:px-3 py-1.5 text-xs rounded-md capitalize flex items-center gap-1.5 shadow-xs transition-all ${
                isReadOnly
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 border border-slate-300 dark:border-slate-700 cursor-not-allowed'
                  : 'bg-[#ffffff] text-[#000000] border border-white hover:bg-slate-100 cursor-pointer'
              }`}
              title={isReadOnly ? 'Evaluation Expired - Read Only Mode' : 'Quick Create'}
            >
              {isReadOnly ? <Lock className="w-3.5 h-3.5 text-slate-300" /> : <Plus className="w-3.5 h-3.5 text-[#000000] stroke-[2.5]" />}
              <span className="hidden sm:inline text-[11.5px] bg-[#ffffff] text-[#000000] font-normal">Create</span>
            </button>
            <button
              onClick={toggleTheme}
              className="p-1.5 bg-[#4338ca] hover:bg-[#3b31b3] text-white rounded-md border border-indigo-400/30 transition-all cursor-pointer shadow-2xs"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle Theme"
            >
              {isDarkMode ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-white" />}
            </button>
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-1.5 bg-[#4338ca] hover:bg-[#3b31b3] text-white rounded-md border border-indigo-400/30 transition-all cursor-pointer shadow-2xs"
              title="Workspace Settings"
              aria-label="Workspace Settings"
            >
              <SettingsIcon className="w-4 h-4 text-white" />
            </button>
          </div>
        </header>

        {isSettingsModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="w-full max-w-[1000px] h-[92vh] sm:h-[640px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-none overflow-hidden flex flex-col">
              <Settings onClose={() => setIsSettingsModalOpen(false)} />
            </div>
          </div>
        )}

        <ActivationScreen />

        <GlobalSearchModal
          isOpen={isGlobalSearchOpen}
          onClose={() => setIsGlobalSearchOpen(false)}
        />
        <ImportExcelModal
          isOpen={isImportExcelOpen}
          onClose={() => setIsImportExcelOpen(false)}
          onSuccess={() => {
            window.dispatchEvent(new Event('appSettingsChanged'));
            window.dispatchEvent(new Event('partiesUpdated'));
            window.dispatchEvent(new Event('stockUpdated'));
          }}
        />
        <ExportDataModal
          isOpen={isExportDataOpen}
          onClose={() => setIsExportDataOpen(false)}
        />
        <CreateNewModal
          isOpen={isCreateNewModalOpen}
          initialView={quickCreateType || undefined}
          onClose={() => {
            setIsCreateNewModalOpen(false);
            setQuickCreateType(null);
          }}
        />
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 bg-[#F7F8FC] dark:bg-slate-950">
          <Outlet />
        </main>
      </div>

      {/* Workspace Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title={editingWs ? "Workspace Configuration" : "New Business Workspace"} maxWidth="max-w-xl">
        <form onSubmit={handleSaveWorkspace} className="p-6 space-y-6">
            <div className="space-y-4 border border-slate-200 dark:border-slate-800 rounded-md p-6">
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400 capitalize">Workspace Name</label>
                    <input required value={wsFormData.name} onChange={e => setWsFormData({...wsFormData, name: e.target.value})} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded text-sm focus:border-slate-400 outline-none capitalize font-medium" />
                </div>
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400 capitalize">GSTIN Number</label>
                    <input value={wsFormData.gstin} onChange={e => setWsFormData({...wsFormData, gstin: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded text-sm focus:border-slate-400 outline-none font-mono uppercase" />
                </div>
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400 capitalize">Business Address</label>
                    <textarea value={wsFormData.address} onChange={e => setWsFormData({...wsFormData, address: e.target.value})} rows={3} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded text-sm focus:border-slate-400 outline-none resize-none" />
                </div>
            </div>
            <div className="flex justify-end pt-2">
                <button type="submit" className="bg-primary text-white px-8 py-2.5 rounded font-medium text-xs hover:bg-primary-dark capitalize shadow-sm flex items-center">
                    <Save className="w-3.5 h-3.5 mr-2" /> {editingWs ? 'Update Workspace' : 'Create Workspace'}
                </button>
            </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog 
        isOpen={deleteConfirm.isOpen} 
        onClose={() => setDeleteConfirm({ isOpen: false, ws: null })} 
        onConfirm={handleConfirmDeleteWs} 
        title="Delete Workspace" 
        message={`This will permanently remove "${deleteConfirm.ws?.name}" and all its data. Are you sure?`} 
      />

      {/* Premium Feature Modal */}
      {premiumNotice.isOpen && (
        <Modal isOpen={true} onClose={() => setPremiumNotice({ isOpen: false, title: '', edition: '' })} title="Premium Feature" maxWidth="max-w-md">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
              <Crown className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {premiumNotice.title} 👑
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                This feature is available in <span className="font-bold text-amber-600 dark:text-amber-400">{premiumNotice.edition}</span>.
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-lg border border-slate-100 dark:border-slate-800 text-left text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
              <div className="flex items-center space-x-2 font-semibold text-slate-900 dark:text-white">
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span>Upgrade Workspace Edition</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Unlock multi-warehouse godown management, stock grouping, delivery challans, and purchase orders seamlessly.
              </p>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setPremiumNotice({ isOpen: false, title: '', edition: '' })}
                className="px-4 py-2 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary-dark transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
      
      <UpdateNotification />
    </div>
  );
};

export default Layout;
