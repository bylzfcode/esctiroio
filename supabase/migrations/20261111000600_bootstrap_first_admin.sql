-- Etapa 2 · Criação segura do PRIMEIRO administrador geral.
--
-- Não existe cadastro público nem rota de API para isso. O dono do projeto:
--   1. cria o usuário em Authentication > Users (com e-mail confirmado) no painel do Supabase;
--   2. executa, no SQL Editor (papel postgres):  select private.bootstrap_first_general_admin('email@dominio');
-- A função só funciona enquanto NÃO existir nenhum administrador geral e não é
-- executável por anon, authenticated nem service_role.

create function private.bootstrap_first_general_admin(p_email text) returns text
language plpgsql set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_user auth.users;
begin
  perform pg_advisory_xact_lock(7710001);
  if exists (select 1 from public.profiles p where p.is_general_admin) then
    raise exception 'Já existe um administrador geral. Use a interface para conceder o papel a outras pessoas.';
  end if;
  select * into v_user from auth.users u where lower(u.email) = v_email;
  if not found then
    raise exception 'Usuário % não encontrado. Crie-o antes em Authentication > Users.', v_email;
  end if;
  insert into public.profiles (id, email, full_name, active, activated_at)
  values (v_user.id, v_email, left(btrim(coalesce(v_user.raw_user_meta_data ->> 'full_name', '')), 120), false, null)
  on conflict (id) do nothing;
  update public.profiles
     set active = true, activated_at = coalesce(activated_at, now()), is_general_admin = true
   where id = v_user.id;
  return format('Administrador geral definido: %s', v_email);
end
$$;

revoke all on function private.bootstrap_first_general_admin(text) from public, anon, authenticated, service_role;
