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

  const checkStatus = useCallback(async () => {
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
        setIsCheckingDevice(false);
        setIsDeviceVerified(false);
        setDeviceVerifiedSession(false);
        setCurrentUserId(null);
        return;
      }

      setCurrentUserId(user.id);
      setIsCheckingDevice(true);

      const result = await checkDeviceAuthorization(user.id);

      if (result.rateLimit) {
        setRateLimit(result.rateLimit);
      }

      setIsPinEnrolled(result.pinEnrolled);

      if (result.deviceVerified) {
        setIsDeviceVerified(true);
        setDeviceVerifiedSession(true);
        const now = Date.now();
        setLastVerified(now);
        localStorage.setItem('device_last_verified', String(now));
        // Trigger safe workspace sync only now that device is verified
        syncUserWorkspaceDataToIndexedDB(user.id).catch(() => {});
      } else {
        setIsDeviceVerified(false);
        setDeviceVerifiedSession(false);
      }
    } catch (err) {
      console.error('[DeviceContext] Check status error:', err);
      setIsDeviceVerified(false);
      setDeviceVerifiedSession(false);
    } finally {
      setIsCheckingDevice(false);
    }
  }, []);

  const isDeviceVerifiedRef = React.useRef(isDeviceVerified);
  isDeviceVerifiedRef.current = isDeviceVerified;

  useEffect(() => {
    checkStatus();

    const { data: authListener } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      if (event === 'SIGNED_IN') {
        checkStatus();
      } else if (event === 'TOKEN_REFRESHED') {
        if (!isDeviceVerifiedRef.current) {
          checkStatus();
        }
      } else if (event === 'SIGNED_OUT') {
        setIsDeviceVerified(false);
        setDeviceVerifiedSession(false);
        setLastVerified(null);
        localStorage.removeItem('device_last_verified');
        setIsCheckingDevice(false);
        setCurrentUserId(null);
        setRateLimit(null);
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
        syncUserWorkspaceDataToIndexedDB(currentUserId).catch(() => {});
      }
      return { success: true };
    }

    return { success: false, error: res.error || 'Failed to enroll Z-PIN' };
  };

  const resetDeviceSession = () => {
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
