import type { JunoCard as Card } from '@veyvox/shared/src/juno';
import { junoCardUrl, resolveJunoDubbing, JUNO_ASSETS } from './junoAssets';
import { useJunoPreferences } from '../../stores/junoPreferences';
import { useTranslation } from 'react-i18next';
export { JUNO_PALETTE } from './junoAssets';

/** The enclosing localized control owns the accessible card name. */
export function JunoCard({ card, back = false, floured = false }: { card?: Card; back?: boolean; floured?: boolean }) {
  const dubbing = useJunoPreferences(s => s.dubbingLanguage);
  const { i18n } = useTranslation('voice');
  const marked = card?.floured || floured;
  const image = <img className={marked ? 'juno-card-face' : 'juno-card-art'} src={junoCardUrl(card, back, resolveJunoDubbing(dubbing, i18n.resolvedLanguage ?? i18n.language))} alt="" aria-hidden="true"
    width="720" height="1056" draggable={false} decoding="async" />;
  return marked ? <span className="juno-card-art juno-floured-card" aria-hidden="true">{image}
    <img className="juno-card-flour" src={JUNO_ASSETS.flour} alt="" width="720" height="1056" draggable={false} decoding="async" />
  </span> : image;
}
