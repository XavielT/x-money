// Reading the notification a bank app posted on the phone, WITHOUT any AI: bank notices are short and
// formulaic, so the amount, the currency, the card digits and the kind come from the text itself. It
// only finds what is certain; anything it cannot find is left empty for the user to fill in the tray.
// A notification that carries no amount or does not look like a movement (a promotion, a code, a
// login notice) returns null: it never becomes a draft. Pure.
import { RawTransaction } from './schema';
import { currencyOf } from './amount';

export interface BankNotification {
  pkg: string;
  title: string;
  text: string;
  postedAt: number; // epoch ms, as Android reports it
}

// Names as in the app's bank catalog (data/banks.ts), so the draft resolves to the catalog bank
export const BANK_OF_PACKAGE: Readonly<Record<string, string>> = {
  'com.popular.app.android': 'Banco Popular',
  'com.banreservas.tubancoappmobile': 'Banreservas',
  'com.bhdleon.tdcdigital': 'Banco BHD',
  'com.artech.infocorp_bhd.bhd': 'Banco BHD',
};

export const isBankPackage = (pkg: string): boolean => pkg in BANK_OF_PACKAGE;

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const AMOUNT = /(?:rd\s*\$|us\s*\$|usd|dop|\$)\s*(\d[\d.,]*\d|\d)/gi;
const BALANCE_WORDS = /(balance|saldo|disponible|limite|credito disponible)/;

// The first amount that is not a balance ("... Balance disponible RD$ 5,000.00" is not the movement)
function amountOf(original: string): string | undefined {
  const flat = norm(original);
  for (const m of original.matchAll(AMOUNT)) {
    const start = m.index ?? 0;
    if (BALANCE_WORDS.test(flat.slice(Math.max(0, start - 28), start))) continue;
    return m[0].replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

// The 4 digits that name the card or account, trying the most specific wording first
export function cardDigitsIn(text: string): string | undefined {
  const four = '(?<!\\d)(\\d{4})(?!\\d)';
  const patterns = [
    new RegExp(`tarjeta[^\\d\\n]{0,45}?[*x•.\\s]*${four}`, 'i'),
    new RegExp(`(?:terminad[ao]s?\\s+en|terminacion|termina\\s+en|ultimos\\s+4\\s+digitos)[^\\d]{0,6}${four}`, 'i'),
    new RegExp(`[*x•]{2,}\\s*${four}`, 'i'),
    new RegExp(`cuenta[^\\d\\n]{0,30}?[*x•.\\s]*${four}`, 'i'),
  ];
  const flat = norm(text);
  for (const re of patterns) {
    const m = re.exec(flat);
    if (m) return m[1];
  }
  return undefined;
}

const NOT_A_MERCHANT = /^(su|tu|la|el|mi|una?|cuenta|tarjeta|linea|app|banca|nuestro|este)\b/i;

function merchantOf(original: string): string | undefined {
  const labeled = /(?:comercio|establecimiento|lugar|detalle|descripcion|descripción|beneficiario)\s*[:\-]\s*([^\n.]{2,50})/i.exec(original);
  const viaEn = /\ben\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ&'*\-\s]{1,49}?)(?=\s+(?:el|con|a\s+las|a\s+la|por|desde|usando|mediante|fecha)\b|[.\n,;]|$)/.exec(original);
  const pick = (labeled?.[1] ?? viaEn?.[1])?.trim();
  if (!pick || NOT_A_MERCHANT.test(pick) || /^\d/.test(pick)) return undefined;
  return pick.slice(0, 60);
}

type Kind = RawTransaction['kind'];

// Order matters: a deposit is judged before a purchase because both can say "su cuenta"
function kindOf(flat: string): Kind | null {
  if (/(devolucion|reverso|reversado|reembolso|anulacion)/.test(flat)) return 'unknown'; // a refund is the user's call
  if (/(deposit|acredit|abono a su|recibio una transferencia|transferencia recibida|nomina|credito a su cuenta|has recibido|ha recibido)/.test(flat)) return 'income';
  if (/pago\b.*\btarjeta|tarjeta.*\bpago\b/.test(flat) && !/(compra|consumo)/.test(flat)) return 'unknown';
  if (/(compra|consumo|retiro|debito|cargo|avance de efectivo|pagaste|pago de|pago a|pago en|pago realizado)/.test(flat)) return 'expense';
  if (/transferencia/.test(flat)) return 'unknown'; // sent: an expense or a move between own accounts, the user says which
  return null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
// The phone's local calendar day of the notification
export const localDateOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function readBankNotification(n: BankNotification): RawTransaction | null {
  const bankName = BANK_OF_PACKAGE[n.pkg];
  if (!bankName) return null;
  const original = `${n.title}\n${n.text}`.trim();
  const flat = norm(original);
  const kind = kindOf(flat);
  const amountText = amountOf(original);
  if (!kind || !amountText) return null; // not a movement: never a draft

  const item: RawTransaction = { kind, amountText, bankName, confidence: { amount: 0.9, kind: kind === 'unknown' ? 0.3 : 0.7 } };
  const currency = currencyOf(amountText);
  if (currency) item.currencyHint = currency;
  const last4 = cardDigitsIn(original);
  if (last4) item.accountLast4 = last4;
  item.accountHint = bankName;
  const merchant = merchantOf(original);
  if (merchant) item.counterparty = merchant;
  // a date printed in the notice wins; otherwise the day the phone received it
  const printed = /\b(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\b/.exec(original);
  item.dateText = printed ? printed[1] : localDateOf(n.postedAt);
  item.description = (merchant ?? n.title ?? 'Bank notification').trim().slice(0, 160) || 'Bank notification';
  item.notes = 'Read from a bank notification on this phone, without AI: check every field.';
  return item;
}
