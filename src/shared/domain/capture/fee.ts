// The bank's own tax printed in a notice or an email ("Impuestos: DOP 4.00" on a Banreservas transfer), read
// from the text itself so it never depends on the AI having returned it. It is NOT part of the amount: the
// bank takes it from the account on top. The ITBIS of an invoice is a different thing and is never read here
// (it is data of the receipt, not a charge of the bank). Pure.
const LABEL = /\bimpuestos?(?:\s+dgii)?(?:\s+\d[\d.,]*\s*%)?\s*[:\-]?\s*((?:dop|rd\s*\$|us\s*\$|usd)?\s*\d[\d.,]*\d|(?:dop|rd\s*\$|us\s*\$|usd)?\s*\d)/i;

// "DOP 4.00" as printed, or undefined when the text states no bank tax
export function bankTaxInText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = LABEL.exec(text.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const found = m?.[1]?.replace(/\s+/g, ' ').trim();
  return found || undefined;
}
