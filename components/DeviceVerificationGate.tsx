import React, { useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, AlertCircle, LogOut, Lock } from 'lucide-react';
import { useDeviceVerification } from '../context/DeviceVerificationContext';
import { performAppSignOut } from '../lib/deviceAuth';

export const DeviceVerificationGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    isCheckingDevice,
    isDeviceVerified,
    requiresVerification,
    requiresEnrollment,
    currentUserId,
    rateLimit,
    verifyPin,
    enrollPin,
    refreshDeviceStatus,
    lastVerified
  } = useDeviceVerification();

  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [enrollPinDigits, setEnrollPinDigits] = useState<string[]>(['', '', '', '']);
  const [confirmPinDigits, setConfirmPinDigits] = useState<string[]>(['', '', '', '']);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);

  const digitInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const enrollInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const confirmInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown countdown timer
  useEffect(() => {
    if (rateLimit && !rateLimit.allowed && rateLimit.retryAfterSeconds) {
      setCooldownSeconds(rateLimit.retryAfterSeconds);
    }
  }, [rateLimit]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          refreshDeviceStatus();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds, refreshDeviceStatus]);

  // Focus first input box
  useEffect(() => {
    if (requiresVerification) {
      setTimeout(() => {
        digitInputsRef.current[0]?.focus();
      }, 150);
    } else if (requiresEnrollment) {
      setTimeout(() => {
        enrollInputsRef.current[0]?.focus();
      }, 150);
    }
  }, [requiresVerification, requiresEnrollment]);

  // Digit input handling
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

  // Submit Verification (Entering PIN)
  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullPin = pinDigits.join('');
    if (fullPin.length !== 4) {
      setErrorMessage('Please enter all 4 digits of your Z-PIN.');
      return;
    }

    if (cooldownSeconds > 0) {
      setErrorMessage(`Please wait ${cooldownSeconds}s before retrying.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const res = await verifyPin(fullPin);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Verification failed.');
      setPinDigits(['', '', '', '']);
      digitInputsRef.current[0]?.focus();
    }
  };

  // Submit Enrollment (Setting PIN)
  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p1 = enrollPinDigits.join('');
    const p2 = confirmPinDigits.join('');

    if (p1.length !== 4) {
      setErrorMessage('Z-PIN must contain exactly 4 numeric digits.');
      return;
    }

    if (p1 !== p2) {
      setErrorMessage('Confirmation PIN does not match.');
      setConfirmPinDigits(['', '', '', '']);
      confirmInputsRef.current[0]?.focus();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const res = await enrollPin(p1, p2);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to setup Z-PIN.');
    }
  };

  const handleSignOut = async () => {
    setIsSubmitting(true);
    await performAppSignOut();
  };

  // 1. If not currently checking and no authenticated user session exists, redirect immediately to /login
  if (!isCheckingDevice && !currentUserId) {
    return <Navigate to="/login" replace />;
  }

  const ONE_HOUR = 60 * 60 * 1000;
  const isRecentlyVerified = lastVerified !== null && (Date.now() - lastVerified < ONE_HOUR);

  // 2. Verified session: Grant Access to children directly.
  // Children and active forms remain continuously mounted across tab switches and reactivations.
  if (isDeviceVerified || (isRecentlyVerified && !requiresVerification && !requiresEnrollment)) {
    return <>{children}</>;
  }

  // 3. Initial State: Checking device credentials for unverified session
  if (isCheckingDevice) {
    return (
      <div className="min-h-screen bg-[#F0F2F6] dark:bg-slate-950 flex items-center justify-center p-4 font-sans transition-colors">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-xl max-w-sm w-full text-center transition-colors">
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#1865E8] dark:text-blue-400 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-[#1865E8] dark:text-blue-400" />
          </div>
          <h2 className="text-base font-bold text-slate-800 dark:text-white">
            Verifying Device Security
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Validating browser credentials...
          </p>
        </div>
      </div>
    );
  }

  // 3. Enrollment Mode (Setting up 4-Digit Z-PIN)
  if (requiresEnrollment) {
    return (
      <div className="min-h-screen bg-[#F0F2F6] dark:bg-slate-950 flex items-center justify-center p-4 sm:p-8 font-sans transition-colors">
        <div className="w-full max-w-[1040px] rounded-[32px] p-5 sm:p-7 shadow-2xl bg-gradient-to-br from-[#00967A] via-[#028090] to-[#1660E8]">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch min-h-[500px]">
            {/* Left Column: Heading exactly as requested: "Your account, **protected.**" */}
            <div className="md:col-span-5 flex flex-col justify-between py-6 px-4 sm:px-6 text-left">
              <div>
                <h1 className="text-white text-2xl sm:text-3xl font-medium tracking-tight">
                  Your account,
                </h1>
                <h2 className="text-white text-3xl sm:text-4xl font-extrabold tracking-tight mt-0.5">
                  protected.
                </h2>
                <p className="text-white/85 text-xs sm:text-sm mt-4 font-normal leading-relaxed max-w-xs">
                  Please set your Z-PIN for securing your account for login from unknown devices
                </p>
              </div>

              <div className="mt-8">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="text-white/90 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer underline transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>

            {/* Right Column: Pixel-perfect White Card */}
            <div className="md:col-span-7 bg-white dark:bg-slate-900 rounded-[24px] p-6 sm:p-10 flex flex-col justify-between shadow-sm min-h-[460px] text-left transition-colors">
              {errorMessage && (
                <div className="p-3 mb-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 text-xs rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <form onSubmit={handleEnrollSubmit} className="space-y-8 my-auto">
                {/* Set your 4-Digit Z-PIN */}
                <div>
                  <label className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 block">
                    Set your 4-Digit Z-PIN
                  </label>
                  <div className="flex items-center gap-3 sm:gap-4">
                    {[0, 1, 2, 3].map((idx) => (
                      <input
                        key={`enroll-${idx}`}
                        ref={(el) => { enrollInputsRef.current[idx] = el; }}
                        type="password"
                        inputMode="numeric"
                        maxLength={1}
                        value={enrollPinDigits[idx]}
                        onChange={(e) => handleDigitChange(idx, e.target.value, enrollPinDigits, setEnrollPinDigits, enrollInputsRef)}
                        onKeyDown={(e) => handleKeyDown(idx, e, enrollPinDigits, enrollInputsRef)}
                        onPaste={(e) => handlePaste(e, setEnrollPinDigits, enrollInputsRef)}
                        placeholder="0"
                        className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 rounded-xl focus:border-[#1865E8] focus:bg-white dark:focus:bg-slate-800 text-slate-800 dark:text-white outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    ))}
                  </div>
                </div>

                {/* Confirm your Z-PIN */}
                <div>
                  <label className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 block">
                    Confirm your Z-PIN
                  </label>
                  <div className="flex items-center gap-3 sm:gap-4">
                    {[0, 1, 2, 3].map((idx) => (
                      <input
                        key={`confirm-${idx}`}
                        ref={(el) => { confirmInputsRef.current[idx] = el; }}
                        type="password"
                        inputMode="numeric"
                        maxLength={1}
                        value={confirmPinDigits[idx]}
                        onChange={(e) => handleDigitChange(idx, e.target.value, confirmPinDigits, setConfirmPinDigits, confirmInputsRef)}
                        onKeyDown={(e) => handleKeyDown(idx, e, confirmPinDigits, confirmInputsRef)}
                        onPaste={(e) => handlePaste(e, setConfirmPinDigits, confirmInputsRef)}
                        placeholder="0"
                        className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 rounded-xl focus:border-[#1865E8] focus:bg-white dark:focus:bg-slate-800 text-slate-800 dark:text-white outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || enrollPinDigits.join('').length !== 4 || confirmPinDigits.join('').length !== 4}
                  className="w-full py-3.5 bg-[#1865E8] hover:bg-[#1357CE] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer disabled:opacity-50 mt-8"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <span>Authorizing Device & PIN...</span>
                    </>
                  ) : (
                    <span>Complete your Setup &gt;</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 4. Verification Mode (Entering 4-Digit Z-PIN from Unrecognized Browser)
  if (requiresVerification) {
    return (
      <div className="min-h-screen bg-[#F0F2F6] dark:bg-slate-950 flex items-center justify-center p-4 sm:p-8 font-sans transition-colors">
        <div className="w-full max-w-[1040px] rounded-[32px] p-5 sm:p-7 shadow-2xl bg-gradient-to-br from-[#00967A] via-[#028090] to-[#1660E8]">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch min-h-[500px]">
            {/* Left Column: Heading "Your account, **protected.**" */}
            <div className="md:col-span-5 flex flex-col justify-between py-6 px-4 sm:px-6 text-left">
              <div>
                <h1 className="text-white text-2xl sm:text-3xl font-medium tracking-tight">
                  Your account,
                </h1>
                <h2 className="text-white text-3xl sm:text-4xl font-extrabold tracking-tight mt-0.5">
                  protected.
                </h2>
                <p className="text-white/85 text-xs sm:text-sm mt-4 font-normal leading-relaxed max-w-xs">
                  Please enter your 4-digit Z-PIN for securing your account for login from unknown devices
                </p>
              </div>

              <div className="mt-8">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="text-white/90 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer underline transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>

            {/* Right Column: White Inner Card for PIN Entry */}
            <div className="md:col-span-7 bg-white dark:bg-slate-900 rounded-[24px] p-6 sm:p-10 flex flex-col justify-between shadow-sm min-h-[460px] text-left transition-colors">
              {cooldownSeconds > 0 ? (
                <div className="p-3.5 mb-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-start gap-2">
                  <Lock className="w-4 h-4 mr-1 shrink-0 mt-0.5 text-rose-500" />
                  <div>
                    <p className="font-bold">Verification Temporarily Locked</p>
                    <p className="mt-0.5">
                      Too many failed attempts. Try again in{' '}
                      <span className="font-mono font-bold">{cooldownSeconds}s</span>.
                    </p>
                  </div>
                </div>
              ) : errorMessage ? (
                <div className="p-3 mb-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 text-xs rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  <span>{errorMessage}</span>
                </div>
              ) : null}

              <form onSubmit={handleVerifySubmit} className="space-y-8 my-auto">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Enter your 4-Digit Z-PIN
                    </label>
                    {rateLimit && cooldownSeconds === 0 && (
                      <span className="text-[11px] text-slate-400 font-medium">
                        {rateLimit.remainingAttempts} attempts remaining
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4">
                    {[0, 1, 2, 3].map((idx) => (
                      <input
                        key={`verify-pin-${idx}`}
                        ref={(el) => { digitInputsRef.current[idx] = el; }}
                        type="password"
                        inputMode="numeric"
                        maxLength={1}
                        disabled={cooldownSeconds > 0 || isSubmitting}
                        value={pinDigits[idx]}
                        onChange={(e) => handleDigitChange(idx, e.target.value, pinDigits, setPinDigits, digitInputsRef)}
                        onKeyDown={(e) => handleKeyDown(idx, e, pinDigits, digitInputsRef)}
                        onPaste={(e) => handlePaste(e, setPinDigits, digitInputsRef)}
                        placeholder="0"
                        className="w-12 h-12 sm:w-14 sm:h-14 text-center text-lg sm:text-xl font-bold bg-[#F4F5F7] dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 rounded-xl focus:border-[#1865E8] focus:bg-white dark:focus:bg-slate-800 text-slate-800 dark:text-white outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 disabled:opacity-50"
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || cooldownSeconds > 0 || pinDigits.join('').length !== 4}
                  className="w-full py-3.5 bg-[#1865E8] hover:bg-[#1357CE] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer disabled:opacity-50 mt-8"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <span>Verifying Z-PIN...</span>
                    </>
                  ) : cooldownSeconds > 0 ? (
                    <span>Locked ({cooldownSeconds}s)</span>
                  ) : (
                    <span>Verify &amp; Continue &gt;</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback: If neither enrollment nor verification is required, render children
  return <>{children}</>;
};
