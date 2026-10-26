import { holderRank, planPrice, upgradeOffer } from '@/features/payments/upgrade';
import { PLANS } from './payments.js';

const plans = Object.values(PLANS);

describe('upgrade pricing', () => {
  it('charges list price without a pass', () => {
    expect(holderRank([])).toBe(-1);
    expect(plans.map((p) => planPrice(p, -1))).toEqual([99, 169, 369]);
    expect(upgradeOffer(plans, -1)).toBeUndefined();
  });

  it('takes 15% off longer plans only', () => {
    const mini = holderRank(['MINI']);
    expect(plans.map((p) => planPrice(p, mini))).toEqual([99, 144, 314]);
    expect(upgradeOffer(plans, holderRank(['PRO']))).toEqual({ percentOff: 15, prices: { MAX: 314 } });
    expect(upgradeOffer(plans, holderRank(['MAX', 'MINI']))).toBeUndefined();
  });

  it('counts legacy (plan-less) passes as Pro', () => {
    expect(holderRank([null])).toBe(holderRank(['PRO']));
  });
});
