// Datas financeiras: vencimento, competência e data de pagamento são DATAS (texto 'AAAA-MM-DD'), sem hora e
// sem fuso: nunca passam por `new Date('2026-03-10')` (que as deslocaria pelo fuso do navegador).
// Só o "hoje" e a apresentação de instantes usam um fuso, sempre America/Sao_Paulo.

export const TZ = 'America/Sao_Paulo';
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Dia civil atual em São Paulo, 'AAAA-MM-DD'. */
export function todaySP(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** '2026-03-10' -> '10/03/2026' (só reordena o texto). */
export function formatDateBR(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Soma dias a uma data civil (aritmética de calendário em UTC: sem horário de verão, sem deslocamento). */
export function addDaysISO(iso: string, days: number): string {
  const m = ISO.exec(iso)!;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

/** Primeiro e último dia do mês da data informada. */
export function monthRange(iso: string): { from: string; to: string } {
  const m = ISO.exec(iso)!;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}

/** Quantos dias faltam (negativo = passou) entre `today` e `due`, em dias civis. */
export function daysUntil(today: string, due: string): number {
  const a = ISO.exec(today)!;
  const b = ISO.exec(due)!;
  return Math.round((Date.UTC(+b[1]!, +b[2]! - 1, +b[3]!) - Date.UTC(+a[1]!, +a[2]! - 1, +a[3]!)) / 86_400_000);
}
