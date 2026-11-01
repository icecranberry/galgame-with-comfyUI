export function splitAngelPersona(value) {
  const text = String(value || '')
  const heading = /^##[ \t]*你的外观[ \t]*\r?$/m.exec(text)
  if (!heading) return { persona: text.trimEnd(), appearance: '', tail: '' }
  const start = heading.index + heading[0].length
  const rest = text.slice(start)
  const next = /\n##[ \t]+/.exec(rest)
  return { persona: text.slice(0, heading.index).trimEnd(), appearance: rest.slice(0, next ? next.index : undefined).trim(), tail: next ? rest.slice(next.index) : '' }
}

export function composeAngelPersona({ persona, appearance, tail = '' }) {
  return `${persona.trimEnd()}${appearance.trim() ? `\n\n## 你的外观\n${appearance.trim()}` : ''}${tail}`
}
