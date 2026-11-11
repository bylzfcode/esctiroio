import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatBRL, centsToInput, parseBRL } from '@/lib/money';
import { RECEIPT_ACCEPT, validateReceiptFile } from '@/lib/receipt';
import { isISODate, todaySP } from '@/lib/dates';
import { useToast } from '@/context/ToastContext';
import { services } from '@/services';
import { ReceiptUploadError, ServiceError, errorMessage } from '@/services';
import type { FinanceAccountDetail, PaymentMethod } from '@/services/types';
import { Button } from '../ui/Button';
import { Field, SelectField, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/StateViews';
import { METHODS, METHOD_LABEL, SETTLE_VERB } from './common';

interface Props {
  open: boolean;
  account: FinanceAccountDetail['account'];
  onClose: () => void;
  /** Chamado assim que o pagamento está salvo (mesmo que o comprovante ainda falte). */
  onSaved: () => void;
}

/**
 * Confirmar pagamento/recebimento (total ou parcial).
 *  - A chave de idempotência nasce a cada nova intenção; clique duplo ou reenvio SEM alterar nada reaproveita a
 *    chave, e o servidor devolve o mesmo pagamento (nunca duplica).
 *  - Se o upload do comprovante falhar DEPOIS de o pagamento ser salvo, o pagamento permanece e só o envio do arquivo
 *    pode ser repetido.
 */
export function PaymentModal({ open, account, onClose, onSaved }: Props) {
  const toast = useToast();
  const verb = SETTLE_VERB[account.kind];
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todaySP());
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Pagamento já salvo, comprovante pendente de nova tentativa.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const submitting = useRef(false);
  const idemKey = useRef(crypto.randomUUID());
  const today = todaySP();

  useEffect(() => {
    if (!open) return;
    setAmount(centsToInput(account.balanceCents));
    setPaidOn(todaySP());
    setMethod('pix');
    setNotes('');
    setFile(null);
    setFileError(null);
    setErrors({});
    setFormError(null);
    setSaving(false);
    setSavedId(null);
    setReceiptError(null);
    submitting.current = false;
    idemKey.current = crypto.randomUUID();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    idemKey.current = crypto.randomUUID(); // alterou os dados: é uma nova intenção
    set(v);
  };

  const pickFile = async (f: File | null) => {
    setFile(f);
    setFileError(null);
    if (f) {
      const { error } = await validateReceiptFile(f);
      if (error) setFileError(error);
    }
  };

  async function uploadReceipt(paymentId: string): Promise<boolean> {
    if (!file || !services.finance) return true;
    try {
      await services.finance.attachReceipt({ id: paymentId, storeId: account.storeId, accountId: account.id }, file);
      return true;
    } catch (err) {
      setReceiptError(err instanceof ReceiptUploadError ? err.message : errorMessage(err));
      return false;
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || !services.finance) return; // bloqueia clique duplo antes mesmo do estado atualizar
    const cents = parseBRL(amount);
    const next: Record<string, string> = {};
    if (cents === null) next.amountCents = 'Informe um valor maior que zero.';
    else if (cents > account.balanceCents) next.amountCents = `O valor excede o saldo pendente (${formatBRL(account.balanceCents)}).`;
    if (!isISODate(paidOn)) next.paidOn = 'Informe a data.';
    else if (paidOn > today) next.paidOn = 'A data não pode ser futura.';
    if (file && fileError) next.file = fileError;
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    submitting.current = true;
    setSaving(true);
    try {
      const id = await services.finance.confirmPayment(account.id, { amountCents: cents!, paidOn, method, notes, idempotencyKey: idemKey.current });
      setSavedId(id);
      onSaved();
      if (await uploadReceipt(id)) {
        if (file) onSaved(); // recarrega de novo: o comprovante só existe depois do upload
        toast.success(`${verb.noun} confirmado${file ? ' e comprovante anexado' : ''}.`);
        onClose();
        return;
      }
      toast.info(`${verb.noun} confirmado. O comprovante não foi anexado: tente novamente.`);
    } catch (err) {
      if (err instanceof ServiceError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
      submitting.current = false;
    }
    setSaving(false);
  };

  const retryReceipt = async () => {
    if (!savedId || saving) return;
    setSaving(true);
    setReceiptError(null);
    if (await uploadReceipt(savedId)) {
      toast.success('Comprovante anexado.');
      onSaved();
      onClose();
      return;
    }
    setSaving(false);
  };

  // Pagamento salvo, mas o comprovante falhou: só dá para tentar o arquivo de novo (nunca o pagamento).
  if (savedId) {
    return (
      <Modal open={open} onClose={onClose} busy={saving} title={`${verb.noun} confirmado`} description="O valor já foi registrado. Falta apenas o comprovante." footer={
        <>
          <Button onClick={onClose} disabled={saving}>Anexar depois</Button>
          <Button variant="primary" loading={saving} onClick={retryReceipt}>Tentar anexar novamente</Button>
        </>
      }>
        <div className="space-y-3">
          <Notice tone="warn">{receiptError ?? 'O comprovante não foi anexado.'}</Notice>
          <p className="text-sm text-mute">O {verb.noun.toLowerCase()} <strong className="text-ink">não será duplicado</strong>. Você também pode anexar o comprovante depois, na página da conta.</p>
          <Field label="Comprovante" error={fileError ?? undefined}>
            {({ id }) => <input id={id} type="file" accept={RECEIPT_ACCEPT} className="block w-full text-sm" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />}
          </Field>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title={verb.action}
      description={`${account.description} · saldo pendente ${formatBRL(account.balanceCents)}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" type="submit" form="form-pagamento" loading={saving}>{verb.action}</Button>
        </>
      }
    >
      <form id="form-pagamento" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Valor (R$)" required inputMode="decimal" value={amount} onChange={(e) => touch(setAmount)(e.target.value)} error={errors.amountCents} hint="Pode ser parcial; o saldo restante continua em aberto." />
          <TextField label={account.kind === 'payable' ? 'Data do pagamento' : 'Data do recebimento'} required type="date" max={today} value={paidOn} onChange={(e) => touch(setPaidOn)(e.target.value)} error={errors.paidOn} />
        </div>
        <SelectField label="Forma" required value={method} onChange={(e) => touch(setMethod)(e.target.value as PaymentMethod)} error={errors.method}>
          {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
        </SelectField>
        <Field label="Observação" error={errors.notes}>
          {({ id, describedBy, invalid }) => <textarea id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className="input min-h-[64px]" maxLength={500} value={notes} onChange={(e) => touch(setNotes)(e.target.value)} />}
        </Field>
        <Field label="Comprovante (opcional)" error={errors.file ?? fileError ?? undefined} hint="Imagem (JPG, PNG, WebP) ou PDF de até 5 MB. Anexar não confirma o envio do comprovante.">
          {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} type="file" accept={RECEIPT_ACCEPT} className="block w-full text-sm" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />}
        </Field>
      </form>
    </Modal>
  );
}
