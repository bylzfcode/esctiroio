// Dinheiro em CENTAVOS (inteiros), moeda BRL. Nenhuma operação usa ponto flutuante: a leitura do que a
// pessoa digita e a formatação trabalham só com texto e inteiros, para que 0,1 + 0,2 seja sempre 0,30.

/** Limite igual ao do servidor (R$ 999.999.999,99). */
export const MAX_CENTS = 99_999_999_999;

/**
 * Lê "1.234,56", "1234,5", "R$ 10", "0,05" e devolve centavos; ou null se inválido
 * (vazio, negativo, letras, mais de 2 casas decimais, zero a menos que `allowZero`, acima do limite).
 */
export function parseBRL(input: string, opts: { allowZero?: boolean } = {}): number | null {
  const raw = input.replace(/\s/g, '').replace(/^R\$/i, '');
  if (!raw || /[^0-9.,]/.test(raw)) return null;
  let intPart: string;
  let frac = '';
  if (raw.includes(',')) {
    const parts = raw.split(',');
    if (parts.length !== 2) return null;
    // vírgula = decimal; pontos só como separador de milhar (grupos de 3)
    const [i, f] = parts as [string, string];
    if (i.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(i)) return null;
    intPart = i.replace(/\./g, '');
    frac = f;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    intPart = raw.replace(/\./g, ''); // 1.234 = mil duzentos e trinta e quatro
  } else if (/^\d+\.\d{1,2}$/.test(raw)) {
    [intPart, frac] = raw.split('.') as [string, string]; // 10.5 = dez e cinquenta
  } else if (/^\d+$/.test(raw)) {
    intPart = raw;
  } else return null;
  if (!/^\d+$/.test(intPart) || (frac !== '' && !/^\d{1,2}$/.test(frac))) return null;
  if (intPart.length > 12) return null;
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  if (cents === 0 && !opts.allowZero) return null;
  return cents;
}

/** 123456 -> "R$ 1.234,56" (aritmética inteira). */
export function formatBRL(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${reais},${centavos}`;
}

/** 123456 -> "1234,56" (valor inicial de campos de edição). */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
