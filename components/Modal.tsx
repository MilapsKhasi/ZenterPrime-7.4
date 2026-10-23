
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
  preventBackdropClose?: boolean;
  skipEscWarning?: boolean;
}

// Global Modal Stack Management
const modalStack: string[] = [];

export function registerModal(id: string) {
  const index = modalStack.indexOf(id);
  if (index !== -1) {
    modalStack.splice(index, 1);
  }
  modalStack.push(id);
}

export function unregisterModal(id: string) {
  const index = modalStack.indexOf(id);
  if (index !== -1) {
    modalStack.splice(index, 1);
  }
}

export function isTopModal(id: string): boolean {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === id;
}

const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  maxWidth = 'max-w-5xl',
  preventBackdropClose = true,
  skipEscWarning = false
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const modalIdRef = useRef<string>('');
  if (!modalIdRef.current) {
    modalIdRef.current = 'modal_' + Math.random().toString(36).substring(2, 9);
  }
  const modalId = modalIdRef.current;

  const hasFocusedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [showCloseWarning, setShowCloseWarning] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      registerModal(modalId);
      return () => {
        unregisterModal(modalId);
      };
    } else {
      unregisterModal(modalId);
    }
  }, [isOpen, modalId]);

  useEffect(() => {
    if (!isOpen) {
      setShowCloseWarning(false);
    }
  }, [isOpen]);

  const handleCloseAttempt = () => {
    if (skipEscWarning) {
      onCloseRef.current();
    } else {
      setShowCloseWarning(true);
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      
      const handleKeyDown = (e: KeyboardEvent) => {
        if (!isTopModal(modalId)) return;
        if (showCloseWarning) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          handleCloseAttempt();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          e.stopPropagation();
          if (modalRef.current) {
            const form = modalRef.current.querySelector('form');
            if (form) {
              if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
              } else {
                const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
                if (submitBtn) submitBtn.click();
                else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
            } else {
              const primaryBtn = modalRef.current.querySelector('button[type="submit"], button.bg-primary') as HTMLButtonElement | null;
              if (primaryBtn) primaryBtn.click();
            }
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      // Auto focus once when modal opens
      let timer: NodeJS.Timeout | null = null;
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        timer = setTimeout(() => {
          if (modalRef.current) {
            const focusableInputs = modalRef.current.querySelectorAll<
              HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
            >('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');

            if (focusableInputs.length > 0) {
              const firstInput = focusableInputs[0];
              firstInput.focus();
            } else {
              const focusableBtns = modalRef.current.querySelectorAll<HTMLButtonElement>(
                'button:not([disabled]):not([aria-label="Close"])'
              );
              if (focusableBtns.length > 0) {
                focusableBtns[0].focus();
              }
            }
          }
        }, 50);
      }

      return () => {
        document.body.style.overflow = 'unset';
        window.removeEventListener('keydown', handleKeyDown);
        if (timer) clearTimeout(timer);
      };
    } else {
      hasFocusedRef.current = false;
    }
  }, [isOpen, showCloseWarning, skipEscWarning, modalId]);

  // Handle keyboard shortcuts (Y / N / Esc) when warning confirmation is active
  useEffect(() => {
    if (!showCloseWarning) return;

    const handleWarningKeyDown = (e: KeyboardEvent) => {
      if (!isTopModal(modalId)) return;

      const key = e.key.toLowerCase();
      if (key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setShowCloseWarning(false);
        onCloseRef.current();
      } else if (key === 'n' || key === 'escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setShowCloseWarning(false);
      }
    };

    window.addEventListener('keydown', handleWarningKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleWarningKeyDown, { capture: true });
    };
  }, [showCloseWarning, modalId]);

  if (!isOpen) return null;

  const stackIndex = Math.max(0, modalStack.indexOf(modalId));
  const baseZIndex = 1000 + stackIndex * 20;
  const warningZIndex = baseZIndex + 10;

  return createPortal(
    <div 
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: baseZIndex }}
    >
      {/* Backdrop - Outside clicks strictly disabled */}
      <div 
        className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80" 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }} 
      />
      <div 
        ref={modalRef}
        className={`relative bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 w-full ${maxWidth} flex flex-col overflow-hidden max-h-[90vh] z-10`}
      >
        <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 shrink-0 border-b border-slate-200 dark:border-slate-800 z-10">
          <h3 
            style={{ fontFamily: 'Ubuntu', fontWeight: 'normal', lineHeight: '30px' }}
            className="text-[18px] font-normal text-slate-900 dark:text-slate-100 capitalize"
          >
            {title}
          </h3>
          <button 
            type="button" 
            aria-label="Close"
            onClick={handleCloseAttempt} 
            className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-none cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 custom-scrollbar">
          {children}
        </div>
      </div>

      {/* Draft Loss Confirmation Warning Dialog */}
      {showCloseWarning && (
        <div 
          className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/70"
          style={{ zIndex: warningZIndex }}
        >
          <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 p-6 max-w-md w-full flex flex-col items-center text-center">
            <div className="p-3 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 mb-4">
              <AlertTriangle className="w-8 h-8" />
            </div>
            
            <h4 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
              Confirm Close Form
            </h4>
            
            <p className="text-xs text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
              Are you sure you want to close this form? You will not be able to see the entered draft data by reopening this form.
            </p>

            <div className="flex items-center justify-center gap-3 w-full">
              <button
                type="button"
                onClick={() => setShowCloseWarning(false)}
                className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold uppercase text-[11px] tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>No</span>
                <span className="text-[9px] bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-slate-500 dark:text-slate-400">(N)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowCloseWarning(false);
                  onCloseRef.current();
                }}
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold uppercase text-[11px] tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Yes</span>
                <span className="text-[9px] bg-rose-700 px-1.5 py-0.5 text-rose-100">(Y)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default Modal;
