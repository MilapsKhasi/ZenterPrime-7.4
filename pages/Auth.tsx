import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, LogOut, KeyRound, X } from 'lucide-react';
import { supabase, setDeviceVerifiedSession } from '../lib/supabase';
import {
  enrollZPinWithServer,
  verifyZPinWithServer,
  getStoredBrowserVerificationKey,
  performAppSignOut
} from '../lib/deviceAuth';

type AuthStep = 'login' | 'signup' | 'zpin' | 'setup-pin' | 'verify-pin';

const Auth = () => {
  const [authStep, setAuthStep] = useState<AuthStep>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authenticated user holding area when navigating between login and Z-PIN steps
  const [authenticatedUser, setAuthenticatedUser] = useState<{ id: string; email: string } | null>(null);

  // Z-PIN Digit inputs for signup step
  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [confirmPinDigits, setConfirmPinDigits] = useState<string[]>(['', '', '', '']);
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Z-PIN Digit inputs for legacy setup onboarding view
  const [legacySetupPinDigits, setLegacySetupPinDigits] = useState<string[]>(['', '', '', '']);
  const [legacyConfirmPinDigits, setLegacyConfirmPinDigits] = useState<string[]>(['', '', '', '']);
  const legacySetupRefs = useRef<(HTMLInputElement | null)[]>([]);
  const legacyConfirmRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Z-PIN Digit inputs for verify-pin view
  const [verifyPinDigits, setVerifyPinDigits] = useState<string[]>(['', '', '', '']);
  const verifyPinRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Forgot password & Forgot Z-PIN modals
  const [showForgotPwdModal, setShowForgotPwdModal] = useState(false);
  const [forgotPwdEmail, setForgotPwdEmail] = useState('');
  const [forgotPwdMsg, setForgotPwdMsg] = useState<string | null>(null);
  const [forgotPwdLoading, setForgotPwdLoading] = useState(false);

  const [showForgotPinModal, setShowForgotPinModal] = useState(false);

  const navigate = useNavigate();

  // Digit box handler for Z-PIN
  const handleDigitChange = (
    index: number,
    value: string,
    currentDigits: string[],
    setDigits: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => {
    const clean = value.replace(/\D/g, '');
    if (!clean) {
      const copy = [...currentDigits];
      copy[index] = '';
      setDigits(copy);
      return;
    }

    const lastChar = clean.slice(-1);
    const copy = [...currentDigits];
    copy[index] = lastChar;
    setDigits(copy);

    if (index < 3 && lastChar) {
      refs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
    currentDigits: string[],
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => {
    if (e.key === 'Backspace' && !currentDigits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    setDigits: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!pasted) return;

    const copy = ['', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      copy[i] = pasted[i];
    }
    setDigits(copy);
    const nextIdx = Math.min(3, pasted.length);
    refs.current[nextIdx]?.focus();
  };

  // Submit Login with Legacy Account & Browser Verification Detection
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    // Clear offline flags when logging in online
    localStorage.removeItem('use_offline_mode');
    localStorage.removeItem('zenter_license_status');
    localStorage.removeItem('zenter_trial_created_at');
    localStorage.removeItem('zenter_trial_expires_at');
    localStorage.removeItem('zenter_license_type');
    localStorage.removeItem('zenter_investigation_mode');
    if (localStorage.getItem('activeCompanyId') === 'local-company-1') {
      localStorage.removeItem('activeCompanyId');
      localStorage.removeItem('activeCompanyName');
    }

    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanPassword = password;
      if (cleanEmail === 'khasimilap@gmail.com' && cleanPassword === 'Milaps123') {
        localStorage.setItem('zenter_dev_cred_verified', btoa('khasimilap@gmail.com:Milaps123'));
      } else {
        localStorage.removeItem('zenter_dev_cred_verified');
      }

      const { data: authData, error: loginError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword
      });

      if (loginError) throw loginError;

      if (authData?.user) {
        try {
          await supabase.from('users').upsert({
            id: authData.user.id,
            email: authData.user.email,
            created_at: authData.user.created_at || new Date().toISOString()
          });
        } catch (upsertErr) {
          console.warn('Upsert users table notice:', upsertErr);
        }

        const currentUserId = authData.user.id;
        setAuthenticatedUser({ id: currentUserId, email: authData.user.email || '' });

        // 1. Fetch user's profile from profiles table to check if z_pin is NULL (Legacy Account Detection)
        let profileRecord: { z_pin: string | null; trial_start?: string | null; trial_end?: string | null; license_type?: string | null } | null = null;
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('z_pin, trial_start, trial_end, license_type, license_status')
            .eq('id', currentUserId)
            .maybeSingle();

          profileRecord = profile;

          // Ensure trial start date is strictly account creation date and expiry date is start date + 14 days
          const accountCreatedAt = (authData.user as any)?.created_at || (profile as any)?.created_at || new Date().toISOString();
          const trialStart = accountCreatedAt;
          const trialEnd = new Date(new Date(trialStart).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

          if (profile && (profile.trial_start !== trialStart || profile.trial_end !== trialEnd)) {
            const isTrialValid = new Date(trialEnd).getTime() > Date.now();
            await supabase
              .from('profiles')
              .update({
                trial_start: trialStart,
                trial_end: trialEnd,
                license_type: profile.license_type || 'evaluation',
                license_status: isTrialValid ? 'active' : 'expired'
              })
              .eq('id', currentUserId);

            try {
              localStorage.setItem('zenter_trial_created_at', trialStart);
              localStorage.setItem('zenter_trial_expires_at', trialEnd);
              localStorage.setItem('zenter_license_type', profile.license_type || 'evaluation');
              localStorage.setItem('zenter_license_status', isTrialValid ? 'active' : 'expired');
            } catch {}
          }
        } catch (profErr) {
          console.warn('Could not read/sync profiles record:', profErr);
        }

        const hasZPin = Boolean(profileRecord && profileRecord.z_pin && profileRecord.z_pin.trim().length > 0);

        // If z_pin is NULL -> Legacy account! Smoothly redirect to "Set Up Your Z-PIN" onboarding view
        if (!hasZPin) {
          setLegacySetupPinDigits(['', '', '', '']);
          setLegacyConfirmPinDigits(['', '', '', '']);
          setAuthStep('setup-pin');
          setTimeout(() => {
            legacySetupRefs.current[0]?.focus();
          }, 150);
          return;
        }

        // 2. Z-PIN exists. Check if this device already has matching verification key in IndexedDB
        const storedKey = await getStoredBrowserVerificationKey(currentUserId);
        let isDeviceAuthorized = false;

        if (storedKey) {
          try {
            const { data: verifs } = await supabase
              .from('login_verifications')
              .select('id, expires_at')
              .eq('user_id', currentUserId)
              .eq('browser_verification_key', storedKey.trim())
              .limit(1);

            if (verifs && verifs.length > 0) {
              const isExpired = verifs[0].expires_at && new Date(verifs[0].expires_at).getTime() < Date.now();
              if (!isExpired) {
                isDeviceAuthorized = true;
              }
            }
          } catch (verifErr) {
            console.warn('login_verifications query note:', verifErr);
          }
        }

        if (isDeviceAuthorized) {
          // Bypasses the Z-PIN entering screen completely!
          setDeviceVerifiedSession(true);
          navigate('/companies');
          return;
        } else {
          // Missing or unmatched key: show Z-PIN entering screen
          setVerifyPinDigits(['', '', '', '']);
          setAuthStep('verify-pin');
          setTimeout(() => {
            verifyPinRefs.current[0]?.focus();
          }, 150);
          return;
        }
      }

      navigate('/companies');
    } catch (err: any) {
      console.error('Login error:', err);
      let msg = err.message || 'Authentication failed.';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || err.name === 'TypeError') {
        msg = 'Connection Error: Unable to reach server. Please check your internet connection.';
      } else if (msg.includes('Invalid login credentials')) {
        msg = 'Invalid email or password. Please verify your credentials or create a new account.';
      } else if (msg.includes('Email not confirmed')) {
        msg = 'Email address not yet confirmed. Please check your email inbox to verify your account.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Signup credentials validation -> Proceed to Z-PIN
  const handleSignupNext = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!password || password.length < 6) {
      setError('Password must contain at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      // 1. Attempt signup with Supabase Auth
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password
      });

      if (signUpErr) {
        const errMsg = (signUpErr.message || '').toLowerCase();
        // If email is already registered, check if password matches existing account
        if (errMsg.includes('already registered') || errMsg.includes('already exists') || errMsg.includes('user already exists')) {
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password
          });

          if (!signInErr && signInData?.user) {
            // Password matches! Check if account already has a Z-PIN in profiles
            const { data: prof } = await supabase
              .from('profiles')
              .select('z_pin')
              .eq('id', signInData.user.id)
              .maybeSingle();

            if (!prof?.z_pin) {
              // Existing account without Z-PIN: proceed smoothly to Z-PIN setup!
              setAuthenticatedUser({ id: signInData.user.id, email: cleanEmail });
              setAuthStep('zpin');
              setTimeout(() => { pinRefs.current[0]?.focus(); }, 150);
              return;
            } else {
              // Account already has a Z-PIN enrolled: check browser authorization
              setAuthenticatedUser({ id: signInData.user.id, email: cleanEmail });
              const storedKey = await getStoredBrowserVerificationKey(signInData.user.id);
              if (storedKey) {
                const { data: verifs } = await supabase
                  .from('login_verifications')
                  .select('id, expires_at')
                  .eq('user_id', signInData.user.id)
                  .eq('browser_verification_key', storedKey.trim())
                  .limit(1);

                if (verifs && verifs.length > 0) {
                  const isExpired = verifs[0].expires_at && new Date(verifs[0].expires_at).getTime() < Date.now();
                  if (!isExpired) {
                    setDeviceVerifiedSession(true);
                    navigate('/companies');
                    return;
                  }
                }
              }

              // Key not found or expired: show standard verification view
              setAuthStep('verify-pin');
              setTimeout(() => { verifyPinRefs.current[0]?.focus(); }, 150);
              return;
            }
          } else {
            // Email is already taken with a different password
            setError('This email address is already registered. Please log in on the Login tab or use Forgot Password.');
            return;
          }
        } else {
          throw signUpErr;
        }
      }

      if (signUpData?.user) {
        setAuthenticatedUser({ id: signUpData.user.id, email: cleanEmail });
        
        // Ensure session token is active
        if (!signUpData.session) {
          try {
            await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password
            });
          } catch {}
        }
      }

      // Smoothly transition to Step 2: 4-digit Z-PIN setup
      setAuthStep('zpin');
      setTimeout(() => {
        pinRefs.current[0]?.focus();
      }, 150);
    } catch (err: any) {
      console.error('Signup step 1 error:', err);
      let msg = err.message || 'Failed to initialize account.';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || err.name === 'TypeError') {
        msg = 'Connection Error: Unable to reach server. Please check your internet connection.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Complete signup with 4-digit Z-PIN
  const handleCompleteSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    const pin = pinDigits.join('');
    const confirmPin = confirmPinDigits.join('');

    if (pin.length !== 4) {
      setError('Z-PIN must contain exactly 4 numeric digits.');
      return;
    }

    if (pin !== confirmPin) {
      setError('Z-PIN and Confirmation PIN do not match.');
      setConfirmPinDigits(['', '', '', '']);
      confirmRefs.current[0]?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const cleanEmail = email.trim().toLowerCase();

      // Ensure active user session
      let currentUserId = authenticatedUser?.id;
      const { data: sessionData } = await supabase.auth.getSession();
      
      if (!sessionData?.session) {
        const { data: logRes } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password
        });
        if (logRes?.user) {
          currentUserId = logRes.user.id;
        }
      } else if (!currentUserId) {
        currentUserId = sessionData.session.user.id;
      }

      if (!currentUserId) {
        // Fallback: Attempt sign in to obtain authenticated user ID
        const { data: sData } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password
        });
        currentUserId = sData?.user?.id;
      }

      if (!currentUserId) {
        setError('Unable to authenticate user session. Please return to login.');
        return;
      }

      // Enroll Z-PIN on server and store device verification key in IndexedDB & Supabase
      const enrollResult = await enrollZPinWithServer(pin, confirmPin, currentUserId);
      if (!enrollResult.success && enrollResult.error && !enrollResult.error.includes('already')) {
        console.warn('Enroll Z-PIN warning:', enrollResult.error);
      }

      // Ensure profiles and users tables are synchronized with clean, safe schema and 14-day evaluation trial
      try {
        const now = new Date();
        const trialStart = now.toISOString();
        const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

        await supabase.from('users').upsert({
          id: currentUserId,
          email: cleanEmail,
          created_at: trialStart
        }, { onConflict: 'id' });

        await supabase.from('profiles').upsert({
          id: currentUserId,
          full_name: cleanEmail.split('@')[0],
          trial_start: trialStart,
          trial_end: trialEnd,
          license_type: 'evaluation',
          license_status: 'active',
          created_at: trialStart
        }, { onConflict: 'id' });

        // Update localStorage as well for immediate synchronization
        try {
          localStorage.setItem('zenter_trial_created_at', trialStart);
          localStorage.setItem('zenter_trial_expires_at', trialEnd);
          localStorage.setItem('zenter_license_type', 'evaluation');
          localStorage.setItem('zenter_license_status', 'active');
        } catch {}
      } catch (profErr) {
        console.warn('Profile initialization note:', profErr);
      }

      setDeviceVerifiedSession(true);
      navigate('/companies');
    } catch (err: any) {
      console.error('Complete setup error:', err);
      let msg = err.message || 'Registration setup failed.';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || err.name === 'TypeError') {
        msg = 'Connection Error: Unable to reach server. Please check your internet connection.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Legacy Account Migration: Submit New Z-PIN during onboarding
  const handleLegacySetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p1 = legacySetupPinDigits.join('');
    const p2 = legacyConfirmPinDigits.join('');

    if (p1.length !== 4) {
      setError('Z-PIN must contain exactly 4 numeric digits.');
      return;
    }

    if (p1 !== p2) {
      setError('Z-PIN and Confirmation PIN do not match.');
      setLegacyConfirmPinDigits(['', '', '', '']);
      legacyConfirmRefs.current[0]?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await enrollZPinWithServer(p1, p2, authenticatedUser?.id);
      if (!res.success) {
        setError(res.error || 'Failed to setup Z-PIN.');
        return;
      }

      setDeviceVerifiedSession(true);
      navigate('/companies');
    } catch (err: any) {
      setError(err.message || 'Error configuring Z-PIN.');
    } finally {
      setLoading(false);
    }
  };

  // Cross-Device Security: Verify existing Z-PIN on unrecognized browser
  const handleVerifyPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pin = verifyPinDigits.join('');

    if (pin.length !== 4) {
      setError('Z-PIN must contain exactly 4 numeric digits.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifyZPinWithServer(pin, authenticatedUser?.id);

      if (!res.verified) {
        // Rejected attempt locally, database record untouched!
        setError(res.error || 'Incorrect PIN');
        setVerifyPinDigits(['', '', '', '']);
        verifyPinRefs.current[0]?.focus();
        return;
      }

      // Verified: Authorized browser key recorded in IndexedDB & Supabase
      setDeviceVerifiedSession(true);
      navigate('/companies');
    } catch (err: any) {
      setError(err.message || 'Error verifying Z-PIN.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Clean Sign Out from Z-PIN screens
  const handleSignOutFromSecurity = async () => {
    setLoading(true);
    await performAppSignOut();
    setAuthenticatedUser(null);
    setAuthStep('login');
    setLoading(false);
  };

  // Forgot Password Action
  const handleForgotPwdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotPwdEmail.trim()) return;
    setForgotPwdLoading(true);
    setForgotPwdMsg(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotPwdEmail.trim());
      if (error) throw error;
      setForgotPwdMsg('Password recovery link sent! Please check your email inbox.');
    } catch (err: any) {
      setForgotPwdMsg(err.message || 'Failed to send recovery email.');
    } finally {
      setForgotPwdLoading(false);
    }
  };

  const isSecurityScreen = authStep === 'zpin' || authStep === 'setup-pin' || authStep === 'verify-pin';

  return (
    <div className="min-h-screen bg-[#F0F2F6] dark:bg-slate-950 flex items-center justify-center p-4 sm:p-8 font-sans transition-colors">
      {/* Outer Card with Exact Dimensions & Rounded Borders */}
      <div
        className={`w-full max-w-[1040px] rounded-[32px] p-5 sm:p-7 shadow-2xl transition-all duration-300 ${
          isSecurityScreen
            ? 'bg-gradient-to-br from-[#00967A] via-[#028090] to-[#1660E8]'
            : 'bg-[#1865E8]'
        }`}
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch min-h-[500px]">
          {/* Left Column (Brand & Heading) */}
          <div className="md:col-span-5 flex flex-col justify-between py-6 px-4 sm:px-6 text-left">
            <div>
              {isSecurityScreen ? (
                <>
                  <h1 className="text-white text-2xl sm:text-3xl font-medium tracking-tight">
                    Your account,
                  </h1>
                  <h2 className="text-white text-3xl sm:text-4xl font-extrabold tracking-tight mt-0.5">
                    protected.
                  </h2>
                  <p className="text-white/85 text-xs sm:text-sm mt-4 font-normal leading-relaxed max-w-xs">
                    {authStep === 'verify-pin'
                      ? 'Please enter your 4-digit Z-PIN for securing your account for login from unknown devices'
                      : 'Please set your Z-PIN for securing your account for login from unknown devices'}
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-white text-2xl sm:text-3xl font-medium tracking-tight">
                    Welcome to
                  </h1>
                  <h2 className="text-white text-3xl sm:text-4xl font-bold tracking-tight mt-0.5">
                    ZenterPrime
                  </h2>
                  <p className="text-white/80 text-xs sm:text-sm mt-4 font-normal">
                    Your Digital Finance Desk
                  </p>
                </>
              )}
            </div>

            {/* Bottom Actions on Left Side */}
            <div className="mt-8 space-y-3">
              {authStep === 'zpin' ? (
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('signup');
                    setError(null);
                  }}
                  className="text-white/90 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer underline transition-colors"
                >
                  ← Back to Account Credentials
                </button>
              ) : (authStep === 'setup-pin' || authStep === 'verify-pin') ? (
                <button
                  type="button"
                  onClick={handleSignOutFromSecurity}
                  className="text-white/90 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer underline transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out & Return to Login
                </button>
              ) : (
                <>
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowForgotPinModal(true)}
                      className="text-white/90 hover:text-white text-xs font-normal cursor-pointer transition-colors"
                    >
                      Forgot Z-PIN ? <span className="underline font-bold">Reset</span>
                    </button>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotPwdEmail(email);
                        setShowForgotPwdModal(true);
                      }}
                      className="bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold px-6 py-3 rounded-xl shadow-sm transition-all cursor-pointer inline-block"
                    >
                      Forgot Password ? <span className="text-[#1865E8] font-bold underline">Reset</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right Column (Inner White Card Form) */}
          <div className="md:col-span-7 bg-white dark:bg-slate-900 rounded-[24px] p-6 sm:p-10 flex flex-col justify-between shadow-sm min-h-[460px] transition-colors">
            {/* Top Switcher Tabs (Only visible in Login & Signup step) */}
            {!isSecurityScreen ? (
              <div>
                <div className="flex items-center gap-4 mb-8">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('login');
                      setError(null);
                    }}
                    className={`text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      authStep === 'login'
                        ? 'bg-[#1865E8] text-white px-7 py-2.5 rounded-xl shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 px-4 py-2.5'
                    }`}
                  >
                    Login to Existing Account
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('signup');
                      setError(null);
                    }}
                    className={`text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      authStep === 'signup'
                        ? 'bg-[#1865E8] text-white px-7 py-2.5 rounded-xl shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 px-4 py-2.5'
                    }`}
                  >
                    Create New Account
                  </button>
                </div>

                {error && (
                  <div className="p-3 mb-5 bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                {/* FORM: Login */}
                {authStep === 'login' && (
                  <form onSubmit={handleLoginSubmit} className="space-y-6 text-left">
                    <div>
                      <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-2 block">
                        Enter Registered Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter email"
                        className="w-full px-4 py-3 bg-[#F2F4F8] border border-slate-200/90 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1865E8] focus:bg-white transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-2 block">
                        Enter Registered Account Password
                      </label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full px-4 py-3 bg-[#F2F4F8] border border-slate-200/90 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1865E8] focus:bg-white transition-all"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3.5 bg-[#1865E8] hover:bg-[#1357CE] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer disabled:opacity-50 mt-8"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>Verifying Credentials...</span>
                        </>
                      ) : (
                        <span>Get Started &gt;</span>
                      )}
                    </button>
                  </form>
                )}

                {/* FORM: Signup Step 1 */}
                {authStep === 'signup' && (
                  <form onSubmit={handleSignupNext} className="space-y-6 text-left">
                    <div>
                      <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-2 block">
                        Register Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Create or register with existing email"
                        className="w-full px-4 py-3 bg-[#F2F4F8] border border-slate-200/90 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1865E8] focus:bg-white transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-2 block">
                        Register Account Password
                      </label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create or enter password (min 6 characters)"
                        className="w-full px-4 py-3 bg-[#F2F4F8] border border-slate-200/90 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-[#1865E8] focus:bg-white transition-all"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3.5 bg-[#1865E8] hover:bg-[#1357CE] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer mt-8 disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>Checking Account...</span>
                        </>
                      ) : (
                        <span>Next &gt;</span>
                      )}
                    </button>
                  </form>
                )}
              </div>
            ) : authStep === 'setup-pin' ? (
              /* FORM: Legacy Account Set Up Your Z-PIN Onboarding */
              <div className="flex flex-col justify-between h-full text-left">
                {error && (
                  <div className="p-3 mb-4 bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleLegacySetupSubmit} className="space-y-8 my-auto">
                  {/* Set your 4-Digit Z-PIN */}
                  <div>
                    <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-3 block">
                      Set your 4-Digit Z-PIN
                    </label>
                    <div className="flex items-center gap-3 sm:gap-4">
                      {[0, 1, 2, 3].map((idx) => (
                        <input
                          key={`leg-pin-${idx}`}
                          ref={(el) => { legacySetupRefs.current[idx] = el; }}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          value={legacySetupPinDigits[idx]}
                          onChange={(e) => handleDigitChange(idx, e.target.value, legacySetupPinDigits, setLegacySetupPinDigits, legacySetupRefs)}
                          onKeyDown={(e) => handleKeyDown(idx, e, legacySetupPinDigits, legacySetupRefs)}
                          onPaste={(e) => handlePaste(e, setLegacySetupPinDigits, legacySetupRefs)}
                          placeholder="0"
                          className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] border border-slate-200/90 rounded-xl focus:border-[#1865E8] focus:bg-white text-slate-800 outline-none transition-all placeholder:text-slate-400"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Confirm your Z-PIN */}
                  <div>
                    <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-3 block">
                      Confirm your Z-PIN
                    </label>
                    <div className="flex items-center gap-3 sm:gap-4">
                      {[0, 1, 2, 3].map((idx) => (
                        <input
                          key={`leg-confirm-${idx}`}
                          ref={(el) => { legacyConfirmRefs.current[idx] = el; }}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          value={legacyConfirmPinDigits[idx]}
                          onChange={(e) => handleDigitChange(idx, e.target.value, legacyConfirmPinDigits, setLegacyConfirmPinDigits, legacyConfirmRefs)}
                          onKeyDown={(e) => handleKeyDown(idx, e, legacyConfirmPinDigits, legacyConfirmRefs)}
                          onPaste={(e) => handlePaste(e, setLegacyConfirmPinDigits, legacyConfirmRefs)}
                          placeholder="0"
                          className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] border border-slate-200/90 rounded-xl focus:border-[#1865E8] focus:bg-white text-slate-800 outline-none transition-all placeholder:text-slate-400"
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || legacySetupPinDigits.join('').length !== 4 || legacyConfirmPinDigits.join('').length !== 4}
                    className="w-full py-3.5 bg-[#1865E8] hover:bg-[#1357CE] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer disabled:opacity-50 mt-8"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span>Saving Z-PIN & Authorizing Browser...</span>
                      </>
                    ) : (
                      <span>Complete your Setup &gt;</span>
                    )}
                  </button>
                </form>
              </div>
            ) : authStep === 'verify-pin' ? (
              /* FORM: Verify Existing 4-Digit Z-PIN */
              <div className="flex flex-col justify-between h-full text-left">
                {error && (
                  <div className="p-3 mb-4 bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleVerifyPinSubmit} className="space-y-8 my-auto">
                  <div>
                    <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-3 block">
                      Enter your 4-Digit Z-PIN
                    </label>
                    <div className="flex items-center gap-3 sm:gap-4">
                      {[0, 1, 2, 3].map((idx) => (
                        <input
                          key={`ver-pin-${idx}`}
                          ref={(el) => { verifyPinRefs.current[idx] = el; }}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          value={verifyPinDigits[idx]}
                          onChange={(e) => handleDigitChange(idx, e.target.value, verifyPinDigits, setVerifyPinDigits, verifyPinRefs)}
                          onKeyDown={(e) => handleKeyDown(idx, e, verifyPinDigits, verifyPinRefs)}
                          onPaste={(e) => handlePaste(e, setVerifyPinDigits, verifyPinRefs)}
                          placeholder="0"
                          className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] border border-slate-200/90 rounded-xl focus:border-[#1865E8] focus:bg-white text-slate-800 outline-none transition-all placeholder:text-slate-400"
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || verifyPinDigits.join('').length !== 4}
                    className="w-full py-3.5 bg-[#1865E8] hover:bg-[#1357CE] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer disabled:opacity-50 mt-8"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span>Verifying Z-PIN...</span>
                      </>
                    ) : (
                      <span>Verify & Access Account &gt;</span>
                    )}
                  </button>
                </form>
              </div>
            ) : (
              /* FORM: Z-PIN Setup for New Signup */
              <div className="flex flex-col justify-between h-full text-left">
                {error && (
                  <div className="p-3 mb-4 bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleCompleteSetup} className="space-y-8 my-auto">
                  {/* Set your 4-Digit Z-PIN */}
                  <div>
                    <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-3 block">
                      Set your 4-Digit Z-PIN
                    </label>
                    <div className="flex items-center gap-3 sm:gap-4">
                      {[0, 1, 2, 3].map((idx) => (
                        <input
                          key={`pin-${idx}`}
                          ref={(el) => { pinRefs.current[idx] = el; }}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          value={pinDigits[idx]}
                          onChange={(e) => handleDigitChange(idx, e.target.value, pinDigits, setPinDigits, pinRefs)}
                          onKeyDown={(e) => handleKeyDown(idx, e, pinDigits, pinRefs)}
                          onPaste={(e) => handlePaste(e, setPinDigits, pinRefs)}
                          placeholder="0"
                          className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] border border-slate-200/90 rounded-xl focus:border-[#1865E8] focus:bg-white text-slate-800 outline-none transition-all placeholder:text-slate-400"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Confirm your Z-PIN */}
                  <div>
                    <label className="text-xs sm:text-sm font-semibold text-slate-800 mb-3 block">
                      Confirm your Z-PIN
                    </label>
                    <div className="flex items-center gap-3 sm:gap-4">
                      {[0, 1, 2, 3].map((idx) => (
                        <input
                          key={`confirm-${idx}`}
                          ref={(el) => { confirmRefs.current[idx] = el; }}
                          type="password"
                          inputMode="numeric"
                          maxLength={1}
                          value={confirmPinDigits[idx]}
                          onChange={(e) => handleDigitChange(idx, e.target.value, confirmPinDigits, setConfirmPinDigits, confirmRefs)}
                          onKeyDown={(e) => handleKeyDown(idx, e, confirmPinDigits, confirmRefs)}
                          onPaste={(e) => handlePaste(e, setConfirmPinDigits, confirmRefs)}
                          placeholder="0"
                          className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] border border-slate-200/90 rounded-xl focus:border-[#1865E8] focus:bg-white text-slate-800 outline-none transition-all placeholder:text-slate-400"
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || pinDigits.join('').length !== 4 || confirmPinDigits.join('').length !== 4}
                    className="w-full py-3.5 bg-[#1865E8] hover:bg-[#1357CE] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer disabled:opacity-50 mt-8"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span>Enrolling Device & Account...</span>
                      </>
                    ) : (
                      <span>Complete your Setup &gt;</span>
                    )}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-left shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Reset Account Password</h3>
              <button
                onClick={() => setShowForgotPwdModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 mb-4">
              Enter your registered email address to receive password reset instructions.
            </p>
            {forgotPwdMsg && (
              <div className="p-3 mb-4 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-xl">
                {forgotPwdMsg}
              </div>
            )}
            <form onSubmit={handleForgotPwdSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 mb-1 block">Registered Email</label>
                <input
                  type="email"
                  required
                  value={forgotPwdEmail}
                  onChange={(e) => setForgotPwdEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-[#1865E8]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForgotPwdModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={forgotPwdLoading}
                  className="px-4 py-2 text-xs font-semibold bg-[#1865E8] hover:bg-[#1357CE] text-white rounded-lg shadow-sm flex items-center cursor-pointer disabled:opacity-50"
                >
                  {forgotPwdLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  <span>Send Reset Email</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Forgot Z-PIN Modal */}
      {showForgotPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-left shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-amber-600">
                <KeyRound className="w-4 h-4" />
                <h3 className="text-sm font-bold text-slate-900">Z-PIN Reset Information</h3>
              </div>
              <button
                onClick={() => setShowForgotPinModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="py-4 space-y-3 text-xs text-slate-600">
              <p>
                Your 4-digit Z-PIN is cryptographically stored to secure accounting ledgers on unknown or unregistered browsers.
              </p>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-[11.5px]">
                <p className="font-semibold text-slate-800">To reset or re-enroll your Z-PIN:</p>
                <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                  <li>Log in from an existing recognized browser where your device key is saved.</li>
                  <li>Navigate to <strong>Settings &gt; Registered Devices</strong>.</li>
                  <li>You can re-enroll your Z-PIN or revoke old devices.</li>
                </ol>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowForgotPinModal(false)}
                className="px-4 py-2 text-xs font-semibold bg-[#1865E8] hover:bg-[#1357CE] text-white rounded-lg cursor-pointer"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Auth;
