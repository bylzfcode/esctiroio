// Validação de comprovantes NO NAVEGADOR (conveniência e mensagens claras). A validação autoritativa é do
// servidor: limites do bucket, políticas por loja e conferência dos metadados em attach_payment_receipt.

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];
export const RECEIPT_ACCEPT = RECEIPT_TYPES.join(',');
export const EXT: Record<ReceiptType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

function sniff(b: Uint8Array): ReceiptType | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'application/pdf'; // %PDF
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'; // RIFF....WEBP
  return null;
}

/** Devolve a mensagem de erro (ou null se o arquivo é aceitável) e o tipo real detectado pelos primeiros bytes. */
export async function validateReceiptFile(file: Pick<File, 'size' | 'type' | 'slice'>): Promise<{ error: string | null; type: ReceiptType | null }> {
  if (file.size <= 0) return { error: 'O arquivo está vazio.', type: null };
  if (file.size > RECEIPT_MAX_BYTES) return { error: 'O arquivo deve ter no máximo 5 MB.', type: null };
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return { error: 'Use uma imagem (JPG, PNG ou WebP) ou um PDF.', type: null };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const real = sniff(head);
  if (real !== file.type) return { error: 'O conteúdo do arquivo não corresponde a uma imagem ou PDF válido.', type: null };
  return { error: null, type: real };
}

/** Nome apresentável (sem caminho) e seguro para o campo de texto. */
export function displayName(name: string): string {
  return name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 150) || 'comprovante';
}
