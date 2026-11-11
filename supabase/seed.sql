-- SOMENTE DESENVOLVIMENTO LOCAL. Executado por `supabase db reset` (nunca por migração).
-- Contém apenas lojas FICTÍCIAS. As contas fictícias são criadas por `npm run dev:seed`
-- (a API de administração do Auth é o caminho correto para criar usuários com senha).

-- Trava: recusa rodar em um banco que já tenha usuários reais.
do $$
begin
  if exists (select 1 from auth.users where email !~ '@dev\.example$') then
    raise exception 'seed.sql recusado: este banco tem usuários reais. O seed é só para desenvolvimento local.';
  end if;
end $$;

insert into public.stores (code, name) values
  ('A01', 'Loja Alfa'),
  ('B02', 'Loja Beta'),
  ('G03', 'Loja Gama'),
  ('D04', 'Loja Delta')
on conflict (code) do nothing;
