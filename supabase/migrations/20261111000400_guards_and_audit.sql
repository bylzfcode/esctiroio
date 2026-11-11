-- Etapa 2 · Invariantes no banco e auditoria.
-- Gatilhos valem para QUALQUER caminho de escrita (RPC, serviço, SQL), na mesma transação
-- da alteração: se a auditoria falhar, a alteração é desfeita.

-- ---------------------------------------------------------------------------
-- Contas nascem inativas a partir de auth.users (convite/bootstrap ativam depois)
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null then return new; end if;
  insert into public.profiles (id, email, full_name, active)
  values (new.id, lower(btrim(new.email)),
          left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), false)
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.profiles set email = lower(btrim(new.email)) where id = new.id;
  end if;
  return new;
end
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Imutabilidade e carimbo de atualização
-- ---------------------------------------------------------------------------
create function private.protect_membership() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.person_id <> old.person_id or new.store_id <> old.store_id then
    raise exception 'Pessoa e loja de um vínculo não podem ser alteradas.' using errcode = 'PT403';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger memberships_protect
  before update on public.memberships
  for each row execute function private.protect_membership();

create function private.protect_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id then
    raise exception 'O identificador da conta não pode ser alterado.' using errcode = 'PT403';
  end if;
  -- A primeira ativação é registrada uma única vez.
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception 'A data de ativação da conta não pode ser alterada.' using errcode = 'PT403';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_protect
  before update on public.profiles
  for each row execute function private.protect_profile();

-- ---------------------------------------------------------------------------
-- Nunca remover/desativar o último administrador geral ativo
-- ---------------------------------------------------------------------------
create function private.guard_last_general_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_general_admin and old.active
     and (tg_op = 'DELETE' or not new.is_general_admin or not new.active) then
    -- Serializa operações concorrentes: dois administradores não se removem ao mesmo tempo.
    perform pg_advisory_xact_lock(7710001);
    if not exists (
      select 1 from public.profiles p
      where p.id <> old.id and p.is_general_admin and p.active
    ) then
      raise exception 'Não é possível remover ou desativar o último administrador geral ativo.'
        using errcode = 'PT409';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger profiles_guard_last_admin
  before update of is_general_admin, active or delete on public.profiles
  for each row execute function private.guard_last_general_admin();

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
-- Escrita central. Ator = usuário do JWT; sem usuário (serviço), usa app.actor_id definido
-- por funções restritas ao service_role (ex.: activate_profile), ou registra "Sistema".
create function private.audit_write(
  p_store uuid, p_action text, p_target uuid, p_summary text, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
  v_actor_name text := 'Sistema';
  v_store_name text;
  v_target_name text;
begin
  if v_actor is not null then
    select coalesce(nullif(p.full_name, ''), p.email) into v_actor_name from public.profiles p where p.id = v_actor;
    v_actor_name := coalesce(v_actor_name, 'Conta removida');
  end if;
  if p_store is not null then select s.name into v_store_name from public.stores s where s.id = p_store; end if;
  if p_target is not null then
    select coalesce(nullif(p.full_name, ''), p.email) into v_target_name from public.profiles p where p.id = p_target;
  end if;
  insert into public.audit_log (actor_id, actor_name, store_id, store_name, action,
                                target_person_id, target_person_name, summary, details)
  values (v_actor, v_actor_name, p_store, v_store_name, p_action,
          p_target, v_target_name, p_summary, coalesce(p_details, '{}'::jsonb));
end
$$;

create function private.audit_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text; v_store text; v_parts text[] := '{}'; v_text text; v_diff text;
  v_role_label text;
begin
  select coalesce(nullif(p.full_name, ''), p.email) into v_name from public.profiles p where p.id = new.person_id;
  select s.name into v_store from public.stores s where s.id = new.store_id;

  if tg_op = 'INSERT' then
    v_role_label := case new.role when 'responsavel' then 'responsável' else 'funcionário' end;
    perform private.audit_write(new.store_id, 'vinculo_criado', new.person_id,
      format('Vínculo de %s com a %s criado como %s%s.', v_name, v_store, v_role_label,
             case when new.job_title <> '' then ' (' || new.job_title || ')' else '' end),
      jsonb_build_object('after', jsonb_build_object('role', new.role, 'job_title', new.job_title,
                                                      'permissions', new.permissions)));
    return new;
  end if;

  if old.active <> new.active then
    perform private.audit_write(new.store_id,
      case when new.active then 'vinculo_reativado' else 'vinculo_desativado' end, new.person_id,
      format('Vínculo de %s com a %s %s.', v_name, v_store, case when new.active then 'reativado' else 'desativado' end));
  end if;

  if old.job_title is distinct from new.job_title then
    v_parts := v_parts || case when new.job_title <> '' then 'cargo alterado para ' || new.job_title else 'cargo removido' end;
  end if;
  if old.role <> new.role then
    v_parts := v_parts || ('perfil alterado para ' || case new.role when 'responsavel' then 'responsável' else 'funcionário' end);
  end if;
  if cardinality(v_parts) > 0 then
    v_text := array_to_string(v_parts, '; ');
    perform private.audit_write(new.store_id, 'vinculo_editado', new.person_id,
      upper(left(v_text, 1)) || substr(v_text, 2) || '.',
      jsonb_build_object('before', jsonb_build_object('role', old.role, 'job_title', old.job_title),
                         'after',  jsonb_build_object('role', new.role, 'job_title', new.job_title)));
  end if;

  if old.permissions is distinct from new.permissions then
    v_diff := private.permissions_diff_text(old.permissions, new.permissions);
    if v_diff is not null then
      perform private.audit_write(new.store_id, 'permissoes_alteradas', new.person_id, v_diff || '.',
        jsonb_build_object('before', old.permissions, 'after', new.permissions));
    end if;
  end if;
  return new;
end
$$;

create trigger memberships_audit
  after insert or update on public.memberships
  for each row execute function private.audit_membership();

create function private.audit_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old text := coalesce(nullif(old.full_name, ''), old.email);
  v_new text := coalesce(nullif(new.full_name, ''), new.email);
begin
  if old.activated_at is null and new.activated_at is not null then
    perform private.audit_write(null, 'conta_criada', new.id, format('Conta de %s criada.', v_new));
  elsif old.activated_at is not null then
    if old.active <> new.active then
      perform private.audit_write(null, case when new.active then 'conta_reativada' else 'conta_desativada' end, new.id,
        format('Conta de %s %s.', v_new, case when new.active then 'reativada' else 'desativada' end));
    end if;
    if old.full_name is distinct from new.full_name then
      perform private.audit_write(null, 'conta_editada', new.id,
        format('Nome da conta alterado de %s para %s.', v_old, v_new));
    end if;
  end if;
  if old.is_general_admin <> new.is_general_admin then
    perform private.audit_write(null, case when new.is_general_admin then 'admin_concedido' else 'admin_removido' end, new.id,
      format('Papel de administrador geral %s %s.', case when new.is_general_admin then 'concedido a' else 'removido de' end, v_new));
  end if;
  return new;
end
$$;

create trigger profiles_audit
  after update on public.profiles
  for each row execute function private.audit_profile();

-- Auditoria é append-only para TODOS os papéis (inclusive service_role): nada edita ou apaga.
create function private.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Registros de auditoria não podem ser alterados nem apagados.' using errcode = 'PT403';
end
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_immutable();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_immutable();

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_general_admin(), private.can_see_store(uuid), private.has_permission(uuid, text, text),
  private.actor_role(uuid), private.active_uid()
  to authenticated;
grant execute on all functions in schema private to service_role;
