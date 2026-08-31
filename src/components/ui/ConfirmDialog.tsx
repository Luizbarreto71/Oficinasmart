import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/Field';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  /** Pede um motivo antes de confirmar (usado em exclusões e cancelamentos). */
  askReason?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  tone = 'danger',
  loading,
  askReason,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => onConfirm(askReason ? reason.trim() || undefined : undefined)}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <div>{message}</div>
        {askReason && (
          <Input
            placeholder="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        )}
      </div>
    </Modal>
  );
}
