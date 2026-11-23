import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { PlanPaywall } from './payments/PlanPaywall';
import { CLIMA_EASE } from './SpotlightCard';
import type { WompiPurchaseResponse } from '../types';

export interface AddTimeModalProps {
  open: boolean;
  deviceId?: string;
  getAuthToken: () => Promise<string>;
  onClose: () => void;
  onPaymentCompleted: (result: WompiPurchaseResponse) => void;
}

export function AddTimeModal({
  open,
  deviceId,
  getAuthToken,
  onClose,
  onPaymentCompleted,
}: AddTimeModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Añadir tiempo de aire acondicionado"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: CLIMA_EASE }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/30 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.3, ease: CLIMA_EASE }}
            className="alabaster-card w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] bg-white/95"
          >
            <div className="sm:hidden pt-3 pb-1 flex justify-center" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-slate-300/80" />
            </div>

            <div
              className="px-6 py-4 flex items-center justify-between gap-4"
              style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.06)' }}
            >
              <div>
                <h2 className="text-base font-bold tracking-tight text-[#0F172A]">
                  Añadir más tiempo
                </h2>
                <p className="text-xs text-slate-500">
                  Los segundos del plan se suman a tu saldo disponible
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="w-10 h-10 rounded-full text-slate-500 hover:text-[#0F172A] hover:bg-slate-100/80 flex items-center justify-center transition-transform duration-150 ease-clima active:scale-95 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <PlanPaywall
                isModal
                deviceId={deviceId}
                getAuthToken={getAuthToken}
                onPaymentCompleted={(result) => {
                  onClose();
                  onPaymentCompleted(result);
                }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
