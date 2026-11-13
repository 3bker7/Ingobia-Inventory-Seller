import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  isDestructive = false,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="sm">
      <div className="flex gap-4 items-start mb-6">
        <div
          className={`p-2.5 rounded-lg shrink-0 ${
            isDestructive
              ? 'bg-rose-50 text-[#DC5555]'
              : 'bg-amber-50 text-[#D99A27]'
          }`}
        >
          <AlertTriangle className="w-5 h-5" />
        </div>
        <p className="text-sm text-[#64748B] leading-relaxed pt-1">
          {description}
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8ECF2]">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-[#64748B] hover:text-[#172033] bg-[#F7F8FA] hover:bg-slate-200/60 rounded-lg transition-colors"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
            isDestructive
              ? 'bg-[#DC5555] hover:bg-rose-700'
              : 'bg-[#2563EB] hover:bg-blue-700'
          }`}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
