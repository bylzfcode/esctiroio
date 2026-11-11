import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/StateViews';

/** Pede um motivo (obrigatório) antes de uma ação irreversível, como estorno ou cancelamento. */
export function ReasonDialog({
  open, title, description, confirmLabel, label = 'Motivo', optional, busy, error, onCancel, onConfirm,
}: {
  open: boolean; title: string; description: string; confirmLabel: string; label?: string; optional?: boolean;
  busy?: boolean; error?: string | null; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const tooShort = !optional && reason.trim().length < 3;
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button
            variant={optional ? 'primary' : 'danger'}
            loading={busy}
            onClick={() => (tooShort ? setTouched(true) : onConfirm(reason.trim()))}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-mute">{description}</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label={label} required={!optional} error={touched && tooShort ? 'Informe ao menos 3 caracteres.' : undefined}>
          {({ id, describedBy, invalid }) => (
            <textarea id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={`input min-h-[88px] ${invalid ? 'input-error' : ''}`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  );
}
