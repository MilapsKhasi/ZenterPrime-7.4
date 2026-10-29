import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase, setDeviceVerifiedSession, syncUserWorkspaceDataToIndexedDB } from '../lib/supabase';
import {
  checkDeviceAuthorization,
  verifyZPinWithServer,
  enrollZPinWithServer,
  RateLimitInfo,
  clearStoredBrowserVerificationKey
} from '../lib/deviceAuth';

interface DeviceVerificationContextType {
  isCheckingDevice: boolean;
  isDeviceVerified: boolean;
  isPinEnrolled: boolean;
  requiresVerification: boolean;
  requiresEnrollment: boolean;
  currentUserId: string | null;
  rateLimit: RateLimitInfo | null;
  lastVerified: number | null;
  verifyPin: (pin: string) => Promise<{ success: boolean; error?: string }>;
  enrollPin: (pin: string, confirmPin: string) => Promise<{ success: boolean; error?: string }>;
  refreshDeviceStatus: () => Promise<void>;
  resetDeviceSession: () => void;
}

const DeviceVerificationContext = createContext<DeviceVerificationContextType | undefined>(undefined);

export const DeviceVerificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isCheckingDevice, setIsCheckingDevice] = useState<boolean>(true);
  const [isDeviceVerified, setIsDeviceVerified] = useState<boolean>(false);
  const [isPinEnrolled, setIsPinEnrolled] = useState<boolean>(true);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [lastVerified, setLastVerified] = useState<number | null>(() => {
    if (typeof window !== 'undefined') {
      const val = localStorage.getItem('device_last_verified');
      return val ? Number(val) : null;
    }
    return null;
  });

  const isDeviceVerifiedRef = React.useRef(isDeviceVerified);
  isDeviceVerifiedRef.current = isDeviceVerified;

  const verifiedUserIdRef = React.useRef<string | null>(null);
  const inFlightCheckRef = React.useRef<Promise<void> | null>(null);

  const checkStatus = useCallback(async (force = false) => {
    // Prevent duplicate or concurrent verification requests
    if (inFlightCheckRef.current) {
      return inFlightCheckRef.current;
    }

    const checkPromise = (async () => {
      // If running in offline local mode, bypass cloud device check
      if (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true') {
        setIsDeviceVerified(true);
        setDeviceVerifiedSession(true);
        const now = Date.now();
        setLastVerified(now);
        localStorage.setItem('device_last_verified', String(now));
        setIsCheckingDevice(false);
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user;

        if (!user) {
          verifiedUserIdRef.current = null;
          setIsCheckingDevice(false);
          setIsDeviceVerified(false);
          setDeviceVerifiedSession(false);
          setCurrentUserId(null);
          return;
        }

        // Reuse verified state for ordinary tab switches / visibility re-checks within the same authenticated session
        if (!force && isDeviceVerifiedRef.current && verifiedUserIdRef.current === user.id) {
          setIsCheckingDevice(false);
          return;
        }

        setCurrentUserId(user.id);

        // Only show loading screen if the session is not yet verified
        if (!isDeviceVerifiedRef.current) {
          setIsCheckingDevice(true);
        }

        const result = await checkDeviceAuthorization(user.id);

        if (result.rateLimit) {
          setRateLimit(result.rateLimit);
        }

        setIsPinEnrolled(result.pinEnrolled);

        if (result.deviceVerified) {
          verifiedUserIdRef.current = user.id;
          setIsDeviceVerified(true);
          setDeviceVerifiedSession(true);
          const now = Date.now();
          setLastVerified(now);
          localStorage.setItem('device_last_verified', String(now));
          // Trigger safe workspace sync only now that device is verified
          syncUserWorkspaceDataToIndexedDB(user.id).catch(() => {});
        } else {
          verifiedUserIdRef.current = null;
          setIsDeviceVerified(false);
          setDeviceVerifiedSession(false);
          setLastVerified(null);
          localStorage.removeItem('device_last_verified');
        }
      } catch (err) {
        console.error('[DeviceContext] Check status error:', err);
        verifiedUserIdRef.current = null;
        setIsDeviceVerified(false);
        setDeviceVerifiedSession(false);
        setLastVerified(null);
        localStorage.removeItem('device_last_verified');
      } finally {
        setIsCheckingDevice(false);
        inFlightCheckRef.current = null;
      }
    })();

    inFlightCheckRef.current = checkPromise;
    return checkPromise;
  }, []);

  useEffect(() => {
    // Initial verification when application loads
    checkStatus(true);

    const { data: authListener } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      const sessionUserId = session?.user?.id || null;

      if (event === 'SIGNED_OUT' || !session?.user) {
        verifiedUserIdRef.current = null;
        setIsDeviceVerified(false);
        setDeviceVerifiedSession(false);
        setLastVerified(null);
        localStorage.removeItem('device_last_verified');
        setIsCheckingDevice(false);
        setCurrentUserId(null);
        setRateLimit(null);
        return;
      }

      if (event === 'SIGNED_IN') {
        // Only run device verification if the authenticated user has actually changed,
        // or if the session is not yet verified. Ordinary tab switches / tab reactivations
        // that re-emit SIGNED_IN for the existing verified user will reuse the verified state.
        const isSameUser = Boolean(verifiedUserIdRef.current && sessionUserId && verifiedUserIdRef.current === sessionUserId);
        if (!isDeviceVerifiedRef.current || !isSameUser) {
          checkStatus(true);
        }
      } else if (event === 'TOKEN_REFRESHED') {
        const isSameUser = Boolean(verifiedUserIdRef.current && sessionUserId && verifiedUserIdRef.current === sessionUserId);
        if (!isDeviceVerifiedRef.current || !isSameUser) {
          checkStatus(false);
        }
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [checkStatus]);

  const verifyPin = async (pin: string): Promise<{ success: boolean; error?: string }> => {
    const res = await verifyZPinWithServer(pin, currentUserId);

    if (res.verified) {
      setIsDeviceVerified(true);
      setDeviceVerifiedSession(true);
      const now = Date.now();
      setLastVerified(now);
      localStorage.setItem('device_last_verified', String(now));
      if (currentUserId) {
        verifiedUserIdRef.current = currentUserId;
        syncUserWorkspaceDataToIndexedDB(currentUserId).catch(() => {});
      }
      return { success: true };
    }

    if (res.locked) {
      setRateLimit({
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: res.retryAfterSeconds,
        lockedUntil: res.lockedUntil
      });
    } else if (typeof res.remainingAttempts === 'number') {
      setRateLimit(prev => ({
        allowed: res.remainingAttempts! > 0,
        remainingAttempts: res.remainingAttempts!,
        retryAfterSeconds: res.retryAfterSeconds,
        lockedUntil: res.lockedUntil
      }));
    }

    return { success: false, error: res.error || 'Verification failed' };
  };

  const enrollPin = async (pin: string, confirmPin: string): Promise<{ success: boolean; error?: string }> => {
    const res = await enrollZPinWithServer(pin, confirmPin, currentUserId);

    if (res.success) {
      setIsPinEnrolled(true);
      setIsDeviceVerified(true);
      setDeviceVerifiedSession(true);
      const now = Date.now();
      setLastVerified(now);
      localStorage.setItem('device_last_verified', String(now));
      if (currentUserId) {
        verifiedUserIdRef.current = currentUserId;
        syncUserWorkspaceDataToIndexedDB(currentUserId).catch(() => {});
      }
      return { success: true };
    }

    return { success: false, error: res.error || 'Failed to enroll Z-PIN' };
  };

  const resetDeviceSession = () => {
    verifiedUserIdRef.current = null;
    setIsDeviceVerified(false);
    setDeviceVerifiedSession(false);
    setLastVerified(null);
    localStorage.removeItem('device_last_verified');
    clearStoredBrowserVerificationKey().catch(() => {});
  };

  const requiresEnrollment = Boolean(currentUserId && !isCheckingDevice && !isPinEnrolled);
  const requiresVerification = Boolean(currentUserId && !isCheckingDevice && isPinEnrolled && !isDeviceVerified);

  return (
    <DeviceVerificationContext.Provider
      value={{
        isCheckingDevice,
        isDeviceVerified,
        isPinEnrolled,
        requiresVerification,
        requiresEnrollment,
        currentUserId,
        rateLimit,
        lastVerified,
        verifyPin,
        enrollPin,
        refreshDeviceStatus: checkStatus,
        resetDeviceSession
      }}
    >
      {children}
    </DeviceVerificationContext.Provider>
  );
};

export const useDeviceVerification = () => {
  const context = useContext(DeviceVerificationContext);
  if (!context) {
    throw new Error('useDeviceVerification must be used within a DeviceVerificationProvider');
  }
  return context;
};
