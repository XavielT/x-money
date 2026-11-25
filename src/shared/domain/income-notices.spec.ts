import { IncomeSourceModel } from '../models/income-source.model';
import { transaction } from '../testing/builders';
import { plannedIncomeNotices } from './income-notices';

const payroll = (over: Partial<IncomeSourceModel> = {}): IncomeSourceModel => ({
  id: 'pay',
  name: 'Payroll',
  kind: 'payroll',
  icon: '💼',
  color: '#000',
  active: true,
  stability: 'recurring',
  schedule: { mode: 'month-days', days: [13, 28] },
  method: 'transfer',
  verifiability: 'documented',
  createdAt: '2026-01-01',
  ...over,
});

describe('the days a phone reminder fires for an expected income', () => {
  it('the 13th and the 28th of the next five weeks, in order, with a stable key', () => {
    const n = plannedIncomeNotices([payroll()], [], '2026-11-25', 35);
    expect(n.map((x) => x.at)).toEqual(['2026-11-28', '2026-12-13', '2026-12-28']);
    expect(n[0].key).toBe('income:pay:2026-11-28');
  });

  it('an inactive source and a source without a schedule never remind', () => {
    expect(plannedIncomeNotices([payroll({ active: false }), payroll({ id: 'x', schedule: undefined })], [], '2026-11-25')).toEqual([]);
  });

  it('a day that already arrived (a registered income) is not reminded again', () => {
    const arrived = transaction({ type: 'income', incomeSourceId: 'pay', date: '2026-11-28', amount: 100 });
    expect(plannedIncomeNotices([payroll()], [arrived], '2026-11-28', 10).map((x) => x.at)).toEqual([]);
  });

  it('the reminder carries no amount: only source and date', () => {
    expect(Object.keys(plannedIncomeNotices([payroll()], [], '2026-11-25')[0]).sort()).toEqual(['at', 'key', 'sourceId']);
  });
});
