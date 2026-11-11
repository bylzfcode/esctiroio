-- Financeiro (parte 1) · Comprovantes: bucket PRIVADO no Supabase Storage + vínculo à liquidação.
--
--  * Caminho obrigatório: {loja}/{conta}/{pagamento}/{arquivo}. Só quem tem "confirmar liquidação" na loja
--    envia, e só para um pagamento existente, não estornado e ainda sem comprovante.
--  * Leitura (visualizar/baixar): quem tem "visualizar" em Financeiro na loja.
--  * Sem política de UPDATE/DELETE: ninguém sobrescreve nem apaga comprovantes.
--  * Tipo e tamanho: limites do bucket (aplicados pelo Storage) + conferência em attach_payment_receipt
--    com os metadados que o PRÓPRIO Storage gravou (não os informados pelo cliente).
--  * Anexar NÃO confirma envio: são colunas e permissões separadas.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function private.receipt_path_re(p_store uuid, p_account uuid, p_payment uuid) returns text
language sql immutable set search_path = '' as $$
  select '^' || p_store::text || '/' || p_account::text || '/' || p_payment::text || '/[A-Za-z0-9._-]{1,100}$'
$$;

create function private.can_read_receipt(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then private.has_permission(split_part(p_name, '/', 1)::uuid, 'finance', 'view') else false end
$$;

create function private.can_upload_receipt(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ok boolean;
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if p_name !~ ('^' || uuid_re || '/' || uuid_re || '/' || uuid_re || '/[A-Za-z0-9._-]{1,100}$') then return false; end if;
  select exists (
    select 1 from public.finance_payments p
    where p.id = split_part(p_name, '/', 3)::uuid and p.account_id = split_part(p_name, '/', 2)::uuid
      and p.store_id = split_part(p_name, '/', 1)::uuid and p.reversed_at is null and p.receipt_path is null
      and private.has_permission(p.store_id, 'finance', 'settle')) into v_ok;
  return v_ok;
end
$$;

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and private.can_read_receipt(name));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and private.can_upload_receipt(name));

-- Vincula o arquivo já enviado à liquidação (e só a ela).
create function public.attach_payment_receipt(p_payment_id uuid, p_file_path text, p_file_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.finance_payments; v_obj record; v_mime text; v_size bigint; v_name text := btrim(coalesce(p_file_name, ''));
begin
  select * into v_p from public.finance_payments p where p.id = p_payment_id for update;
  if not found then perform private.fail('PT404', 'Pagamento não encontrado.'); end if;
  perform private.finance_require(v_p.store_id, 'settle');
  if v_p.reversed_at is not null then perform private.fail('PT409', 'Este pagamento foi estornado.'); end if;
  if v_p.receipt_path is not null then perform private.fail('PT409', 'Este pagamento já tem comprovante anexado.'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 150 then perform private.fail('PT422', 'Nome do arquivo inválido.', 'file'); end if;
  if p_file_path is null or p_file_path !~ private.receipt_path_re(v_p.store_id, v_p.account_id, v_p.id) then
    perform private.fail('PT422', 'Caminho do arquivo inválido para este pagamento.', 'file');
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'receipts' and o.name = p_file_path;
  if not found then perform private.fail('PT422', 'Arquivo não encontrado no armazenamento. Envie novamente.', 'file'); end if;
  v_mime := v_obj.metadata ->> 'mimetype';
  v_size := (v_obj.metadata ->> 'size')::bigint;
  if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    perform private.fail('PT422', 'Tipo de arquivo não permitido. Use imagem (JPG, PNG, WebP) ou PDF.', 'file');
  end if;
  if v_size is null or v_size <= 0 or v_size > 5242880 then perform private.fail('PT422', 'O arquivo deve ter no máximo 5 MB.', 'file'); end if;
  update public.finance_payments
     set receipt_path = p_file_path, receipt_name = v_name, receipt_mime = v_mime, receipt_size = v_size,
         receipt_attached_at = clock_timestamp(), receipt_attached_by = auth.uid(), receipt_attached_by_name = private.actor_display_name()
   where id = v_p.id;
end
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_general_admin(), private.can_see_store(uuid), private.has_permission(uuid, text, text),
  private.actor_role(uuid), private.active_uid(), private.today_sp(timestamptz),
  private.can_read_receipt(text), private.can_upload_receipt(text)
  to authenticated;
grant execute on all functions in schema private to service_role;

revoke all on function public.attach_payment_receipt(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.attach_payment_receipt(uuid, text, text) to authenticated;
