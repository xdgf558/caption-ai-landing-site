import { readMusicMembershipEntry, musicMembershipHref, MUSIC_RETURN_HASH } from '../music/navigation.js';
import { musicText } from './musicMessages.js';

export function mountMusicMemberReturn(root, { locale, search = globalThis.location.search } = {}) {
  const t = musicText(locale), returnPath = readMusicMembershipEntry(search);
  if (!returnPath) return null;
  root.hidden = false;
  root.querySelector('a').href = returnPath + MUSIC_RETURN_HASH;
  root.querySelector('a').textContent = t('返回音乐');
  root.querySelector('p').textContent = t('返回音乐后会重新核验收听资格，并保持暂停。');
  return { returnPath, checkoutReturnPath: musicMembershipHref(locale, new URL(returnPath, 'https://return.invalid').search) };
}
