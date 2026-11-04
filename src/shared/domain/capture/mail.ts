// The sender filter of the mail capture: plain addresses or domains only. The app never invents a
// bank address; the list starts empty and the user fills it. Pure.
const SENDER = /^[a-z0-9@._+-]{3,80}$/;

export function cleanSenders(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim().toLowerCase();
    if (SENDER.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 20);
}

// "avisos@banco.example, banco2.example" typed in one field -> a clean list
export const parseSenderText = (text: string): string[] => cleanSenders(text.split(/[\s,;]+/).filter(Boolean));
