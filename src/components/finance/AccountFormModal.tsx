import { useEffect, useRef, useState, type FormEvent } from 'react';
import { centsToInput, parseBRL } from '@/lib/money';
import { addDaysISO, isISODate, todaySP } from '@/lib/dates';
import { useToast } from '@/context/ToastContext';
import { services } from '@/services';
import { ServiceError, errorMessage } from '@/services/errors';
import type { FinanceAccountDetail, FinanceKind } from '@/services/types';
import { Button } from '../ui/Button';
import { Field, SelectField, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/StateViews';
import { KIND_LABEL } from './common';

interface Props {
  open: boolean;
  storeId: string;
  storeName: string;
  /** Presente = edição. */
  account?: FinanceAccountDetail['account'] | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export function AccountFormModal({ open, storeId, storeName, account, onClose, onSaved }: Props) {
  const toast = useToast();
  const editing = !!account;
  const [kind, setKind] = useState<FinanceKind>('payable');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [amount, setAmount] = useState('');
  const [competence, setCompetence] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const idemKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    const t = todaySP();
    setKind(account?.kind ?? 'payable');
    setDescription(account?.description ?? '');
    setCategory(account?.category ?? '');
    setCounterparty(account?.counterparty ?? '');
    setAmount(account ? centsToInput(account.amountCents) : '');
    setCompetence(account?.competenceDate ?? t);
    setDue(account?.dueDate ?? addDaysISO(t, 7));
    setNotes(account?.notes ?? '');
    setErrors({});
    setFormError(null);
    setSaving(false);
    submitting.current = false;
    idemKey.current = crypto.randomUUID();
  }, [open, account]);

  // Qualquer alteração é uma nova intenção: nova chave de idempotência (repetir SEM alterar reaproveita a chave).
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    idemKey.current = crypto.randomUUID();
    set(v);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current || !services.finance) return; // clique duplo
    const next: Record<string, string> = {};
    const cents = parseBRL(amount);
    if (description.trim().length < 2) next.description = 'Informe a descrição.';
    if (cents === null) next.amountCents = 'Informe um valor maior que zero, por exemplo 1.234,56.';
    if (!isISODate(competence)) next.competenceDate = 'Informe a data de competência.';
    if (!isISODate(due)) next.dueDate = 'Informe o vencimento.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    submitting.current = true;
    setSaving(true);
    try {
      const input = { description, category, counterparty, amountCents: cents!, competenceDate: competence, dueDate: due, notes };
      let id: string;
      if (account) {
        await services.finance.updateAccount(account.id, input);
        id = account.id;
        toast.success('Conta atualizada.');
      } else {
        id = await services.finance.createAccount(storeId, { ...input, kind, idempotencyKey: idemKey.current });
        toast.success('Conta criada.');
      }
      onSaved(id);
    } catch (err) {
      if (err instanceof ServiceError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
      setSaving(false);
      submitting.current = false;
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      title={editing ? 'Editar conta' : 'Nova conta'}
      description={`${storeName} · moeda BRL. A conta pertence somente a esta loja.`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" type="submit" form="form-conta" loading={saving}>{editing ? 'Salvar alterações' : 'Criar conta'}</Button>
        </>
      }
    >
      <form id="form-conta" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Tipo" required value={kind} disabled={editing} onChange={(e) => touch(setKind)(e.target.value as FinanceKind)} hint={editing ? 'O tipo não muda depois de criada.' : undefined} error={errors.kind}>
            <option value="payable">{KIND_LABEL.payable}</option>
            <option value="receivable">{KIND_LABEL.receivable}</option>
          </SelectField>
          <TextField label="Valor (R$)" required inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => touch(setAmount)(e.target.value)} error={errors.amountCents} hint={account && account.settledCents > 0 ? 'Não pode ser menor que o total já liquidado.' : undefined} />
        </div>
        <TextField label="Descrição" required maxLength={200} value={description} onChange={(e) => touch(setDescription)(e.target.value)} error={errors.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Categoria" maxLength={80} value={category} onChange={(e) => touch(setCategory)(e.target.value)} error={errors.category} hint="Opcional. Ex.: Aluguel, Fornecedores." />
          <TextField label={kind === 'payable' ? 'Fornecedor / credor' : 'Cliente / devedor'} maxLength={120} value={counterparty} onChange={(e) => touch(setCounterparty)(e.target.value)} error={errors.counterparty} hint="Contraparte. Opcional." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Data de competência" required type="date" value={competence} onChange={(e) => touch(setCompetence)(e.target.value)} error={errors.competenceDate} hint="Mês a que a conta se refere." />
          <TextField label="Vencimento" required type="date" value={due} onChange={(e) => touch(setDue)(e.target.value)} error={errors.dueDate} />
        </div>
        <Field label="Observações" error={errors.notes}>
          {({ id, describedBy, invalid }) => (
            <textarea id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={`input min-h-[80px] ${invalid ? 'input-error' : ''}`} maxLength={1000} value={notes} onChange={(e) => touch(setNotes)(e.target.value)} />
          )}
        </Field>
      </form>
    </Modal>
  );
}
