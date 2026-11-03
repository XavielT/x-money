import { probe } from '../../supabase/functions/xmoney-api/lib/probe.ts';
describe('probe', () => { it('imports with .ts ext', () => { expect(probe).toBe(1); }); });
