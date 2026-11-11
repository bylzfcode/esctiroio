import { describe, expect, it } from 'vitest';
import { addDaysISO, daysUntil, formatDateBR, isISODate, monthRange, todaySP } from '@/lib/dates';
import { centsToInput, formatBRL, MAX_CENTS, parseBRL } from '@/lib/money';
import { displayName, validateReceiptFile } from '@/lib/receipt';

describe('dinheiro em centavos (sem ponto flutuante)', () => {
  it.each([
    ['1.234,56', 123456], ['1234,56', 123456], ['1234,5', 123450], ['0,05', 5], ['R$ 10', 1000], ['  R$ 1.000,00 ', 100000],
    ['10', 1000], ['10.5', 1050], ['10.50', 1050], ['1.234', 123400], ['1.234.567,89', 123456789], ['999.999.999,99', MAX_CENTS],
    ['0,10', 10], ['0,20', 20], ['19,90', 1990], ['0,01', 1],
  ])('lê %s como %i centavos', (txt, cents) => expect(parseBRL(txt)).toBe(cents));

  it.each(['', 'abc', '-5', '10,999', '1,2,3', '1.2.3', '10,5a', 'R$', ',50', '1..000', '12.34.567', '1.000.00', '0', '0,00', '1000000000,00'])(
    'recusa %j', (txt) => expect(parseBRL(txt)).toBeNull());

  it('aceita zero só quando permitido', () => expect(parseBRL('0,00', { allowZero: true })).toBe(0));

  it('somas que erram em float são exatas em centavos (0,1 + 0,2 = 0,30)', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // o problema que evitamos
    expect(parseBRL('0,10')! + parseBRL('0,20')!).toBe(parseBRL('0,30'));
    expect(formatBRL(parseBRL('1.234.567,89')! * 3)).toBe('R$ 3.703.703,67');
  });

  it('formata com separadores brasileiros', () => {
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(99999999999)).toBe('R$ 999.999.999,99');
    expect(formatBRL(-250)).toBe('-R$ 2,50');
    expect(centsToInput(123456)).toBe('1234,56');
    expect(parseBRL(centsToInput(123405))).toBe(123405); // ida e volta
  });
});

describe('datas sem fuso e "hoje" em America/Sao_Paulo', () => {
  it('todaySP usa o dia civil de São Paulo (UTC-3)', () => {
    expect(todaySP(new Date('2026-03-10T02:59:59Z'))).toBe('2026-03-09');
    expect(todaySP(new Date('2026-03-10T03:00:00Z'))).toBe('2026-03-10');
    expect(todaySP(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
    expect(todaySP(new Date('2026-07-01T00:00:00Z'))).toBe('2026-06-30');
  });

  it('formata reordenando o texto, sem passar por Date (nada de deslocar um dia)', () => {
    expect(formatDateBR('2026-03-10')).toBe('10/03/2026');
    expect(formatDateBR('2026-12-31')).toBe('31/12/2026');
    expect(formatDateBR('2026-01-01')).toBe('01/01/2026');
    expect(formatDateBR('texto')).toBe('texto');
  });

  it('aritmética de calendário: dias, meses, bissexto, viradas de ano', () => {
    expect(addDaysISO('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(monthRange('2026-02-17')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02-10').to).toBe('2028-02-29');
    expect(daysUntil('2026-03-10', '2026-03-09')).toBe(-1);
    expect(daysUntil('2026-03-10', '2026-03-10')).toBe(0);
    expect(daysUntil('2026-03-10', '2026-04-10')).toBe(31);
  });

  it('valida datas reais', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('10/03/2026')).toBe(false);
  });

  it('o resultado independe do fuso do processo', () => {
    const before = process.env.TZ;
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
      process.env.TZ = tz;
      expect(formatDateBR('2026-03-10')).toBe('10/03/2026');
      expect(addDaysISO('2026-03-10', 0)).toBe('2026-03-10');
      expect(todaySP(new Date('2026-03-10T02:30:00Z'))).toBe('2026-03-09');
    }
    process.env.TZ = before;
  });
});

describe('comprovante: validação no navegador (conveniência; o servidor revalida)', () => {
  const file = (bytes: number[], type: string, pad = 0) => new Blob([new Uint8Array([...bytes, ...new Array(pad).fill(0)])], { type });
  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPG = [0xff, 0xd8, 0xff, 0xe0];
  const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

  it('aceita PDF, PNG, JPEG e WebP reais', async () => {
    expect((await validateReceiptFile(file(PDF, 'application/pdf'))).type).toBe('application/pdf');
    expect((await validateReceiptFile(file(PNG, 'image/png'))).type).toBe('image/png');
    expect((await validateReceiptFile(file(JPG, 'image/jpeg'))).type).toBe('image/jpeg');
    expect((await validateReceiptFile(file(WEBP, 'image/webp'))).type).toBe('image/webp');
  });

  it('recusa vazio, grande demais, tipo não permitido e conteúdo que não corresponde ao tipo', async () => {
    expect((await validateReceiptFile(file([], 'application/pdf'))).error).toMatch(/vazio/);
    expect((await validateReceiptFile(file(PDF, 'application/pdf', 5 * 1024 * 1024))).error).toMatch(/5 MB/);
    expect((await validateReceiptFile(file(PDF, 'text/html'))).error).toMatch(/imagem.*PDF/);
    expect((await validateReceiptFile(file(PDF, 'image/png'))).error).toMatch(/não corresponde/);
    expect((await validateReceiptFile(file([...'<html><script>'].map((c) => c.charCodeAt(0)), 'image/png'))).error).toMatch(/não corresponde/);
  });

  it('nome do arquivo sem caminho nem caracteres de controle', () => {
    expect(displayName('C:\\fotos\\nota fiscal.pdf')).toBe('nota fiscal.pdf');
    expect(displayName('../../etc/passwd')).toBe('passwd');
    expect(displayName('')).toBe('comprovante');
    expect(displayName('a'.repeat(300)).length).toBe(150);
  });
});
