import { BankModel } from '../models/bank.model';

// Bank catalog: Dominican Republic banks first, then international options.
// Colors are approximate brand colors; badges render initials over them.
export const BANKS_MOCK: BankModel[] = [
  { id: 'banreservas', name: 'Banreservas', short: 'BR', color: '#0033a0', textColor: '#ffffff' },
  { id: 'popular', name: 'Banco Popular', short: 'BP', color: '#0067b1', textColor: '#ffffff' },
  { id: 'bhd', name: 'Banco BHD', short: 'BHD', color: '#00954d', textColor: '#ffffff' },
  { id: 'scotiabank', name: 'Scotiabank', short: 'SB', color: '#ec111a', textColor: '#ffffff' },
  { id: 'santa-cruz', name: 'Banco Santa Cruz', short: 'BSC', color: '#009b77', textColor: '#ffffff' },
  { id: 'banesco', name: 'Banesco', short: 'BN', color: '#007a33', textColor: '#ffffff' },
  { id: 'caribe', name: 'Banco Caribe', short: 'BC', color: '#f58220', textColor: '#121212' },
  { id: 'apap', name: 'APAP', short: 'AP', color: '#e4002b', textColor: '#ffffff' },
  { id: 'promerica', name: 'Promerica', short: 'PM', color: '#008542', textColor: '#ffffff' },
  { id: 'lafise', name: 'Banco Lafise', short: 'LF', color: '#00693c', textColor: '#ffffff' },
  { id: 'ademi', name: 'Banco Ademi', short: 'AD', color: '#c8102e', textColor: '#ffffff' },
  { id: 'vimenca', name: 'Banco Vimenca', short: 'VM', color: '#da291c', textColor: '#ffffff' },
  { id: 'bdi', name: 'Banco BDI', short: 'BDI', color: '#1b365d', textColor: '#ffffff' },
  { id: 'qik', name: 'Qik Banco Digital', short: 'QIK', color: '#6e2585', textColor: '#ffffff' },
  { id: 'paypal', name: 'PayPal', short: 'PP', color: '#003087', textColor: '#ffffff' },
  { id: 'binance', name: 'Binance', short: 'BNB', color: '#f0b90b', textColor: '#121212' },
  { id: 'other', name: 'Other', short: '🏦', color: '#455a64', textColor: '#ffffff' },
];

export function bankById(id: string | undefined): BankModel | undefined {
  return id ? BANKS_MOCK.find((b) => b.id === id) : undefined;
}
