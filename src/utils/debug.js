export function focusLog(...args) {
  if (import.meta.env.DEV) console.log(...args)
}
