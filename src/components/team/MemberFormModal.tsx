import { useEffect, useState, type FormEvent } from 'react';
import { fullPermissions, hasPermission, intersectPermissions, normalizePermissions } from '@/domain/permissions';
import { ROLE_LABEL } from '@/domain/modules';
import type { PermissionSet, StoreRole } from '@/domain/types';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { services } from '@/services';
import { ServiceError, errorMessage } from '@/services/errors';
import type { AccountLookup, TeamMemberRow } from '@/services/types';
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [lookup, setLookup] = useState<AccountLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Reinicia o formulário sempre que for aberto.
  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    setLookup(null);
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

  const checkEmail = async () => {
    if (isEdit || !actor) return;
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setLookup(null);
      return;
    }
    setChecking(true);
    try {
      setLookup(await services.team.lookupAccount(actor, storeId, value));
    } catch (err) {
      setLookup(null);
      setFormError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

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

  const blockingLookup =
    !isEdit && lookup?.exists && (lookup.isGeneralAdmin || lookup.linkStatus !== undefined);
  const newAccount = !isEdit && lookup !== null && !lookup.exists;

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
        await services.team.createMember(actor, storeId, { email, name: lookup?.exists ? undefined : name, jobTitle, role, permissions });
        toast.success(
          lookup?.exists
            ? `${lookup.name} foi vinculado(a) à ${storeName}. A conta já existente foi reaproveitada.`
            : `Cadastro concluído: ${name.trim()} agora tem acesso à ${storeName}.`,
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
          <Button variant="primary" type="submit" form="form-membro" loading={saving} disabled={!!blockingLookup || checking}>
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
            onChange={(e) => {
              setEmail(e.target.value);
              setLookup(null);
            }}
            onBlur={checkEmail}
            error={fieldErrors.email}
            hint={isEdit ? 'O e-mail identifica a conta e não muda por aqui.' : 'Se a pessoa já tiver conta, ela será reaproveitada.'}
          />

          {checking && <p className="text-xs text-mute">Verificando se já existe uma conta com este e-mail…</p>}
          {!isEdit && lookup?.exists && !blockingLookup && (
            <Notice>
              Conta existente de <strong>{lookup.name}</strong>. Será criado apenas o vínculo com a {storeName}; os dados da
              conta e os vínculos com outras lojas não são alterados.
            </Notice>
          )}
          {!isEdit && lookup?.exists && lookup.isGeneralAdmin && (
            <Notice tone="danger">Administradores gerais já acessam todas as lojas e não precisam de vínculo.</Notice>
          )}
          {!isEdit && lookup?.exists && !lookup.isGeneralAdmin && lookup.linkStatus === 'ativo' && (
            <Notice tone="danger">{lookup.name} já está vinculado(a) a esta loja.</Notice>
          )}
          {!isEdit && lookup?.exists && !lookup.isGeneralAdmin && lookup.linkStatus === 'inativo' && (
            <Notice tone="warn">
              {lookup.name} tem um vínculo desativado nesta loja. Feche esta janela e use “Reativar” na lista de inativos para
              preservar o histórico e as permissões.
            </Notice>
          )}

          {(newAccount || isEdit) && (
            <TextField
              label="Nome completo"
              required
              value={name}
              readOnly={isEdit && !isAdmin}
              disabled={isEdit && !isAdmin}
              onChange={(e) => setName(e.target.value)}
              error={fieldErrors.name}
              hint={
                isEdit && !isAdmin
                  ? 'A conta é compartilhada entre lojas; só o administrador geral altera estes dados.'
                  : newAccount
                    ? 'Nenhuma conta encontrada: uma nova conta será criada.'
                    : undefined
              }
            />
          )}
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
              <SelectField label="Perfil nesta loja" value={role} onChange={(e) => changeRole(e.target.value as StoreRole)}>
                <option value="funcionario">{ROLE_LABEL.funcionario}</option>
                <option value="responsavel">{ROLE_LABEL.responsavel}</option>
              </SelectField>
            ) : (
              <Field label="Perfil nesta loja" hint="Responsáveis só gerenciam funcionários.">
                {({ id }) => (
                  <input id={id} className="input" value={ROLE_LABEL.funcionario} disabled readOnly />
                )}
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
