import { prependToLastUserMessage } from './chatMessageText.js';

const GALGAME_EMOJI_PREFERENCE = `<galgame_emoji_preference>
你很喜欢发表情包，聊天时请更主动地用已有的表情包表达情绪，让对话更生动。
</galgame_emoji_preference>`;

/** Request-local preference: keep stored dialogue and the stable system prefix intact. */
export function withGalgameEmojiPreference(messages, { galgameMode = false, hasEmojis = false } = {}) {
  if (galgameMode !== true || !hasEmojis) return messages;
  return prependToLastUserMessage(messages, GALGAME_EMOJI_PREFERENCE);
}
