
import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Parties from './pages/Parties';
import Bills from './pages/Bills';
import Sales from './pages/Sales';
import Stock from './pages/Stock';
import Masters from './pages/Masters';
import Reports from './pages/Reports';
import Purchases from './pages/Purchases';
import AdditionalCharges from './pages/AdditionalCharges';
import Cashbook from './pages/Cashbook';
import Payments from './pages/Payments';
import Auth from './pages/Auth';
import Companies from './pages/Companies';
import DeliveryChallans from './pages/DeliveryChallans';
import { CompanyProvider, useCompany } from './context/CompanyContext';
import { LicenseProvider } from './context/LicenseContext';
import { SecurityDemoProvider } from './context/SecurityDemoContext';
import { DeviceVerificationProvider } from './context/DeviceVerificationContext';
import { DeviceVerificationGate } from './components/DeviceVerificationGate';
import { supabase } from './lib/supabase';
import { Database, AlertCircle, Copy, Check } from 'lucide-react';

const AppContent = () => {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const { activeCompany, loading: companyLoading } = useCompany();

  useEffect(() => {
    const checkSchema = async (sess: any) => {
      if (!sess) return;
      try {
        const { error } = await supabase.from('companies').select('id').limit(1);
        if (error) {
          if (error.message.includes('not found') || error.message.includes('does not exist')) {
            setDbError("SCHEMA_MISSING");
          } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            console.warn("Schema check offline / connection warning:", error.message);
            localStorage.setItem('use_offline_mode', 'true');
            setDbError(null);
          }
        }
      } catch (e: any) {
        if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError') || e.name === 'TypeError') {
          console.warn("Schema check offline / connection warning:", e.message || e);
          localStorage.setItem('use_offline_mode', 'true');
          setDbError(null);
        } else {
          console.error("Schema check error:", e);
        }
      }
    };

    const initAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
            console.warn("Auth init session offline warning:", error.message);
            localStorage.setItem('use_offline_mode', 'true');
            const { data: offlineData } = await supabase.auth.getSession();
            setSession(offlineData?.session || null);
            setAuthLoading(false);
            return;
          } else {
            console.error("Auth init session error:", error);
            localStorage.removeItem('local_session_user');
            setSession(null);
            setAuthLoading(false);
            return;
          }
        }

        const currentSession = data?.session || null;
        setSession(currentSession);
        if (currentSession) {
          await checkSchema(currentSession);
        }
      } catch (e: any) {
        if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError') || e.name === 'TypeError') {
          console.warn("Auth init session offline unexpected warning:", e.message || e);
          localStorage.setItem('use_offline_mode', 'true');
          const { data: offlineData } = await supabase.auth.getSession();
          setSession(offlineData?.session || null);
        } else {
          console.error("Auth init unexpected error:", e);
        }
      } finally {
        setAuthLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: any, newSession: any) => {
      setSession(newSession);
      if (event === 'SIGNED_IN' && newSession) {
        checkSchema(newSession);
      }
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem('local_session_user');
        localStorage.removeItem('use_offline_mode');
        localStorage.removeItem('activeCompanyId');
        localStorage.removeItem('activeCompanyName');
        setSession(null);
        setDbError(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const copySql = () => {
    const sql = `
-- 0. Clean up any old/conflicting triggers, functions, and tables to prevent uuid/bigint type conflicts
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS on_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS sync_user ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.sync_user() CASCADE;

DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;
DROP TABLE IF EXISTS public.login_verifications CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.vendors CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.purchase_bills CASCADE;
DROP TABLE IF EXISTS public.sales_invoices CASCADE;
DROP TABLE IF EXISTS public.stock_items CASCADE;
DROP TABLE IF EXISTS public.duties_taxes CASCADE;
DROP TABLE IF EXISTS public.cashbooks CASCADE;

-- 1. Create Profiles Table for Multi-tenancy Context
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  active_company_id uuid,
  full_name text,
  created_at timestamptz DEFAULT now()
);

-- 2. Create Core Tables
CREATE TABLE public.companies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, 
  name text NOT NULL, 
  gstin text, 
  address text, 
  is_deleted boolean DEFAULT false, 
  created_at timestamptz DEFAULT now(), 
  user_id uuid DEFAULT auth.uid(),
  created_by uuid DEFAULT auth.uid()
);

-- 2.1 Create OTP Verification Table
CREATE TABLE public.login_verifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  otp text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2.2 Create Users Table
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2.3 Create Vendors and Customers Tables
CREATE TABLE public.vendors (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, email text, phone text, gstin text, pan text, state text, account_number text, account_name text, ifsc_code text, address text, balance numeric DEFAULT 0, party_type text DEFAULT 'vendor', is_customer boolean DEFAULT false, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.customers (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, email text, phone text, gstin text, pan text, state text, account_number text, account_name text, ifsc_code text, address text, balance numeric DEFAULT 0, party_type text DEFAULT 'customer', is_customer boolean DEFAULT true, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());

-- 2.4 Create Bills and Invoices Tables
CREATE TABLE public.purchase_bills (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, vendor_name text NOT NULL, bill_number text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE, total_without_gst numeric DEFAULT 0, total_gst numeric DEFAULT 0, grand_total numeric DEFAULT 0, status text DEFAULT 'Pending', is_deleted boolean DEFAULT false, description text, items jsonb DEFAULT '{}'::jsonb, round_off numeric DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE public.sales_invoices (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, customer_name text NOT NULL, invoice_number text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE, total_without_gst numeric DEFAULT 0, total_gst numeric DEFAULT 0, grand_total numeric DEFAULT 0, status text DEFAULT 'Pending', is_deleted boolean DEFAULT false, description text, items jsonb DEFAULT '{}'::jsonb, round_off numeric DEFAULT 0, created_at timestamptz DEFAULT now());

-- 2.5 Create Stock, Duties and Taxes, and Cashbook Tables
CREATE TABLE public.stock_items (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, hsn text, rate numeric DEFAULT 0, selling_price numeric DEFAULT 0, tax_rate numeric DEFAULT 0, unit text DEFAULT 'PCS', in_stock numeric DEFAULT 0, sku text, description text, kg_per_bag numeric DEFAULT 0, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.duties_taxes (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, type text DEFAULT 'Charge', calc_method text DEFAULT 'Percentage', rate numeric DEFAULT 0, fixed_amount numeric DEFAULT 0, apply_on text DEFAULT 'Subtotal', applicable_to text DEFAULT 'Both', is_default boolean DEFAULT false, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.cashbooks (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, date date NOT NULL, income_total numeric DEFAULT 0, expense_total numeric DEFAULT 0, balance numeric DEFAULT 0, raw_data jsonb DEFAULT '{}'::jsonb, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());

-- 3. Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duties_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_verifications ENABLE ROW LEVEL SECURITY;

-- 4. Set Policies
CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id);
CREATE POLICY "Manage own companies" ON public.companies FOR ALL TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Manage own users" ON public.users FOR ALL TO authenticated USING (auth.uid() = id);
CREATE POLICY "Manage company vendors" ON public.vendors FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company customers" ON public.customers FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company purchase bills" ON public.purchase_bills FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company sales" ON public.sales_invoices FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company stock" ON public.stock_items FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company taxes" ON public.duties_taxes FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company cashbook" ON public.cashbooks FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage own OTPs" ON public.login_verifications FOR ALL TO authenticated USING (auth.uid() = user_id);
    `.trim();
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (authLoading || companyLoading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-white dark:bg-slate-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );

  const isOfflineMode = typeof window !== 'undefined' && (
    localStorage.getItem('use_offline_mode') === 'true' ||
    localStorage.getItem('local_session_user') !== null ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  );

  if ((dbError === "CONNECTION_ERROR" && !isOfflineMode) || (session && dbError === "SCHEMA_MISSING")) {
    const isConnectionError = dbError === "CONNECTION_ERROR";
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            {isConnectionError ? <AlertCircle className="w-8 h-8 text-red-500" /> : <Database className="w-8 h-8 text-primary" />}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2 capitalize">
            {isConnectionError ? "Connection Error" : "Database Setup Required"}
          </h1>
          <p className="text-slate-500 mb-8 capitalize">
            {isConnectionError 
              ? "Unable to reach the server. Please check your internet connection or ensure the Supabase project is active." 
              : "Required tables haven't been created yet."}
          </p>
          
          {!isConnectionError && (
            <div className="bg-slate-900 rounded-lg p-6 text-left mb-6 relative group">
              <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                {`CREATE TABLE public.profiles (...);\nCREATE TABLE public.companies (...);\n...`}
              </pre>
              <button onClick={copySql} className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded text-xs font-medium flex items-center capitalize">
                {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                {copied ? 'Copied!' : 'Copy Sql'}
              </button>
            </div>
          )}
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button onClick={() => window.location.reload()} className="px-8 py-3 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark capitalize">
              {isConnectionError ? "Retry Connection" : "Refresh After Running Sql"}
            </button>
            <button 
              onClick={() => {
                localStorage.setItem('use_offline_mode', 'true');
                window.location.reload();
              }} 
              className="px-8 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg border border-slate-200 capitalize"
            >
              Continue in Offline/Local Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Simplified Authentication Guard: Just check for session
  const authenticated = !!session;

  return (
    <div>
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="/setup" element={<Auth />} />
        <Route 
          path="/companies" 
          element={
            authenticated ? (
              <DeviceVerificationGate>
                <Companies />
              </DeviceVerificationGate>
            ) : (
              <Navigate to="/login" replace />
            )
          } 
        />
        
        <Route 
          path="/" 
          element={
            authenticated ? (
              <DeviceVerificationGate>
                {activeCompany ? <Layout /> : <Navigate to="/companies" replace />}
              </DeviceVerificationGate>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="masters" element={<Masters />} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="bills" element={<Bills />} />
          <Route path="payments" element={<Navigate to="/receive-payment" replace />} />
          <Route path="receive-payment" element={<Payments typeFilter="Receipt" />} />
          <Route path="make-payment" element={<Payments typeFilter="Payment" />} />
          <Route path="sales" element={<Sales />} />
          <Route path="delivery-challan" element={<DeliveryChallans />} />
          <Route path="parties" element={<Parties />} />
          <Route path="cashbook" element={<Cashbook />} />
          <Route path="additional-charges" element={<AdditionalCharges />} />
          <Route path="stock" element={<Stock />} />
          <Route path="reports" element={<Reports />} />
        </Route>
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

const App = () => (
  <Router>
    <SecurityDemoProvider>
      <LicenseProvider>
        <CompanyProvider>
          <DeviceVerificationProvider>
            <AppContent />
          </DeviceVerificationProvider>
        </CompanyProvider>
      </LicenseProvider>
    </SecurityDemoProvider>
  </Router>
);

export default App;
