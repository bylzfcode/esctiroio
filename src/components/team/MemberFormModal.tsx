import { useEffect, useState, type FormEvent } from 'react';
import { fullPermissions, hasPermission, intersectPermissions, normalizePermissions } from '@/domain/permissions';
import { ROLE_LABEL } from '@/domain/modules';
import type { PermissionSet, StoreRole } from '@/domain/types';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { services } from '@/services';
import { ServiceError, errorMessage } from '@/services/errors';
import type { TeamMemberRow } from '@/services/types';
import { Button } from '../ui/Button';
import { SelectField, TextField, Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/StateViews';
import { PermissionMatrix } from './PermissionMatrix';

interface Props {
  open: boolean;
  /** Linha editada; ausente = novo cadastro. */
  member: TeamMemberRow | null;
  storeId: string;
  storeName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function MemberFormModal({ open, member, storeId, storeName, onClose, onSaved }: Props) {
  const { actor, access } = useSession();
  const toast = useToast();
  const isEdit = !!member;
  const isAdmin = access.role === 'admin_geral';

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<StoreRole>('funcionario');
  const [permissions, setPermissions] = useState<PermissionSet>({});
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Reinicia o formulário sempre que for aberto.
  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    setSaving(false);
    if (member) {
      setEmail(member.person.email);
      setName(member.person.name);
      setJobTitle(member.membership.jobTitle);
      setRole(member.membership.role);
      setPermissions(member.membership.permissions);
    } else {
      setEmail('');
      setName('');
      setJobTitle('');
      setRole('funcionario');
      setPermissions(hasPermission(access.permissions, 'overview', 'view') ? { overview: ['view'] } : {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member]);

  const changeRole = (next: StoreRole) => {
    setRole(next);
    if (!isEdit) {
      // Novo responsável começa com tudo que quem cadastra pode conceder; funcionário volta ao mínimo.
      setPermissions(
        next === 'responsavel'
          ? normalizePermissions(intersectPermissions(fullPermissions('responsavel'), access.permissions), 'responsavel')
          : normalizePermissions(permissions, 'funcionario'),
      );
    } else {
      setPermissions((p) => normalizePermissions(p, next));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      if (member) {
        await services.team.updateMember(actor, member.membership.id, {
          jobTitle,
          role,
          permissions,
          name: isAdmin ? name : undefined,
        });
        toast.success(`Vínculo de ${member.person.name} atualizado.`);
      } else {
        await services.team.createMember(actor, storeId, { email, name, jobTitle, role, permissions });
        // Mensagem única: não revelamos se a pessoa já tinha conta em outra loja.
        toast.success(
          `Vínculo com a ${storeName} criado. Se a pessoa ainda não tiver conta, ela receberá um convite por e-mail.`,
        );
      }
      onSaved();
    } catch (err) {
      if (err instanceof ServiceError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      setFormError(errorMessage(err));
      setSaving(false);
    }
  };

  const title = isEdit ? `Editar vínculo: ${member?.person.name}` : isAdmin ? 'Nova pessoa na loja' : 'Novo funcionário';

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      title={title}
      description={`Vínculo com a ${storeName}. Perfil, cargo e permissões valem apenas para esta loja.`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="form-membro" loading={saving}>
            {isEdit ? 'Salvar alterações' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form id="form-membro" onSubmit={submit} noValidate className="space-y-5">
        {formError && <Notice tone="danger">{formError}</Notice>}

        <section className="space-y-4" aria-label="Conta da pessoa">
          <h3 className="text-sm font-semibold text-ink">Conta da pessoa</h3>
          <TextField
            label="E-mail"
            type="email"
            autoComplete="off"
            required
            value={email}
            readOnly={isEdit}
            disabled={isEdit}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            hint={
              isEdit
                ? 'O e-mail identifica a conta e não muda por aqui.'
                : 'Se a pessoa já tiver conta, ela será reaproveitada; senão, receberá um convite por e-mail.'
            }
          />
          <TextField
            label="Nome completo"
            required
            value={name}
            readOnly={isEdit && !isAdmin}
            disabled={isEdit && !isAdmin}
            onChange={(e) => setName(e.target.value)}
            error={fieldErrors.name}
            hint={
              isEdit
                ? isAdmin
                  ? 'A conta é compartilhada entre lojas: alterar o nome vale para todas.'
                  : 'A conta é compartilhada entre lojas; só o administrador geral altera estes dados.'
                : 'Usado apenas se a pessoa ainda não tiver conta. Em contas existentes, o nome cadastrado é mantido.'
            }
          />
        </section>

        <section className="space-y-4" aria-label="Vínculo com a loja">
          <h3 className="text-sm font-semibold text-ink">Vínculo com a {storeName}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Cargo ou função"
              value={jobTitle}
              maxLength={60}
              onChange={(e) => setJobTitle(e.target.value)}
              error={fieldErrors.jobTitle}
              hint="Opcional. Ex.: Caixa, Estoquista."
            />
            {isAdmin ? (
              <SelectField label="Perfil nesta loja" value={role} onChange={(e) => changeRole(e.target.value as StoreRole)} error={fieldErrors.role}>
                <option value="funcionario">{ROLE_LABEL.funcionario}</option>
                <option value="responsavel">{ROLE_LABEL.responsavel}</option>
              </SelectField>
            ) : (
              <Field label="Perfil nesta loja" hint="Somente o administrador geral concede o papel de responsável.">
                {({ id }) => <input id={id} className="input" value={ROLE_LABEL.funcionario} disabled readOnly />}
              </Field>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-[13px] font-medium text-ink">Permissões por módulo</h4>
            <PermissionMatrix value={permissions} onChange={setPermissions} role={role} actorPermissions={access.permissions} disabled={saving} />
            {fieldErrors.permissions && <p className="mt-2 text-xs font-medium text-danger">{fieldErrors.permissions}</p>}
          </div>
        </section>
      </form>
    </Modal>
  );
}
