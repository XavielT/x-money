import { BankModel } from '../models/bank.model';

// Bank catalog: Dominican Republic banks first, then international options.
// Logos are bundled in public/banks (official favicons/logos); banks without
// a logo image fall back to an initials badge over the brand color.
export const BANKS_MOCK: BankModel[] = [
  { id: 'banreservas', name: 'Banreservas', short: 'BR', color: '#0033a0', textColor: '#ffffff', logo: 'banks/banreservas.png' },
  { id: 'popular', name: 'Banco Popular', short: 'BP', color: '#0067b1', textColor: '#ffffff', logo: 'banks/popular.png' },
  { id: 'bhd', name: 'Banco BHD', short: 'BHD', color: '#00954d', textColor: '#ffffff', logo: 'banks/bhd.png' },
  { id: 'scotiabank', name: 'Scotiabank', short: 'SB', color: '#ec111a', textColor: '#ffffff', logo: 'banks/scotiabank.png' },
  { id: 'santa-cruz', name: 'Banco Santa Cruz', short: 'BSC', color: '#009b77', textColor: '#ffffff', logo: 'banks/santa-cruz.png' },
  { id: 'banesco', name: 'Banesco', short: 'BN', color: '#007a33', textColor: '#ffffff', logo: 'banks/banesco.png' },
  { id: 'caribe', name: 'Banco Caribe', short: 'BC', color: '#f58220', textColor: '#121212', logo: 'banks/caribe.png' },
  { id: 'apap', name: 'APAP', short: 'AP', color: '#e4002b', textColor: '#ffffff', logo: 'banks/apap.png' },
  { id: 'promerica', name: 'Promerica', short: 'PM', color: '#008542', textColor: '#ffffff', logo: 'banks/promerica.png' },
  { id: 'lafise', name: 'Banco Lafise', short: 'LF', color: '#00693c', textColor: '#ffffff', logo: 'banks/lafise.png' },
  { id: 'ademi', name: 'Banco Ademi', short: 'AD', color: '#c8102e', textColor: '#ffffff', logo: 'banks/ademi.png' },
  { id: 'vimenca', name: 'Banco Vimenca', short: 'VM', color: '#da291c', textColor: '#ffffff', logo: 'banks/vimenca.png' },
  { id: 'bdi', name: 'Banco BDI', short: 'BDI', color: '#1b365d', textColor: '#ffffff' },
  { id: 'qik', name: 'Qik Banco Digital', short: 'QIK', color: '#6e2585', textColor: '#ffffff', logo: 'banks/qik.png' },
  // Digital wallets / neobank apps (initials badges until a logo lands in public/banks)
  { id: 'billet', name: 'Billet', short: 'Bt', color: '#00a7e1', textColor: '#121212' },
  { id: 'tpago', name: 'tPago', short: 'tP', color: '#00a651', textColor: '#ffffff' },
  { id: 'vimenpaga', name: 'Vimenpaga', short: 'VP', color: '#e4002b', textColor: '#ffffff' },
  { id: 'paypal', name: 'PayPal', short: 'PP', color: '#003087', textColor: '#ffffff', logo: 'banks/paypal.png' },
  { id: 'binance', name: 'Binance', short: 'BNB', color: '#f0b90b', textColor: '#121212', logo: 'banks/binance.png' },
  { id: 'other', name: 'Other', short: '🏦', color: '#455a64', textColor: '#ffffff' },
];

export function bankById(id: string | undefined): BankModel | undefined {
  return id ? BANKS_MOCK.find((b) => b.id === id) : undefined;
}
