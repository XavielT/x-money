// Dates read from a document or a transcript. Pure. Dominican format: day/month/year. A date the
// text does not give is never invented here; the caller decides what to assume and says so.
import { addDays, daysBetween, isValidIsoDate } from '../dates';

export interface ParsedDate {
  iso: string;
  time?: string; // HH:mm, 24 hours
  doubt?: 'future'; // more than one day after today
}

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1, febrero: 2, feb: 2, february: 2, marzo: 3, mar: 3, march: 3, abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5, junio: 6, jun: 6, june: 6, julio: 7, jul: 7, july: 7, agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, september: 9, octubre: 10, oct: 10, october: 10, noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};

const strip = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n: number): string => String(n).padStart(2, '0');

function timeOf(text: string): string | undefined {
  const m = /(?:^|[^\d])(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i.exec(text);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = (m[3] ?? '').replace(/[.\s]/g, '').toLowerCase();
  if (min > 59 || h > 23) return undefined;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return `${pad(h)}:${pad(min)}`;
}

const fullYear = (y: number): number => (y < 100 ? 2000 + y : y);

// Without a year: the current one, or the previous one when that would land in the future
function withoutYear(day: number, month: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const here = `${year}-${pad(month)}-${pad(day)}`;
  const candidate = isValidIsoDate(here) ? here : null;
  if (candidate && candidate <= today) return candidate;
  const before = `${year - 1}-${pad(month)}-${pad(day)}`;
  if (isValidIsoDate(before)) return before;
  return candidate; // 29 Feb of a non-leap previous year: keep the current-year reading
}

export function parseDate(text: string, today: string): ParsedDate | null {
  const source = strip(text ?? '').trim();
  if (!source) return null;
  const time = timeOf(source);
  let iso: string | null = null;

  const relative = /\b(hoy|ayer|anteayer|today|yesterday)\b/.exec(source);
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(source))) {
    iso = `${m[1]}-${m[2]}-${m[3]}`;
  } else if ((m = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/.exec(source))) {
    iso = `${fullYear(Number(m[3]))}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`; // day/month/year
  } else if ((m = /\b(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?\s*(?:de\s+|,\s*)?(\d{4})\b/.exec(source)) && MONTHS[m[2]]) {
    iso = `${m[3]}-${pad(MONTHS[m[2]])}-${pad(Number(m[1]))}`;
  } else if ((m = /\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(source)) && MONTHS[m[1]]) {
    iso = `${m[3]}-${pad(MONTHS[m[1]])}-${pad(Number(m[2]))}`;
  } else if ((m = /\b(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\b/.exec(source)) && MONTHS[m[2]]) {
    iso = withoutYear(Number(m[1]), MONTHS[m[2]], today);
  } else if (relative) {
    iso = relative[1] === 'hoy' || relative[1] === 'today' ? today : relative[1] === 'anteayer' ? addDays(today, -2) : addDays(today, -1);
  }
  if (!iso || !isValidIsoDate(iso)) return null;
  const out: ParsedDate = { iso };
  if (time) out.time = time;
  if (daysBetween(today, iso) > 1) out.doubt = 'future';
  return out;
}
