// What the category of a purchase usually is, from the NAME of the place, with no AI and no network. Pure.
// It only knows widely known places and fixed bank wording (gas stations, supermarket chains, pharmacies, utilities, the bank's own
// taxes, a transfer to a person). It is a suggestion: the user's own learned rule always comes first and nothing is saved until
// the user accepts. What it does not know it returns as null: it never guesses a category.
import { TransactionType } from '../models/transaction.model';

export interface MerchantHint {
  categoryId: string;
  keyword: string; // the word that made the match, for "why this suggestion"
}

// lowercase, no accents, symbols and digits' separators as single spaces: "UBER*EATS SANTO DOMINGO" -> "uber eats santo domingo"
export const normalizePlace = (s: string | undefined): string =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "shell" = the whole word; "total energ*" = a phrase whose last word may continue
const compile = (kw: string): RegExp => (kw.endsWith('*') ? new RegExp(`(?:^| )${escape(kw.slice(0, -1))}`) : new RegExp(`(?:^| )${escape(kw)}(?: |$)`));

interface Rule {
  id: string;
  keywords: readonly string[];
}

// The order matters: the first rule that matches wins ("uber eats" is delivery, plain "uber" is transport)
const EXPENSE: readonly Rule[] = [
  { id: 'cat-bank-fees', keywords: ['impuesto*', 'dgii', 'cobro imp*', 'comision*', 'cargo mensual*', 'cargo por*'] },
  { id: 'cat-fuel', keywords: ['shell', 'texaco', 'esso', 'sunix', 'total energ*', 'estacion total*', 'gasolinera*', 'combustible*', 'petrom*'] },
  { id: 'cat-delivery', keywords: ['uber eats', 'ubereats', 'pedidosya', 'pedidos ya', 'glovo', 'rappi'] },
  { id: 'cat-parking', keywords: ['parking*', 'estacionamiento*', 'parqueo*', 'peaje*', 'paso rapido'] },
  { id: 'cat-transport', keywords: ['uber', 'indriver', 'in driver', 'yango', 'taxi*'] },
  { id: 'cat-electricity', keywords: ['edeeste', 'edenorte', 'edesur'] },
  { id: 'cat-utilities', keywords: ['caasd', 'inapa', 'coraasan', 'corasaan', 'acueducto*'] },
  { id: 'cat-phone', keywords: ['claro', 'altice', 'viva', 'tricom', 'recar*'] },
  { id: 'cat-subscriptions', keywords: ['netflix', 'spotify', 'apple com bill', 'icloud', 'youtube*', 'hbo*', 'disney*', 'prime video', 'amazon prime', 'openai', 'chatgpt', 'google one'] },
  { id: 'cat-sports', keywords: ['smart fit', 'smartfit', 'gimnasio*', 'gym'] },
  { id: 'cat-health', keywords: ['farmacia*', 'farm', 'gbc', 'hidalgos', 'clinica*', 'hospital*', 'laborat*', 'medic*', 'dental*', 'dentist*', 'odont*'] },
  { id: 'cat-restaurants', keywords: ['mcdonald*', 'burger king', 'wendy*', 'pizza hut', 'kfc', 'subway', 'papa john*', 'domino*', 'teriyaki', 'restaurante*', 'restaurant*', 'cafeteria*', 'pica pollo', 'sushi'] },
  { id: 'cat-going-out', keywords: ['liquor*', 'licor*', 'bar', 'cerveceria*', 'discoteca*'] },
  { id: 'cat-groceries', keywords: ['jumbo', 'sirena', 'supermercado*', 'super mercado*', 'pricesmart', 'plaza lama', 'bravo', 'sm bravo', 'hiper ole', 'hiperole', 'carrefour', 'la cadena', 'colmado*', 'minimarket', 'mini market'] },
  { id: 'cat-vehicle-maintenance', keywords: ['taller*', 'repuesto*', 'lubricante*', 'gomera*', 'neumatic*', 'car wash', 'lavadero*'] },
  { id: 'cat-shopping', keywords: ['temu', 'amazon', 'aliexpress', 'shein', 'ebay'] },
];

const INCOME: readonly Rule[] = [
  { id: 'cat-salary', keywords: ['nomina*', 'payroll', 'salario*', 'sueldo*', 'salary'] },
  { id: 'cat-reimbursements', keywords: ['reembolso*', 'reimbursement*', 'reintegro*'] },
  { id: 'cat-received-people', keywords: ['mb desde*', 'transferencia ach de*', 'transferencia de*', 'deposito de*'] },
];

// A transfer to a person ("MB a 0842189607 Daisy", "Pago ACH MB a 16024750017", "Transferencia a ..."): money you sent, not a purchase
const SENT_TO_PERSON: readonly RegExp[] = [/^(?:pago ach )?mb a \d/, /^(?:pago ach|transferencia|transf|ach) a /];

const compiled = new Map<string, RegExp>();
const re = (kw: string): RegExp => {
  let r = compiled.get(kw);
  if (!r) compiled.set(kw, (r = compile(kw)));
  return r;
};

export function hintFor(text: string | undefined, type: Extract<TransactionType, 'expense' | 'income'> = 'expense'): MerchantHint | null {
  const flat = normalizePlace(text);
  if (!flat) return null;
  if (type === 'expense') {
    const sent = SENT_TO_PERSON.find((r) => r.test(flat));
    if (sent) return { categoryId: 'cat-sent-people', keyword: 'transfer to a person' };
    for (const rule of EXPENSE) {
      const kw = rule.keywords.find((k) => re(k).test(flat));
      if (kw) return { categoryId: rule.id, keyword: kw.replace(/\*$/, '') };
    }
    return null;
  }
  for (const rule of INCOME) {
    const kw = rule.keywords.find((k) => re(k).test(flat));
    if (kw) return { categoryId: rule.id, keyword: kw.replace(/\*$/, '') };
  }
  return null;
}
