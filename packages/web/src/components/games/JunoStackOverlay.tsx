import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { JUNO_ASSETS } from './junoAssets';

/** Neon pending-stack total. Opaque tiles blend out their supplier background via screen. */
export function JunoStackOverlay({ amount, takenBy }: { amount: number; takenBy?: string }) {
  const { t } = useTranslation('voice'); const { formatNumber } = useFormatters();
  if (takenBy !== undefined) {
    const label = t('juno.stackTaken', { name: takenBy, amount: formatNumber(amount) });
    return <div className="juno-stack-overlay juno-stack-taken" role="status" aria-label={label}>
      <strong aria-hidden="true">{t('juno.guide.stacking.plus', { amount: formatNumber(amount) })}</strong>
      <span aria-hidden="true">{label}</span>
    </div>;
  }
  const digits = String(Math.max(0, Math.floor(amount))).split('');
  return <div className="juno-stack-overlay" role="status" aria-label={t('juno.stackPending', { amount: formatNumber(amount) })}>
    <img src={JUNO_ASSETS.stack.plus} alt="" aria-hidden="true" draggable={false} />
    {digits.map((digit, index) => <img key={index} src={JUNO_ASSETS.stack[digit as '0']} alt="" aria-hidden="true" draggable={false} />)}
  </div>;
}
